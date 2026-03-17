import { z } from "zod/v4";

// --- Structural schemas (validate shape before param expansion) ---
// These accept strings that may contain %{param} or ${ENV_VAR} placeholders.

const SourceConfigSchema = z
  .object({
    image: z
      .string()
      .optional()
      .describe("Container image (e.g., 'nginx:latest', 'ghcr.io/org/app:v1')."),
    repo: z.string().optional().describe("GitHub repository URL."),
  })
  .describe("Service source — specify either 'image' (container) or 'repo' (GitHub), not both.")
  .refine((s) => (s.image ? !s.repo : !!s.repo), {
    message: "source must have either 'image' or 'repo', not both or neither",
  });

const ServiceVolumeRefSchema = z
  .object({
    name: z.string().min(1).describe("Volume name (must match a top-level volume key)."),
    mount: z
      .string()
      .describe("Mount path inside the container (must be absolute, e.g., '/data')."),
  })
  .describe("Volume reference — links to a top-level volume definition.");

const VolumeConfigFieldsSchema = z.object({
  size_mb: z.number().int().positive().optional().describe("Volume size in MB."),
  region: z.string().optional().describe("Volume region (defaults to service region)."),
});

const VolumeEntrySchema = VolumeConfigFieldsSchema.extend({
  environments: z
    .record(z.string(), VolumeConfigFieldsSchema)
    .optional()
    .describe("Per-environment volume overrides."),
}).describe("Top-level volume configuration.");

const HealthcheckConfigSchema = z
  .object({
    path: z.string().min(1).describe("HTTP path for healthcheck (e.g., '/health')."),
    timeout: z
      .number()
      .positive()
      .optional()
      .describe("Healthcheck timeout in seconds (default: 300)."),
  })
  .describe("HTTP healthcheck configuration.");

const RegionConfigSchema = z
  .object({
    region: z.string().min(1).describe("Railway region identifier."),
    num_replicas: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Number of replicas in this region (default: 1)."),
  })
  .describe("Deployment region configuration.");

const RegistryCredentialsSchema = z
  .object({
    username: z.string().describe("Registry username. Supports ${ENV_VAR} syntax."),
    password: z.string().describe("Registry password. Supports ${ENV_VAR} syntax."),
  })
  .describe("Registry credentials for private container images.");

const DomainSchema = z.string();

const DomainEntrySchema = z.union([
  DomainSchema,
  z.object({
    domain: DomainSchema,
    target_port: z.number().int().positive().optional().describe("Target port for the domain."),
  }),
]);

const RailwayDomainSchema = z
  .union([
    z.boolean(),
    z.object({
      target_port: z
        .number()
        .int()
        .positive()
        .describe("Target port for the Railway-provided domain."),
    }),
  ])
  .optional()
  .describe(
    "Enable a Railway-provided domain (.up.railway.app). Set to true or specify target_port.",
  );

const LimitsConfigSchema = z
  .object({
    memory_gb: z.number().positive().optional().describe("Memory limit in GB."),
    vcpus: z.number().positive().optional().describe("vCPU limit."),
  })
  .optional()
  .describe("Resource limits for the service.");

const ParamDefSchema = z.object({
  required: z
    .boolean()
    .optional()
    .describe("Whether this parameter must be provided by the environment config."),
  default: z
    .string()
    .optional()
    .describe("Default value if not provided by the environment config."),
});

// --- Bucket ---

const BucketConfigFieldsSchema = z.object({
  region: z.string().optional().describe("Bucket region (e.g., 'iad')."),
});

const BucketEntrySchema = BucketConfigFieldsSchema.extend({
  environments: z
    .record(z.string(), BucketConfigFieldsSchema)
    .optional()
    .describe("Per-environment bucket overrides."),
}).describe("S3-compatible bucket configuration.");

// --- Shared variables ---

const SharedVariableValueSchema = z.object({
  value: z.string().describe("Variable value. Supports ${ENV_VAR} syntax."),
});

