import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { createInterface } from "readline";
import { parse as parseYaml } from "yaml";
import { loadEnvironmentConfig } from "./config/loader.js";
import { validateEnvironmentConfig } from "./config/schema.js";
import { loadEnvFile } from "./config/variables.js";
import { createClient } from "./railway/client.js";
import { fetchCurrentState, resolveEnvironmentId, resolveProjectId } from "./railway/queries.js";
import { applyChangeset, printApplyResult, printChangeset } from "./reconcile/apply.js";
import { computeChangeset } from "./reconcile/diff.js";

interface CliOptions {
  apply?: boolean;
  yes?: boolean;
  envFile?: string;
  verbose?: boolean;
  color?: boolean;
  validate?: boolean;
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

Usage:
  railway-deploy <config.yaml>               Dry-run — show what would change
  railway-deploy --apply <config.yaml>       Apply changes to Railway
  railway-deploy --validate <config.yaml>    Validate config without connecting

Examples:
  $ railway-deploy environments/production.yaml
  $ railway-deploy --apply -y environments/staging.yaml
  $ railway-deploy --validate environments/production.yaml
  $ railway-deploy --env-file .env --apply environments/production.yaml

Environment:
  RAILWAY_TOKEN    Railway API token (required for all operations except --validate)

Docs: https://github.com/tachyon-gg/railway-deploy`,
  )
  .version("0.2.3")
  .argument("<config>", "path to environment YAML config file")
  .option("--apply", "execute changes (default is dry-run)")
  .option("--env-file <path>", "load .env file for ${VAR} resolution")
  .option("--no-color", "disable colored output")
  .option("--validate", "validate config syntax without connecting to Railway")
  .option("-v, --verbose", "show detailed diffs with old and new values")
  .option("-y, --yes", "skip confirmation prompts for destructive operations")
  .action(async (configPath: string, opts: CliOptions) => {
    try {
      await run(configPath, opts);
    } catch (err) {
      console.error(formatError(err, opts.verbose ?? false));
      process.exit(1);
    }
  });

async function run(configPath: string, opts: CliOptions) {
  // Load .env file if specified (before any config loading)
  if (opts.envFile) {
    const envVars = loadEnvFile(opts.envFile);
    Object.assign(process.env, envVars);
  }

  // --validate mode: validate config and exit
  if (opts.validate) {
    const absPath = resolve(configPath);
    if (!existsSync(absPath)) {
      throw new Error(`Config file not found: ${absPath}`);
    }
    const raw = readFileSync(absPath, "utf-8");
    const parsed = parseYaml(raw);
    validateEnvironmentConfig(parsed);

    // Also try full config load to catch template/param issues
    // Use lenient mode so missing ${ENV_VAR} references don't fail validation
    loadEnvironmentConfig(configPath, { lenient: true });

    console.log("Config is valid.");
    process.exit(0);
  }

  const token = process.env.RAILWAY_TOKEN;
  if (!token) {
    console.error("Error: RAILWAY_TOKEN environment variable is required.");
    console.error("  Set it with: export RAILWAY_TOKEN=<your-token>");
    process.exit(1);
  }

  // Phase 0: Load and resolve config
  console.log(`Loading config: ${configPath}`);
  const {
    state: desiredState,
    deletedVars,
    deletedSharedVars,
    projectName,
    environmentName,
  } = loadEnvironmentConfig(configPath);

  console.log(`Project: ${projectName}`);
  console.log(`Environment: ${environmentName}`);
  console.log(`Services: ${Object.keys(desiredState.services).join(", ")}`);

  // Phase 1: Connect to Railway and fetch current state
  const client = createClient(token);

  console.log("\nResolving project and environment...");
  const projectId = await resolveProjectId(client, projectName);
  const environmentId = await resolveEnvironmentId(client, projectId, environmentName);

  desiredState.projectId = projectId;
  desiredState.environmentId = environmentId;

  console.log(`Project ID: ${projectId}`);
  console.log(`Environment ID: ${environmentId}`);

  console.log("\nFetching current state from Railway...");
  const {
    state: currentState,
    domainMap,
    volumeMap,
    serviceDomainMap,
    tcpProxyMap,
  } = await fetchCurrentState(client, projectId, environmentId);

  console.log(`Found ${Object.keys(currentState.services).length} existing service(s)`);

  // Phase 2: Compute diff
  const changeset = computeChangeset(
    desiredState,
    currentState,
    deletedVars,
    deletedSharedVars,
    domainMap,
    volumeMap,
    serviceDomainMap,
    tcpProxyMap,
  );

  const noColor = opts.color === false;
  const verbose = opts.verbose ?? false;

  printChangeset(changeset, {
    verbose,
    noColor,
    currentState,
  });

  // Phase 3: Apply (if --apply flag is set)
  if (opts.apply) {
    if (changeset.changes.length === 0) {
      console.log("Nothing to apply.");
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
        console.log("Aborted.");
        process.exit(2);
      }
    }

    console.log("Applying changes...\n");
    const result = await applyChangeset(client, changeset, projectId, environmentId, {
      verbose,
      noColor,
    });
    printApplyResult(result, noColor);

    if (result.failed.length > 0) {
      process.exit(1);
    }
  } else {
    if (changeset.changes.length > 0) {
      console.log("Run with --apply to execute these changes.");
      process.exit(2);
    }
  }
}

function formatError(err: unknown, verbose: boolean): string {
  if (!(err instanceof Error)) return String(err);

  const msg = err.message;

  // Zod validation errors are already formatted
  if (msg.startsWith("Invalid environment config:") || msg.startsWith("Invalid service template")) {
    return msg;
  }

  // Config/file errors
  if (msg.includes("not found") || msg.includes("Failed to read") || msg.includes("Invalid YAML")) {
    return `Error: ${msg}`;
  }

  // Railway API errors
  if (msg.includes("GraphQL") || msg.includes("request")) {
    const formatted = `Railway API error: ${msg}`;
    if (!verbose) {
      return `${formatted}\n  (run with --verbose for full stack trace)`;
    }
    return `${formatted}\n${err.stack || ""}`;
  }

  // Network errors
  if (msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT") || msg.includes("fetch failed")) {
    return `Network error: ${msg}\n  Check your RAILWAY_TOKEN and network connectivity.`;
  }

  if (verbose && err.stack) {
    return err.stack;
  }
  return `Error: ${msg}`;
}

program.parse();
