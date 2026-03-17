/**
 * Builds an EnvironmentConfig (Railway's native format) from our State (loaded from YAML).
 *
 * This is the bridge between the config loader and Railway's patch system.
 * The resulting EnvironmentConfig can be staged via environmentStageChanges.
 *
 * IaC principle: every user-manageable field is explicitly set — either to the
 * user's value or to null (reset to Railway default). Fields not in config get
 * nulled so Railway clears any previously-set value.
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
 * IaC: every user-manageable field is explicitly set or nulled.
 * Railway-internal fields (runtime, useLegacyStacker) are omitted.
 */
function buildServiceConfig(svc: ServiceState, volumeId?: string): EnvConfigService {
  const service: EnvConfigService = {};

  // --- Source ---
  if (svc.source?.image || svc.source?.repo) {
    const source: EnvConfigSource = {};
    if (svc.source?.image) source.image = svc.source.image;
    if (svc.source?.repo) source.repo = svc.source.repo;
    if (svc.branch) source.branch = svc.branch;
    if (svc.rootDirectory) source.rootDirectory = svc.rootDirectory;
    if (svc.waitForCi !== undefined) source.checkSuites = svc.waitForCi;
    if (svc.autoUpdates) {
      source.autoUpdates = {
        type: svc.autoUpdates.type,
        schedule: svc.autoUpdates.schedule,
      };
    }
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
  if (svc.privateHostname) {
    networking.privateNetworkEndpoint = svc.privateHostname;
  }
  if (svc.railwayDomain) {
    // serviceDomains can be created via patches — Railway ignores the key
    // and assigns its own *.up.railway.app domain. The port is applied.
    networking.serviceDomains = {
      _: { port: svc.railwayDomain.targetPort },
    };
  }
  // tcpProxies in EnvironmentConfig are keyed by application port number as string
  if (svc.tcpProxies && svc.tcpProxies.length > 0) {
    networking.tcpProxies = {};
    for (const port of svc.tcpProxies) {
      networking.tcpProxies[String(port)] = {};
    }
  }
  service.networking = networking;

  // --- Build ---
  // Only include fields the user explicitly configured
  const build: Record<string, unknown> = {};
  if (svc.builder) build.builder = svc.builder;
  if (svc.dockerfilePath) build.dockerfilePath = svc.dockerfilePath;
  if (svc.buildCommand) build.buildCommand = svc.buildCommand;
  if (svc.watchPatterns) build.watchPatterns = svc.watchPatterns;
  if (svc.metal) build.buildEnvironment = "V3";
  if (Object.keys(build).length > 0) {
    service.build = build;
  }

  // --- Deploy ---
  // Only include fields the user explicitly configured
  const deploy: Record<string, unknown> = {};
  if (svc.startCommand) deploy.startCommand = svc.startCommand;
  if (svc.restartPolicy) deploy.restartPolicyType = svc.restartPolicy;
  if (svc.restartPolicyMaxRetries !== undefined)
    deploy.restartPolicyMaxRetries = svc.restartPolicyMaxRetries;
  if (svc.cronSchedule) deploy.cronSchedule = svc.cronSchedule;
  if (svc.healthcheck) {
    deploy.healthcheckPath = svc.healthcheck.path;
    deploy.healthcheckTimeout = svc.healthcheck.timeout;
  }
  if (svc.serverless !== undefined) deploy.sleepApplication = svc.serverless;
  if (svc.drainingSeconds !== undefined) deploy.drainingSeconds = svc.drainingSeconds;
  if (svc.overlapSeconds !== undefined) deploy.overlapSeconds = svc.overlapSeconds;
  if (svc.ipv6EgressEnabled !== undefined) deploy.ipv6EgressEnabled = svc.ipv6EgressEnabled;
  if (svc.registryCredentials) deploy.registryCredentials = svc.registryCredentials;
  if (svc.preDeployCommand) deploy.preDeployCommand = svc.preDeployCommand;
  if (svc.region) {
    deploy.multiRegionConfig = {
      [svc.region.region]: { numReplicas: svc.region.numReplicas },
    };
  }
  if (svc.limits) {
    deploy.limitOverride = {
      containers: {
        ...(svc.limits.memoryGB !== undefined
          ? { memoryBytes: Math.round(svc.limits.memoryGB * 1_000_000_000) }
          : {}),
        ...(svc.limits.vCPUs !== undefined ? { cpu: svc.limits.vCPUs } : {}),
      },
    };
  }
  // runtime and useLegacyStacker are Railway-internal — never send
  if (Object.keys(deploy).length > 0) {
    service.deploy = deploy;
  }

  // --- Volume mounts ---
  if (svc.volume && volumeId) {
    service.volumeMounts = {
      [volumeId]: { mountPath: svc.volume.mount },
    };
  }

  // --- Config file ---
  // Send if user set it (including empty string to clear a previous value)
  if (svc.railwayConfigFile !== undefined) {
    service.configFile = svc.railwayConfigFile;
  }

  // Note: staticOutboundIps is handled via egress gateway mutations in apply.ts,
  // not through the EnvironmentConfig patch system.

  return service;
}

/**
 * Build a service config for a newly created service (after serviceCreate returns its ID).
 */
export function buildNewServiceConfig(svc: ServiceState, volumeId?: string): EnvConfigService {
  return buildServiceConfig(svc, volumeId);
}
