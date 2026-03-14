import type { Change, Changeset, UpdateServiceSettings } from "../types/changeset.js";
import type { ServiceState, State } from "../types/state.js";
import { deepEqual } from "../util.js";

/** Railway auto-injects these read-only variables into every service. Never diff them. */
const RAILWAY_MANAGED_PREFIXES = ["RAILWAY_"];

function isRailwayManaged(key: string): boolean {
  return RAILWAY_MANAGED_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * Compute a changeset by diffing desired state against current state.
 */
export function computeChangeset(
  desired: State,
  current: State,
  deletedVars: Record<string, string[]>,
  deletedSharedVars: string[],
  domainMap: Record<string, Array<{ id: string; domain: string }>>,
  volumeMap?: Record<string, { volumeId: string; mount: string; name: string }>,
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
      for (const domain of desiredSvc.domains) {
        changes.push({
          type: "create-domain",
          serviceName: name,
          domain,
        });
      }

      // Apply service settings that aren't part of create-service
      const newSvcSettings: UpdateServiceSettings["settings"] = {};
      if (desiredSvc.restartPolicy) newSvcSettings.restartPolicy = desiredSvc.restartPolicy;
      if (desiredSvc.healthcheck) newSvcSettings.healthcheck = desiredSvc.healthcheck;
      if (desiredSvc.regions) newSvcSettings.regions = desiredSvc.regions;
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

  // Compare source (order-independent)
  if (desired.source && !deepEqual(desired.source, current.source)) {
    settings.source = desired.source;
  }

  // Compare restart policy
  if (desired.restartPolicy && desired.restartPolicy !== current.restartPolicy) {
    settings.restartPolicy = desired.restartPolicy;
  }

  // Compare healthcheck (order-independent)
  if (desired.healthcheck && !deepEqual(desired.healthcheck, current.healthcheck)) {
    settings.healthcheck = desired.healthcheck;
  }

  // Compare cron schedule
  if (desired.cronSchedule && desired.cronSchedule !== current.cronSchedule) {
    settings.cronSchedule = desired.cronSchedule;
  }

  // Compare regions (order-independent)
  if (desired.regions && !deepEqual(desired.regions, current.regions)) {
    settings.regions = desired.regions;
  }

  // Compare new service settings
  if (desired.startCommand !== undefined && desired.startCommand !== current.startCommand) {
    settings.startCommand = desired.startCommand;
  }
  if (desired.buildCommand !== undefined && desired.buildCommand !== current.buildCommand) {
    settings.buildCommand = desired.buildCommand;
  }
  if (desired.rootDirectory !== undefined && desired.rootDirectory !== current.rootDirectory) {
    settings.rootDirectory = desired.rootDirectory;
  }
  if (desired.dockerfilePath !== undefined && desired.dockerfilePath !== current.dockerfilePath) {
    settings.dockerfilePath = desired.dockerfilePath;
  }
  if (
    desired.preDeployCommand !== undefined &&
    desired.preDeployCommand !== current.preDeployCommand
  ) {
    settings.preDeployCommand = desired.preDeployCommand;
  }
  if (
    desired.restartPolicyMaxRetries !== undefined &&
    desired.restartPolicyMaxRetries !== current.restartPolicyMaxRetries
  ) {
    settings.restartPolicyMaxRetries = desired.restartPolicyMaxRetries;
  }
  if (
    desired.sleepApplication !== undefined &&
    desired.sleepApplication !== current.sleepApplication
  ) {
    settings.sleepApplication = desired.sleepApplication;
  }

  if (Object.keys(settings).length > 0) {
    changes.push({
      type: "update-service-settings",
      serviceName: desired.name,
      serviceId: current.id!,
      settings,
    });
  }
}

function diffDomains(
  serviceName: string,
  desired: ServiceState,
  current: ServiceState,
  currentDomains: Array<{ id: string; domain: string }>,
  changes: Change[],
): void {
  const desiredSet = new Set(desired.domains);
  const currentSet = new Set(currentDomains.map((d) => d.domain));

  // Create domains that are desired but don't exist
  for (const domain of desiredSet) {
    if (!currentSet.has(domain)) {
      changes.push({
        type: "create-domain",
        serviceName,
        serviceId: current.id,
        domain,
      });
    }
  }

  // Delete domains that exist but aren't desired
  for (const d of currentDomains) {
    if (!desiredSet.has(d.domain)) {
      changes.push({
        type: "delete-domain",
        serviceName,
        serviceId: current.id,
        domain: d.domain,
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
