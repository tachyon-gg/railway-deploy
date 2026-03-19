import { z } from "zod/v4";

// --- Structural schemas (validate shape before env var expansion) ---

const RegistryCredentialsSchema = z
  .object({
    username: z.string().describe("Registry username. Supports ${ENV_VAR} syntax."),
    password: z.string().describe("Registry password. Supports ${ENV_VAR} syntax."),
  })
  .strict()
  .describe("Registry credentials for private container images.");

// --- Auto-updates ---

const AutoUpdateWindowSchema = z
  .object({
    start_hour: z.number().int().min(0).max(24).describe("Start hour (0-24)."),
    end_hour: z.number().int().min(0).max(24).describe("End hour (0-24)."),
  })
  .strict();

const AutoUpdateConfigSchema = z
  .object({
    sunday: AutoUpdateWindowSchema.optional(),
    monday: AutoUpdateWindowSchema.optional(),
    tuesday: AutoUpdateWindowSchema.optional(),
    wednesday: AutoUpdateWindowSchema.optional(),
    thursday: AutoUpdateWindowSchema.optional(),
    friday: AutoUpdateWindowSchema.optional(),
    saturday: AutoUpdateWindowSchema.optional(),
  })
  .strict()
  .describe("Auto-update schedule for image-based services. Specify update windows per day.");

// --- Source ---

const RepoSourceSchema = z
  .object({
    repo: z.string().describe("GitHub repository URL."),
    branch: z
      .string()
      .optional()
      .describe("GitHub branch to deploy from. Changes are auto-deployed from this branch."),
    root_directory: z
      .string()
      .optional()
      .describe("Root directory for the service (monorepo support)."),
    wait_for_ci: z
      .boolean()
      .optional()
      .describe("Wait for CI check suites (GitHub Actions) to complete before deploying."),
  })
  .strict()
  .describe("Repository source — deploy from a GitHub repo.");

const ImageSourceSchema = z
  .object({
    image: z.string().describe("Container image (e.g., 'nginx:latest', 'ghcr.io/org/app:v1')."),
    registry_credentials: RegistryCredentialsSchema.optional().describe(
      "Registry credentials for private container images.",
    ),
    auto_updates: AutoUpdateConfigSchema.optional().describe(
      "Auto-update schedule for image-based services.",
    ),
  })
  .strict()
  .describe("Image source — deploy from a container image.");

const SourceConfigSchema = z
  .union([RepoSourceSchema, ImageSourceSchema])
  .describe("Service source — either a GitHub repo or a container image.");

// --- Build ---

const RailpackBuildSchema = z
  .object({
    builder: z.literal("railpack"),
    command: z.string().optional(),
    watch_patterns: z.array(z.string()).optional(),
    metal: z.boolean().optional().describe("Enable Metal build environment."),
  })
  .strict();

const NixpacksBuildSchema = z
  .object({
    builder: z.literal("nixpacks"),
    command: z.string().optional(),
    watch_patterns: z.array(z.string()).optional(),
    metal: z.boolean().optional().describe("Enable Metal build environment."),
  })
  .strict();

const DockerfileBuildSchema = z
  .object({
    builder: z.literal("dockerfile"),
    dockerfile_path: z.string().optional(),
    watch_patterns: z.array(z.string()).optional(),
    metal: z.boolean().optional().describe("Enable Metal build environment."),
  })
  .strict();

const BuildConfigSchema = z
  .union([RailpackBuildSchema, NixpacksBuildSchema, DockerfileBuildSchema])
  .describe(
    "Build configuration. Fields depend on builder: command for railpack/nixpacks, dockerfile_path for dockerfile.",
  );

// --- Volume ---

const ServiceVolumeRefSchema = z
  .object({
    name: z.string().min(1).describe("Volume name (must match a top-level volume key)."),
    mount: z
      .string()
      .describe("Mount path inside the container (must be absolute, e.g., '/data')."),
  })
  .strict()
  .describe("Volume reference — links to a top-level volume definition.");

const VolumeConfigFieldsSchema = z
  .object({
    size_mb: z.number().int().positive().optional().describe("Volume size in MB."),
    region: z.string().optional().describe("Volume region (defaults to service region)."),
  })
  .strict();

const VolumeEntrySchema = VolumeConfigFieldsSchema.extend({
  environments: z
    .record(z.string(), VolumeConfigFieldsSchema)
    .optional()
    .describe("Per-environment volume overrides."),
})
  .strict()
  .describe("Top-level volume configuration.");

const HealthcheckConfigSchema = z
  .object({
    path: z.string().min(1).describe("HTTP path for healthcheck (e.g., '/health')."),
    timeout: z
      .number()
      .positive()
      .optional()
      .describe("Healthcheck timeout in seconds (default: 300)."),
  })
  .strict()
  .describe("HTTP healthcheck configuration.");

// --- Regions ---
// String shorthand: "us-west1" (1 replica)
// Map form: { "us-west1": 2, "us-east4": 1 } (multi-region with replica counts)

const RegionsConfigSchema = z
  .union([
    z.string().min(1).describe("Single region identifier (1 replica)."),
    z
      .record(z.string(), z.number().int().positive())
      .describe("Map of region identifier to replica count (multi-region support)."),
  ])
  .describe(
    "Deployment region(s). String for single region, map for multi-region with replica counts.",
  );

