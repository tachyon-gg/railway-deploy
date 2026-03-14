import type { GraphQLClient } from "graphql-request";
import type { ServiceInstanceUpdateInput } from "../generated/graphql.js";
import {
  createBucket,
  createCustomDomain,
  createService,
  createVolume,
  deleteCustomDomain,
  deleteService,
  deleteSharedVariable,
  deleteVariable,
  deleteVolume,
  updateServiceInstance,
  upsertSharedVariables,
  upsertVariables,
} from "../railway/mutations.js";
import type { Change, Changeset } from "../types/changeset.js";
import { changeLabel } from "./format.js";

// Re-export for backwards compatibility
export { printApplyResult, printChangeset } from "./format.js";

interface ApplyResult {
  applied: Change[];
  failed: Array<{ change: Change; error: string }>;
}

interface ApplyOptions {
  verbose?: boolean;
  noColor?: boolean;
}

// ANSI color helpers (used in apply output)
function green(text: string, noColor: boolean): string {
  return noColor ? text : `\x1b[32m${text}\x1b[0m`;
}
function red(text: string, noColor: boolean): string {
  return noColor ? text : `\x1b[31m${text}\x1b[0m`;
}

/**
 * Execute a changeset against Railway, tracking successes and failures.
 */
export async function applyChangeset(
  client: GraphQLClient,
  changeset: Changeset,
  projectId: string,
  environmentId: string,
  options?: ApplyOptions,
): Promise<ApplyResult> {
  const applied: Change[] = [];
  const failed: Array<{ change: Change; error: string }> = [];
  const noColor = options?.noColor ?? false;

  // Track newly created service IDs so subsequent changes can reference them
  const createdServiceIds = new Map<string, string>();

  // Find indices of last variable change for skipDeploys optimization
  const varChangeIndices = changeset.changes
    .map((c, i) => (c.type === "upsert-variables" || c.type === "upsert-shared-variables" ? i : -1))
    .filter((i) => i >= 0);
  const lastVarChangeIdx =
    varChangeIndices.length > 0 ? varChangeIndices[varChangeIndices.length - 1] : -1;

  for (let i = 0; i < changeset.changes.length; i++) {
    const change = changeset.changes[i];
    const skipDeploys =
      (change.type === "upsert-variables" || change.type === "upsert-shared-variables") &&
      i < lastVarChangeIdx;

    try {
      await applyChange(client, change, projectId, environmentId, createdServiceIds, skipDeploys);
      applied.push(change);
      console.log(`  ${green("✓", noColor)} ${changeLabel(change)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push({ change, error: message });
      console.log(`  ${red("✗", noColor)} ${changeLabel(change)} — ${message}`);
    }
  }

  return { applied, failed };
}

async function applyChange(
  client: GraphQLClient,
  change: Change,
  projectId: string,
  environmentId: string,
  createdServiceIds: Map<string, string>,
  skipDeploys?: boolean,
): Promise<void> {
  switch (change.type) {
    case "create-service": {
      const result = await createService(
        client,
        projectId,
        change.name,
        change.source,
        environmentId,
      );
      createdServiceIds.set(change.name, result.id);

      // Create volume if specified
      if (change.volume) {
        await createVolume(client, projectId, result.id, environmentId, change.volume.mount);
      }

      // Update service instance settings if needed
      if (change.cronSchedule) {
        await updateServiceInstance(client, result.id, environmentId, {
          cronSchedule: change.cronSchedule,
        });
      }
      break;
    }

    case "delete-service":
      await deleteService(client, change.serviceId);
      break;

    case "upsert-variables": {
      const serviceId = change.serviceId || createdServiceIds.get(change.serviceName);
      if (!serviceId) {
        throw new Error(
          `No service ID for "${change.serviceName}" — service may not have been created yet`,
        );
      }
      await upsertVariables(
        client,
        projectId,
        environmentId,
        serviceId,
        change.variables,
        skipDeploys,
      );
      break;
    }

    case "delete-variables": {
      const serviceId = change.serviceId || createdServiceIds.get(change.serviceName);
      if (!serviceId) {
        throw new Error(`No service ID for "${change.serviceName}"`);
      }
      for (const name of change.variableNames) {
        await deleteVariable(client, projectId, environmentId, serviceId, name);
      }
      break;
    }

    case "upsert-shared-variables":
      await upsertSharedVariables(client, projectId, environmentId, change.variables, skipDeploys);
      break;

    case "delete-shared-variables":
      for (const name of change.variableNames) {
        await deleteSharedVariable(client, projectId, environmentId, name);
      }
      break;

    case "create-domain": {
      const serviceId = change.serviceId || createdServiceIds.get(change.serviceName);
      if (!serviceId) {
        throw new Error(`No service ID for "${change.serviceName}"`);
      }
      await createCustomDomain(client, projectId, serviceId, environmentId, change.domain);
      break;
    }

    case "delete-domain":
      await deleteCustomDomain(client, change.domainId);
      break;

    case "update-service-settings": {
      const serviceId = change.serviceId || createdServiceIds.get(change.serviceName);
      if (!serviceId) {
        throw new Error(`No service ID for "${change.serviceName}"`);
      }
      const input: ServiceInstanceUpdateInput = {};
      if (change.settings.source) input.source = change.settings.source;
      if (change.settings.restartPolicy)
        input.restartPolicyType = change.settings
          .restartPolicy as ServiceInstanceUpdateInput["restartPolicyType"];
      if (change.settings.healthcheck) {
        input.healthcheckPath = change.settings.healthcheck.path;
        input.healthcheckTimeout = change.settings.healthcheck.timeout;
      }
      if (change.settings.cronSchedule) input.cronSchedule = change.settings.cronSchedule;
      if (change.settings.regions?.[0]) {
        input.region = change.settings.regions[0].region;
        input.numReplicas = change.settings.regions[0].numReplicas;
      }
      if (change.settings.startCommand !== undefined)
        input.startCommand = change.settings.startCommand;
      if (change.settings.buildCommand !== undefined)
        input.buildCommand = change.settings.buildCommand;
      if (change.settings.rootDirectory !== undefined)
        input.rootDirectory = change.settings.rootDirectory;
      if (change.settings.dockerfilePath !== undefined)
        input.dockerfilePath = change.settings.dockerfilePath;
      if (change.settings.preDeployCommand !== undefined)
        input.preDeployCommand = [change.settings.preDeployCommand];
      if (change.settings.restartPolicyMaxRetries !== undefined)
        input.restartPolicyMaxRetries = change.settings.restartPolicyMaxRetries;
      if (change.settings.sleepApplication !== undefined)
        input.sleepApplication = change.settings.sleepApplication;

      await updateServiceInstance(client, serviceId, environmentId, input);
      break;
    }

    case "delete-volume":
      await deleteVolume(client, change.volumeId);
      break;

    case "create-bucket":
      await createBucket(client, projectId, change.bucketName);
      break;

    case "delete-bucket":
      // Railway API doesn't support bucket deletion
      throw new Error("Bucket deletion is not supported by the Railway API — delete manually");

    default: {
      const _exhaustive: never = change;
      throw new Error(`Unknown change type: ${(_exhaustive as Change).type}`);
    }
  }
}
