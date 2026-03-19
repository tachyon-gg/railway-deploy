/**
 * Diff engine: compares desired EnvironmentConfig against current (live) EnvironmentConfig.
 *
 * Produces a ConfigDiff containing field-level changes plus service/volume lifecycle operations.
 */

import { logger } from "../logger.js";
import type {
  ConfigDiff,
  ConfigDiffEntry,
  ServiceToCreate,
  ServiceToDelete,
  VolumeToCreate,
} from "../types/changeset.js";
import type {
  EnvConfigBuild,
  EnvConfigDeploy,
  EnvConfigNetworking,
  EnvConfigService,
  EnvConfigSource,
  EnvConfigVariable,
  EnvConfigVolume,
  EnvironmentConfig,
} from "../types/envconfig.js";
import type { State } from "../types/state.js";
import { deepEqual } from "../util.js";

/** Railway auto-injects these read-only variables. Never diff them. */
const RAILWAY_MANAGED_PREFIXES = ["RAILWAY_"];

function isRailwayManaged(key: string): boolean {
  return RAILWAY_MANAGED_PREFIXES.some((p) => key.startsWith(p));
}

export interface DiffContext {
  /** Map from service ID → service name (for display) */
  serviceIdToName: Map<string, string>;
  /** The desired State (for service create info) */
  desiredState: State;
  /** All service names in config across all environments (for scoping) */
  allServiceNames: Set<string>;
  /** Shared variable names explicitly marked for deletion via null */
  deletedSharedVars: string[];
  /** Per-service variable names explicitly marked for deletion via null */
  deletedVars: Record<string, string[]>;
  /** Current egress gateway status per service name (true = has static IPs) */
  egressByService?: Map<string, boolean>;
  /** Current custom domains per service name */
  customDomainsByService?: Map<string, Array<{ id: string; domain: string; targetPort?: number }>>;
  /** Current railway domain (service domain) per service name */
  serviceDomainByService?: Map<string, { id: string; domain: string; targetPort?: number }>;
}

/**
 * Compute the diff between desired and current EnvironmentConfig.
 */
