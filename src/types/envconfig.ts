/**
 * TypeScript types for Railway's EnvironmentConfig JSON object.
 *
 * Derived from fetching `environment.config(decryptVariables: true)` against
 * a real Railway project. This is the native IaC representation Railway uses
 * internally — we build this from YAML config, diff against the live version,
 * and apply via environmentStageChanges + environmentPatchCommitStaged.
 */

/** Variable value in EnvironmentConfig */
export interface EnvConfigVariable {
  value: string;
  generator?: string;
}

/** Auto-update schedule entry */
export interface AutoUpdateScheduleEntry {
  day: number;
  startHour: number;
  endHour: number;
}

/** Auto-update configuration for image-based services */
export interface AutoUpdateConfig {
  type: string;
  schedule: AutoUpdateScheduleEntry[];
}

/** Service source configuration */
export interface EnvConfigSource {
  image?: string;
  repo?: string;
  branch?: string | null;
  rootDirectory?: string | null;
  checkSuites?: boolean | null;
  autoUpdates?: AutoUpdateConfig | null;
}

/** Service networking configuration */
export interface EnvConfigNetworking {
  customDomains?: Record<string, { port?: number }>;
  privateNetworkEndpoint?: string | null;
  /** Service domains (*.up.railway.app) — keyed by domain string */
  serviceDomains?: Record<string, { port?: number }> | null;
  /** TCP proxies — keyed by application port number as string */
  tcpProxies?: Record<string, Record<string, never>>;
}

/** Service build configuration */
export interface EnvConfigBuild {
  builder?: string | null;
  dockerfilePath?: string | null;
  buildCommand?: string | null;
  watchPatterns?: string[] | null;
  buildEnvironment?: string | null;
}

/** Multi-region configuration — keyed by region slug */
export type MultiRegionConfig = Record<string, { numReplicas: number }>;

/** Resource limit override */
export interface EnvConfigLimitOverride {
  containers?: {
    cpu?: number;
    memoryBytes?: number;
  };
}

/** Service deploy configuration */
export interface EnvConfigDeploy {
  startCommand?: string | null;
  restartPolicyType?: string | null;
  restartPolicyMaxRetries?: number | null;
  cronSchedule?: string | null;
  healthcheckPath?: string | null;
  healthcheckTimeout?: number | null;
  sleepApplication?: boolean | null;
  drainingSeconds?: number | null;
  overlapSeconds?: number | null;
  ipv6EgressEnabled?: boolean | null;
  registryCredentials?: { username: string; password: string } | null;
  runtime?: string;
  useLegacyStacker?: boolean;
  multiRegionConfig?: MultiRegionConfig | null;
  requiredMountPath?: string;
  preDeployCommand?: string | string[] | null;
  limitOverride?: EnvConfigLimitOverride | null;
}

/** Volume mount inside a service block */
export interface EnvConfigVolumeMount {
  mountPath: string;
}

/** Per-service block in EnvironmentConfig */
export interface EnvConfigService {
  source?: EnvConfigSource;
  networking?: EnvConfigNetworking;
  variables?: Record<string, EnvConfigVariable>;
  build?: EnvConfigBuild;
  deploy?: EnvConfigDeploy;
  volumeMounts?: Record<string, EnvConfigVolumeMount>;
  /** Railway config file path */
  configFile?: string | null;
  /** Service group ID */
  groupId?: string;
}

/** Top-level volume configuration */
export interface EnvConfigVolume {
  sizeMB?: number;
  region?: string;
  allowOnlineResize?: boolean;
  alerts?: Record<string, Record<string, Record<string, unknown>>>;
}

/** Bucket configuration */
export interface EnvConfigBucket {
  region?: string;
  isCreated?: boolean;
}

/** Service group for UI organization */
export interface EnvConfigGroup {
  name: string;
  color?: string | null;
  icon?: string | null;
  isCollapsed?: boolean;
}

/** Top-level EnvironmentConfig structure */
export interface EnvironmentConfig {
  services?: Record<string, EnvConfigService>;
  sharedVariables?: Record<string, EnvConfigVariable>;
  volumes?: Record<string, EnvConfigVolume>;
  buckets?: Record<string, EnvConfigBucket>;
  groups?: Record<string, EnvConfigGroup>;
  privateNetworkDisabled?: boolean;
}
