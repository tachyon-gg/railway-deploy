import type { GraphQLClient } from "graphql-request";
import type { ServiceInstanceUpdateInput } from "../generated/graphql.js";
import { logger } from "../logger.js";
import {
  clearEgressGateways,
  createBucket,
  createCustomDomain,
  createEgressGateway,
  createService,
  createServiceDomain,
  createTcpProxy,
  createVolume,
  deleteCustomDomain,
  deleteService,
  deleteServiceDomain,
  deleteSharedVariable,
  deleteTcpProxy,
  deleteVariable,
  deleteVolume,
  updateCustomDomain,
  updateDeploymentTrigger,
  updateServiceDomain,
  updateServiceInstance,
  updateServiceInstanceLimits,
  updateVolume,
  updateVolumeInstance,
  upsertSharedVariables,
  upsertVariables,
} from "../railway/mutations.js";
import type { Change, Changeset } from "../types/changeset.js";
import { changeLabel } from "./format.js";

interface ApplyResult {
  applied: Change[];
  failed: Array<{ change: Change; error: string }>;
}

/** Extract a clean error message from GraphQL or network errors */
function extractErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const msg = err.message;

  // Try to parse structured GraphQL error response
  try {
    const parsed = "response" in err ? (err as { response: unknown }).response : undefined;
    if (parsed && typeof parsed === "object" && parsed !== null) {
      const resp = parsed as { errors?: Array<{ message: string }>; body?: string };
      const gqlMessage = resp.errors?.[0]?.message;
      if (gqlMessage && gqlMessage !== "Problem processing request") {
        return gqlMessage;
      }
    }
  } catch {
    // Fall through to regex extraction
  }

  // Fallback: extract "message" from stringified error
  const match = msg.match(/"message":"([^"]+)"/);
  if (match) return match[1];
  return msg;
}

/**
 * Execute a changeset against Railway, applying each change sequentially
 * and tracking successes and failures.
 *
 * Newly created service IDs are tracked so that subsequent changes (variables,
 * domains, settings) for the same service can resolve the ID. Variable upserts
 * use `skipDeploys` per service — only each service's final variable upsert
 * triggers a deploy, avoiding unnecessary intermediate deployments.
 *
 * @param client - Authenticated GraphQL client.
 * @param changeset - The changes to apply (from {@link computeChangeset}).
 * @param projectId - Railway project ID.
 * @param environmentId - Railway environment ID.
 * @returns Lists of successfully applied changes and failures with error messages.
 */
