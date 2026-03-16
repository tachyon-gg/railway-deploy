import { logger } from "../logger.js";
import type { Change, Changeset } from "../types/changeset.js";
import type { ServiceState } from "../types/state.js";

/** Patterns that indicate a variable value is sensitive */
const SENSITIVE_PATTERNS = [
  "PASSWORD",
  "PASSPHRASE",
  "SECRET",
  "TOKEN",
  "KEY",
  "PRIVATE",
  "CREDENTIAL",
  "JWT",
  "CERT",
  "SIGNING",
  "ENCRYPTION",
];

function isSensitive(key: string): boolean {
  const upper = key.toUpperCase();
  return SENSITIVE_PATTERNS.some((p) => upper.includes(p));
}

function maskValue(key: string, value: string): string {
  return isSensitive(key) ? "***" : value;
}

type Action = "create" | "update" | "delete";

interface ChangeDescription {
  /** Display category for grouping */
  category: string;
  /** Create, update, or delete */
  action: Action;
  /** Human-readable summary line */
  summary: string;
  /** Service name for grouping, or null for project-level changes */
  serviceName: string | null;
}

/**
 * Single source of truth for how a change is displayed.
 * Every change type maps to a category, action, and summary.
 */
function describeChange(change: Change): ChangeDescription {
  switch (change.type) {
    case "create-service": {
      const src = change.source?.image || change.source?.repo || "empty";
      const details: string[] = [src];
      if (change.branch) details.push(`branch: ${change.branch}`);
      if (change.volume) details.push(`volume: ${change.volume.mount}`);
      if (change.cronSchedule) details.push(`cron: ${change.cronSchedule}`);
      return {
        category: "Service",
        action: "create",
        serviceName: change.name,
        summary: `create (${details.join(", ")})`,
      };
    }
    case "delete-service":
      return {
        category: "Service",
        action: "delete",
        serviceName: change.name,
        summary: "delete",
      };

    case "update-service-settings":
      return {
        category: "Settings",
        action: "update",
        serviceName: change.serviceName,
        summary: `settings: ${Object.keys(change.settings).join(", ")}`,
      };

    case "update-deployment-trigger": {
      const parts: string[] = [];
      if (change.branch) parts.push(`branch → ${change.branch}`);
      if (change.checkSuites !== undefined) parts.push(`checkSuites → ${change.checkSuites}`);
      return {
        category: "Trigger",
        action: "update",
        serviceName: change.serviceName,
        summary: `trigger: ${parts.join(", ")}`,
      };
    }

    case "upsert-variables":
      return {
        category: "Variables",
        action: "update",
        serviceName: change.serviceName,
        summary: `set ${Object.keys(change.variables).length} var(s) — ${Object.keys(change.variables).join(", ")}`,
      };
    case "delete-variables":
      return {
        category: "Variables",
        action: "delete",
        serviceName: change.serviceName,
        summary: `delete ${change.variableNames.length} var(s) — ${change.variableNames.join(", ")}`,
      };

    case "upsert-shared-variables":
      return {
        category: "Shared variables",
        action: "update",
        serviceName: null,
        summary: `set ${Object.keys(change.variables).length} var(s) — ${Object.keys(change.variables).join(", ")}`,
      };
    case "delete-shared-variables":
      return {
        category: "Shared variables",
        action: "delete",
        serviceName: null,
        summary: `delete ${change.variableNames.length} var(s) — ${change.variableNames.join(", ")}`,
      };

    case "create-domain": {
      const port = change.targetPort ? ` (port ${change.targetPort})` : "";
      return {
        category: "Domain",
        action: "create",
        serviceName: change.serviceName,
        summary: `domain: ${change.domain}${port}`,
      };
    }
    case "delete-domain":
      return {
        category: "Domain",
        action: "delete",
        serviceName: change.serviceName,
        summary: `domain: ${change.domain}`,
      };
    case "update-domain": {
      const port = change.targetPort ? ` (port ${change.targetPort})` : "";
      return {
        category: "Domain",
        action: "update",
        serviceName: change.serviceName,
        summary: `domain: ${change.domain}${port}`,
      };
    }

    case "create-service-domain": {
      const port = change.targetPort ? ` (port ${change.targetPort})` : "";
      return {
        category: "Railway domain",
        action: "create",
        serviceName: change.serviceName,
        summary: `railway domain${port}`,
      };
    }
    case "delete-service-domain":
      return {
        category: "Railway domain",
        action: "delete",
        serviceName: change.serviceName,
        summary: "railway domain",
      };
    case "update-service-domain": {
      const port = change.targetPort ? ` (port ${change.targetPort})` : "";
      return {
        category: "Railway domain",
        action: "update",
        serviceName: change.serviceName,
        summary: `railway domain: ${change.domain}${port}`,
      };
    }

    case "create-volume":
      return {
        category: "Volume",
        action: "create",
        serviceName: change.serviceName,
        summary: `volume: ${change.mount}`,
      };
    case "update-volume": {
      const parts: string[] = [];
      if (change.name) parts.push(`name: ${change.name}`);
      if (change.mount) parts.push(`mount: ${change.mount}`);
      return {
        category: "Volume",
        action: "update",
        serviceName: change.serviceName,
        summary: `volume: ${parts.join(", ")}`,
      };
    }
    case "delete-volume":
      return {
        category: "Volume",
        action: "delete",
        serviceName: change.serviceName,
        summary: `volume (${change.volumeId})`,
      };

    case "create-tcp-proxy":
      return {
        category: "TCP proxy",
        action: "create",
        serviceName: change.serviceName,
        summary: `tcp proxy: port ${change.applicationPort}`,
      };
    case "delete-tcp-proxy":
      return {
        category: "TCP proxy",
        action: "delete",
        serviceName: change.serviceName,
        summary: `tcp proxy: ${change.proxyId}`,
      };

    case "update-service-limits": {
      const parts: string[] = [];
      if (change.limits.memoryGB !== undefined)
        parts.push(`memory: ${change.limits.memoryGB ?? "unset"}GB`);
      if (change.limits.vCPUs !== undefined) parts.push(`vCPUs: ${change.limits.vCPUs ?? "unset"}`);
      return {
        category: "Limits",
        action: "update",
        serviceName: change.serviceName,
        summary: `limits: ${parts.join(", ")}`,
      };
    }

    case "enable-static-ips":
      return {
        category: "Static IPs",
        action: "create",
        serviceName: change.serviceName,
        summary: "static outbound IPs: enable",
      };
    case "disable-static-ips":
      return {
        category: "Static IPs",
        action: "delete",
        serviceName: change.serviceName,
        summary: "static outbound IPs: disable",
      };

    case "create-bucket":
      return {
        category: "Buckets",
        action: "create",
        serviceName: null,
        summary: change.bucketName,
      };
    case "delete-bucket":
      return { category: "Buckets", action: "delete", serviceName: null, summary: change.name };

    default: {
      const _exhaustive: never = change;
      return {
        category: "Unknown",
        action: "update",
        serviceName: null,
        summary: (_exhaustive as Change).type,
      };
    }
  }
}