const SharedVariableEntrySchema = z
  .union([
    z.string().describe("Simple string value — same for all environments."),
    SharedVariableValueSchema.extend({
      environments: z
        .record(z.string(), SharedVariableValueSchema)
        .optional()
        .describe("Per-environment variable value overrides."),
    }),
  ])
  .describe(
    "Shared variable — either a plain string (same everywhere) or object with value + per-env overrides.",
  );

// --- Auto-updates ---

const AutoUpdateScheduleSchema = z.object({
  day: z.number().int().min(0).max(6).describe("Day of week (0=Sunday, 6=Saturday)."),
  start_hour: z.number().int().min(0).max(24).describe("Start hour (0-24)."),
  end_hour: z.number().int().min(0).max(24).describe("End hour (0-24)."),
});

const AutoUpdateConfigSchema = z
  .object({
    type: z.string().describe("Update type (e.g., 'patch')."),
    schedule: z.array(AutoUpdateScheduleSchema).describe("Update schedule entries."),
  })
  .describe("Auto-update configuration for image-based services.");

// --- Service ---

/** Shared service fields — common to templates, service entries, and overrides. */
const ServiceFieldsSchema = z.object({
  source: SourceConfigSchema.optional().describe(
    "Service source — specify either 'image' or 'repo', not both.",
  ),
  variables: z
    .record(z.string(), z.string().nullable())
    .optional()
    .describe(
      "Service-level variables. Set to null to delete. Supports ${ENV_VAR} and ${{service.VAR}} syntax.",
    ),
  domains: z.array(DomainEntrySchema).optional().describe("Custom domains for this service."),
  volume: ServiceVolumeRefSchema.optional().describe(
    "Volume reference — name must match a top-level volume key.",
  ),
  region: RegionConfigSchema.optional().describe("Deployment region."),
  restart_policy: z
    .union([
      z.string(),
      z.object({ type: z.string(), max_retries: z.number().int().nonnegative().optional() }),
    ])
    .optional()
    .describe(
      "Restart policy: ALWAYS, NEVER, or ON_FAILURE. Can be a string or object with type and max_retries.",
    ),
  healthcheck: HealthcheckConfigSchema.optional().describe("HTTP healthcheck configuration."),
  cron_schedule: z
    .string()
    .optional()
    .describe("Cron schedule (5-field format, e.g., '*/5 * * * *')."),
  start_command: z.string().optional().describe("Custom start command for the service."),
  build_command: z.string().optional().describe("Custom build command (Nixpacks/Heroku builds)."),
  root_directory: z
    .string()
    .optional()
    .describe("Root directory for the service (monorepo support)."),
  dockerfile_path: z.string().optional().describe("Path to a custom Dockerfile."),
  pre_deploy_command: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Command(s) to run before deployment (e.g., DB migrations)."),
  serverless: z
    .boolean()
    .optional()
    .describe("Enable serverless mode. Containers scale to zero when idle."),
  builder: z.string().optional().describe("Builder: RAILPACK, NIXPACKS, HEROKU, or PAKETO."),
  watch_patterns: z
    .array(z.string())
    .optional()
    .describe("Gitignore-style patterns to trigger deploys based on changed file paths."),
  draining_seconds: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Time in seconds between SIGTERM and SIGKILL during deployment teardown."),
  overlap_seconds: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      "Time in seconds the old deployment overlaps with the new one during blue-green deploys.",
    ),
  ipv6_egress: z.boolean().optional().describe("Enable IPv6 outbound traffic for the service."),
  branch: z
    .string()
    .optional()
    .describe("GitHub branch to deploy from. Changes are auto-deployed from this branch."),
  wait_for_ci: z
    .boolean()
    .optional()
    .describe("Wait for CI check suites (GitHub Actions) to complete before deploying."),
  registry_credentials: RegistryCredentialsSchema.optional().describe(
    "Registry credentials for private container images.",
  ),
  railway_domain: RailwayDomainSchema,
  tcp_proxies: z
    .array(z.number().int().positive())
    .optional()
    .describe("Multiple TCP proxy application ports."),
  limits: LimitsConfigSchema,
  railway_config_file: z
    .string()
    .optional()
    .describe("Path to a railway.json or railway.toml config-as-code file in the repository."),
  static_outbound_ips: z
    .boolean()
    .optional()
    .describe("Enable static outbound IPs (egress gateways) for the service."),
  private_hostname: z
    .string()
    .optional()
    .describe("Private network DNS hostname (e.g., 'postgres', 'redis')."),
  auto_updates: AutoUpdateConfigSchema.optional().describe(
    "Auto-update configuration for image-based services.",
  ),
  metal: z.boolean().optional().describe("Enable Metal build environment (V3)."),
});

