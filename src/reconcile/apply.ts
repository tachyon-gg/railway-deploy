/**
 * Apply engine: stages and commits an EnvironmentConfig patch.
 *
 * The new pipeline is dramatically simpler than the old one:
 * 1. Create new services (serviceCreate)
 * 2. Create new volumes (volumeCreate)
 * 3. Stage changes (environmentStageChanges)
 * 4. Commit (environmentPatchCommitStaged)
 * 5. Delete removed services (serviceDelete)
 */

import type { GraphQLClient } from "graphql-request";
import { logger } from "../logger.js";
import {
  clearEgressGateways,
  commitStagedChanges,
  createEgressGateway,
  createService,
  createVolume,
  deleteService,
  stageEnvironmentChanges,
  updateVolume,
} from "../railway/mutations.js";
import type { ConfigDiff } from "../types/changeset.js";
import type { EnvironmentConfig } from "../types/envconfig.js";
import type { State } from "../types/state.js";
import { buildServiceConfig } from "./config.js";
import type { ApplyResult } from "./format.js";

/**
 * Extract a clean error message from GraphQL or network errors.
 */
function extractErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const msg = err.message;

  try {
    const parsed = "response" in err ? (err as { response: unknown }).response : undefined;
    if (parsed && typeof parsed === "object" && parsed !== null) {
      const resp = parsed as { errors?: Array<{ message: string }> };
      const gqlMessage = resp.errors?.[0]?.message;
      if (gqlMessage && gqlMessage !== "Problem processing request") {
        return gqlMessage;
      }
    }
  } catch {
    // Fall through
  }

  const match = msg.match(/"message":"([^"]+)"/);
  if (match) return match[1];
  return msg;
}

/**
 * Apply a config diff by staging and committing an EnvironmentConfig patch.
 */