/**
 * Human-readable one-line label for a change (used in apply output).
 */
export function changeLabel(change: Change): string {
  const desc = describeChange(change);
  const prefix = desc.serviceName ? `${desc.serviceName}: ` : "";
  return `${prefix}${desc.summary}`;
}

const ACTION_ICON: Record<Action, string> = {
  create: "+",
  update: "~",
  delete: "-",
};

/**
 * Print a human-readable summary of the changeset to stdout.
 *
 * Sensitive variable values (matching PASSWORD, SECRET, TOKEN, etc.) are
 * automatically masked. In verbose mode, old and new values are shown
 * side-by-side when `currentState` is provided.
 */
export function printChangeset(
  changeset: Changeset,
  options?: {
    verbose?: boolean;
    currentState?: {
      services: Record<string, ServiceState>;
      sharedVariables: Record<string, string>;
    };
  },
): void {
  const verbose = options?.verbose ?? false;

  if (changeset.changes.length === 0) {
    logger.info(`\nNo changes needed — Railway matches desired state.\n`);
    return;
  }

  logger.info(`\nChangeset (${changeset.changes.length} changes):\n`);

  // Describe all changes and group by service (null = project-level)
  const described = changeset.changes.map((change) => ({ change, desc: describeChange(change) }));
  const serviceGroups = new Map<
    string | null,
    Array<{ change: Change; desc: ChangeDescription }>
  >();
  for (const entry of described) {
    const key = entry.desc.serviceName;
    let group = serviceGroups.get(key);
    if (!group) {
      group = [];
      serviceGroups.set(key, group);
    }
    group.push(entry);
  }

  // Print project-level changes first (shared variables, buckets)
  const projectChanges = serviceGroups.get(null);
  if (projectChanges) {
    for (const { change, desc } of projectChanges) {
      const icon = ACTION_ICON[desc.action];
      if (verbose && change.type === "upsert-shared-variables") {
        logger.info(`  ~ Shared variables:`);
        for (const [key, value] of Object.entries(change.variables)) {
          const oldVal = options?.currentState?.sharedVariables[key];
          const oldStr = oldVal !== undefined ? maskValue(key, oldVal) : "(unset)";
          logger.info(`    ${icon} ${key}: "${oldStr}" → "${maskValue(key, value)}"`);
        }
      } else {
        logger.info(`  ${icon} ${desc.category}: ${desc.summary}`);
      }
    }
    logger.info("");
    serviceGroups.delete(null);
  }

  // Print per-service changes
  for (const [serviceName, entries] of serviceGroups) {
    const hasCreate = entries.some(
      (e) => e.desc.action === "create" && e.desc.category === "Service",
    );
    const hasDelete = entries.some(
      (e) => e.desc.action === "delete" && e.desc.category === "Service",
    );
    const headerAction: Action = hasCreate ? "create" : hasDelete ? "delete" : "update";
    const headerIcon = ACTION_ICON[headerAction];
    logger.info(`  ${headerIcon} ${serviceName}:`);
    for (const { change, desc } of entries) {
      const icon = ACTION_ICON[desc.action];

      if (verbose && change.type === "update-service-settings") {
        for (const [key, value] of Object.entries(change.settings)) {
          if (isSensitive(key)) {
            logger.info(`    ${icon} ${key}: ***`);
            continue;
          }
          const currentSvc = options?.currentState?.services[change.serviceName];
          const oldVal = currentSvc ? currentSvc[key as keyof ServiceState] : undefined;
          const oldStr = oldVal !== undefined ? JSON.stringify(oldVal) : "(unset)";
          const newStr = value === null ? "(unset)" : JSON.stringify(value);
          logger.info(`    ${icon} ${key}: ${oldStr} → ${newStr}`);
        }
      } else if (verbose && change.type === "upsert-variables") {
        for (const [key, value] of Object.entries(change.variables)) {
          const currentSvc = options?.currentState?.services[change.serviceName];
          const oldVal = currentSvc?.variables[key];
          const oldStr = oldVal !== undefined ? maskValue(key, oldVal) : "(unset)";
          logger.info(`    ${icon} ${key}: "${oldStr}" → "${maskValue(key, value)}"`);
        }
      } else {
        logger.info(`    ${icon} ${desc.summary}`);
      }
    }
    logger.info("");
  }

  // Summary line
  let createCount = 0;
  let updateCount = 0;
  let deleteCount = 0;
  for (const { desc } of described) {
    if (desc.action === "create") createCount++;
    else if (desc.action === "update") updateCount++;
    else deleteCount++;
  }

  const parts: string[] = [];
  if (createCount > 0) parts.push(`${createCount} to create`);
  if (updateCount > 0) parts.push(`${updateCount} to update`);
  if (deleteCount > 0) parts.push(`${deleteCount} to delete`);
  logger.info(`  ${parts.join(", ")}\n`);
}

/**
 * Print apply results.
 */
export function printApplyResult(result: {
  applied: Change[];
  failed: Array<{ change: Change; error: string }>;
}): void {
  logger.info("\nApply results:");
  logger.info(`  ${result.applied.length} succeeded`);

  if (result.failed.length > 0) {
    logger.error(`  ${result.failed.length} failed:\n`);
    for (const f of result.failed) {
      logger.info(`    ${changeLabel(f.change)}: ${f.error}`);
    }
  }
  logger.info("");
}