const DomainSchema = z.string();

const DomainEntrySchema = z.union([
  DomainSchema,
  z
    .object({
      domain: DomainSchema,
      target_port: z.number().int().positive().optional().describe("Target port for the domain."),
    })
    .strict(),
]);

const RailwayDomainSchema = z
  .object({
    target_port: z
      .number()
      .int()
      .positive()
      .describe("Target port for the Railway-provided domain."),
  })
  .strict()
  .optional()
  .describe("Enable a Railway-provided domain (.up.railway.app). Specify target_port.");

// --- Restart policy ---

const RestartPolicySchema = z
  .union([
    z.enum(["always", "never", "on_failure"]),
    z
      .object({
        type: z.literal("on_failure"),
        max_retries: z.number().int().nonnegative(),
      })
      .strict(),
  ])
  .optional()
  .describe(
    "Restart policy: always, never, or on_failure. Object form with max_retries only for on_failure.",
  );

const LimitsConfigSchema = z
  .object({
    memory_gb: z.number().positive().optional().describe("Memory limit in GB."),
    vcpus: z.number().positive().optional().describe("vCPU limit."),
  })
  .strict()
  .optional()
  .describe("Resource limits for the service.");

// --- Bucket ---

const BucketConfigFieldsSchema = z
  .object({
    region: z.string().optional().describe("Bucket region (e.g., 'iad')."),
  })
  .strict();

const BucketEntrySchema = BucketConfigFieldsSchema.extend({
  environments: z
    .record(z.string(), BucketConfigFieldsSchema)
    .optional()
    .describe("Per-environment bucket overrides."),
})
  .strict()
  .describe("S3-compatible bucket configuration.");

// --- Shared variables ---

const SharedVariableValueSchema = z
  .object({
    value: z.string().describe("Variable value. Supports ${ENV_VAR} syntax."),
  })
  .strict();

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

// --- Service ---

/** Shared service fields — common to templates, service entries, and overrides. */
const ServiceFieldsSchema = z.object({
  source: SourceConfigSchema.optional().describe(
    "Service source — specify either 'image' or 'repo', not both.",
  ),
  build: BuildConfigSchema.optional().describe("Build configuration."),
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
  regions: RegionsConfigSchema.optional().describe("Deployment region(s)."),
  restart_policy: RestartPolicySchema,
  healthcheck: HealthcheckConfigSchema.optional().describe("HTTP healthcheck configuration."),
  cron_schedule: z
    .string()
    .optional()
    .describe("Cron schedule (5-field format, e.g., '*/5 * * * *')."),
  start_command: z.string().optional().describe("Custom start command for the service."),
  pre_deploy_command: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Command(s) to run before deployment (e.g., DB migrations)."),
  serverless: z
    .boolean()
    .optional()
    .describe("Enable serverless mode. Containers scale to zero when idle."),
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
  railway_domain: RailwayDomainSchema,
  tcp_proxy: z.number().int().positive().optional().describe("TCP proxy application port."),
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
});

const ParamDefSchema = z
  .object({
    required: z
      .boolean()
      .optional()
      .describe("Whether this parameter must be provided by the service config."),
    default: z.string().optional().describe("Default value if not provided."),
  })
  .strict();

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

// --- Inferred types (derived from Zod schemas — single source of truth) ---

export type ParsedProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type ServiceFields = z.infer<typeof ServiceFieldsSchema>;
export type ServiceTemplate = z.infer<typeof ServiceTemplateSchema>;
export type ServiceEntry = z.infer<typeof ServiceEntrySchema>;
export type ServiceEnvironmentOverride = z.infer<typeof ServiceEnvironmentOverrideSchema>;
export type ProjectServiceEntry = z.infer<typeof ProjectServiceEntrySchema>;
export type DomainEntry = z.infer<typeof DomainEntrySchema>;
export type SharedVariableEntry = z.infer<typeof SharedVariableEntrySchema>;
export type AutoUpdateConfig = z.infer<typeof AutoUpdateConfigSchema>;
export type ParamDef = z.infer<typeof ParamDefSchema>;

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

// --- Value validation (run on resolved ServiceState after param/env expansion) ---
// builder and restart_policy are validated by the schema's enums before this runs.
// This validates values that can only be checked after %{param} and ${ENV_VAR} expansion.

const CRON_FIELD_PATTERN = /^(\*|[0-9]+(-[0-9]+)?(,[0-9]+(-[0-9]+)?)*)(\/[0-9]+)?$/;
const DOMAIN_PATTERN = /^(\*\.)?[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export function validateResolvedService(
  name: string,
  service: {
    cronSchedule?: string;
    volume?: { mount: string };
    domains: Array<{ domain: string }>;
  },
): void {
  const errors: string[] = [];

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
    if (d.domain.includes("${{") || d.domain.includes("${")) continue;
    if (!DOMAIN_PATTERN.test(d.domain)) {
      errors.push(`domain: "${d.domain}" is not a valid domain format`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid resolved config for service "${name}":\n  ${errors.join("\n  ")}`);
  }
}