export function computeConfigDiff(
  desired: EnvironmentConfig,
  current: EnvironmentConfig,
  ctx: DiffContext,
): ConfigDiff {
  const entries: ConfigDiffEntry[] = [];
  const servicesToCreate: ServiceToCreate[] = [];
  const servicesToDelete: ServiceToDelete[] = [];
  const volumesToCreate: VolumeToCreate[] = [];
  const dataLossEntries: ConfigDiffEntry[] = [];

  // --- Shared variables ---
  diffSharedVariables(desired, current, ctx.deletedSharedVars, entries);

  // --- Services ---
  const desiredServices = desired.services || {};
  const currentServices = current.services || {};
  const desiredIds = new Set(Object.keys(desiredServices));
  const currentIds = new Set(Object.keys(currentServices));

  // Services to update (exist in both desired and current)
  for (const id of desiredIds) {
    const name = ctx.serviceIdToName.get(id) || id;
    if (currentIds.has(id)) {
      diffService(
        name,
        desiredServices[id],
        currentServices[id],
        ctx.deletedVars[name] || [],
        entries,
        dataLossEntries,
      );
    } else {
      // Service ID in desired but not in current — this means it was just created
      // and we're including its full config. Emit "add" entries for display.
      emitNewServiceEntries(name, desiredServices[id], entries);
    }
  }

  // Detect services to create (in desired State but no ID — not yet in desired EnvironmentConfig)
  for (const [name, svc] of Object.entries(ctx.desiredState.services)) {
    const hasId = [...ctx.serviceIdToName.entries()].some(([, n]) => n === name);
    if (!hasId) {
      servicesToCreate.push({
        name,
        source: svc.source,
        volume: svc.volume,
        cronSchedule: svc.cronSchedule,
        branch: svc.branch,
        registryCredentials: svc.registryCredentials,
      });
    }
  }

  // Services to delete (in current but not desired, and not scoped to other envs)
  for (const id of currentIds) {
    if (!desiredIds.has(id)) {
      const name = ctx.serviceIdToName.get(id) || id;
      // Don't delete if service exists in config but is scoped to another environment
      if (ctx.allServiceNames.has(name)) continue;
      servicesToDelete.push({ name, serviceId: id });
      const entry: ConfigDiffEntry = {
        path: "service",
        action: "remove",
        serviceName: name,
        category: "service",
      };
      entries.push(entry);
      // Flag as data loss if the service has volumes attached
      const currentSvc = currentServices[id];
      if (currentSvc?.volumeMounts && Object.keys(currentSvc.volumeMounts).length > 0) {
        dataLossEntries.push(entry);
      }
    }
  }

  // --- Volumes to create ---
  // Check if any service in desired has a volume but no volumeId mapping
  for (const [name, svc] of Object.entries(ctx.desiredState.services)) {
    if (!svc.volume) continue;
    const serviceId = [...ctx.serviceIdToName.entries()].find(([, n]) => n === name)?.[0];
    if (!serviceId) continue; // New service — volume created with service
    const desiredSvc = desiredServices[serviceId];
    if (!desiredSvc?.volumeMounts || Object.keys(desiredSvc.volumeMounts).length === 0) {
      // Has volume in state but no volumeMount in config — needs creation
      const currentSvc = currentServices[serviceId];
      if (!currentSvc?.volumeMounts || Object.keys(currentSvc.volumeMounts).length === 0) {
        volumesToCreate.push({
          serviceName: name,
          serviceId,
          mount: svc.volume.mount,
          name: svc.volume.name,
        });
      }
    }
  }

  // --- Volumes (top-level size/region config) ---
  diffVolumes(desired, current, entries);

  // --- Buckets ---
  diffBuckets(desired, current, entries);

  // --- Static outbound IPs (egress gateways) ---
  // Not part of EnvironmentConfig — handled via separate API
  if (ctx.egressByService) {
    for (const [name, svc] of Object.entries(ctx.desiredState.services)) {
      const currentHasEgress = ctx.egressByService.get(name) ?? false;
      const desiredHasEgress = svc.staticOutboundIps ?? false;
      if (desiredHasEgress && !currentHasEgress) {
        entries.push({
          path: "staticOutboundIps",
          action: "add",
          serviceName: name,
          category: "setting",
          newValue: true,
        });
      } else if (!desiredHasEgress && currentHasEgress) {
        entries.push({
          path: "staticOutboundIps",
          action: "remove",
          serviceName: name,
          category: "setting",
          oldValue: true,
        });
      }
    }
  }

  // --- Private network endpoints ---
  // Not part of EnvironmentConfig patches — handled via dedicated mutations
  // (PrivateNetworkEndpointRename for create/update, PrivateNetworkEndpointDelete for removal).
  // Only diff when user explicitly configures private_hostname.
  // When user doesn't set private_hostname, Railway's auto-assigned value is left alone.
  for (const [name, svc] of Object.entries(ctx.desiredState.services)) {
    const serviceId = [...ctx.serviceIdToName.entries()].find(([, n]) => n === name)?.[0];
    const currentEndpoint = serviceId
      ? current.services?.[serviceId]?.networking?.privateNetworkEndpoint || undefined
      : undefined;

    if (svc.privateHostname !== undefined) {
      // User explicitly set private_hostname
      const desiredHostname = svc.privateHostname || undefined;
      if (desiredHostname !== currentEndpoint) {
        entries.push({
          path: "networking.privateNetworkEndpoint",
          action: desiredHostname ? (currentEndpoint ? "update" : "add") : "remove",
          serviceName: name,
          category: "private-hostname",
          oldValue: currentEndpoint,
          newValue: desiredHostname,
        });
      }
    }
    // When privateHostname is undefined (not in config), skip — leave Railway's value alone
  }

  // --- Custom domains ---
  // Not part of EnvironmentConfig patches — handled via separate mutations.
  // Compare desired State's domains vs current custom domains from service map.
  if (ctx.customDomainsByService) {
    for (const [name, svc] of Object.entries(ctx.desiredState.services)) {
      const desiredDomains = new Map(svc.domains.map((d) => [d.domain, d.targetPort]));
      const currentDomains = ctx.customDomainsByService.get(name) ?? [];
      const currentDomainMap = new Map(currentDomains.map((d) => [d.domain, d]));

      // Domains to add or update
      for (const [domain, targetPort] of desiredDomains) {
        const current = currentDomainMap.get(domain);
        if (!current) {
          entries.push({
            path: `networking.customDomains.${domain}`,
            action: "add",
            serviceName: name,
            category: "domain",
            newValue: targetPort ? { port: targetPort } : {},
          });
        } else if (targetPort !== current.targetPort) {
          entries.push({
            path: `networking.customDomains.${domain}`,
            action: "update",
            serviceName: name,
            category: "domain",
            oldValue: current.targetPort ? { port: current.targetPort } : {},
            newValue: targetPort ? { port: targetPort } : {},
          });
        }
      }

      // Domains to remove
      for (const current of currentDomains) {
        if (!desiredDomains.has(current.domain)) {
          entries.push({
            path: `networking.customDomains.${current.domain}`,
            action: "remove",
            serviceName: name,
            category: "domain",
            oldValue: current.domain,
          });
        }
      }
    }
  }

  // --- Railway domains (service domains) ---
  // Not part of EnvironmentConfig patches — handled via separate mutations.
  // Compare desired State's railwayDomain vs current service domain from serviceDomainByService.
  // NOTE: EnvironmentConfig does NOT include serviceDomains from the Railway API,
  // so we must use the serviceDomainByService map fetched via the GetProject query.
  if (ctx.serviceDomainByService) {
    for (const [name, svc] of Object.entries(ctx.desiredState.services)) {
      const currentDomain = ctx.serviceDomainByService.get(name);
      const currentHasDomain = !!currentDomain;
      const desiredHasDomain = !!svc.railwayDomain;

      if (desiredHasDomain && !currentHasDomain) {
        entries.push({
          path: "networking.serviceDomains",
          action: "add",
          serviceName: name,
          category: "railway-domain",
          newValue: svc.railwayDomain?.targetPort
            ? `port ${svc.railwayDomain.targetPort}`
            : "enabled",
        });
      } else if (!desiredHasDomain && currentHasDomain) {
        entries.push({
          path: `networking.serviceDomains.${currentDomain.domain}`,
          action: "remove",
          serviceName: name,
          category: "railway-domain",
          oldValue: currentDomain.domain,
        });
      } else if (desiredHasDomain && currentHasDomain) {
        const desiredPort = svc.railwayDomain?.targetPort;
        const currentPort = currentDomain.targetPort;
        if (desiredPort !== currentPort) {
          entries.push({
            path: `networking.serviceDomains.${currentDomain.domain}`,
            action: "update",
            serviceName: name,
            category: "railway-domain",
            oldValue: currentPort,
            newValue: desiredPort,
          });
        }
      }
    }
  }

  return {
    entries,
    servicesToCreate,
    servicesToDelete,
    volumesToCreate,
    hasDataLoss: dataLossEntries.length > 0,
    dataLossEntries,
  };
}

