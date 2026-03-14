/** Raw YAML config types — before normalization to State */

/** Parameter definition in a service template */
export interface ParamDef {
  required?: boolean;
  default?: string;
}

/** Source configuration for a service */
export interface SourceConfig {
  image?: string;
  repo?: string;
}

/** Volume configuration */
export interface VolumeConfig {
  mount: string;
  name: string;
}

/** Healthcheck configuration */
export interface HealthcheckConfig {
  path: string;
  timeout?: number;
}

/** Region configuration */
export interface RegionConfig {
  region: string;
  num_replicas?: number;
}

/** Bucket configuration */
export interface BucketConfig {
  name: string;
}

/** Domain entry — supports both simple string and object with target_port */
export type DomainEntry = string | { domain: string; target_port?: number };

/** Limits configuration */
export interface LimitsConfig {
  memory_gb?: number;
  vcpus?: number;
}

/** Service template YAML structure (services/*.yaml) */
export interface ServiceTemplate {
  params?: Record<string, ParamDef>;
  source?: SourceConfig;
  variables?: Record<string, string | null>;
  /** Custom domains */
  domains?: DomainEntry[];
  region?: RegionConfig;
  restart_policy?: string;
  healthcheck?: HealthcheckConfig;
  cron_schedule?: string;
  volume?: VolumeConfig;
  start_command?: string;
  build_command?: string;
  root_directory?: string;
  dockerfile_path?: string;
  pre_deploy_command?: string | string[];
  restart_policy_max_retries?: number;
  sleep_application?: boolean;
  builder?: string;
  watch_patterns?: string[];
  draining_seconds?: number;
  overlap_seconds?: number;
  ipv6_egress?: boolean;
  branch?: string;
  check_suites?: boolean;
  registry_credentials?: { username: string; password: string };
  /** Railway-provided domain */
  railway_domain?: boolean | { target_port: number };
  /** TCP proxies */
  tcp_proxies?: number[];
  /** Resource limits */
  limits?: LimitsConfig;
  /** Railway config file path */
  railway_config_file?: string;
  /** Enable static outbound IPs */
  static_outbound_ips?: boolean;
}

/** Service entry in an environment file */
export interface ServiceEntry {
  /** Path to a service template file */
  template?: string;
  /** Parameter values to pass to the template */
  params?: Record<string, string>;
  /** Additional/override variables */
  variables?: Record<string, string | null>;
  /** Inline source (when no template) */
  source?: SourceConfig;
  /** Custom domains */
  domains?: DomainEntry[];
  /** Inline volume (when no template) */
  volume?: VolumeConfig;
  /** Inline region */
  region?: RegionConfig;
  /** Inline restart policy */
  restart_policy?: string;
  /** Inline healthcheck */
  healthcheck?: HealthcheckConfig;
  /** Inline cron schedule */
  cron_schedule?: string;
  /** Inline start command */
  start_command?: string;
  /** Inline build command */
  build_command?: string;
  /** Inline root directory */
  root_directory?: string;
  /** Inline Dockerfile path */
  dockerfile_path?: string;
  /** Inline pre-deploy command */
  pre_deploy_command?: string | string[];
  /** Inline restart policy max retries */
  restart_policy_max_retries?: number;
  /** Inline sleep application */
  sleep_application?: boolean;
  /** Builder to use */
  builder?: string;
  /** Watch patterns for triggering deploys */
  watch_patterns?: string[];
  /** Draining seconds for zero-downtime deploys */
  draining_seconds?: number;
  /** Overlap seconds for zero-downtime deploys */
  overlap_seconds?: number;
  /** Enable IPv6 egress */
  ipv6_egress?: boolean;
  /** Branch to deploy from */
  branch?: string;
  /** Wait for CI check suites before deploying */
  check_suites?: boolean;
  /** Registry credentials for private images */
  registry_credentials?: { username: string; password: string };
  /** Railway-provided domain */
  railway_domain?: boolean | { target_port: number };
  /** TCP proxies */
  tcp_proxies?: number[];
  /** Resource limits */
  limits?: LimitsConfig;
  /** Railway config file path */
  railway_config_file?: string;
  /** Enable static outbound IPs */
  static_outbound_ips?: boolean;
}

/** Top-level environment file YAML structure (environments/*.yaml) */
export interface EnvironmentConfig {
  project: string;
  environment: string;
  shared_variables?: Record<string, string | null>;
  services: Record<string, ServiceEntry>;
  buckets?: Record<string, BucketConfig>;
}
