import type { Change, Changeset, UpdateServiceSettings } from "../types/changeset.js";
import type { ServiceState, State } from "../types/state.js";
import { deepEqual } from "../util.js";

/** Railway auto-injects these read-only variables into every service. Never diff them. */
const RAILWAY_MANAGED_PREFIXES = ["RAILWAY_"];

function isRailwayManaged(key: string): boolean {
  return RAILWAY_MANAGED_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * Compute a changeset by diffing desired state against current (live) state.
 *
 * Produces an ordered list of changes: shared variables, then per-service
 * creates/updates (variables, domains, settings, volumes), then service
 * deletions, then buckets. Variables prefixed with `RAILWAY_` are ignored
 * as they are managed by Railway itself.
 *
 * @param desired - The desired state from config.
 * @param current - The current live state from Railway.
 * @param deletedVars - Per-service variable names explicitly marked for deletion (via `null`).
 * @param deletedSharedVars - Shared variable names explicitly marked for deletion.
 * @param domainMap - Current custom domains per service (from {@link fetchCurrentState}).
 * @param volumeMap - Current volumes per service (from {@link fetchCurrentState}).
 * @returns A {@link Changeset} containing all changes needed to reconcile.
 */
export function computeChangeset(
  desired: State,
  current: State,
  deletedVars: Record<string, string[]>,
  deletedSharedVars: string[],
  domainMap: Record<string, Array<{ id: string; domain: string; targetPort?: number }>>,
  volumeMap?: Record<string, { volumeId: string; mount: string; name: string }>,
  serviceDomainMap?: Record<string, { id: string; domain: string }>,
  tcpProxyMap?: Record<string, Array<{ id: string; applicationPort: number }>>,
): Changeset {
  const changes: Change[] = [];

  // --- Shared variables ---
  diffSharedVariables(desired, current, deletedSharedVars, changes);

  // --- Services ---
  const desiredNames = new Set(Object.keys(desired.services));
  const currentNames = new Set(Object.keys(current.services));

  // Services to create or update
  for (const name of desiredNames) {
    const desiredSvc = desired.services[name];
    const currentSvc = current.services[name];

    if (!currentSvc) {
      // Service doesn't exist — create it
      changes.push({
        type: "create-service",
        name,
        source: desiredSvc.source,
        volume: desiredSvc.volume,
        cronSchedule: desiredSvc.cronSchedule,
        branch: desiredSvc.branch,
        registryCredentials: desiredSvc.registryCredentials,
      });

      // Set all variables for new service
      if (Object.keys(desiredSvc.variables).length > 0) {
        changes.push({
          type: "upsert-variables",
          serviceName: name,
          variables: desiredSvc.variables,
        });
      }

      // Add domains
      for (const d of desiredSvc.domains) {
        changes.push({
          type: "create-domain",
          serviceName: name,
          domain: d.domain,
          ...(d.targetPort !== undefined ? { targetPort: d.targetPort } : {}),
        });
      }

      // Add railway domain for new service
      if (desiredSvc.railwayDomain) {
        changes.push({
          type: "create-service-domain",
          serviceName: name,
          targetPort: desiredSvc.railwayDomain.targetPort,
        });
      }

      // Add TCP proxies for new service
      if (desiredSvc.tcpProxies) {
        for (const port of desiredSvc.tcpProxies) {
          changes.push({
            type: "create-tcp-proxy",
            serviceName: name,
            applicationPort: port,
          });
        }
      }

      // Apply service settings that aren't part of create-service
      const newSvcSettings: UpdateServiceSettings["settings"] = {};
      if (desiredSvc.restartPolicy) newSvcSettings.restartPolicy = desiredSvc.restartPolicy;
      if (desiredSvc.healthcheck) newSvcSettings.healthcheck = desiredSvc.healthcheck;
      if (desiredSvc.region) newSvcSettings.region = desiredSvc.region;
      if (desiredSvc.startCommand !== undefined)
        newSvcSettings.startCommand = desiredSvc.startCommand;
      if (desiredSvc.buildCommand !== undefined)
        newSvcSettings.buildCommand = desiredSvc.buildCommand;
      if (desiredSvc.rootDirectory !== undefined)
        newSvcSettings.rootDirectory = desiredSvc.rootDirectory;
      if (desiredSvc.dockerfilePath !== undefined)
        newSvcSettings.dockerfilePath = desiredSvc.dockerfilePath;
      if (desiredSvc.preDeployCommand !== undefined)
        newSvcSettings.preDeployCommand = desiredSvc.preDeployCommand;
      if (desiredSvc.restartPolicyMaxRetries !== undefined)
        newSvcSettings.restartPolicyMaxRetries = desiredSvc.restartPolicyMaxRetries;
      if (desiredSvc.sleepApplication !== undefined)
        newSvcSettings.sleepApplication = desiredSvc.sleepApplication;
      if (desiredSvc.builder !== undefined) newSvcSettings.builder = desiredSvc.builder;
      if (desiredSvc.watchPatterns !== undefined)
        newSvcSettings.watchPatterns = desiredSvc.watchPatterns;
      if (desiredSvc.drainingSeconds !== undefined)
        newSvcSettings.drainingSeconds = desiredSvc.drainingSeconds;
      if (desiredSvc.overlapSeconds !== undefined)
        newSvcSettings.overlapSeconds = desiredSvc.overlapSeconds;
      if (desiredSvc.ipv6EgressEnabled !== undefined)
        newSvcSettings.ipv6EgressEnabled = desiredSvc.ipv6EgressEnabled;
      // registryCredentials already passed in create-service — skip here for new services
      if (desiredSvc.railwayConfigFile !== undefined)
        newSvcSettings.railwayConfigFile = desiredSvc.railwayConfigFile;

      // Resource limits for new service (separate mutation)
      if (desiredSvc.limits) {
        changes.push({
          type: "update-service-limits",
          serviceName: name,
          serviceId: "", // Resolved at apply time
          limits: desiredSvc.limits,
        });
      }

      // Static outbound IPs for new service
      if (desiredSvc.staticOutboundIps) {
        changes.push({
          type: "enable-static-ips",
          serviceName: name,
          serviceId: "", // Resolved at apply time
        });
      }

      // Metal (VM runtime) for new service
      if (desiredSvc.metal) {
        changes.push({
          type: "enable-service-feature-flag",
          serviceName: name,
          serviceId: "", // Resolved at apply time
          flag: "USE_VM_RUNTIME",
        });
      }

      if (Object.keys(newSvcSettings).length > 0) {
        changes.push({
          type: "update-service-settings",
          serviceName: name,
          serviceId: "", // Resolved at apply time via createdServiceIds
          settings: newSvcSettings,
        });
      }
    } else {
      // Service exists — check for updates
      diffServiceSettings(desiredSvc, currentSvc, changes);
      diffVariables(name, desiredSvc, currentSvc, deletedVars[name] || [], changes);
      diffDomains(name, desiredSvc, currentSvc, domainMap[name] || [], changes);
      diffVolume(name, desiredSvc, currentSvc, volumeMap?.[name], changes);
      diffServiceDomain(name, desiredSvc, currentSvc, serviceDomainMap?.[name], changes);
      diffTcpProxies(name, desiredSvc, currentSvc, tcpProxyMap?.[name] || [], changes);
      diffServiceLimits(name, desiredSvc, currentSvc, changes);

      // Branch / checkSuites (deployment trigger) diff
      if (
        (desiredSvc.branch && desiredSvc.branch !== currentSvc.branch) ||
        (desiredSvc.checkSuites !== undefined && desiredSvc.checkSuites !== currentSvc.checkSuites)
      ) {
        if (currentSvc.id && currentSvc.deploymentTriggerId) {
          changes.push({
            type: "update-deployment-trigger",
            serviceName: name,
            serviceId: currentSvc.id,
            triggerId: currentSvc.deploymentTriggerId,
            ...(desiredSvc.branch && desiredSvc.branch !== currentSvc.branch
              ? { branch: desiredSvc.branch }
              : {}),
            ...(desiredSvc.checkSuites !== undefined &&
            desiredSvc.checkSuites !== currentSvc.checkSuites
              ? { checkSuites: desiredSvc.checkSuites }
              : {}),
          });
        } else {
          console.warn(
            `  Warning: "${name}" has branch/check_suites in config but no deployment trigger exists — skipping`,
          );
        }
      }

      // Static outbound IPs diff
      diffStaticOutboundIps(name, desiredSvc, currentSvc, changes);

      // Metal (VM runtime) diff
      diffMetal(name, desiredSvc, currentSvc, changes);
    }
  }

  // Services to delete (exist in Railway but not in YAML)
  for (const name of currentNames) {
    if (!desiredNames.has(name)) {
      const currentSvc = current.services[name];
      if (currentSvc.id) {
        changes.push({
          type: "delete-service",
          name,
          serviceId: currentSvc.id,
        });
      }
    }
  }

  // --- Buckets ---
  diffBuckets(desired, current, changes);

  return { changes };
}

/**
 * Diff variables — shared helper for both service and shared variables.
 */
function diffVarsHelper(
  desired: Record<string, string>,
  current: Record<string, string>,
  explicitDeletes: string[],
): { toUpsert: Record<string, string>; toDelete: string[] } {
  const toUpsert: Record<string, string> = {};
  for (const [key, value] of Object.entries(desired)) {
    if (current[key] !== value) {
      toUpsert[key] = value;
    }
  }

  const toDelete: string[] = [...explicitDeletes];
  for (const key of Object.keys(current)) {
    if (
      !(key in desired) &&
      !explicitDeletes.includes(key) &&
      !toDelete.includes(key) &&
      !isRailwayManaged(key)
    ) {
      toDelete.push(key);
    }
  }

  return { toUpsert, toDelete };
}

function diffSharedVariables(
  desired: State,
  current: State,
  deletedSharedVars: string[],
  changes: Change[],
): void {
  const { toUpsert, toDelete } = diffVarsHelper(
    desired.sharedVariables,
    current.sharedVariables,
    deletedSharedVars,
  );

  if (Object.keys(toUpsert).length > 0) {
    changes.push({ type: "upsert-shared-variables", variables: toUpsert });
  }
  if (toDelete.length > 0) {
    changes.push({ type: "delete-shared-variables", variableNames: toDelete });
  }
}

function diffVariables(
  serviceName: string,
  desired: ServiceState,
  current: ServiceState,
  deletedVarNames: string[],
  changes: Change[],
): void {
  const { toUpsert, toDelete } = diffVarsHelper(
    desired.variables,
    current.variables,
    deletedVarNames,
  );

  if (Object.keys(toUpsert).length > 0) {
    changes.push({
      type: "upsert-variables",
      serviceName,
      serviceId: current.id,
      variables: toUpsert,
    });
  }
  if (toDelete.length > 0) {
    changes.push({
      type: "delete-variables",
      serviceName,
      serviceId: current.id,
      variableNames: toDelete,
    });
  }
}

function diffServiceSettings(
  desired: ServiceState,
  current: ServiceState,
  changes: Change[],
): void {
  if (!current.id) return;

  const settings: UpdateServiceSettings["settings"] = {};

  // For every field: if desired differs from current, record the change.
  // If desired is absent but current has a value, record null (clear it).
  if (!deepEqual(desired.source, current.source)) {
    settings.source = desired.source ?? null;
  }
  // restartPolicyType is non-nullable on Railway — can't clear it
  if (desired.restartPolicy !== undefined && desired.restartPolicy !== current.restartPolicy) {
    settings.restartPolicy = desired.restartPolicy;
  } else if (desired.restartPolicy === undefined && current.restartPolicy !== undefined) {
    console.warn(
      `  Warning: "${desired.name}" has no restart_policy in config — Railway will keep "${current.restartPolicy}"`,
    );
  }
  if (!deepEqual(desired.healthcheck, current.healthcheck)) {
    settings.healthcheck = desired.healthcheck ?? null;
  }
  if (desired.cronSchedule !== current.cronSchedule) {
    settings.cronSchedule = desired.cronSchedule ?? null;
  }
  if (!deepEqual(desired.region, current.region)) {
    settings.region = desired.region ?? null;
  }
  if (desired.startCommand !== current.startCommand) {
    settings.startCommand = desired.startCommand ?? null;
  }
  if (desired.buildCommand !== current.buildCommand) {
    settings.buildCommand = desired.buildCommand ?? null;
  }
  if (desired.rootDirectory !== current.rootDirectory) {
    settings.rootDirectory = desired.rootDirectory ?? null;
  }
  if (desired.dockerfilePath !== current.dockerfilePath) {
    settings.dockerfilePath = desired.dockerfilePath ?? null;
  }
  if (!deepEqual(desired.preDeployCommand, current.preDeployCommand)) {
    settings.preDeployCommand = desired.preDeployCommand ?? null;
  }
  // restartPolicyMaxRetries is non-nullable on Railway — can't clear it
  if (
    desired.restartPolicyMaxRetries !== undefined &&
    desired.restartPolicyMaxRetries !== current.restartPolicyMaxRetries
  ) {
    settings.restartPolicyMaxRetries = desired.restartPolicyMaxRetries;
  } else if (
    desired.restartPolicyMaxRetries === undefined &&
    current.restartPolicyMaxRetries !== undefined
  ) {
    console.warn(
      `  Warning: "${desired.name}" has no restart_policy_max_retries in config — Railway will keep ${current.restartPolicyMaxRetries}`,
    );
  }
  if (desired.sleepApplication !== current.sleepApplication) {
    settings.sleepApplication = desired.sleepApplication ?? null;
  }
  // Group 1 fields
  // builder is non-nullable on Railway — can't clear it
  if (desired.builder !== undefined && desired.builder !== current.builder) {
    settings.builder = desired.builder;
  } else if (desired.builder === undefined && current.builder !== undefined) {
    console.warn(
      `  Warning: "${desired.name}" has no builder in config — Railway will keep "${current.builder}"`,
    );
  }
  // watchPatterns is non-nullable on Railway — can't clear it
  if (
    desired.watchPatterns !== undefined &&
    !deepEqual(desired.watchPatterns, current.watchPatterns)
  ) {
    settings.watchPatterns = desired.watchPatterns;
  } else if (desired.watchPatterns === undefined && current.watchPatterns !== undefined) {
    console.warn(
      `  Warning: "${desired.name}" has no watch_patterns in config — Railway will keep current patterns`,
    );
  }
  if (desired.drainingSeconds !== current.drainingSeconds) {
    settings.drainingSeconds = desired.drainingSeconds ?? null;
  }
  if (desired.overlapSeconds !== current.overlapSeconds) {
    settings.overlapSeconds = desired.overlapSeconds ?? null;
  }
  if (desired.ipv6EgressEnabled !== current.ipv6EgressEnabled) {
    settings.ipv6EgressEnabled = desired.ipv6EgressEnabled ?? null;
  }
  if (desired.railwayConfigFile !== current.railwayConfigFile) {
    settings.railwayConfigFile = desired.railwayConfigFile ?? null;
  }
  // Registry credentials can't be diffed (Railway doesn't return them).
  // Always include if specified — user needs to see they're being sent.
  if (desired.registryCredentials) {
    settings.registryCredentials = desired.registryCredentials;
  }

  if (Object.keys(settings).length > 0) {
    changes.push({
      type: "update-service-settings",
      serviceName: desired.name,
      serviceId: current.id ?? "",
      settings,
    });
  }
}

function diffDomains(
  serviceName: string,
  desired: ServiceState,
  current: ServiceState,
  currentDomains: Array<{ id: string; domain: string; targetPort?: number }>,
  changes: Change[],
): void {
  // Build lookup maps
  const desiredByName = new Map(desired.domains.map((d) => [d.domain, d]));
  const currentByName = new Map(currentDomains.map((d) => [d.domain, d]));

  // Create domains that are desired but don't exist
  for (const [domainName, desiredDomain] of desiredByName) {
    const existing = currentByName.get(domainName);
    if (!existing) {
      changes.push({
        type: "create-domain",
        serviceName,
        serviceId: current.id,
        domain: domainName,
        ...(desiredDomain.targetPort !== undefined ? { targetPort: desiredDomain.targetPort } : {}),
      });
    } else if (
      desiredDomain.targetPort !== undefined &&
      desiredDomain.targetPort !== existing.targetPort
    ) {
      // targetPort changed — Railway doesn't support in-place update, so delete + create
      changes.push({
        type: "delete-domain",
        serviceName,
        serviceId: current.id,
        domain: domainName,
        domainId: existing.id,
      });
      changes.push({
        type: "create-domain",
        serviceName,
        serviceId: current.id,
        domain: domainName,
        ...(desiredDomain.targetPort !== undefined ? { targetPort: desiredDomain.targetPort } : {}),
      });
    }
  }

  // Delete domains that exist but aren't desired
  for (const [domainName, d] of currentByName) {
    if (!desiredByName.has(domainName)) {
      changes.push({
        type: "delete-domain",
        serviceName,
        serviceId: current.id,
        domain: domainName,
        domainId: d.id,
      });
    }
  }
}

function diffVolume(
  serviceName: string,
  desired: ServiceState,
  current: ServiceState,
  currentVolume: { volumeId: string; mount: string; name: string } | undefined,
  changes: Change[],
): void {
  // Volume removal: current has volume but desired doesn't
  if (!desired.volume && currentVolume && current.id) {
    changes.push({
      type: "delete-volume",
      serviceName,
      serviceId: current.id,
      volumeId: currentVolume.volumeId,
    });
  }

  // Volume update: both exist but differ (Railway doesn't support in-place update, so delete + create)
  if (desired.volume && currentVolume && current.id) {
    if (
      desired.volume.mount !== currentVolume.mount ||
      desired.volume.name !== currentVolume.name
    ) {
      changes.push({
        type: "delete-volume",
        serviceName,
        serviceId: current.id,
        volumeId: currentVolume.volumeId,
      });
      changes.push({
        type: "create-volume",
        serviceName,
        serviceId: current.id,
        mount: desired.volume.mount,
        name: desired.volume.name,
      });
    }
  }

  // Volume addition: desired has volume but current doesn't
  if (desired.volume && !currentVolume && current.id) {
    changes.push({
      type: "create-volume",
      serviceName,
      serviceId: current.id,
      mount: desired.volume.mount,
      name: desired.volume.name,
    });
  }
}

function diffBuckets(desired: State, current: State, changes: Change[]): void {
  const desiredBuckets = desired.buckets || {};
  const currentBuckets = current.buckets || {};

  // Create buckets that are desired but don't exist
  for (const [key, bucket] of Object.entries(desiredBuckets)) {
    // Check by name — key is the config key, bucket.name is the Railway name
    const exists = Object.values(currentBuckets).some((cb) => cb.name === bucket.name);
    if (!exists) {
      changes.push({
        type: "create-bucket",
        name: key,
        bucketName: bucket.name,
      });
    }
  }

  // Note: Railway API doesn't support bucket deletion. We could warn here
  // but for now we just skip deletion — buckets must be deleted manually.
}

function diffServiceDomain(
  serviceName: string,
  desired: ServiceState,
  current: ServiceState,
  currentServiceDomain: { id: string; domain: string } | undefined,
  changes: Change[],
): void {
  if (desired.railwayDomain && !currentServiceDomain) {
    // Desired has railway domain but none exists → create
    changes.push({
      type: "create-service-domain",
      serviceName,
      serviceId: current.id,
      targetPort: desired.railwayDomain.targetPort,
    });
  } else if (!desired.railwayDomain && currentServiceDomain) {
    // No desired railway domain but one exists → delete
    changes.push({
      type: "delete-service-domain",
      serviceName,
      serviceId: current.id,
      domainId: currentServiceDomain.id,
    });
  } else if (desired.railwayDomain && currentServiceDomain) {
    // Both exist — check if targetPort changed (requires delete + create)
    const currentTargetPort = current.railwayDomain?.targetPort;
    if (desired.railwayDomain.targetPort !== currentTargetPort) {
      changes.push({
        type: "delete-service-domain",
        serviceName,
        serviceId: current.id,
        domainId: currentServiceDomain.id,
      });
      changes.push({
        type: "create-service-domain",
        serviceName,
        serviceId: current.id,
        targetPort: desired.railwayDomain.targetPort,
      });
    }
  }
}

function diffTcpProxies(
  serviceName: string,
  desired: ServiceState,
  current: ServiceState,
  currentProxies: Array<{ id: string; applicationPort: number }>,
  changes: Change[],
): void {
  const desiredPorts = new Set(desired.tcpProxies || []);
  const currentPortMap = new Map(currentProxies.map((p) => [p.applicationPort, p]));

  // Create missing proxies
  for (const port of desiredPorts) {
    if (!currentPortMap.has(port)) {
      changes.push({
        type: "create-tcp-proxy",
        serviceName,
        serviceId: current.id,
        applicationPort: port,
      });
    }
  }

  // Delete extra proxies
  for (const [port, proxy] of currentPortMap) {
    if (!desiredPorts.has(port)) {
      changes.push({
        type: "delete-tcp-proxy",
        serviceName,
        serviceId: current.id,
        proxyId: proxy.id,
      });
    }
  }
}

function diffServiceLimits(
  serviceName: string,
  desired: ServiceState,
  current: ServiceState,
  changes: Change[],
): void {
  if (!current.id) return;

  if (!deepEqual(desired.limits, current.limits)) {
    // Compute the limits to send: desired fields, or null to clear
    const limits: { memoryGB?: number | null; vCPUs?: number | null } = {};
    if (desired.limits) {
      limits.memoryGB = desired.limits.memoryGB ?? null;
      limits.vCPUs = desired.limits.vCPUs ?? null;
    } else if (current.limits) {
      // Desired has no limits but current does — clear them
      limits.memoryGB = null;
      limits.vCPUs = null;
    } else {
      return; // Both undefined — no change
    }

    changes.push({
      type: "update-service-limits",
      serviceName,
      serviceId: current.id,
      limits,
    });
  }
}

function diffMetal(
  serviceName: string,
  desired: ServiceState,
  current: ServiceState,
  changes: Change[],
): void {
  if (!current.id) return;

  if (desired.metal === true && !current.metal) {
    console.warn(
      `  Warning: "${serviceName}" metal flag is service-level — applies across all Railway environments`,
    );
    changes.push({
      type: "enable-service-feature-flag",
      serviceName,
      serviceId: current.id,
      flag: "USE_VM_RUNTIME",
    });
  } else if (desired.metal === false && current.metal) {
    console.warn(
      `  Warning: "${serviceName}" metal flag is service-level — applies across all Railway environments`,
    );
    changes.push({
      type: "disable-service-feature-flag",
      serviceName,
      serviceId: current.id,
      flag: "USE_VM_RUNTIME",
    });
  }
}

function diffStaticOutboundIps(
  serviceName: string,
  desired: ServiceState,
  current: ServiceState,
  changes: Change[],
): void {
  if (!current.id) return;

  if (desired.staticOutboundIps && !current.staticOutboundIps) {
    changes.push({
      type: "enable-static-ips",
      serviceName,
      serviceId: current.id,
    });
  } else if (!desired.staticOutboundIps && current.staticOutboundIps) {
    changes.push({
      type: "disable-static-ips",
      serviceName,
      serviceId: current.id,
    });
  }
}
