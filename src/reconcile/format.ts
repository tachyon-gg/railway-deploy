import type { Change, Changeset } from "../types/changeset.js";

// ANSI color helpers
function green(text: string, noColor: boolean): string {
  return noColor ? text : `\x1b[32m${text}\x1b[0m`;
}
function red(text: string, noColor: boolean): string {
  return noColor ? text : `\x1b[31m${text}\x1b[0m`;
}
function yellow(text: string, noColor: boolean): string {
  return noColor ? text : `\x1b[33m${text}\x1b[0m`;
}
function dim(text: string, noColor: boolean): string {
  return noColor ? text : `\x1b[2m${text}\x1b[0m`;
}

/** Patterns that indicate a variable value is sensitive */
const SENSITIVE_PATTERNS = ["PASSWORD", "SECRET", "TOKEN", "KEY", "PRIVATE", "CREDENTIAL"];

function isSensitive(key: string): boolean {
  const upper = key.toUpperCase();
  return SENSITIVE_PATTERNS.some((p) => upper.includes(p));
}

function maskValue(key: string, value: string): string {
  return isSensitive(key) ? "***" : value;
}

export function changeLabel(change: Change): string {
  switch (change.type) {
    case "create-service":
      return `create-service: ${change.name}`;
    case "delete-service":
      return `delete-service: ${change.name}`;
    case "upsert-variables":
      return `upsert-variables: ${change.serviceName} (${Object.keys(change.variables).length} vars)`;
    case "delete-variables":
      return `delete-variables: ${change.serviceName} (${change.variableNames.length} vars)`;
    case "upsert-shared-variables":
      return `upsert-shared-variables (${Object.keys(change.variables).length} vars)`;
    case "delete-shared-variables":
      return `delete-shared-variables (${change.variableNames.length} vars)`;
    case "create-domain":
      return `create-domain: ${change.serviceName} → ${change.domain}`;
    case "delete-domain":
      return `delete-domain: ${change.serviceName} → ${change.domain}`;
    case "update-service-settings":
      return `update-settings: ${change.serviceName} (${Object.keys(change.settings).join(", ")})`;
    case "create-volume":
      return `create-volume: ${change.serviceName} (${change.mount})`;
    case "delete-volume":
      return `delete-volume: ${change.serviceName}`;
    case "update-deployment-trigger": {
      const parts: string[] = [];
      if (change.branch) parts.push(`branch: ${change.branch}`);
      if (change.checkSuites !== undefined) parts.push(`checkSuites: ${change.checkSuites}`);
      return `update-deployment-trigger: ${change.serviceName} → ${parts.join(", ")}`;
    }
    case "create-service-domain":
      return `create-service-domain: ${change.serviceName}`;
    case "delete-service-domain":
      return `delete-service-domain: ${change.serviceName}`;
    case "create-tcp-proxy":
      return `create-tcp-proxy: ${change.serviceName} (port ${change.applicationPort})`;
    case "delete-tcp-proxy":
      return `delete-tcp-proxy: ${change.serviceName}`;
    case "update-service-limits":
      return `update-service-limits: ${change.serviceName}`;
    case "enable-static-ips":
      return `enable-static-ips: ${change.serviceName}`;
    case "disable-static-ips":
      return `disable-static-ips: ${change.serviceName}`;
    case "create-bucket":
      return `create-bucket: ${change.bucketName}`;
    case "delete-bucket":
      return `delete-bucket: ${change.name}`;
    default: {
      const _exhaustive: never = change;
      return `unknown: ${(_exhaustive as Change).type}`;
    }
  }
}

/**
 * Print a human-readable summary of the changeset to stdout, grouped by
 * change category (services, settings, variables, domains, volumes, buckets).
 *
 * Sensitive variable values (matching PASSWORD, SECRET, TOKEN, etc.) are
 * automatically masked. In verbose mode, old and new values are shown
 * side-by-side when `currentState` is provided.
 */
