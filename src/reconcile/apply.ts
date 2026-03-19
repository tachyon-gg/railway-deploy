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
  createBucket,
  createCustomDomain,
  createEgressGateway,
  createService,
  createServiceDomain,
  createVolume,
  deleteCustomDomain,
  deletePrivateNetworkEndpoint,
  deleteService,
  deleteServiceDomain,
  deleteTcpProxy,
  deleteVolume,
  renamePrivateNetworkEndpoint,
  stageEnvironmentChanges,
  updateCustomDomain,
  updateServiceDomain,
  updateVolume,
} from "../railway/mutations.js";
import type { DomainInfo } from "../railway/queries.js";
import {
  fetchEnvironmentConfig,
  fetchPrivateNetworkEndpoint,
  fetchTcpProxy,
} from "../railway/queries.js";
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
  serviceDomainByService?: Map<string, DomainInfo>,
  customDomainsByService?: Map<string, DomainInfo[]>,
  volumeIdByService?: Map<string, string>,
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

  // Register newly created service IDs so later steps (egress, domains) can resolve them
  if (serviceNameToId) {
    for (const [name, id] of createdServiceIds) {
      serviceNameToId.set(name, id);
    }
  }

  // Step 1c: For newly created services with region config, null-inject Railway's
  // auto-assigned default regions. Railway assigns a default region on service creation
  // that we don't know about at diff time (service didn't exist yet).
  if (createdServiceIds.size > 0) {
    try {
      const postCreateConfig = await fetchEnvironmentConfig(client, environmentId);
      for (const [, svcId] of createdServiceIds) {
        const currentMrc = (postCreateConfig.services?.[svcId]?.deploy as Record<string, unknown>)
          ?.multiRegionConfig as Record<string, unknown> | undefined;
        const desiredMrc = (desiredConfig.services?.[svcId]?.deploy as Record<string, unknown>)
          ?.multiRegionConfig as Record<string, unknown> | undefined;
        if (currentMrc && desiredMrc) {
          for (const region of Object.keys(currentMrc)) {
            if (!(region in desiredMrc)) {
              (desiredMrc as Record<string, unknown>)[region] = null;
            }
          }
        }
      }
    } catch {
      // Non-fatal — convergence will clean up on next run
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

  // Step 2b: Create new buckets (can't be done via patches)
  for (const [key, bucket] of Object.entries(desiredState.buckets)) {
    if (bucket.id) continue; // Already exists
    try {
      const created = await createBucket(client, projectId, bucket.name);
      // Update the desired config with the new bucket ID
      desiredConfig.buckets = desiredConfig.buckets || {};
      desiredConfig.buckets[created.id] = { region: bucket.region || "iad", isCreated: true };
      logger.success(`Created bucket: ${bucket.name} (${created.id})`);
    } catch (err) {
      result.errors.push({
        step: `create-bucket:${key}`,
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
      // "domain" and "railway-domain" categories are handled via separate mutations
      // in steps 4.6 and 4.7, not via null-injection in the patch.
    } else if (
      entry.category === "setting" &&
      entry.path.startsWith("deploy.multiRegionConfig.") &&
      entry.serviceName &&
      serviceNameToId
    ) {
      // Region keys are a collection — need per-key null to remove old regions
      const svcId = serviceNameToId.get(entry.serviceName);
      if (svcId && desiredConfig.services?.[svcId]) {
        const region = entry.path.slice("deploy.multiRegionConfig.".length);
        const svcCfg = desiredConfig.services[svcId];
        svcCfg.deploy = svcCfg.deploy || {};
        const mrc =
          ((svcCfg.deploy as Record<string, unknown>).multiRegionConfig as Record<
            string,
            unknown
          >) || {};
        mrc[region] = null;
        (svcCfg.deploy as Record<string, unknown>).multiRegionConfig = mrc;
      }
    }
    // "volume" remove entries: handled post-commit via volumeDelete (step 4.8)
    // TCP proxy removal/update: handled post-commit via Step 4.4
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

      // Clean up orphaned volumes created in step 2
      for (const vol of createdVolumeIds) {
        try {
          await deleteVolume(client, vol.id);
          logger.warn(`Cleaned up orphaned volume for ${vol.serviceName}`);
        } catch {
          logger.warn(
            `Orphaned volume for ${vol.serviceName} (ID: ${vol.id}) — delete manually in Railway dashboard`,
          );
        }
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

  // Step 4.4: Delete TCP proxies (must happen after commit, not in --stage mode)
  // Patches can create proxies but can't remove them (null injection is ignored).
  // For updates (port change), delete old proxy so the committed patch can create the new one.
  if (result.committed) {
    for (const entry of diff.entries) {
      if (
        entry.category === "setting" &&
        entry.path.startsWith("networking.tcpProxies.") &&
        (entry.action === "remove" || entry.action === "update") &&
        entry.serviceName &&
        serviceNameToId
      ) {
        const svcId = serviceNameToId.get(entry.serviceName);
        if (svcId) {
          try {
            const proxy = await fetchTcpProxy(client, svcId, environmentId);
            if (proxy) {
              await deleteTcpProxy(client, proxy.id);
              logger.success(`Deleted TCP proxy ${proxy.applicationPort} for ${entry.serviceName}`);
            }
          } catch (err) {
            result.errors.push({
              step: `tcp-proxy-delete:${entry.serviceName}`,
              error: extractErrorMessage(err),
            });
          }
        }
      }
    }
  }

  // Step 4.5: Handle static outbound IPs (egress gateways — separate from patch system)
  for (const entry of diff.entries) {
    if (entry.path !== "staticOutboundIps" || !entry.serviceName || !serviceNameToId) continue;
    const svcId =
      serviceNameToId.get(entry.serviceName) ?? createdServiceIds.get(entry.serviceName);
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

  // Step 4.6: Handle railway domains (service domains — separate from patch system)
  for (const entry of diff.entries) {
    if (entry.category !== "railway-domain" || !entry.serviceName || !serviceNameToId) continue;
    const svcId = serviceNameToId.get(entry.serviceName);
    if (!svcId) continue;
    try {
      if (entry.action === "add") {
        const port = desiredState.services[entry.serviceName]?.railwayDomain?.targetPort;
        const created = await createServiceDomain(client, svcId, environmentId, port);
        logger.success(`Created railway domain for ${entry.serviceName}: ${created.domain}`);
      } else if (entry.action === "remove") {
        const domainInfo = serviceDomainByService?.get(entry.serviceName);
        if (domainInfo) {
          await deleteServiceDomain(client, domainInfo.id);
          logger.success(`Deleted railway domain for ${entry.serviceName}: ${domainInfo.domain}`);
        }
      } else if (entry.action === "update") {
        const domainInfo = serviceDomainByService?.get(entry.serviceName);
        if (domainInfo) {
          const port = desiredState.services[entry.serviceName]?.railwayDomain?.targetPort;
          await updateServiceDomain(client, {
            serviceDomainId: domainInfo.id,
            serviceId: svcId,
            environmentId,
            domain: domainInfo.domain,
            targetPort: port,
          });
          logger.success(`Updated railway domain port for ${entry.serviceName}`);
        }
      }
    } catch (err) {
      result.errors.push({
        step: `railway-domain:${entry.serviceName}`,
        error: extractErrorMessage(err),
      });
    }
  }

  // Step 4.7: Handle custom domains (separate mutations, not patches)
  for (const entry of diff.entries) {
    if (entry.category !== "domain" || !entry.serviceName || !serviceNameToId) continue;
    const svcId = serviceNameToId.get(entry.serviceName);
    if (!svcId) continue;
    try {
      if (entry.action === "add") {
        const domainPrefix = "networking.customDomains.";
        const domain = entry.path.startsWith(domainPrefix)
          ? entry.path.slice(domainPrefix.length)
          : entry.path;
        const port =
          entry.newValue && typeof entry.newValue === "object" && "port" in entry.newValue
            ? (entry.newValue as { port: number }).port
            : undefined;
        await createCustomDomain(client, projectId, svcId, environmentId, domain, port);
        logger.success(`Created custom domain: ${domain}`);
      } else if (entry.action === "remove") {
        const domainPrefix = "networking.customDomains.";
        const domainName = entry.path.startsWith(domainPrefix)
          ? entry.path.slice(domainPrefix.length)
          : entry.path;
        const currentDomains = customDomainsByService?.get(entry.serviceName) ?? [];
        const domainInfo = currentDomains.find((d) => d.domain === domainName);
        if (domainInfo) {
          await deleteCustomDomain(client, domainInfo.id);
          logger.success(`Deleted custom domain: ${domainName}`);
        }
      } else if (entry.action === "update") {
        const domainPrefix = "networking.customDomains.";
        const domainName = entry.path.startsWith(domainPrefix)
          ? entry.path.slice(domainPrefix.length)
          : entry.path;
        const currentDomains = customDomainsByService?.get(entry.serviceName) ?? [];
        const domainInfo = currentDomains.find((d) => d.domain === domainName);
        if (domainInfo) {
          const port =
            entry.newValue && typeof entry.newValue === "object" && "port" in entry.newValue
              ? (entry.newValue as { port: number }).port
              : undefined;
          await updateCustomDomain(client, domainInfo.id, environmentId, port);
          logger.success(`Updated custom domain: ${domainName}`);
        }
      }
    } catch (err) {
      result.errors.push({
        step: `custom-domain:${entry.serviceName}`,
        error: extractErrorMessage(err),
      });
    }
  }

  // Step 4.75: Handle private network endpoints (dedicated mutations)
  for (const entry of diff.entries) {
    if (entry.category !== "private-hostname" || !entry.serviceName || !serviceNameToId) continue;
    const svcId =
      serviceNameToId.get(entry.serviceName) ?? createdServiceIds.get(entry.serviceName);
    if (!svcId) continue;
    try {
      if (entry.action === "add" || entry.action === "update") {
        // Fetch current endpoint to get its ID and private network ID.
        // For newly created services, Railway may not have assigned an endpoint yet,
        // so we retry with exponential backoff (1s, 2s, 4s).
        let resolved = await fetchPrivateNetworkEndpoint(client, environmentId, svcId);
        if (!resolved) {
          for (const delay of [1000, 2000, 4000]) {
            await new Promise((r) => setTimeout(r, delay));
            resolved = await fetchPrivateNetworkEndpoint(client, environmentId, svcId);
            if (resolved) break;
          }
        }
        if (resolved) {
          await renamePrivateNetworkEndpoint(
            client,
            resolved.id,
            entry.newValue as string,
            resolved.privateNetworkId,
          );
          logger.success(`Set private hostname for ${entry.serviceName}: ${entry.newValue}`);
        } else {
          result.errors.push({
            step: `private-hostname:${entry.serviceName}`,
            error: "Could not find private network endpoint to rename",
          });
        }
      } else if (entry.action === "remove") {
        const endpoint = await fetchPrivateNetworkEndpoint(client, environmentId, svcId);
        if (endpoint) {
          await deletePrivateNetworkEndpoint(client, endpoint.id);
          logger.success(`Removed private hostname for ${entry.serviceName}`);
        }
      }
    } catch (err) {
      result.errors.push({
        step: `private-hostname:${entry.serviceName}`,
        error: extractErrorMessage(err),
      });
    }
  }

  // Step 4.8: Handle volume mount removal (volumeDelete — separate from patch system)
  for (const entry of diff.entries) {
    if (entry.category !== "volume" || entry.action !== "remove" || !entry.serviceName) continue;
    const volId = entry.path.split(".").pop();
    if (!volId) continue;
    // Also check volumeIdByService for the volume ID
    const resolvedVolId = volumeIdByService?.get(entry.serviceName) ?? volId;
    try {
      await deleteVolume(client, resolvedVolId);
      logger.success(`Deleted volume for ${entry.serviceName}`);
    } catch (err) {
      result.errors.push({
        step: `delete-volume:${entry.serviceName}`,
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