function diffSharedVariables(
  desired: EnvironmentConfig,
  current: EnvironmentConfig,
  deletedSharedVars: string[],
  entries: ConfigDiffEntry[],
): void {
  const desiredVars = desired.sharedVariables || {};
  const currentVars = current.sharedVariables || {};

  // Added or changed
  for (const [key, dv] of Object.entries(desiredVars)) {
    if (isRailwayManaged(key)) continue;
    const cv = currentVars[key];
    if (!cv) {
      entries.push({
        path: `sharedVariables.${key}`,
        action: "add",
        serviceName: null,
        category: "shared-variable",
        newValue: dv.value,
      });
    } else if (dv.value !== cv.value) {
      entries.push({
        path: `sharedVariables.${key}`,
        action: "update",
        serviceName: null,
        category: "shared-variable",
        oldValue: cv.value,
        newValue: dv.value,
      });
    }
  }

  // Removed (in current but not in desired, or explicitly deleted)
  const allDeletes = new Set(deletedSharedVars);
  for (const key of Object.keys(currentVars)) {
    if (isRailwayManaged(key)) continue;
    if (!(key in desiredVars) && !allDeletes.has(key)) {
      allDeletes.add(key);
    }
  }
  for (const key of allDeletes) {
    if (isRailwayManaged(key)) continue;
    if (key in currentVars) {
      entries.push({
        path: `sharedVariables.${key}`,
        action: "remove",
        serviceName: null,
        category: "shared-variable",
        oldValue: currentVars[key]?.value,
      });
    }
  }
}