export const ServiceTemplateSchema = ServiceFieldsSchema.extend({
  params: z
    .record(z.string(), ParamDefSchema)
    .optional()
    .describe("Parameter definitions. Each param can be required or have a default value."),
})
  .strict()
  .describe("Reusable service template with parameterized configuration.");

const ServiceEntrySchema = ServiceFieldsSchema.extend({
  template: z.string().optional().describe("Relative path to a service template YAML file."),
  params: z
    .record(z.string(), z.string())
    .optional()
    .describe("Parameter values to pass to the template, replacing %{param} placeholders."),
}).strict();

/** Per-environment override schema — currently same shape as ServiceEntry, may diverge. */
const ServiceEnvironmentOverrideSchema = ServiceEntrySchema;

/** Project-level service entry with optional per-environment overrides */
const ProjectServiceEntrySchema = ServiceEntrySchema.extend({
  environments: z
    .record(z.string(), ServiceEnvironmentOverrideSchema)
    .optional()
    .describe(
      "Per-environment overrides. Keys are environment names, values override the base service configuration.",
    ),
});

// --- Project config ---

export const ProjectConfigSchema = z
  .object({
    project: z
      .string()
      .min(1, "project name is required")
      .describe("Railway project name (must match exactly)."),
    environments: z
      .array(z.string().min(1))
      .min(1, "at least one environment is required")
      .describe("List of Railway environment names to manage."),
    shared_variables: z
      .record(z.string(), SharedVariableEntrySchema)
      .optional()
      .describe(
        "Shared variables. Plain string = same everywhere. Object with value + environments = per-env overrides.",
      ),
    services: z
      .record(z.string(), ProjectServiceEntrySchema)
      .describe("Map of service name to service configuration."),
    volumes: z
      .record(z.string(), VolumeEntrySchema)
      .optional()
      .describe("Top-level volume definitions. Referenced by services via volume.name."),
    buckets: z
      .record(z.string(), BucketEntrySchema)
      .optional()
      .describe("S3-compatible Railway bucket definitions."),
  })
  .strict()
  .describe("Declarative project configuration for Railway Deploy.");

/** Inferred type from the ProjectConfig Zod schema. */
export type ParsedProjectConfig = z.infer<typeof ProjectConfigSchema>;

/**
 * Validate and parse a project config object against the structural schema.
 * Returns the typed config on success, throws a formatted error on failure.
 */
export function validateProjectConfig(data: unknown): ParsedProjectConfig {
  const result = ProjectConfigSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
        return `  ${path}: ${issue.message}`;
      })
      .join("\n");
    throw new Error(`Invalid project config:\n${issues}`);
  }
  return result.data;
}

/** Inferred type from the ServiceTemplate Zod schema. */
export type ParsedServiceTemplate = z.infer<typeof ServiceTemplateSchema>;

/**
 * Validate and parse a service template object against the structural schema.
 * Returns the typed template on success, throws a formatted error on failure.
 */
export function validateServiceTemplate(
  data: unknown,
  templatePath: string,
): ParsedServiceTemplate {
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
  return result.data;
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
