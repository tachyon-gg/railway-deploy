/** Raw YAML config types — before normalization to State */

/** Parameter definition in a service template */
export interface ParamDef {
  required?: boolean;
  default?: string;
}

/** Auto-update schedule entry for image-based services */
export interface AutoUpdateScheduleConfig {
  day: number;
  start_hour: number;
  end_hour: number;
}

/** Auto-update configuration for image-based services */
export interface AutoUpdateConfig {
  type: string;
  schedule: AutoUpdateScheduleConfig[];
}

/** Source configuration for a service */
export interface SourceConfig {
  image?: string;
  repo?: string;
}

/** Volume reference on a service — name + mount path */
export interface ServiceVolumeRef {
  name: string;
  mount: string;
}

/** Top-level volume configuration (overridable fields) */
export interface VolumeConfigFields {
  size_mb?: number;
  region?: string;
}

/** Top-level volume entry with optional per-env overrides */
export interface VolumeEntry extends VolumeConfigFields {
  environments?: Record<string, VolumeConfigFields>;
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

/** Bucket configuration (overridable fields) */
export interface BucketConfigFields {
  region?: string;
}

/** Top-level bucket entry with optional per-env overrides */
export interface BucketEntry extends BucketConfigFields {
  environments?: Record<string, BucketConfigFields>;
}

/**
 * Shared variable entry — either a plain string (same value everywhere)
 * or an object with value + optional per-env overrides.
 */
export type SharedVariableEntry =
  | string
  | {
      value: string;
      environments?: Record<string, { value: string }>;
    };

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
  volume?: ServiceVolumeRef;
  region?: RegionConfig;
  restart_policy?: string | { type: string; max_retries?: number };
  healthcheck?: HealthcheckConfig;
  cron_schedule?: string;
  start_command?: string;
  build_command?: string;
  root_directory?: string;
  dockerfile_path?: string;
  pre_deploy_command?: string | string[];
  serverless?: boolean;
  builder?: string;
  watch_patterns?: string[];
  draining_seconds?: number;
  overlap_seconds?: number;
  ipv6_egress?: boolean;
  branch?: string;
  wait_for_ci?: boolean;
  registry_credentials?: { username: string; password: string };
  railway_domain?: boolean | { target_port: number };
  tcp_proxies?: number[];
  limits?: LimitsConfig;
  railway_config_file?: string;
  static_outbound_ips?: boolean;
  private_hostname?: string;
  auto_updates?: AutoUpdateConfig;
  metal?: boolean;
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