function diffService(
  name: string,
  desiredRaw: EnvConfigService,
  currentRaw: EnvConfigService,
  deletedVarNames: string[],
  entries: ConfigDiffEntry[],
  dataLossEntries: ConfigDiffEntry[],
): void {
  // Enrich both sides with known Railway defaults before comparing
  const desired = enrichServiceDefaults(desiredRaw);
  const current = enrichServiceDefaults(currentRaw);

  diffServiceVariables(
    name,
    desired.variables || {},
    current.variables || {},
    deletedVarNames,
    entries,
  );
  diffServiceSource(name, desired.source, current.source, entries);
  diffServiceNetworking(name, desired.networking, current.networking, entries);
  diffServiceBuild(name, desired.build, current.build, entries);
  diffServiceDeploy(name, desired.deploy, current.deploy, entries);
  diffServiceVolumeMounts(
    name,
    desired.volumeMounts,
    current.volumeMounts,
    entries,
    dataLossEntries,
  );
  if ((desired.configFile || "") !== (current.configFile || "")) {
    entries.push({
      path: "configFile",
      action: desired.configFile ? (current.configFile ? "update" : "add") : "remove",
      serviceName: name,
      category: "setting",
      oldValue: current.configFile,
      newValue: desired.configFile,
    });
  }
}

function diffServiceVariables(
  name: string,
  desired: Record<string, EnvConfigVariable>,
  current: Record<string, EnvConfigVariable>,
  deletedVarNames: string[],
  entries: ConfigDiffEntry[],
): void {
  // Added or changed
  for (const [key, dv] of Object.entries(desired)) {
    if (isRailwayManaged(key)) continue;
    const cv = current[key];
    if (!cv) {
      entries.push({
        path: `variables.${key}`,
        action: "add",
        serviceName: name,
        category: "variable",
        newValue: dv.value,
      });
    } else if (dv.value !== cv.value) {
      entries.push({
        path: `variables.${key}`,
        action: "update",
        serviceName: name,
        category: "variable",
        oldValue: cv.value,
        newValue: dv.value,
      });
    }
  }

  // Removed
  const allDeletes = new Set(deletedVarNames);
  for (const key of Object.keys(current)) {
    if (isRailwayManaged(key)) continue;
    if (!(key in desired) && !allDeletes.has(key)) {
      allDeletes.add(key);
    }
  }
  for (const key of allDeletes) {
    if (isRailwayManaged(key)) continue;
    if (key in current) {
      entries.push({
        path: `variables.${key}`,
        action: "remove",
        serviceName: name,
        category: "variable",
        oldValue: current[key]?.value,
      });
    }
  }
}

