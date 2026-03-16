import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { parse as parseYaml } from "yaml";
import { logger } from "../logger.js";
import type {
  DomainEntry,
  ProjectServiceEntry,
  ServiceEntry,
  ServiceEnvironmentOverride,
  ServiceTemplate,
} from "../types/config.js";
import type { ServiceState, State } from "../types/state.js";
import { DEFAULT_HEALTHCHECK_TIMEOUT, DEFAULT_NUM_REPLICAS } from "../types/state.js";
import { expandParamsDeep, resolveParams } from "./params.js";
import {
  validateProjectConfig,
  validateResolvedService,
  validateServiceTemplate,
} from "./schema.js";
import { getDeletedVariables, resolveEnvVarString, resolveEnvVars } from "./variables.js";

/**
 * Normalize a single DomainEntry to { domain, targetPort? }.
 */
function normalizeDomainEntry(entry: DomainEntry): { domain: string; targetPort?: number } {
  if (typeof entry === "string") {
    return { domain: entry };
  }
  return {
    domain: entry.domain,
    ...(entry.target_port !== undefined ? { targetPort: entry.target_port } : {}),
  };
}

/**
 * Normalize `domains` into a single array.
 */
function normalizeDomains(domains?: DomainEntry[]): Array<{ domain: string; targetPort?: number }> {
  if (!domains) return [];
  return domains.map(normalizeDomainEntry);
}

/** Keys that are shallow-merged (override keys added to/replace defaults). */
const SHALLOW_MERGE_KEYS = ["params", "variables"] as const;

/**
 * Merge a service's default fields with a per-environment override.
 *
 * - `params`, `variables`: shallow merge (override keys replace defaults)
 * - All other fields: override replaces entirely
 * - `environments` key is stripped from the result
 */
export function mergeServiceEntry(
  defaults: ProjectServiceEntry,
  override?: ServiceEnvironmentOverride,
): ServiceEntry {
  if (!override) {
    const { environments: _, ...entry } = defaults;
    return entry;
  }

  const { environments: _, ...merged } = defaults;

  // If the override changes the template, don't merge default params — they belong to the old template
  const templateChanged = override.template !== undefined && override.template !== merged.template;

  // Shallow-merge params and variables
  for (const key of SHALLOW_MERGE_KEYS) {
    if (templateChanged && key === "params") {
      // Use override params exclusively for the new template
      if (override.params) {
        (merged as Record<string, unknown>).params = override.params;
      } else {
        delete (merged as Record<string, unknown>).params;
      }
    } else if (override[key]) {
      (merged as Record<string, unknown>)[key] = { ...merged[key], ...override[key] };
    }
  }

  // All other override fields replace entirely
  for (const [key, value] of Object.entries(override)) {
    if (
      value !== undefined &&
      !SHALLOW_MERGE_KEYS.includes(key as (typeof SHALLOW_MERGE_KEYS)[number])
    ) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }

  return merged;
}

/**
 * Resolve shared variables for a target environment.
 *
 * Merges `defaults` with the target environment's overrides from `environments`.
 */
function resolveSharedVariables(
  sharedVars:
    | {
        defaults?: Record<string, string | null>;
        environments?: Record<string, Record<string, string | null>>;
      }
    | undefined,
  targetEnvironment: string,
): Record<string, string | null> {
  if (!sharedVars) return {};

  const defaults = sharedVars.defaults ?? {};
  const overrides = sharedVars.environments?.[targetEnvironment] ?? {};

  return { ...defaults, ...overrides };
}

/**
 * Determine which services apply to a target environment.
 *
 * - Service has `environments` block → only exists in listed environments
 * - Service has no `environments` block → exists in ALL declared environments
 */