export function printChangeset(
  changeset: Changeset,
  options?: {
    verbose?: boolean;
    noColor?: boolean;
    currentState?: {
      services: Record<string, { variables: Record<string, string> }>;
      sharedVariables: Record<string, string>;
    };
  },
): void {
  const noColor = options?.noColor ?? false;
  const verbose = options?.verbose ?? false;

  if (changeset.changes.length === 0) {
    console.log(`\n${green("No changes needed", noColor)} — Railway matches desired state.\n`);
    return;
  }

  console.log(`\nChangeset (${changeset.changes.length} changes):\n`);

  // Group by type for readability
  const creates = changeset.changes.filter((c) => c.type === "create-service");
  const deletes = changeset.changes.filter((c) => c.type === "delete-service");
  const upsertVars = changeset.changes.filter((c) => c.type === "upsert-variables");
  const deleteVars = changeset.changes.filter((c) => c.type === "delete-variables");
  const sharedUpsert = changeset.changes.filter((c) => c.type === "upsert-shared-variables");
  const sharedDelete = changeset.changes.filter((c) => c.type === "delete-shared-variables");
  const domainChanges = changeset.changes.filter(
    (c) => c.type === "create-domain" || c.type === "delete-domain",
  );
  const settingsChanges = changeset.changes.filter((c) => c.type === "update-service-settings");
  const triggerChanges = changeset.changes.filter((c) => c.type === "update-deployment-trigger");
  const volumeCreates = changeset.changes.filter((c) => c.type === "create-volume");
  const volumeDeletes = changeset.changes.filter((c) => c.type === "delete-volume");
  const serviceDomainChanges = changeset.changes.filter(
    (c) => c.type === "create-service-domain" || c.type === "delete-service-domain",
  );
  const tcpProxyChanges = changeset.changes.filter(
    (c) => c.type === "create-tcp-proxy" || c.type === "delete-tcp-proxy",
  );
  const limitsChanges = changeset.changes.filter((c) => c.type === "update-service-limits");
  const staticIpChanges = changeset.changes.filter(
    (c) => c.type === "enable-static-ips" || c.type === "disable-static-ips",
  );
  const bucketCreates = changeset.changes.filter((c) => c.type === "create-bucket");
  const bucketDeletes = changeset.changes.filter((c) => c.type === "delete-bucket");

  if (creates.length > 0) {
    console.log(`  ${green("+", noColor)} CREATE services:`);
    for (const c of creates) {
      if (c.type === "create-service") {
        const src = c.source?.image || c.source?.repo || "empty";
        console.log(`    ${green("+", noColor)} ${c.name} (${src})`);
      }
    }
    console.log();
  }

  if (deletes.length > 0) {
    console.log(`  ${red("-", noColor)} DELETE services:`);
    for (const c of deletes) {
      if (c.type === "delete-service") {
        console.log(`    ${red("-", noColor)} ${c.name} ${dim(`(${c.serviceId})`, noColor)}`);
      }
    }
    console.log();
  }

  if (settingsChanges.length > 0) {
    console.log(`  ${yellow("~", noColor)} UPDATE service settings:`);
    for (const c of settingsChanges) {
      if (c.type === "update-service-settings") {
        const keys = Object.keys(c.settings).join(", ");
        console.log(`    ${yellow("~", noColor)} ${c.serviceName}: ${keys}`);
        if (verbose) {
          for (const [key, value] of Object.entries(c.settings)) {
            const currentSvc = options?.currentState?.services[c.serviceName];
            const oldVal = currentSvc ? (currentSvc as Record<string, unknown>)[key] : undefined;
            const oldStr = oldVal !== undefined ? JSON.stringify(oldVal) : "(unset)";
            const newStr = value === null ? "(unset)" : JSON.stringify(value);
            console.log(`      ${key}: ${oldStr} → ${newStr}`);
          }
        }
      }
    }
    console.log();
  }

  if (triggerChanges.length > 0) {
    console.log(`  ${yellow("~", noColor)} DEPLOYMENT TRIGGERS:`);
    for (const c of triggerChanges) {
      if (c.type === "update-deployment-trigger") {
        console.log(`    ${yellow("~", noColor)} ${c.serviceName}: branch → ${c.branch}`);
      }
    }
    console.log();
  }

  if (sharedUpsert.length > 0 || sharedDelete.length > 0) {
    console.log(`  ${yellow("~", noColor)} SHARED variables:`);
    for (const c of sharedUpsert) {
      if (c.type === "upsert-shared-variables") {
        for (const [key, value] of Object.entries(c.variables)) {
          if (verbose) {
            const oldVal = options?.currentState?.sharedVariables[key];
            const oldStr = oldVal !== undefined ? maskValue(key, oldVal) : "(unset)";
            console.log(
              `    ${green("+", noColor)} ${key}: ${dim(`"${oldStr}"`, noColor)} → ${dim(`"${maskValue(key, value)}"`, noColor)}`,
            );
          } else {
            console.log(`    ${green("+", noColor)} ${key}`);
          }
        }
      }
    }
    for (const c of sharedDelete) {
      if (c.type === "delete-shared-variables") {
        for (const name of c.variableNames) {
          console.log(`    ${red("-", noColor)} ${name}`);
        }
      }
    }
    console.log();
  }

  if (upsertVars.length > 0 || deleteVars.length > 0) {
    console.log(`  ${yellow("~", noColor)} SERVICE variables:`);
    for (const c of upsertVars) {
      if (c.type === "upsert-variables") {
        const keys = Object.keys(c.variables);
        if (verbose) {
          console.log(`    ${c.serviceName}:`);
          for (const [key, value] of Object.entries(c.variables)) {
            const currentSvc = options?.currentState?.services[c.serviceName];
            const oldVal = currentSvc?.variables[key];
            const oldStr = oldVal !== undefined ? maskValue(key, oldVal) : "(unset)";
            console.log(
              `      ${green("+", noColor)} ${key}: ${dim(`"${oldStr}"`, noColor)} → ${dim(`"${maskValue(key, value)}"`, noColor)}`,
            );
          }
        } else {
          console.log(`    ${c.serviceName}: set ${keys.length} var(s) — ${keys.join(", ")}`);
        }
      }
    }
    for (const c of deleteVars) {
      if (c.type === "delete-variables") {
        console.log(
          `    ${c.serviceName}: ${red("delete", noColor)} ${c.variableNames.length} var(s) — ${c.variableNames.join(", ")}`,
        );
      }
    }
    console.log();
  }

  if (domainChanges.length > 0) {
    console.log(`  ${yellow("~", noColor)} DOMAINS:`);
    for (const c of domainChanges) {
      if (c.type === "create-domain") {
        console.log(`    ${green("+", noColor)} ${c.serviceName}: ${c.domain}`);
      } else if (c.type === "delete-domain") {
        console.log(`    ${red("-", noColor)} ${c.serviceName}: ${c.domain}`);
      }
    }
    console.log();
  }

  if (volumeCreates.length > 0 || volumeDeletes.length > 0) {
    console.log(`  ${yellow("~", noColor)} VOLUMES:`);
    for (const c of volumeCreates) {
      if (c.type === "create-volume") {
        console.log(`    ${green("+", noColor)} ${c.serviceName}: ${c.mount}`);
      }
    }
    for (const c of volumeDeletes) {
      if (c.type === "delete-volume") {
        console.log(`    ${red("-", noColor)} ${c.serviceName}`);
      }
    }
    console.log();
  }

  if (serviceDomainChanges.length > 0) {
    console.log(`  ${yellow("~", noColor)} RAILWAY DOMAINS:`);
    for (const c of serviceDomainChanges) {
      if (c.type === "create-service-domain") {
        const port = c.targetPort ? ` (port ${c.targetPort})` : "";
        console.log(`    ${green("+", noColor)} ${c.serviceName}${port}`);
      } else if (c.type === "delete-service-domain") {
        console.log(`    ${red("-", noColor)} ${c.serviceName}`);
      }
    }
    console.log();
  }

  if (tcpProxyChanges.length > 0) {
    console.log(`  ${yellow("~", noColor)} TCP PROXIES:`);
    for (const c of tcpProxyChanges) {
      if (c.type === "create-tcp-proxy") {
        console.log(`    ${green("+", noColor)} ${c.serviceName}: port ${c.applicationPort}`);
      } else if (c.type === "delete-tcp-proxy") {
        console.log(`    ${red("-", noColor)} ${c.serviceName}`);
      }
    }
    console.log();
  }

  if (limitsChanges.length > 0) {
    console.log(`  ${yellow("~", noColor)} RESOURCE LIMITS:`);
    for (const c of limitsChanges) {
      if (c.type === "update-service-limits") {
        const parts: string[] = [];
        if (c.limits.memoryGB !== undefined)
          parts.push(`memory: ${c.limits.memoryGB ?? "unset"}GB`);
        if (c.limits.vCPUs !== undefined) parts.push(`vCPUs: ${c.limits.vCPUs ?? "unset"}`);
        console.log(`    ${yellow("~", noColor)} ${c.serviceName}: ${parts.join(", ")}`);
      }
    }
    console.log();
  }

  if (staticIpChanges.length > 0) {
    console.log(`  ${yellow("~", noColor)} STATIC OUTBOUND IPS:`);
    for (const c of staticIpChanges) {
      if (c.type === "enable-static-ips") {
        console.log(`    ${green("+", noColor)} ${c.serviceName}: enable`);
      } else if (c.type === "disable-static-ips") {
        console.log(`    ${red("-", noColor)} ${c.serviceName}: disable`);
      }
    }
    console.log();
  }

  if (bucketCreates.length > 0 || bucketDeletes.length > 0) {
    console.log(`  ${yellow("~", noColor)} BUCKETS:`);
    for (const c of bucketCreates) {
      if (c.type === "create-bucket") {
        console.log(`    ${green("+", noColor)} ${c.bucketName}`);
      }
    }
    for (const c of bucketDeletes) {
      if (c.type === "delete-bucket") {
        console.log(`    ${red("-", noColor)} ${c.name}`);
      }
    }
    console.log();
  }

  // Summary line
  const createCount =
    creates.length +
    volumeCreates.length +
    bucketCreates.length +
    serviceDomainChanges.filter((c) => c.type === "create-service-domain").length +
    tcpProxyChanges.filter((c) => c.type === "create-tcp-proxy").length +
    staticIpChanges.filter((c) => c.type === "enable-static-ips").length;
  const updateCount =
    settingsChanges.length +
    triggerChanges.length +
    limitsChanges.length +
    upsertVars.length +
    sharedUpsert.length +
    domainChanges.filter((c) => c.type === "create-domain").length;
  const deleteCount =
    deletes.length +
    deleteVars.length +
    sharedDelete.length +
    volumeDeletes.length +
    bucketDeletes.length +
    domainChanges.filter((c) => c.type === "delete-domain").length +
    serviceDomainChanges.filter((c) => c.type === "delete-service-domain").length +
    tcpProxyChanges.filter((c) => c.type === "delete-tcp-proxy").length +
    staticIpChanges.filter((c) => c.type === "disable-static-ips").length;

  const parts: string[] = [];
  if (createCount > 0) parts.push(green(`${createCount} to create`, noColor));
  if (updateCount > 0) parts.push(yellow(`${updateCount} to update`, noColor));
  if (deleteCount > 0) parts.push(red(`${deleteCount} to delete`, noColor));
  console.log(`  ${parts.join(", ")}\n`);
}

/**
 * Print apply results.
 */
export function printApplyResult(
  result: {
    applied: Change[];
    failed: Array<{ change: Change; error: string }>;
  },
  noColor?: boolean,
): void {
  const nc = noColor ?? false;
  console.log("\nApply results:");
  console.log(`  ${green(`${result.applied.length} succeeded`, nc)}`);

  if (result.failed.length > 0) {
    console.log(`  ${red(`${result.failed.length} failed:`, nc)}\n`);
    for (const f of result.failed) {
      console.log(`    ${changeLabel(f.change)}: ${f.error}`);
    }
  }
  console.log();
}
