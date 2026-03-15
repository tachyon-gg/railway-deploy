import { z } from "zod/v4";

// --- Structural schemas (validate shape before param expansion) ---
// These accept strings that may contain %{param} or ${ENV_VAR} placeholders.

const SourceConfigSchema = z
  .object({
    image: z.string().optional(),
    repo: z.string().optional(),
  })
  .refine((s) => (s.image ? !s.repo : !!s.repo), {
    message: "source must have either 'image' or 'repo', not both or neither",
  });

const VolumeConfigSchema = z.object({
  mount: z.string(),
  name: z.string().min(1),
});

const HealthcheckConfigSchema = z.object({
  path: z.string().min(1),
  timeout: z.number().positive().optional(),
});

const RegionConfigSchema = z.object({
  region: z.string().min(1),
  num_replicas: z.number().int().positive().optional(),
});

const RegistryCredentialsSchema = z.object({
  username: z.string(),
  password: z.string(),
});

const DomainSchema = z.string();

const DomainEntrySchema = z.union([
  DomainSchema,
  z.object({ domain: DomainSchema, target_port: z.number().int().positive().optional() }),
]);

const RailwayDomainSchema = z
  .union([z.boolean(), z.object({ target_port: z.number().int().positive() })])
  .optional();

const LimitsConfigSchema = z
  .object({
    memory_gb: z.number().positive().optional(),
    vcpus: z.number().positive().optional(),
  })
  .optional();

const ParamDefSchema = z.object({
  required: z.boolean().optional(),
  default: z.string().optional(),
});

const BucketConfigSchema = z.object({
  name: z.string().min(1),
});

export const ServiceTemplateSchema = z
  .object({
    params: z.record(z.string(), ParamDefSchema).optional(),
    source: SourceConfigSchema.optional(),
    variables: z.record(z.string(), z.string().nullable()).optional(),
    domains: z.array(DomainEntrySchema).optional(),
    region: RegionConfigSchema.optional(),
    restart_policy: z.string().optional(),
    healthcheck: HealthcheckConfigSchema.optional(),
    cron_schedule: z.string().optional(),
    volume: VolumeConfigSchema.optional(),
    start_command: z.string().optional(),
    build_command: z.string().optional(),
    root_directory: z.string().optional(),
    dockerfile_path: z.string().optional(),
    pre_deploy_command: z.union([z.string(), z.array(z.string())]).optional(),
    restart_policy_max_retries: z.number().int().nonnegative().optional(),
    sleep_application: z.boolean().optional(),
    builder: z.string().optional(),
    watch_patterns: z.array(z.string()).optional(),
    draining_seconds: z.number().int().nonnegative().optional(),
    overlap_seconds: z.number().int().nonnegative().optional(),
    ipv6_egress: z.boolean().optional(),
    branch: z.string().optional(),
    check_suites: z.boolean().optional(),
    registry_credentials: RegistryCredentialsSchema.optional(),
    railway_domain: RailwayDomainSchema,
    tcp_proxies: z.array(z.number().int().positive()).optional(),
    limits: LimitsConfigSchema,
    railway_config_file: z.string().optional(),
    static_outbound_ips: z.boolean().optional(),
  })
  .strict();

const ServiceEntrySchema = z
  .object({
    template: z.string().optional(),
    params: z.record(z.string(), z.string()).optional(),
    variables: z.record(z.string(), z.string().nullable()).optional(),
    source: SourceConfigSchema.optional(),
    domains: z.array(DomainEntrySchema).optional(),
    volume: VolumeConfigSchema.optional(),
    region: RegionConfigSchema.optional(),
    restart_policy: z.string().optional(),
    healthcheck: HealthcheckConfigSchema.optional(),
    cron_schedule: z.string().optional(),
    start_command: z.string().optional(),
    build_command: z.string().optional(),
    root_directory: z.string().optional(),
    dockerfile_path: z.string().optional(),
    pre_deploy_command: z.union([z.string(), z.array(z.string())]).optional(),
    restart_policy_max_retries: z.number().int().nonnegative().optional(),
    sleep_application: z.boolean().optional(),
    builder: z.string().optional(),
    watch_patterns: z.array(z.string()).optional(),
    draining_seconds: z.number().int().nonnegative().optional(),
    overlap_seconds: z.number().int().nonnegative().optional(),
    ipv6_egress: z.boolean().optional(),
    branch: z.string().optional(),
    check_suites: z.boolean().optional(),
    registry_credentials: RegistryCredentialsSchema.optional(),
    railway_domain: RailwayDomainSchema,
    tcp_proxies: z.array(z.number().int().positive()).optional(),
    limits: LimitsConfigSchema,
    railway_config_file: z.string().optional(),
    static_outbound_ips: z.boolean().optional(),
  })
  .strict();