function diffServiceSource(
  name: string,
  desired: EnvConfigSource | undefined,
  current: EnvConfigSource | undefined,
  entries: ConfigDiffEntry[],
): void {
  if (!desired && !current) return;

  const fields: (keyof EnvConfigSource)[] = [
    "image",
    "repo",
    "branch",
    "rootDirectory",
    "checkSuites",
  ];
  for (const field of fields) {
    const dv = normalizeEmpty(desired?.[field]);
    const cv = normalizeEmpty(current?.[field]);
    if (dv === undefined && cv === undefined) continue;
    if (!deepEqual(dv, cv)) {
      entries.push({
        path: `source.${field}`,
        action: dv === undefined ? "remove" : cv !== undefined ? "update" : "add",
        serviceName: name,
        category: "setting",
        oldValue: cv,
        newValue: dv,
      });
    }
  }

  // autoUpdates
  if (
    !deepEqual(desired?.autoUpdates, current?.autoUpdates) &&
    (desired?.autoUpdates || current?.autoUpdates)
  ) {
    entries.push({
      path: "source.autoUpdates",
      action: desired?.autoUpdates ? (current?.autoUpdates ? "update" : "add") : "remove",
      serviceName: name,
      category: "setting",
      oldValue: current?.autoUpdates,
      newValue: desired?.autoUpdates,
    });
  }
}

function diffServiceNetworking(
  name: string,
  desired: EnvConfigNetworking | undefined,
  current: EnvConfigNetworking | undefined,
  entries: ConfigDiffEntry[],
): void {
  // Custom domains are handled via separate mutations — diffed at the top level
  // in computeConfigDiff using desiredState.domains vs customDomainsByService.

  // Private network endpoint is handled via dedicated mutations in apply.ts.
  // Diffing is done at the top level in computeConfigDiff using
  // desiredState.privateHostname vs current config's privateNetworkEndpoint.

  // Service domains (railway domain) are handled via separate mutations in apply.ts.
  // Diffing is done at the top level in computeConfigDiff using desiredState.railwayDomain
  // vs current EnvironmentConfig's serviceDomains.

  // TCP proxies — keyed by port number as string
  const desiredProxies = desired?.tcpProxies || {};
  const currentProxies = current?.tcpProxies || {};
  for (const port of Object.keys(desiredProxies)) {
    if (!(port in currentProxies)) {
      entries.push({
        path: `networking.tcpProxies.${port}`,
        action: "add",
        serviceName: name,
        category: "setting",
        newValue: port,
      });
    }
  }
  for (const port of Object.keys(currentProxies)) {
    if (!(port in desiredProxies)) {
      entries.push({
        path: `networking.tcpProxies.${port}`,
        action: "remove",
        serviceName: name,
        category: "setting",
        oldValue: port,
      });
    }
  }
}

/** Fields that Railway manages internally — never diff */
const RAILWAY_INTERNAL_FIELDS = new Set(["runtime", "useLegacyStacker"]);

/** Known Railway defaults — used to enrich both desired and current configs */
const DEPLOY_DEFAULTS: Record<string, unknown> = {
  restartPolicyType: "ON_FAILURE",
  restartPolicyMaxRetries: 10,
  ipv6EgressEnabled: false,
};

const BUILD_DEFAULTS: Record<string, unknown> = {
  builder: "RAILPACK",
};

/**
 * Enrich a service config with known Railway defaults for missing fields.
 * Applied to BOTH desired and current configs before diffing so that
 * default values match on both sides.
 */
function enrichServiceDefaults(svc: EnvConfigService): EnvConfigService {
  return {
    ...svc,
    build: {
      ...svc.build,
      // Railway forces builder to DOCKERFILE when dockerfilePath is set
      builder:
        svc.build?.builder ??
        (svc.build?.dockerfilePath ? "DOCKERFILE" : (BUILD_DEFAULTS.builder as string)),
    },
    deploy: {
      ...svc.deploy,
      restartPolicyType:
        svc.deploy?.restartPolicyType ?? (DEPLOY_DEFAULTS.restartPolicyType as string),
      restartPolicyMaxRetries:
        svc.deploy?.restartPolicyMaxRetries ?? (DEPLOY_DEFAULTS.restartPolicyMaxRetries as number),
      ipv6EgressEnabled:
        svc.deploy?.ipv6EgressEnabled ?? (DEPLOY_DEFAULTS.ipv6EgressEnabled as boolean),
    },
  };
}

