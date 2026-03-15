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

/** Shared service fields — common to templates, service entries, and overrides. */
export interface ServiceFields {
  source?: SourceConfig;
  variables?: Record<string, string | null>;
  domains?: DomainEntry[];
  volume?: VolumeConfig;
  region?: RegionConfig;
  restart_policy?: string;
  healthcheck?: HealthcheckConfig;
  cron_schedule?: string;
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
  railway_domain?: boolean | { target_port: number };
  tcp_proxies?: number[];
  limits?: LimitsConfig;
  railway_config_file?: string;
  static_outbound_ips?: boolean;
}

/** Service template YAML structure (services/*.yaml) */
export interface ServiceTemplate extends ServiceFields {
  params?: Record<string, ParamDef>;
}

/** Service configuration block (inline or referencing a template) */
export interface ServiceEntry extends ServiceFields {
  template?: string;
  params?: Record<string, string>;
}

/** Per-environment override block — structurally identical to ServiceEntry. */
export type ServiceEnvironmentOverride = ServiceEntry;

/** Project-level service entry (defaults + per-environment overrides) */
export interface ProjectServiceEntry extends ServiceEntry {
  /** Per-environment overrides, keyed by environment name */
  environments?: Record<string, ServiceEnvironmentOverride>;
}
