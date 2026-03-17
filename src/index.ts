import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { createRequire } from "module";
import { resolve } from "path";
import { createInterface } from "readline";
import { parse as parseYaml } from "yaml";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

import { config as loadDotenv } from "dotenv";
import { loadProjectConfig } from "./config/loader.js";
import { validateProjectConfig } from "./config/schema.js";
import { logger } from "./logger.js";
import { createClient } from "./railway/client.js";
import {
  fetchEnvironmentConfig,
  fetchServiceMap,
  hasEgressGateways,
  resolveEnvironmentId,
  resolveProjectId,
} from "./railway/queries.js";
import { applyConfigDiff } from "./reconcile/apply.js";
import { buildEnvironmentConfig } from "./reconcile/config.js";
import type { DiffContext } from "./reconcile/diff.js";
import { computeConfigDiff } from "./reconcile/diff.js";
import { printApplyResult, printConfigDiff } from "./reconcile/format.js";

interface CliOptions {
  apply?: boolean;
  stage?: boolean;
  yes?: boolean;
  envFile?: string;
  verbose?: boolean;
  color?: boolean;
  validate?: boolean;
  environment?: string;
  allowDataLoss?: boolean;
}

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => {
    rl.question(`${message} (y/N) `, (answer) => {
      rl.close();
      res(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

const program = new Command()
  .name("railway-deploy")
  .description(
    `Declarative Railway infrastructure management.

Define your Railway services, variables, domains, volumes, and more in YAML,
and railway-deploy will diff against the live state and apply changes.

Examples:
  $ railway-deploy project.yaml -e production
  $ railway-deploy --apply -y -e staging project.yaml
  $ railway-deploy --validate project.yaml
  $ railway-deploy --env-file .env -e alpha --apply project.yaml

Environment:
  RAILWAY_TOKEN    Railway API token (required for all operations except --validate)

Docs: https://github.com/tachyon-gg/railway-deploy`,
  )
  .version(version)
  .argument("<config>", "path to project YAML config file")
  .option("-e, --environment <name>", "target environment (required except for --validate)")
  .option("--apply", "execute changes (default is dry-run)")
  .option("--stage", "stage changes in Railway without committing (preview in dashboard)")
  .option("--env-file <path>", "load .env file for ${VAR} resolution")
  .option("--no-color", "disable colored output")
  .option("--validate", "validate config without connecting to Railway")
  .option("-v, --verbose", "show detailed diffs with old and new values")
  .option("-y, --yes", "skip confirmation prompts for destructive operations")
  .option("--allow-data-loss", "allow operations that can cause data loss (e.g., volume deletion)")
  .action(async (configPath: string, opts: CliOptions) => {
    try {
      await run(configPath, opts);
    } catch (err) {
      logger.error(err);
      process.exit(1);
    }
  });

async function run(configPath: string, opts: CliOptions) {
  // Configure color and log level
  if (opts.color === false) {
    process.env.NO_COLOR = "1";
  }
  logger.level = opts.verbose ? 4 : 3;

  // Load .env file if specified (before any config loading)
  if (opts.envFile) {
    loadDotenv({ path: opts.envFile });
  }

  // --validate mode: validate config and exit
  if (opts.validate) {
    const absPath = resolve(configPath);
    if (!existsSync(absPath)) {
      throw new Error(`Config file not found: ${absPath}`);
    }
    const raw = readFileSync(absPath, "utf-8");
    let parsed: unknown;
    try {
      parsed = parseYaml(raw);
    } catch (err) {
      throw new Error(
        `Invalid YAML in ${absPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const config = validateProjectConfig(parsed);

    // Also try full config load to catch template/param issues
    const envsToValidate = opts.environment ? [opts.environment] : config.environments;
    for (const env of envsToValidate) {
      loadProjectConfig(configPath, env, { lenient: true });
    }

    logger.info("Config is valid.");
    process.exit(0);
  }

  // Require --environment for all non-validate operations
  if (!opts.environment) {
    logger.error("--environment (-e) is required.");
    logger.error("  Specify which environment to target: railway-deploy <config> -e <environment>");
    process.exit(1);
  }

  if (opts.apply && opts.stage) {
    logger.error("--apply and --stage are mutually exclusive.");
    process.exit(1);
  }

  const token = process.env.RAILWAY_TOKEN;
  if (!token) {
    logger.error("RAILWAY_TOKEN environment variable is required.");
    logger.error("  Set it with: export RAILWAY_TOKEN=<your-token>");
    process.exit(1);
  }

  // Phase 0: Load and resolve config
  logger.info(`Loading config: ${configPath}`);
  const {
    state: desiredState,
    deletedVars,
    deletedSharedVars,
    projectName,
    environmentName,
    allServiceNames,
  } = loadProjectConfig(configPath, opts.environment);

  logger.info(`Project: ${projectName}`);
  logger.info(`Environment: ${environmentName}`);
  logger.info(`Services: ${Object.keys(desiredState.services).join(", ")}`);

  // Phase 1: Connect to Railway
  const client = createClient(token);

  logger.info("\nResolving project and environment...");
  const projectId = await resolveProjectId(client, projectName);
  const environmentId = await resolveEnvironmentId(client, projectId, environmentName, opts.apply);

  desiredState.projectId = projectId;
  desiredState.environmentId = environmentId;

  logger.info(`Project ID: ${projectId}`);
  logger.info(`Environment ID: ${environmentId}`);

  // Phase 2: Fetch current state
  logger.info("\nFetching current state from Railway...");
  const serviceMap = await fetchServiceMap(client, projectId, environmentId);
  const currentConfig = await fetchEnvironmentConfig(client, environmentId);

  logger.info(`Found ${serviceMap.currentServiceNames.size} existing service(s)`);

  // Resolve bucket IDs in desired state
  for (const [key, bucket] of Object.entries(desiredState.buckets)) {
    const existingId = serviceMap.bucketNameToId.get(bucket.name);
    if (existingId) {
      desiredState.buckets[key] = { ...bucket, id: existingId };
    }
  }

  // Fetch egress gateway status for services that configure static_outbound_ips
  const egressByService = new Map<string, boolean>();
  const servicesWithEgress = Object.entries(desiredState.services).filter(
    ([, svc]) => svc.staticOutboundIps !== undefined,
  );
  if (servicesWithEgress.length > 0) {
    const egressResults = await Promise.allSettled(
      servicesWithEgress.map(async ([name]) => {
        const svcId = serviceMap.serviceNameToId.get(name);
        if (!svcId) return { name, hasEgress: false };
        return { name, hasEgress: await hasEgressGateways(client, svcId, environmentId) };
      }),
    );
    for (const result of egressResults) {
      if (result.status === "fulfilled") {
        egressByService.set(result.value.name, result.value.hasEgress);
      }
    }
  }

  // Phase 3: Build desired EnvironmentConfig
  const desiredConfig = buildEnvironmentConfig(desiredState, {
    serviceNameToId: serviceMap.serviceNameToId,
    volumeIdByService: serviceMap.volumeIdByService,
  });

  // Phase 4: Compute diff
  const diffCtx: DiffContext = {
    serviceIdToName: serviceMap.serviceIdToName,
    desiredState,
    allServiceNames,
    deletedSharedVars,
    deletedVars,
    egressByService,
  };

  let diff = computeConfigDiff(desiredConfig, currentConfig, diffCtx);

  const verbose = opts.verbose ?? false;

  // Filter out data-destructive operations unless --allow-data-loss is set
  if (diff.dataLossEntries.length > 0 && !opts.allowDataLoss) {
    const filtered = diff.entries.filter(
      (e) =>
        !diff.dataLossEntries.some(
          (dl) => dl.path === e.path && dl.serviceName === e.serviceName && dl.action === e.action,
        ),
    );
    diff = {
      ...diff,
      entries: filtered,
      hasDataLoss: false,
      dataLossEntries: [],
    };
    logger.warn(`Filtered data-destructive operation(s) (use --allow-data-loss to include)`);
  }

  printConfigDiff(diff, { verbose });

  // Phase 5: Apply or stage
  if (opts.apply || opts.stage) {
    const totalChanges =
      diff.entries.length + diff.servicesToCreate.length + diff.servicesToDelete.length;

    if (totalChanges === 0) {
      logger.info("Nothing to apply.");
      process.exit(0);
    }

    // Check for destructive operations and prompt for confirmation (apply only)
    if (opts.apply) {
      const hasDestructive =
        diff.servicesToDelete.length > 0 || diff.entries.some((e) => e.action === "remove");

      if (hasDestructive && !opts.yes) {
        const ok = await confirm(
          "This changeset includes destructive operations (deletions). Continue?",
        );
        if (!ok) {
          logger.info("Aborted.");
          process.exit(2);
        }
      }
    }

    logger.info(`${opts.stage ? "Staging" : "Applying"} changes...\n`);
    const result = await applyConfigDiff(
      client,
      diff,
      desiredConfig,
      projectId,
      environmentId,
      desiredState,
      serviceMap.serviceNameToId,
      { stageOnly: opts.stage },
    );
    printApplyResult(result);

    if (result.errors.length > 0) {
      process.exit(1);
    }
  } else {
    const totalChanges =
      diff.entries.length + diff.servicesToCreate.length + diff.servicesToDelete.length;
    if (totalChanges > 0) {
      logger.info("Run with --apply to execute these changes, or --stage to preview in Railway.");
      process.exit(2);
    }
  }
}

program.parse();