/**
 * Normalize null/undefined to a common empty sentinel for comparison.
 * Railway omits default fields from config (undefined), while our desired config
 * sends null for unset fields. Both mean "not set" — treat them as equal.
 */
/**
 * Normalize null/undefined/false/0 to a common empty sentinel for comparison.
 * Railway omits default fields from config — both null (our "clear" signal)
 * and undefined (Railway's "not set") mean the same thing.
 * Railway also omits boolean fields at their default value (false), so
 * false is equivalent to undefined/null for diff purposes.
 *
 * Zero is included because Railway omits numeric fields at their default (0)
 * for fields like drainingSeconds and overlapSeconds. Without this, desired=0
 * vs current=undefined would produce a spurious diff. Fields where 0 is a
 * meaningful non-default value (e.g. restartPolicyMaxRetries, default 10)
 * are handled by enrichServiceDefaults which fills in the real default when
 * the value is undefined, so the comparison never reaches normalizeEmpty
 * with a 0-vs-undefined mismatch.
 */
function normalizeEmpty(v: unknown): unknown {
  if (v === null || v === undefined || v === false || v === 0) return undefined;
  if (Array.isArray(v) && v.length === 0) return undefined;
  return v;
}

function diffServiceBuild(
  name: string,
  desired: EnvConfigBuild | undefined,
  current: EnvConfigBuild | undefined,
  entries: ConfigDiffEntry[],
): void {
  if (!desired && !current) return;

  const fields: (keyof EnvConfigBuild)[] = [
    "builder",
    "dockerfilePath",
    "buildCommand",
    "watchPatterns",
  ];
  for (const field of fields) {
    const dv = normalizeEmpty(desired?.[field]);
    const cv = normalizeEmpty(current?.[field]);
    if (dv === undefined && cv === undefined) continue;
    if (!deepEqual(dv, cv)) {
      entries.push({
        path: `build.${field}`,
        action: dv === undefined ? "remove" : cv !== undefined ? "update" : "add",
        serviceName: name,
        category: "setting",
        oldValue: cv,
        newValue: dv,
      });
    }
  }

  // buildEnvironment: non-clearable — Railway ignores null. Only diff when desired includes it.
  const dBuildEnv = normalizeEmpty(desired?.buildEnvironment);
  const cBuildEnv = normalizeEmpty(current?.buildEnvironment);
  if (dBuildEnv && !deepEqual(dBuildEnv, cBuildEnv)) {
    entries.push({
      path: "build.buildEnvironment",
      action: cBuildEnv ? "update" : "add",
      serviceName: name,
      category: "setting",
      oldValue: cBuildEnv,
      newValue: dBuildEnv,
    });
  }
}