export async function applyConfigDiff(
  client: GraphQLClient,
  diff: ConfigDiff,
  desiredConfigInput: EnvironmentConfig,
  projectId: string,
  environmentId: string,
  desiredState: State,
  serviceNameToId?: Map<string, string>,
  options?: { stageOnly?: boolean },
): Promise<ApplyResult> {
  // Clone to avoid mutating the caller's config (safe for retries)
  const desiredConfig: EnvironmentConfig = JSON.parse(JSON.stringify(desiredConfigInput));

  const result: ApplyResult = {
    staged: false,
    committed: false,
    servicesCreated: [],
    servicesDeleted: [],
    volumesCreated: [],
    errors: [],
  };

  // Ensure desiredConfig.services exists for mutations
  if (!desiredConfig.services) {
    desiredConfig.services = {};
  }

  // Track IDs of newly created services for cleanup on failure
  const createdServiceIds: Map<string, string> = new Map();

  // Step 1: Create new services
  for (const svc of diff.servicesToCreate) {
    try {
      const created = await createService(
        client,
        projectId,
        svc.name,
        svc.source,
        environmentId,
        svc.branch,
        svc.registryCredentials,
      );
      result.servicesCreated.push(svc.name);
      createdServiceIds.set(svc.name, created.id);
      logger.success(`Created service: ${svc.name} (${created.id})`);

      // Build and add the new service's config to the patch
      const svcState = desiredState.services[svc.name];
      if (svcState) {
        let volumeId: string | undefined;
        // Create volume for new service if needed
        if (svc.volume) {
          try {
            const vol = await createVolume(
              client,
              projectId,
              created.id,
              environmentId,
              svc.volume.mount,
            );
            volumeId = vol.id;
            if (svc.volume.name && vol.name !== svc.volume.name) {
              await updateVolume(client, vol.id, svc.volume.name);
            }
            result.volumesCreated.push(svc.name);
            logger.success(`Created volume for ${svc.name}: ${svc.volume.mount}`);
          } catch (err) {
            result.errors.push({
              step: `create-volume:${svc.name}`,
              error: extractErrorMessage(err),
            });
          }
        }

        desiredConfig.services[created.id] = buildServiceConfig(svcState, volumeId);
      }
    } catch (err) {
      result.errors.push({
        step: `create-service:${svc.name}`,
        error: extractErrorMessage(err),
      });
    }
  }

  // Track volume IDs created in Step 2 for cleanup on stage failure
  const createdVolumeIds: Array<{ id: string; serviceName: string }> = [];

  // Step 2: Create volumes for existing services that need new volumes
  for (const vol of diff.volumesToCreate) {
    try {
      const created = await createVolume(
        client,
        projectId,
        vol.serviceId,
        environmentId,
        vol.mount,
      );
      if (vol.name && created.name !== vol.name) {
        await updateVolume(client, created.id, vol.name);
      }
      createdVolumeIds.push({ id: created.id, serviceName: vol.serviceName });
      result.volumesCreated.push(vol.serviceName);
      logger.success(`Created volume for ${vol.serviceName}: ${vol.mount}`);

      // Add volumeMount to the service's config
      const svcConfig = desiredConfig.services[vol.serviceId];
      if (svcConfig) {
        svcConfig.volumeMounts = svcConfig.volumeMounts || {};
        svcConfig.volumeMounts[created.id] = { mountPath: vol.mount };
      }
    } catch (err) {
      result.errors.push({
        step: `create-volume:${vol.serviceName}`,
        error: extractErrorMessage(err),
      });
    }
  }

  // Step 2.5: Null-inject removed collection items
  //
  // Settings (deploy.*, build.*, source.*, configFile, networking scalars) are
  // already nulled by the config builder — no injection needed here.
  //
  // Collections (variables, shared vars, custom domains, TCP proxies, volume mounts)
  // are keyed by dynamic names/IDs, so we must explicitly null removed items
  // because merge:true only adds/updates — it won't delete omitted keys.
  for (const entry of diff.entries) {
    if (entry.action !== "remove") continue;

    if (entry.category === "shared-variable") {
      const varName = entry.path.split(".").pop();
      if (varName) {
        desiredConfig.sharedVariables = desiredConfig.sharedVariables || {};
        (desiredConfig.sharedVariables as Record<string, unknown>)[varName] = null;
      }
    } else if (entry.category === "variable" && entry.serviceName && serviceNameToId) {
      const svcId = serviceNameToId.get(entry.serviceName);
      if (svcId && desiredConfig.services?.[svcId]) {
        const varName = entry.path.split(".").pop();
        if (varName) {
          desiredConfig.services[svcId].variables = desiredConfig.services[svcId].variables || {};
          (desiredConfig.services[svcId].variables as Record<string, unknown>)[varName] = null;
        }
      }
    } else if (entry.category === "domain" && entry.serviceName && serviceNameToId) {
      const svcId = serviceNameToId.get(entry.serviceName);
      if (svcId && desiredConfig.services?.[svcId]) {
        if (entry.path === "networking.serviceDomains") {
          // Railway domain removal — already nulled by config builder
          continue;
        }
        const prefix = "networking.customDomains.";
        const domainName = entry.path.startsWith(prefix)
          ? entry.path.slice(prefix.length)
          : entry.path.split(".").pop();
        if (domainName) {
          const svcCfg = desiredConfig.services[svcId];
          svcCfg.networking = svcCfg.networking || {};
          svcCfg.networking.customDomains = svcCfg.networking.customDomains || {};
          (svcCfg.networking.customDomains as Record<string, unknown>)[domainName] = null;
        }
      }
    } else if (entry.category === "volume" && entry.serviceName && serviceNameToId) {
      const svcId = serviceNameToId.get(entry.serviceName);
      if (svcId && desiredConfig.services?.[svcId]) {
        const volId = entry.path.split(".").pop();
        if (volId) {
          const svcCfg = desiredConfig.services[svcId];
          svcCfg.volumeMounts = svcCfg.volumeMounts || {};
          (svcCfg.volumeMounts as Record<string, unknown>)[volId] = null;
        }
      }
    }
    // "setting" category: already nulled by config builder — no injection needed
    // "service" category: handled by step 5 (deleteService)
  }

  // Step 3: Stage changes
  if (diff.entries.length > 0 || Object.keys(desiredConfig.services).length > 0) {
    try {
      await stageEnvironmentChanges(client, environmentId, desiredConfig, true);
      result.staged = true;
      logger.success("Changes staged");
    } catch (err) {
      result.errors.push({
        step: "stage",
        error: extractErrorMessage(err),
      });

      // Clean up orphaned services created in step 1
      for (const [svcName, svcId] of createdServiceIds) {
        try {
          await deleteService(client, svcId);
          logger.warn(`Cleaned up orphaned service: ${svcName}`);
        } catch {
          // Best-effort cleanup
        }
      }

      // Warn about orphaned volumes (no public volumeDelete mutation available)
      for (const vol of createdVolumeIds) {
        logger.warn(
          `Orphaned volume for ${vol.serviceName} (ID: ${vol.id}) — delete manually in Railway dashboard`,
        );
      }

      return result; // Can't commit if stage failed
    }
  }

  // Stage-only mode: stop here — don't commit, don't delete services, don't touch egress
  if (options?.stageOnly) {
    if (result.staged) {
      const hasEgressChanges = diff.entries.some((e) => e.path === "staticOutboundIps");
      const egressNote = hasEgressChanges
        ? " Note: static outbound IP changes require --apply."
        : "";
      logger.info(
        `Changes staged. Review in Railway dashboard, then run --apply to commit.${egressNote}`,
      );
    }
    return result;
  }

  // Step 4: Commit
  if (result.staged) {
    try {
      await commitStagedChanges(client, environmentId);
      result.committed = true;
      logger.success("Changes committed");
    } catch (err) {
      result.errors.push({
        step: "commit",
        error: extractErrorMessage(err),
      });
      return result; // Don't proceed to deletions if commit failed
    }
  }

  // Step 4.5: Handle static outbound IPs (egress gateways — separate from patch system)
  for (const entry of diff.entries) {
    if (entry.path !== "staticOutboundIps" || !entry.serviceName || !serviceNameToId) continue;
    const svcId = serviceNameToId.get(entry.serviceName);
    if (!svcId) continue;
    try {
      if (entry.action === "add") {
        await createEgressGateway(client, svcId, environmentId);
        logger.success(`Enabled static outbound IPs for ${entry.serviceName}`);
      } else if (entry.action === "remove") {
        await clearEgressGateways(client, svcId, environmentId);
        logger.success(`Disabled static outbound IPs for ${entry.serviceName}`);
      }
    } catch (err) {
      result.errors.push({
        step: `egress:${entry.serviceName}`,
        error: extractErrorMessage(err),
      });
    }
  }

  // Step 5: Delete removed services
  for (const svc of diff.servicesToDelete) {
    try {
      await deleteService(client, svc.serviceId);
      result.servicesDeleted.push(svc.name);
      logger.success(`Deleted service: ${svc.name}`);
    } catch (err) {
      result.errors.push({
        step: `delete-service:${svc.name}`,
        error: extractErrorMessage(err),
      });
    }
  }

  return result;
}