function getServicesForEnvironment(
  services: Record<string, ProjectServiceEntry>,
  targetEnvironment: string,
  declaredEnvironments: string[],
): Record<string, ServiceEntry> {
  const envSet = new Set(declaredEnvironments);
  const result: Record<string, ServiceEntry> = {};
  for (const [name, entry] of Object.entries(services)) {
    if (entry.environments) {
      // Warn about unrecognized environment keys (likely typos)
      for (const key of Object.keys(entry.environments)) {
        if (!envSet.has(key)) {
          logger.warn(
            `Service "${name}" has environment override "${key}" which is not in the declared environments (${declaredEnvironments.join(", ")})`,
          );
        }
      }
      // Service has environments block — only include if target is listed
      if (targetEnvironment in entry.environments) {
        result[name] = mergeServiceEntry(entry, entry.environments[targetEnvironment]);
      }
    } else {
      // No environments block — include for all environments
      result[name] = mergeServiceEntry(entry);
    }
  }
  return result;
}

/**
 * Load a project YAML config file, resolve templates, parameters, and produce
 * the desired {@link State} for a single target environment.
 *
 * @param projectFilePath - Path to the project YAML config file.
 * @param targetEnvironment - The environment to resolve for.
 * @param options - Optional flags (lenient mode for validation).
 * @returns The desired state, deleted variable lists, and project/environment names.
 */