function diffServiceDeploy(
  name: string,
  desired: EnvConfigDeploy | undefined,
  current: EnvConfigDeploy | undefined,
  entries: ConfigDiffEntry[],
): void {
  if (!desired && !current) return;

  // Simple scalar fields
  const scalarFields: (keyof EnvConfigDeploy)[] = [
    "startCommand",
    "restartPolicyType",
    "restartPolicyMaxRetries",
    "cronSchedule",
    "healthcheckPath",
    "healthcheckTimeout",
    "sleepApplication",
    "drainingSeconds",
    "overlapSeconds",
    "ipv6EgressEnabled",
    "preDeployCommand",
  ];
  for (const field of scalarFields) {
    if (RAILWAY_INTERNAL_FIELDS.has(field)) continue;
    const dv = normalizeEmpty(desired?.[field]);
    const cv = normalizeEmpty(current?.[field]);
    if (dv === undefined && cv === undefined) continue;
    if (!deepEqual(dv, cv)) {
      entries.push({
        path: `deploy.${field}`,
        action: dv === undefined ? "remove" : cv !== undefined ? "update" : "add",
        serviceName: name,
        category: "setting",
        oldValue: cv,
        newValue: dv,
      });
    }
  }

  // Multi-region config — treated as a collection of region keys
  // When user sets region, diff individual region keys (add/update/remove)
  // When user doesn't set region, skip (Railway keeps its default)
  const dMrc = (desired?.multiRegionConfig as Record<string, unknown> | null | undefined) ?? {};
  const cMrc = (current?.multiRegionConfig as Record<string, unknown> | null | undefined) ?? {};
  if (Object.keys(dMrc).length === 0 && Object.keys(cMrc).length > 0) {
    logger.warn(
      `${name} has Railway region assignment — remove individual regions from the regions: map to clear them`,
    );
  }
  if (Object.keys(dMrc).length > 0) {
    // User configured region — diff per-key
    for (const [region, dv] of Object.entries(dMrc)) {
      const cv = cMrc[region];
      if (!deepEqual(dv, cv)) {
        entries.push({
          path: `deploy.multiRegionConfig.${region}`,
          action: cv !== undefined ? "update" : "add",
          serviceName: name,
          category: "setting",
          oldValue: cv,
          newValue: dv,
        });
      }
    }
    // Regions in current but not in desired — need removal
    for (const region of Object.keys(cMrc)) {
      if (!(region in dMrc)) {
        entries.push({
          path: `deploy.multiRegionConfig.${region}`,
          action: "remove",
          serviceName: name,
          category: "setting",
          oldValue: cMrc[region],
        });
      }
    }
  }

  // Limit override — diff if either side has it
  // Railway keeps limitOverride once set, but { containers: null } clears limits.
  // We must diff both directions: setting and clearing.
  // When desired is { containers: null } and current is absent, both mean "no limits" — skip.
  const dLimits = desired?.limitOverride;
  const cLimits = current?.limitOverride;
  const dIsEmpty =
    dLimits === null ||
    dLimits === undefined ||
    dLimits.containers === null ||
    dLimits.containers === undefined;
  const cIsEmpty =
    cLimits === null ||
    cLimits === undefined ||
    cLimits.containers === null ||
    cLimits.containers === undefined;
  if (!(dIsEmpty && cIsEmpty) && !deepEqual(dLimits, cLimits)) {
    const isClearing = dIsEmpty;
    const hadLimits = !cIsEmpty;
    const action = isClearing && hadLimits ? "remove" : cLimits ? "update" : "add";
    entries.push({
      path: "deploy.limitOverride",
      action,
      serviceName: name,
      category: "setting",
      oldValue: cLimits,
      newValue: dLimits,
    });
  }

  // Registry credentials — always include if desired has them (Railway never returns them).
  // NOTE: We cannot detect removal of registry credentials. Railway's API never returns
  // credentials in the config response (they are write-only), so there is no "current"
  // value to diff against. If a user removes registryCredentials from their config,
  // we simply stop sending them — but we can't emit a "remove" diff entry because
  // we never see them on the current side.
  if (desired?.registryCredentials) {
    entries.push({
      path: "deploy.registryCredentials",
      action: "update",
      serviceName: name,
      category: "setting",
      newValue: "(credentials)",
    });
  }
}

