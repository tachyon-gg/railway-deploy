/** Types for config diff output — comparing desired vs current EnvironmentConfig */

export type DiffAction = "add" | "update" | "remove";

/** A single diff entry representing one field-level change */
export interface ConfigDiffEntry {
  /** Dot-path for display, e.g. "variables.PORT" or "deploy.startCommand" */
  path: string;
  action: DiffAction;
  /** Service name for display grouping (null = project-level) */
  serviceName: string | null;
  /** Category for display: "variable", "domain", "setting", "volume", "shared-variable", "bucket", "service" */
  category: string;
  oldValue?: unknown;
  newValue?: unknown;
}

/** Service to create (exists in desired but not in current) */
export interface ServiceToCreate {
  name: string;
  source?: { image?: string; repo?: string };
  volume?: { mount: string; name: string };
  cronSchedule?: string;
  branch?: string;
  registryCredentials?: { username: string; password: string };
}

/** Service to delete (exists in current but not in desired) */
export interface ServiceToDelete {
  name: string;
  serviceId: string;
}

/** Volume to create (new volume on existing or new service) */
export interface VolumeToCreate {
  serviceName: string;
  serviceId: string;
  mount: string;
  name: string;
}

/** Complete diff between desired and current EnvironmentConfig */
export interface ConfigDiff {
  /** Field-level changes (variables, domains, settings, etc.) */
  entries: ConfigDiffEntry[];
  /** Services that need to be created before patching */
  servicesToCreate: ServiceToCreate[];
  /** Services that need to be deleted after patching */
  servicesToDelete: ServiceToDelete[];
  /** Volumes that need to be created before patching (to get volume IDs) */
  volumesToCreate: VolumeToCreate[];
  /** Whether any data-loss operations are present */
  hasDataLoss: boolean;
  /** Data-loss entries (for --allow-data-loss gating) */
  dataLossEntries: ConfigDiffEntry[];
}