export function loadProjectConfig(
  projectFilePath: string,
  targetEnvironment: string,
  options?: { lenient?: boolean },
): {
  state: State;
  deletedVars: Record<string, string[]>;
  deletedSharedVars: string[];
  projectName: string;
  environmentName: string;
  /** All service names in config (across all environments), used to prevent deleting services scoped to other envs. */
  allServiceNames: Set<string>;
} {
  const absPath = resolve(projectFilePath);
  if (!existsSync(absPath)) {
    throw new Error(`Config file not found: ${absPath}`);
  }

  const configDir = dirname(absPath);
  let raw: string;
  try {
    raw = readFileSync(absPath, "utf-8");
  } catch (err) {
    throw new Error(
      `Failed to read config file: ${absPath} — ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new Error(
      `Invalid YAML in ${absPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const config = validateProjectConfig(parsed);

  // Verify target environment is declared
  if (!config.environments.includes(targetEnvironment)) {
    throw new Error(
      `Environment "${targetEnvironment}" is not declared in config. Available: ${config.environments.join(", ")}`,
    );
  }

  // Resolve shared variables for this environment
  const mergedSharedVars = resolveSharedVariables(config.shared_variables, targetEnvironment);
  const deletedSharedVars = getDeletedVariables(mergedSharedVars);

  const lenient = options?.lenient ?? false;
  const resolvedSharedVars = resolveEnvVars(mergedSharedVars, process.env, lenient);

  // Resolve services for this environment
  const envServices = getServicesForEnvironment(
    config.services,
    targetEnvironment,
    config.environments,
  );
  const services: Record<string, ServiceState> = {};
  const deletedVars: Record<string, string[]> = {};

  for (const [name, entry] of Object.entries(envServices)) {
    const { service, deleted } = resolveService(name, entry, configDir, lenient);
    services[name] = service;
    if (deleted.length > 0) {
      deletedVars[name] = deleted;
    }
  }

  // Parse buckets from config
  const buckets: Record<string, { id: string; name: string }> = {};
  if (config.buckets) {
    for (const [key, bucket] of Object.entries(config.buckets)) {
      buckets[key] = { id: "", name: bucket.name };
    }
  }

  return {
    state: {
      projectId: "",
      environmentId: "",
      sharedVariables: resolvedSharedVars,
      services,
      buckets,
    },
    deletedVars,
    deletedSharedVars,
    projectName: config.project,
    environmentName: targetEnvironment,
    allServiceNames: new Set(Object.keys(config.services)),
  };
}

/**
 * Resolve a single service entry (with optional template) into ServiceState.
 */
function resolveService(
  name: string,
  entry: ServiceEntry,
  configDir: string,
  lenient = false,
): { service: ServiceState; deleted: string[] } {
  let template: ServiceTemplate | undefined;

  if (entry.template) {
    const templatePath = resolve(configDir, entry.template);
    if (!existsSync(templatePath)) {
      throw new Error(`Template not found: ${templatePath} (referenced by service "${name}")`);
    }
    let raw: string;
    try {
      raw = readFileSync(templatePath, "utf-8");
    } catch (err) {
      throw new Error(
        `Failed to read template: ${templatePath} — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    let parsed: unknown;
    try {
      parsed = parseYaml(raw);
    } catch (err) {
      throw new Error(
        `Invalid YAML in template ${templatePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    template = validateServiceTemplate(parsed, templatePath);
  }

  // Resolve params if template has param defs
  // service_name is a built-in param — always set to the service's config key
  if ("service_name" in (entry.params ?? {}) || "service_name" in (template?.params ?? {})) {
    throw new Error(
      `"service_name" is a built-in parameter and cannot be overridden (service "${name}")`,
    );
  }
  let params: Record<string, string> = { service_name: name };
  if (template?.params) {
    params = { ...resolveParams(template.params, entry.params || {}), service_name: name };
  }

  // Resolve each field: entry overrides template. Template values get %{param} expansion.
  const pick = <T>(entryVal: T | undefined, templateVal: T | undefined): T | undefined => {
    if (entryVal !== undefined) return entryVal;
    if (templateVal !== undefined) return expandParamsDeep(templateVal, params) as T;
    return undefined;
  };

  const source = pick(entry.source, template?.source);
  const volume = pick(entry.volume, template?.volume);
  const region = pick(entry.region, template?.region);
  const restartPolicy = pick(entry.restart_policy, template?.restart_policy);
  const healthcheck = pick(entry.healthcheck, template?.healthcheck);
  const cronSchedule = pick(entry.cron_schedule, template?.cron_schedule);
  const startCommand = pick(entry.start_command, template?.start_command);
  const buildCommand = pick(entry.build_command, template?.build_command);
  const rootDirectory = pick(entry.root_directory, template?.root_directory);
  const dockerfilePath = pick(entry.dockerfile_path, template?.dockerfile_path);
  const preDeployCommand = pick(entry.pre_deploy_command, template?.pre_deploy_command);
  const restartPolicyMaxRetries =
    entry.restart_policy_max_retries ?? template?.restart_policy_max_retries;
  const sleepApplication = entry.sleep_application ?? template?.sleep_application;
  const builder = pick(entry.builder, template?.builder);
  const watchPatterns = pick(entry.watch_patterns, template?.watch_patterns);
  const drainingSeconds = entry.draining_seconds ?? template?.draining_seconds;
  const overlapSeconds = entry.overlap_seconds ?? template?.overlap_seconds;
  const ipv6Egress = entry.ipv6_egress ?? template?.ipv6_egress;
  const branch = pick(entry.branch, template?.branch);
  const checkSuites = entry.check_suites ?? template?.check_suites;
  const registryCredentials = entry.registry_credentials ?? template?.registry_credentials;
  const railwayDomain = entry.railway_domain ?? template?.railway_domain;
  const tcpProxies = entry.tcp_proxies ?? template?.tcp_proxies;
  const limits = entry.limits ?? template?.limits;
  const railwayConfigFile = pick(entry.railway_config_file, template?.railway_config_file);
  const staticOutboundIps = entry.static_outbound_ips ?? template?.static_outbound_ips;

  // Normalize domains: entry domains override template domains if specified
  let templateDomains: Array<{ domain: string; targetPort?: number }> = [];
  if (template?.domains) {
    templateDomains = normalizeDomains(expandParamsDeep(template.domains, params) as DomainEntry[]);
  }
  const entryDomains = normalizeDomains(entry.domains);
  const domains = entryDomains.length > 0 ? entryDomains : templateDomains;

  // Merge variables: template vars (param-expanded) + env file vars
  const templateVars = template?.variables ? expandParamsDeep(template.variables, params) : {};
  const mergedVars: Record<string, string | null> = {
    ...templateVars,
    ...(entry.variables || {}),
  };

  // Track deleted vars (null values) before resolving
  const deleted = getDeletedVariables(mergedVars);

  // Resolve ${ENV_VAR} in variables
  const resolvedVars = resolveEnvVars(mergedVars, process.env, lenient);

  // Resolve ${ENV_VAR} in domains if present, and deduplicate by domain name
  const resolvedDomainsRaw = domains.map((d) => ({
    domain: resolveEnvVarString(d.domain, process.env, lenient),
    ...(d.targetPort !== undefined ? { targetPort: d.targetPort } : {}),
  }));
  const seenDomains = new Set<string>();
  const resolvedDomains: Array<{ domain: string; targetPort?: number }> = [];
  for (const d of resolvedDomainsRaw) {
    if (!seenDomains.has(d.domain)) {
      seenDomains.add(d.domain);
      resolvedDomains.push(d);
    }
  }

  const service: ServiceState = {
    name,
    variables: resolvedVars,
    domains: resolvedDomains,
  };

  if (source) service.source = source;
  if (volume) service.volume = { mount: volume.mount, name: volume.name };
  if (region) {
    service.region = {
      region: region.region,
      numReplicas: region.num_replicas ?? DEFAULT_NUM_REPLICAS,
    };
  }
  if (restartPolicy) service.restartPolicy = restartPolicy;
  if (healthcheck)
    service.healthcheck = {
      path: healthcheck.path,
      timeout: healthcheck.timeout ?? DEFAULT_HEALTHCHECK_TIMEOUT,
    };
  if (cronSchedule) service.cronSchedule = cronSchedule;
  if (startCommand) service.startCommand = startCommand;
  if (buildCommand) service.buildCommand = buildCommand;
  if (rootDirectory) service.rootDirectory = rootDirectory;
  if (dockerfilePath) service.dockerfilePath = dockerfilePath;
  if (preDeployCommand) {
    service.preDeployCommand = Array.isArray(preDeployCommand)
      ? preDeployCommand
      : [preDeployCommand];
  }
  if (restartPolicyMaxRetries !== undefined)
    service.restartPolicyMaxRetries = restartPolicyMaxRetries;
  if (sleepApplication !== undefined) service.sleepApplication = sleepApplication;
  if (builder) service.builder = builder;
  if (watchPatterns) service.watchPatterns = watchPatterns;
  if (drainingSeconds !== undefined) service.drainingSeconds = drainingSeconds;
  if (overlapSeconds !== undefined) service.overlapSeconds = overlapSeconds;
  if (ipv6Egress !== undefined) service.ipv6EgressEnabled = ipv6Egress;
  if (branch) service.branch = branch;
  if (checkSuites !== undefined) service.checkSuites = checkSuites;
  if (registryCredentials) {
    service.registryCredentials = {
      username: resolveEnvVarString(registryCredentials.username, process.env, lenient),
      password: resolveEnvVarString(registryCredentials.password, process.env, lenient),
    };
  }
  if (railwayDomain !== undefined) {
    if (railwayDomain === true) {
      service.railwayDomain = {};
    } else if (typeof railwayDomain === "object") {
      service.railwayDomain = { targetPort: railwayDomain.target_port };
    }
    // railwayDomain === false means no railway domain (don't set)
  }
  if (tcpProxies && tcpProxies.length > 0) service.tcpProxies = tcpProxies;
  if (limits) {
    service.limits = {
      ...(limits.memory_gb !== undefined ? { memoryGB: limits.memory_gb } : {}),
      ...(limits.vcpus !== undefined ? { vCPUs: limits.vcpus } : {}),
    };
  }
  if (railwayConfigFile) service.railwayConfigFile = railwayConfigFile;
  if (staticOutboundIps !== undefined) service.staticOutboundIps = staticOutboundIps;

  // Validate resolved values (after param expansion)
  validateResolvedService(name, service);

  return { service, deleted };
}