function diffServiceVolumeMounts(
  name: string,
  desired: Record<string, { mountPath: string }> | undefined,
  current: Record<string, { mountPath: string }> | undefined,
  entries: ConfigDiffEntry[],
  dataLossEntries: ConfigDiffEntry[],
): void {
  const desiredMounts = desired || {};
  const currentMounts = current || {};

  for (const [volId, dv] of Object.entries(desiredMounts)) {
    const cv = currentMounts[volId];
    if (!cv) {
      entries.push({
        path: `volumeMounts.${volId}`,
        action: "add",
        serviceName: name,
        category: "volume",
        newValue: dv.mountPath,
      });
    } else if (dv.mountPath !== cv.mountPath) {
      entries.push({
        path: `volumeMounts.${volId}`,
        action: "update",
        serviceName: name,
        category: "volume",
        oldValue: cv.mountPath,
        newValue: dv.mountPath,
      });
    }
  }

  for (const volId of Object.keys(currentMounts)) {
    if (!(volId in desiredMounts)) {
      const entry: ConfigDiffEntry = {
        path: `volumeMounts.${volId}`,
        action: "remove",
        serviceName: name,
        category: "volume",
        oldValue: currentMounts[volId].mountPath,
      };
      entries.push(entry);
      dataLossEntries.push(entry);
    }
  }
}

function diffVolumes(
  desired: EnvironmentConfig,
  current: EnvironmentConfig,
  entries: ConfigDiffEntry[],
): void {
  const desiredVols = desired.volumes || {};
  const currentVols = current.volumes || {};

  for (const [id, dv] of Object.entries(desiredVols)) {
    const cv = currentVols[id];
    if (!cv) continue; // New volumes are handled by volumesToCreate
    diffVolumeFields(id, dv, cv, entries);
  }
}

function diffVolumeFields(
  volId: string,
  desired: EnvConfigVolume,
  current: EnvConfigVolume,
  entries: ConfigDiffEntry[],
): void {
  if (desired.sizeMB !== undefined && desired.sizeMB !== current.sizeMB) {
    entries.push({
      path: `volumes.${volId}.sizeMB`,
      action: current.sizeMB !== undefined ? "update" : "add",
      serviceName: null,
      category: "volume",
      oldValue: current.sizeMB,
      newValue: desired.sizeMB,
    });
  }
  if (desired.region !== undefined && desired.region !== current.region) {
    entries.push({
      path: `volumes.${volId}.region`,
      action: current.region !== undefined ? "update" : "add",
      serviceName: null,
      category: "volume",
      oldValue: current.region,
      newValue: desired.region,
    });
  }
}

function diffBuckets(
  desired: EnvironmentConfig,
  current: EnvironmentConfig,
  entries: ConfigDiffEntry[],
): void {
  const desiredBuckets = desired.buckets || {};
  const currentBuckets = current.buckets || {};

  for (const [id, dv] of Object.entries(desiredBuckets)) {
    if (!(id in currentBuckets)) {
      entries.push({
        path: `buckets.${id}`,
        action: "add",
        serviceName: null,
        category: "bucket",
        newValue: dv,
      });
    }
  }
  // Warn about buckets in current but not in desired (deletion not supported by Railway)
  for (const id of Object.keys(currentBuckets)) {
    if (!(id in desiredBuckets)) {
      logger.warn(
        `Bucket ${id} exists in Railway but not in config — bucket deletion is not supported by Railway`,
      );
    }
  }
}

/**
 * Emit "add" entries for all fields of a newly created service (for display).
 */
function emitNewServiceEntries(
  name: string,
  svc: EnvConfigService,
  entries: ConfigDiffEntry[],
): void {
  entries.push({
    path: "service",
    action: "add",
    serviceName: name,
    category: "service",
    newValue: svc.source?.image || svc.source?.repo || "empty",
  });

  if (svc.variables) {
    for (const [key, v] of Object.entries(svc.variables)) {
      entries.push({
        path: `variables.${key}`,
        action: "add",
        serviceName: name,
        category: "variable",
        newValue: v.value,
      });
    }
  }

  if (svc.networking?.customDomains) {
    for (const [domain, d] of Object.entries(svc.networking.customDomains)) {
      entries.push({
        path: `networking.customDomains.${domain}`,
        action: "add",
        serviceName: name,
        category: "domain",
        newValue: d,
      });
    }
  }
}