export const EnvironmentConfigSchema = z
  .object({
    project: z.string().min(1, "project name is required"),
    environment: z.string().min(1, "environment name is required"),
    shared_variables: z.record(z.string(), z.string().nullable()).optional(),
    services: z.record(z.string(), ServiceEntrySchema),
    buckets: z.record(z.string(), BucketConfigSchema).optional(),
  })
  .strict();

/**
 * Validate an environment config object against the structural schema.
 * Throws a formatted error on validation failure.
 */
export function validateEnvironmentConfig(data: unknown): void {
  const result = EnvironmentConfigSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
        return `  ${path}: ${issue.message}`;
      })
      .join("\n");
    throw new Error(`Invalid environment config:\n${issues}`);
  }
}

/**
 * Validate a service template object against the structural schema.
 * Throws a formatted error on validation failure.
 */
export function validateServiceTemplate(data: unknown, templatePath: string): void {
  const result = ServiceTemplateSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
        return `  ${path}: ${issue.message}`;
      })
      .join("\n");
    throw new Error(`Invalid service template (${templatePath}):\n${issues}`);
  }
}

// --- Value validation (run after param expansion on resolved ServiceState) ---

const VALID_RESTART_POLICIES = ["ALWAYS", "NEVER", "ON_FAILURE"];
const VALID_BUILDERS = ["RAILPACK", "NIXPACKS", "HEROKU", "PAKETO"];
const CRON_FIELD_PATTERN = /^(\*|[0-9]+(-[0-9]+)?(,[0-9]+(-[0-9]+)?)*)(\/[0-9]+)?$/;
const DOMAIN_PATTERN = /^(\*\.)?[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/**
 * Validate resolved service values after param and env var expansion.
 * Throws on invalid values with clear error messages.
 */
export function validateResolvedService(
  name: string,
  service: {
    restartPolicy?: string;
    builder?: string;
    cronSchedule?: string;
    volume?: { mount: string };
    domains: Array<{ domain: string }>;
  },
): void {
  const errors: string[] = [];

  if (service.restartPolicy && !VALID_RESTART_POLICIES.includes(service.restartPolicy)) {
    errors.push(
      `restart_policy: "${service.restartPolicy}" is not valid (must be ${VALID_RESTART_POLICIES.join(", ")})`,
    );
  }

  if (service.builder && !VALID_BUILDERS.includes(service.builder)) {
    errors.push(
      `builder: "${service.builder}" is not valid (must be ${VALID_BUILDERS.join(", ")})`,
    );
  }

  if (service.cronSchedule) {
    const parts = service.cronSchedule.trim().split(/\s+/);
    if (parts.length !== 5 || !parts.every((p) => CRON_FIELD_PATTERN.test(p))) {
      errors.push(
        `cron_schedule: "${service.cronSchedule}" is not a valid cron expression (5 fields required)`,
      );
    }
  }

  if (service.volume && !service.volume.mount.startsWith("/")) {
    errors.push(`volume.mount: "${service.volume.mount}" must be an absolute path (start with /)`);
  }

  for (const d of service.domains) {
    // Skip validation for Railway references and env vars
    if (d.domain.includes("${{") || d.domain.includes("${")) continue;
    if (!DOMAIN_PATTERN.test(d.domain)) {
      errors.push(`domain: "${d.domain}" is not a valid domain format`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid resolved config for service "${name}":\n  ${errors.join("\n  ")}`);
  }
}
