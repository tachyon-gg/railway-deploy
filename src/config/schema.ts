import { z } from "zod/v4";

const SourceConfigSchema = z
  .object({
    image: z.string().optional(),
    repo: z.string().optional(),
  })
  .refine((s) => (s.image ? !s.repo : !!s.repo), {
    message: "source must have either 'image' or 'repo', not both or neither",
  });

const VolumeConfigSchema = z.object({
  mount: z.string().refine((m) => m.startsWith("/"), {
    message: "volume mount must be an absolute path (start with /)",
  }),
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

const RestartPolicySchema = z.enum(["ALWAYS", "NEVER", "ON_FAILURE"]);

const CronScheduleSchema = z.string().refine(
  (s) => {
    const parts = s.trim().split(/\s+/);
    return parts.length === 5;
  },
  { message: "cron_schedule must have exactly 5 fields (e.g., '*/5 * * * *')" },
);

const DomainSchema = z.string().refine(
  (d) => {
    // Allow %{param} and ${VAR} templates, otherwise validate domain-like format
    if (d.includes("%{") || d.includes("${")) return true;
    // Allow wildcard subdomains (*.example.com) and regular domains
    return /^(\*\.)?[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(d);
  },
  { message: "invalid domain format" },
);

const ParamDefSchema = z.object({
  required: z.boolean().optional(),
  default: z.string().optional(),
});

const BucketConfigSchema = z.object({
  name: z.string().min(1),
});

export const ServiceTemplateSchema = z.object({
  params: z.record(z.string(), ParamDefSchema).optional(),
  source: SourceConfigSchema.optional(),
  variables: z.record(z.string(), z.string().nullable()).optional(),
  domain: DomainSchema.optional(),
  domains: z.array(DomainSchema).optional(),
  regions: z.array(RegionConfigSchema).optional(),
  restart_policy: RestartPolicySchema.optional(),
  healthcheck: HealthcheckConfigSchema.optional(),
  cron_schedule: CronScheduleSchema.optional(),
  volume: VolumeConfigSchema.optional(),
  start_command: z.string().optional(),
  build_command: z.string().optional(),
  root_directory: z.string().optional(),
  dockerfile_path: z.string().optional(),
  pre_deploy_command: z.string().optional(),
  restart_policy_max_retries: z.number().int().nonnegative().optional(),
  sleep_application: z.boolean().optional(),
});

const ServiceEntrySchema = z.object({
  template: z.string().optional(),
  params: z.record(z.string(), z.string()).optional(),
  variables: z.record(z.string(), z.string().nullable()).optional(),
  source: SourceConfigSchema.optional(),
  domain: DomainSchema.optional(),
  domains: z.array(DomainSchema).optional(),
  volume: VolumeConfigSchema.optional(),
  regions: z.array(RegionConfigSchema).optional(),
  restart_policy: RestartPolicySchema.optional(),
  healthcheck: HealthcheckConfigSchema.optional(),
  cron_schedule: CronScheduleSchema.optional(),
  start_command: z.string().optional(),
  build_command: z.string().optional(),
  root_directory: z.string().optional(),
  dockerfile_path: z.string().optional(),
  pre_deploy_command: z.string().optional(),
  restart_policy_max_retries: z.number().int().nonnegative().optional(),
  sleep_application: z.boolean().optional(),
});

export const EnvironmentConfigSchema = z.object({
  project: z.string().min(1, "project name is required"),
  environment: z.string().min(1, "environment name is required"),
  shared_variables: z.record(z.string(), z.string().nullable()).optional(),
  services: z.record(z.string(), ServiceEntrySchema),
  buckets: z.record(z.string(), BucketConfigSchema).optional(),
});

/**
 * Validate an environment config object against the schema.
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
 * Validate a service template object against the schema.
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