export async function applyChangeset(
  client: GraphQLClient,
  changeset: Changeset,
  projectId: string,
  environmentId: string,
): Promise<ApplyResult> {
  const applied: Change[] = [];
  const failed: Array<{ change: Change; error: string }> = [];

  // Track newly created service IDs so subsequent changes can reference them
  const createdServiceIds = new Map<string, string>();

  // Find the last variable change index per service for skipDeploys optimization.
  // Only the final variable upsert for each service should trigger a deploy.
  const lastVarChangeByService = new Map<string, number>();
  for (let i = 0; i < changeset.changes.length; i++) {
    const c = changeset.changes[i];
    if (c.type === "upsert-variables") {
      lastVarChangeByService.set(c.serviceName, i);
    }
  }

  for (let i = 0; i < changeset.changes.length; i++) {
    const change = changeset.changes[i];
    let skipDeploys = false;
    if (change.type === "upsert-variables") {
      skipDeploys = i < (lastVarChangeByService.get(change.serviceName) ?? -1);
    }

    try {
      await applyChange(client, change, projectId, environmentId, createdServiceIds, skipDeploys);
      applied.push(change);
      logger.success(changeLabel(change));
    } catch (err) {
      const message = extractErrorMessage(err);
      failed.push({ change, error: message });
      logger.fail(`${changeLabel(change)} — ${message}`);
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
        change.branch,
        change.registryCredentials,
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
      await createCustomDomain(
        client,
        projectId,
        serviceId,
        environmentId,
        change.domain,
        change.targetPort,
      );
      break;
    }

    case "delete-domain":
      await deleteCustomDomain(client, change.domainId);
      break;

    case "update-domain":
      await updateCustomDomain(client, change.domainId, environmentId, change.targetPort);
      break;

    case "update-service-settings": {
      const serviceId = change.serviceId || createdServiceIds.get(change.serviceName);
      if (!serviceId) {
        throw new Error(`No service ID for "${change.serviceName}"`);
      }
      const input: ServiceInstanceUpdateInput = {};
      if (change.settings.source !== undefined) {
        input.source = change.settings.source;
      }
      if (change.settings.restartPolicy !== undefined) {
        input.restartPolicyType = change.settings
          .restartPolicy as ServiceInstanceUpdateInput["restartPolicyType"];
      }
      if (change.settings.healthcheck !== undefined) {
        if (change.settings.healthcheck) {
          input.healthcheckPath = change.settings.healthcheck.path;
          input.healthcheckTimeout = change.settings.healthcheck.timeout;
        } else {
          input.healthcheckPath = null;
          input.healthcheckTimeout = null;
        }
      }
      if (change.settings.cronSchedule !== undefined) {
        input.cronSchedule = change.settings.cronSchedule;
      }
      if (change.settings.region !== undefined) {
        if (change.settings.region) {
          input.region = change.settings.region.region;
          input.numReplicas = change.settings.region.numReplicas;
        } else {
          input.region = null;
          input.numReplicas = null;
        }
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
        input.preDeployCommand = change.settings.preDeployCommand;
      if (change.settings.restartPolicyMaxRetries !== undefined)
        input.restartPolicyMaxRetries = change.settings.restartPolicyMaxRetries;
      if (change.settings.sleepApplication !== undefined)
        input.sleepApplication = change.settings.sleepApplication;
      if (change.settings.builder !== undefined)
        input.builder = change.settings.builder as ServiceInstanceUpdateInput["builder"];
      if (change.settings.watchPatterns !== undefined)
        input.watchPatterns = change.settings.watchPatterns;
      if (change.settings.drainingSeconds !== undefined)
        input.drainingSeconds = change.settings.drainingSeconds;
      if (change.settings.overlapSeconds !== undefined)
        input.overlapSeconds = change.settings.overlapSeconds;
      if (change.settings.ipv6EgressEnabled !== undefined)
        input.ipv6EgressEnabled = change.settings.ipv6EgressEnabled;
      if (change.settings.registryCredentials !== undefined)
        input.registryCredentials = change.settings.registryCredentials;
      if (change.settings.railwayConfigFile !== undefined)
        input.railwayConfigFile = change.settings.railwayConfigFile;

      await updateServiceInstance(client, serviceId, environmentId, input);
      break;
    }

    case "create-volume": {
      const serviceId = change.serviceId || createdServiceIds.get(change.serviceName);
      if (!serviceId) {
        throw new Error(`No service ID for "${change.serviceName}"`);
      }
      await createVolume(client, projectId, serviceId, environmentId, change.mount);
      break;
    }

    case "delete-volume":
      await deleteVolume(client, change.volumeId);
      break;

    case "update-volume": {
      if (change.name) {
        await updateVolume(client, change.volumeId, change.name);
      }
      if (change.mount) {
        await updateVolumeInstance(client, change.volumeId, environmentId, change.mount);
      }
      break;
    }

    case "create-bucket":
      await createBucket(client, projectId, change.bucketName);
      break;

    case "update-deployment-trigger": {
      const triggerInput: import("../generated/graphql.js").DeploymentTriggerUpdateInput = {};
      if (change.branch) triggerInput.branch = change.branch;
      if (change.checkSuites !== undefined) triggerInput.checkSuites = change.checkSuites;
      await updateDeploymentTrigger(client, change.triggerId, triggerInput);
      break;
    }

    case "create-service-domain": {
      const serviceId = change.serviceId || createdServiceIds.get(change.serviceName);
      if (!serviceId) {
        throw new Error(`No service ID for "${change.serviceName}"`);
      }
      await createServiceDomain(client, serviceId, environmentId, change.targetPort);
      break;
    }

    case "delete-service-domain":
      await deleteServiceDomain(client, change.domainId);
      break;

    case "update-service-domain": {
      const serviceId = change.serviceId || createdServiceIds.get(change.serviceName);
      if (!serviceId) {
        throw new Error(`No service ID for "${change.serviceName}"`);
      }
      await updateServiceDomain(client, {
        serviceDomainId: change.domainId,
        serviceId,
        environmentId,
        domain: change.domain,
        targetPort: change.targetPort,
      });
      break;
    }

    case "create-tcp-proxy": {
      const serviceId = change.serviceId || createdServiceIds.get(change.serviceName);
      if (!serviceId) {
        throw new Error(`No service ID for "${change.serviceName}"`);
      }
      await createTcpProxy(client, serviceId, environmentId, change.applicationPort);
      break;
    }

    case "delete-tcp-proxy":
      await deleteTcpProxy(client, change.proxyId);
      break;

    case "update-service-limits": {
      const serviceId = change.serviceId || createdServiceIds.get(change.serviceName);
      if (!serviceId) {
        throw new Error(`No service ID for "${change.serviceName}"`);
      }
      await updateServiceInstanceLimits(client, serviceId, environmentId, change.limits);
      break;
    }

    case "enable-static-ips": {
      const serviceId = change.serviceId || createdServiceIds.get(change.serviceName);
      if (!serviceId) {
        throw new Error(`No service ID for "${change.serviceName}"`);
      }
      await createEgressGateway(client, serviceId, environmentId);
      break;
    }

    case "disable-static-ips": {
      const serviceId = change.serviceId || createdServiceIds.get(change.serviceName);
      if (!serviceId) {
        throw new Error(`No service ID for "${change.serviceName}"`);
      }
      await clearEgressGateways(client, serviceId, environmentId);
      break;
    }

    case "delete-bucket":
      // Railway API doesn't support bucket deletion
      throw new Error("Bucket deletion is not supported by the Railway API — delete manually");

    default: {
      const _exhaustive: never = change;
      throw new Error(`Unknown change type: ${(_exhaustive as Change).type}`);
    }
  }
}
