/**
 * Builds an EnvironmentConfig (Railway's native format) from our State (loaded from YAML).
 *
 * This is the bridge between the config loader and Railway's patch system.
 * The resulting EnvironmentConfig can be staged via environmentStageChanges.
 *
 * IaC principle: every user-manageable field is explicitly set — either to the
 * user's value or to null (reset to Railway default). This eliminates the need
 * for post-hoc null-injection in the apply step for settings.
 *
 * Collections (variables, domains, shared vars, TCP proxies) use empty objects
 * to represent "none" — removals of individual items are handled by the diff
 * comparing desired vs current collections.
 *
 * Railway-internal fields (runtime, useLegacyStacker) are never sent.
 */

import type {
  EnvConfigNetworking,
  EnvConfigService,
  EnvConfigSource,
  EnvConfigVolume,
  EnvironmentConfig,
} from "../types/envconfig.js";
import type { ServiceState, State } from "../types/state.js";

/** Maps needed to build EnvironmentConfig (service names → IDs, volume names → IDs) */
export interface ConfigBuildMaps {
  serviceNameToId: Map<string, string>;
  /** Map from service name to volume ID (for existing volumes) */
  volumeIdByService: Map<string, string>;
}

/**
 * Build an EnvironmentConfig from our State representation.
 *
 * Only includes services that have a known ID (existing services).
 * New services (without IDs) are skipped here — they must be created
 * first via serviceCreate, then their config is added in a second pass.
 */
export function buildEnvironmentConfig(state: State, maps: ConfigBuildMaps): EnvironmentConfig {
  const config: EnvironmentConfig = {};

  // --- Services ---
  const services: Record<string, EnvConfigService> = {};
  for (const [name, svc] of Object.entries(state.services)) {
    const serviceId = maps.serviceNameToId.get(name);
    if (!serviceId) continue;

    services[serviceId] = buildServiceConfig(svc, maps.volumeIdByService.get(name));
  }
  if (Object.keys(services).length > 0) {
    config.services = services;
  }

  // --- Volumes (top-level config) ---
  const volumes: Record<string, EnvConfigVolume> = {};
  for (const [volName, volState] of Object.entries(state.volumes ?? {})) {
    let volumeId: string | undefined;
    for (const [svcName, svc] of Object.entries(state.services)) {
      if (svc.volume?.name === volName) {
        volumeId = maps.volumeIdByService.get(svcName);
        break;
      }
    }
    if (!volumeId) continue;
    const volConfig: EnvConfigVolume = {};
    if (volState.sizeMB !== undefined) volConfig.sizeMB = volState.sizeMB;
    if (volState.region) volConfig.region = volState.region;
    if (Object.keys(volConfig).length > 0) {
      volumes[volumeId] = volConfig;
    }
  }
  if (Object.keys(volumes).length > 0) {
    config.volumes = volumes;
  }

  // --- Shared variables ---
  // Always include (even if empty) — allows nulling removed vars in diff
  config.sharedVariables = {};
  for (const [key, value] of Object.entries(state.sharedVariables)) {
    config.sharedVariables[key] = { value };
  }

  // --- Buckets ---
  if (Object.keys(state.buckets).length > 0) {
    config.buckets = {};
    for (const [, bucket] of Object.entries(state.buckets)) {
      if (bucket.id) {
        config.buckets[bucket.id] = { region: bucket.region || "iad", isCreated: true };
      }
    }
  }

  return config;
}

/**
 * Build a single service's EnvironmentConfig block from ServiceState.
 *
 * Every user-manageable setting is explicitly set or nulled. This means the
 * patch sent to Railway contains the complete desired state for settings —
 * no post-hoc null-injection needed in the apply step.
 *
 * Railway-internal fields (runtime, useLegacyStacker) are omitted.
 */
