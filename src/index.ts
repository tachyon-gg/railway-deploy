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
import { fetchCurrentState, resolveEnvironmentId, resolveProjectId } from "./railway/queries.js";
import { applyChangeset } from "./reconcile/apply.js";
import { computeChangeset } from "./reconcile/diff.js";
import { printApplyResult, printChangeset } from "./reconcile/format.js";

interface CliOptions {
  apply?: boolean;
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
  // Uses dotenv convention: existing env vars take precedence over .env file
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
    // Use lenient mode so missing ${ENV_VAR} references don't fail validation
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
  } = loadProjectConfig(configPath, opts.environment);

  logger.info(`Project: ${projectName}`);
  logger.info(`Environment: ${environmentName}`);
  logger.info(`Services: ${Object.keys(desiredState.services).join(", ")}`);

  // Phase 1: Connect to Railway and fetch current state
  const client = createClient(token);

  logger.info("\nResolving project and environment...");
  const projectId = await resolveProjectId(client, projectName);
  const environmentId = await resolveEnvironmentId(client, projectId, environmentName, opts.apply);

  desiredState.projectId = projectId;
  desiredState.environmentId = environmentId;

  logger.info(`Project ID: ${projectId}`);
  logger.info(`Environment ID: ${environmentId}`);

  logger.info("\nFetching current state from Railway...");
  const {
    state: currentState,
    domainMap,
    volumeMap,
    serviceDomainMap,
    tcpProxyMap,
  } = await fetchCurrentState(client, projectId, environmentId);

  logger.info(`Found ${Object.keys(currentState.services).length} existing service(s)`);

  // Phase 2: Compute diff
  let changeset = computeChangeset(desiredState, currentState, deletedVars, deletedSharedVars, {
    domainMap,
    volumeMap,
    serviceDomainMap,
    tcpProxyMap,
  });

  const verbose = opts.verbose ?? false;

  // Filter out data-destructive operations unless --allow-data-loss is set
  const DATA_LOSS_TYPES = new Set(["delete-volume"]);
  const dataLossChanges = changeset.changes.filter((c) => DATA_LOSS_TYPES.has(c.type));
  if (dataLossChanges.length > 0 && !opts.allowDataLoss) {
    changeset = { changes: changeset.changes.filter((c) => !DATA_LOSS_TYPES.has(c.type)) };
    logger.warn(
      `Filtered ${dataLossChanges.length} data-destructive operation(s) (use --allow-data-loss to include)`,
    );
  }

  printChangeset(changeset, {
    verbose,
    currentState,
  });

  // Phase 3: Apply (if --apply flag is set)
  if (opts.apply) {
    if (changeset.changes.length === 0) {
      logger.info("Nothing to apply.");
      process.exit(0);
    }

    // Check for destructive operations and prompt for confirmation
    const hasDestructive = changeset.changes.some(
      (c) =>
        c.type === "delete-service" ||
        c.type === "delete-volume" ||
        c.type === "delete-bucket" ||
        c.type === "delete-domain" ||
        c.type === "delete-variables" ||
        c.type === "delete-shared-variables" ||
        c.type === "delete-service-domain" ||
        c.type === "delete-tcp-proxy" ||
        c.type === "disable-static-ips",
    );

    if (hasDestructive && !opts.yes) {
      const ok = await confirm(
        "This changeset includes destructive operations (deletions). Continue?",
      );
      if (!ok) {
        logger.info("Aborted.");
        process.exit(2);
      }
    }

    logger.info("Applying changes...\n");
    const result = await applyChangeset(client, changeset, projectId, environmentId);
    printApplyResult(result);

    if (result.failed.length > 0) {
      process.exit(1);
    }
  } else {
    if (changeset.changes.length > 0) {
      logger.info("Run with --apply to execute these changes.");
      process.exit(2);
    }
  }
}

program.parse();
