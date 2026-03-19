/**
 * Human-readable output for config diffs and apply results.
 */

import { logger } from "../logger.js";
import type { ConfigDiff, ConfigDiffEntry, DiffAction } from "../types/changeset.js";

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

function maskValue(key: string, value: unknown): string {
  if (isSensitive(key)) return "***";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

const ACTION_ICON: Record<DiffAction, string> = {
  add: "+",
  update: "~",
  remove: "-",
};

/**
 * Print a human-readable summary of the config diff.
 */
export function printConfigDiff(diff: ConfigDiff, options?: { verbose?: boolean }): void {
  const verbose = options?.verbose ?? false;
  const totalChanges =
    diff.entries.length + diff.servicesToCreate.length + diff.servicesToDelete.length;

  if (totalChanges === 0) {
    logger.info(`\nNo changes needed — Railway matches desired state.\n`);
    return;
  }

  logger.info(`\nChangeset (${totalChanges} changes):\n`);

  // Group entries by service name (null = project-level)
  const groups = new Map<string | null, ConfigDiffEntry[]>();
  for (const entry of diff.entries) {
    const key = entry.serviceName;
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push(entry);
  }

  // Print project-level changes first (shared variables, buckets)
  const projectEntries = groups.get(null);
  if (projectEntries) {
    for (const entry of projectEntries) {
      const icon = ACTION_ICON[entry.action];
      const label = formatEntryLabel(entry, verbose);
      logger.info(`  ${icon} ${label}`);
    }
    logger.info("");
    groups.delete(null);
  }

  // Print per-service changes
  for (const [serviceName, serviceEntries] of groups) {
    const hasServiceCreate = serviceEntries.some(
      (e) => e.action === "add" && e.category === "service",
    );
    const hasServiceDelete = serviceEntries.some(
      (e) => e.action === "remove" && e.category === "service",
    );
    const headerAction: DiffAction = hasServiceCreate
      ? "add"
      : hasServiceDelete
        ? "remove"
        : "update";
    const headerIcon = ACTION_ICON[headerAction];

    logger.info(`  ${headerIcon} ${serviceName}:`);
    for (const entry of serviceEntries) {
      if (entry.category === "service") continue; // Already shown in header
      const icon = ACTION_ICON[entry.action];
      const label = formatEntryLabel(entry, verbose);
      logger.info(`    ${icon} ${label}`);
    }
    logger.info("");
  }

  // Summary line
  let addCount = 0;
  let updateCount = 0;
  let removeCount = 0;
  for (const entry of diff.entries) {
    if (entry.action === "add") addCount++;
    else if (entry.action === "update") updateCount++;
    else removeCount++;
  }
  addCount += diff.servicesToCreate.length;
  removeCount += diff.servicesToDelete.length;

  const parts: string[] = [];
  if (addCount > 0) parts.push(`${addCount} to create`);
  if (updateCount > 0) parts.push(`${updateCount} to update`);
  if (removeCount > 0) parts.push(`${removeCount} to delete`);
  logger.info(`  ${parts.join(", ")}\n`);
}

function formatEntryLabel(entry: ConfigDiffEntry, verbose: boolean): string {
  const pathParts = entry.path.split(".");

  switch (entry.category) {
    case "shared-variable": {
      const varName = pathParts[pathParts.length - 1];
      if (verbose && entry.action !== "remove") {
        const oldStr =
          entry.oldValue !== undefined ? `"${maskValue(varName, entry.oldValue)}"` : "(unset)";
        const newStr = `"${maskValue(varName, entry.newValue)}"`;
        return `Shared variable ${varName}: ${oldStr} → ${newStr}`;
      }
      if (entry.action === "remove") return `Shared variable: delete ${varName}`;
      return `Shared variable: ${entry.action === "add" ? "set" : "update"} ${varName}`;
    }

    case "variable": {
      const varName = pathParts[pathParts.length - 1];
      if (verbose && entry.action !== "remove") {
        const oldStr =
          entry.oldValue !== undefined ? `"${maskValue(varName, entry.oldValue)}"` : "(unset)";
        const newStr = `"${maskValue(varName, entry.newValue)}"`;
        return `${varName}: ${oldStr} → ${newStr}`;
      }
      if (entry.action === "remove") return `delete variable ${varName}`;
      return `${entry.action === "add" ? "set" : "update"} variable ${varName}`;
    }

    case "domain": {
      // Domain names contain dots, so extract everything after "customDomains."
      const domainPrefix = "networking.customDomains.";
      const domain = entry.path.startsWith(domainPrefix)
        ? entry.path.slice(domainPrefix.length)
        : pathParts[pathParts.length - 1];
      const portStr =
        entry.newValue && typeof entry.newValue === "object" && "port" in entry.newValue
          ? ` (port ${(entry.newValue as { port: number }).port})`
          : "";
      return `domain: ${entry.action === "remove" ? "remove" : ""} ${domain}${portStr}`.trim();
    }

    case "setting": {
      const knownPrefixes = ["deploy.", "build.", "source.", "networking."];
      const prefix = knownPrefixes.find((p) => entry.path.startsWith(p));
      const field = prefix ? entry.path.slice(prefix.length) : entry.path;
      if (verbose && entry.oldValue !== undefined) {
        if (isSensitive(field)) return `${field}: ***`;
        const oldStr = entry.oldValue !== undefined ? JSON.stringify(entry.oldValue) : "(unset)";
        const newStr =
          entry.newValue !== undefined && entry.newValue !== null
            ? JSON.stringify(entry.newValue)
            : "(unset)";
        return `${field}: ${oldStr} → ${newStr}`;
      }
      return `${field}: ${entry.action === "remove" ? "(unset)" : JSON.stringify(entry.newValue ?? "(set)")}`;
    }

    case "volume": {
      if (entry.action === "add") return `volume: ${entry.newValue}`;
      if (entry.action === "remove") return "volume: remove";
      return `volume: ${entry.oldValue} → ${entry.newValue}`;
    }

    case "bucket":
      return `bucket: ${entry.action}`;

    case "service":
      return `service: ${entry.action === "add" ? `create (${entry.newValue})` : "delete"}`;

    case "private-hostname": {
      if (entry.action === "remove") return "private hostname: remove";
      return `private hostname: ${entry.newValue}`;
    }

    default:
      return `${entry.path}: ${entry.action}`;
  }
}

/** Apply result from the new patch-based pipeline */
export interface ApplyResult {
  staged: boolean;
  committed: boolean;
  servicesCreated: string[];
  servicesDeleted: string[];
  volumesCreated: string[];
  errors: Array<{ step: string; error: string }>;
}

/**
 * Print apply results.
 */
export function printApplyResult(result: ApplyResult): void {
  logger.info("\nApply results:");

  if (result.servicesCreated.length > 0) {
    logger.info(`  Created ${result.servicesCreated.length} service(s)`);
  }
  if (result.volumesCreated.length > 0) {
    logger.info(`  Created ${result.volumesCreated.length} volume(s)`);
  }
  if (result.staged) {
    logger.success("  Changes staged");
  }
  if (result.committed) {
    logger.success("  Changes committed");
  }
  if (result.servicesDeleted.length > 0) {
    logger.info(`  Deleted ${result.servicesDeleted.length} service(s)`);
  }

  if (result.errors.length > 0) {
    logger.error(`  ${result.errors.length} error(s):\n`);
    for (const e of result.errors) {
      logger.info(`    ${e.step}: ${e.error}`);
    }
  }

  const succeeded =
    (result.staged ? 1 : 0) +
    (result.committed ? 1 : 0) +
    result.servicesCreated.length +
    result.servicesDeleted.length +
    result.volumesCreated.length;
  logger.info(`  ${succeeded} succeeded, ${result.errors.length} failed`);
  logger.info("");
}