export function buildServiceConfig(svc: ServiceState, volumeId?: string): EnvConfigService {
  const service: EnvConfigService = {};

  // --- Source ---
  if (svc.source?.image || svc.source?.repo) {
    const source: EnvConfigSource = {};
    if (svc.source?.image) source.image = svc.source.image;
    if (svc.source?.repo) source.repo = svc.source.repo;
    source.branch = svc.branch ?? null;
    source.rootDirectory = svc.rootDirectory ?? null;
    source.checkSuites = svc.waitForCi ?? null;
    source.autoUpdates = svc.autoUpdates
      ? { type: svc.autoUpdates.type, schedule: svc.autoUpdates.schedule }
      : null;
    service.source = source;
  }

  // --- Variables (always include — empty object means "no variables") ---
  service.variables = {};
  for (const [key, value] of Object.entries(svc.variables)) {
    service.variables[key] = { value };
  }

  // --- Networking ---
  const networking: EnvConfigNetworking = {};
  // Custom domains — always include (empty = no domains)
  networking.customDomains = {};
  for (const d of svc.domains) {
    networking.customDomains[d.domain] = d.targetPort !== undefined ? { port: d.targetPort } : {};
  }
  networking.privateNetworkEndpoint = svc.privateHostname ?? null;
  networking.serviceDomains = svc.railwayDomain
    ? { _: { port: svc.railwayDomain.targetPort } }
    : null;
  // TCP proxies — always include (empty = no proxies)
  networking.tcpProxies = {};
  if (svc.tcpProxies && svc.tcpProxies.length > 0) {
    for (const port of svc.tcpProxies) {
      networking.tcpProxies[String(port)] = {};
    }
  }
  service.networking = networking;

  // --- Build ---
  // Clearable fields: null when unset (Railway clears them)
  // Default-backed fields: omit when unset (Railway keeps its default)
  service.build = {
    builder: svc.builder ?? undefined, // default-backed: RAILPACK
    dockerfilePath: svc.dockerfilePath ?? null,
    buildCommand: svc.buildCommand ?? null,
    watchPatterns: svc.watchPatterns ?? null,
    buildEnvironment: svc.metal ? "V3" : null,
  };

  // --- Deploy ---
  // Clearable fields: null when unset (Railway clears them)
  // Default-backed fields: omit when unset (Railway keeps its default)
  service.deploy = {
    startCommand: svc.startCommand ?? null,
    restartPolicyType: svc.restartPolicy ?? undefined, // default-backed: ON_FAILURE
    restartPolicyMaxRetries: svc.restartPolicyMaxRetries ?? null,
    cronSchedule: svc.cronSchedule ?? null,
    healthcheckPath: svc.healthcheck?.path ?? null,
    healthcheckTimeout: svc.healthcheck?.timeout ?? null,
    sleepApplication: svc.serverless ?? null,
    drainingSeconds: svc.drainingSeconds ?? null,
    overlapSeconds: svc.overlapSeconds ?? null,
    ipv6EgressEnabled: svc.ipv6EgressEnabled ?? undefined, // default-backed: false
    preDeployCommand: svc.preDeployCommand ?? null,
    // multiRegionConfig: default-backed (project-specific region) — omit when unset
    ...(svc.region
      ? { multiRegionConfig: { [svc.region.region]: { numReplicas: svc.region.numReplicas } } }
      : {}),
    limitOverride: svc.limits
      ? {
          containers: {
            ...(svc.limits.memoryGB !== undefined
              ? { memoryBytes: Math.round(svc.limits.memoryGB * 1_000_000_000) }
              : {}),
            ...(svc.limits.vCPUs !== undefined ? { cpu: svc.limits.vCPUs } : {}),
          },
        }
      : null,
    ...(svc.registryCredentials ? { registryCredentials: svc.registryCredentials } : {}),
    // runtime and useLegacyStacker are Railway-internal — never send
  };

  // --- Volume mounts ---
  if (svc.volume && volumeId) {
    service.volumeMounts = {
      [volumeId]: { mountPath: svc.volume.mount },
    };
  }

  // --- Config file ---
  service.configFile = svc.railwayConfigFile ?? null;

  // Note: staticOutboundIps is handled via egress gateway mutations in apply.ts,
  // not through the EnvironmentConfig patch system.

  return service;
}
