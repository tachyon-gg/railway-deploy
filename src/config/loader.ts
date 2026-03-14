import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { parse as parseYaml } from "yaml";
import type {
  DomainEntry,
  EnvironmentConfig,
  ServiceEntry,
  ServiceTemplate,
} from "../types/config.js";
import type { ServiceState, State } from "../types/state.js";
import { DEFAULT_HEALTHCHECK_TIMEOUT, DEFAULT_NUM_REPLICAS } from "../types/state.js";
import { expandParamsDeep, resolveParams } from "./params.js";
import { validateEnvironmentConfig, validateServiceTemplate } from "./schema.js";
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
 * Normalize singular `domain` and plural `domains` into a single array.
 */
function normalizeDomains(
  domain?: DomainEntry,
  domains?: DomainEntry[],
): Array<{ domain: string; targetPort?: number }> {
  const result: Array<{ domain: string; targetPort?: number }> = [];
  if (domains) result.push(...domains.map(normalizeDomainEntry));
  if (domain) {
    const normalized = normalizeDomainEntry(domain);
    if (!result.some((d) => d.domain === normalized.domain)) {
      result.push(normalized);
    }
  }
  return result;
}

/**
 * Load an environment YAML file, resolve templates and parameters, and produce
 * the desired {@link State} for reconciliation.
 *
 * @param envFilePath - Path to the environment YAML config file.
 * @returns The desired state, deleted variable lists (for explicit `null` overrides),
 *          and the project/environment names from the config.
 * @throws On missing file, invalid YAML, schema validation failure, or missing template.
 */
export function loadEnvironmentConfig(envFilePath: string): {
  state: State;
  deletedVars: Record<string, string[]>;
  deletedSharedVars: string[];
  projectName: string;
  environmentName: string;
} {
  const absPath = resolve(envFilePath);
  if (!existsSync(absPath)) {
    throw new Error(`Config file not found: ${absPath}`);
  }

  const envDir = dirname(absPath);
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

  validateEnvironmentConfig(parsed);
  const config = parsed as EnvironmentConfig;

  const services: Record<string, ServiceState> = {};
  const deletedVars: Record<string, string[]> = {};

  for (const [name, entry] of Object.entries(config.services)) {
    const { service, deleted } = resolveService(name, entry, envDir);
    services[name] = service;
    if (deleted.length > 0) {
      deletedVars[name] = deleted;
    }
  }

  // Resolve shared variables
  const resolvedSharedVars = config.shared_variables ? resolveEnvVars(config.shared_variables) : {};
  const deletedSharedVars = config.shared_variables
    ? getDeletedVariables(config.shared_variables)
    : [];

  // Parse buckets from config
  const buckets: Record<string, { id: string; name: string }> = {};
  if (config.buckets) {
    for (const [key, bucket] of Object.entries(config.buckets)) {
      buckets[key] = { id: "", name: bucket.name };
    }
  }

  return {
    state: {
      projectId: "", // Resolved later from project name
      environmentId: "", // Resolved later from environment name
      sharedVariables: resolvedSharedVars,
      services,
      buckets,
    },
    deletedVars,
    deletedSharedVars,
    projectName: config.project,
    environmentName: config.environment,
  };
}

/**
 * Resolve a single service entry (with optional template) into ServiceState.
 */
function resolveService(
  name: string,
  entry: ServiceEntry,
  envDir: string,
): { service: ServiceState; deleted: string[] } {
  let template: ServiceTemplate | undefined;

  if (entry.template) {
    const templatePath = resolve(envDir, entry.template);
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
    validateServiceTemplate(parsed, templatePath);
    template = parsed as ServiceTemplate;
  }

  // Resolve params if template has param defs
  let params: Record<string, string> = {};
  if (template?.params) {
    params = resolveParams(template.params, entry.params || {});
  }

  // Start with template values, expand params
  let source = template?.source ? expandParamsDeep(template.source, params) : entry.source;
  const volume = template?.volume ? expandParamsDeep(template.volume, params) : entry.volume;
  const region = template?.region ? expandParamsDeep(template.region, params) : entry.region;
  const restartPolicy = template?.restart_policy
    ? expandParamsDeep(template.restart_policy, params)
    : entry.restart_policy;
  const healthcheck = template?.healthcheck
    ? expandParamsDeep(template.healthcheck, params)
    : entry.healthcheck;
  const cronSchedule = template?.cron_schedule
    ? expandParamsDeep(template.cron_schedule, params)
    : entry.cron_schedule;
  const startCommand = template?.start_command
    ? expandParamsDeep(template.start_command, params)
    : entry.start_command;
  const buildCommand = template?.build_command
    ? expandParamsDeep(template.build_command, params)
    : entry.build_command;
  const rootDirectory = template?.root_directory
    ? expandParamsDeep(template.root_directory, params)
    : entry.root_directory;
  const dockerfilePath = template?.dockerfile_path
    ? expandParamsDeep(template.dockerfile_path, params)
    : entry.dockerfile_path;
  const preDeployCommand = template?.pre_deploy_command
    ? expandParamsDeep(template.pre_deploy_command, params)
    : entry.pre_deploy_command;
  const restartPolicyMaxRetries =
    template?.restart_policy_max_retries ?? entry.restart_policy_max_retries;
  const sleepApplication = template?.sleep_application ?? entry.sleep_application;
  const builder = template?.builder ? expandParamsDeep(template.builder, params) : entry.builder;
  const watchPatterns = template?.watch_patterns
    ? expandParamsDeep(template.watch_patterns, params)
    : entry.watch_patterns;
  const drainingSeconds = template?.draining_seconds ?? entry.draining_seconds;
  const overlapSeconds = template?.overlap_seconds ?? entry.overlap_seconds;
  const ipv6Egress = template?.ipv6_egress ?? entry.ipv6_egress;
  const branch = template?.branch ? expandParamsDeep(template.branch, params) : entry.branch;
  const checkSuites = template?.check_suites ?? entry.check_suites;
  const registryCredentials = template?.registry_credentials ?? entry.registry_credentials;
  const railwayDomain = template?.railway_domain ?? entry.railway_domain;
  const tcpProxy = template?.tcp_proxy ?? entry.tcp_proxy;
  const tcpProxies = template?.tcp_proxies ?? entry.tcp_proxies;
  const limits = template?.limits ?? entry.limits;
  const railwayConfigFile = template?.railway_config_file
    ? expandParamsDeep(template.railway_config_file, params)
    : entry.railway_config_file;
  const staticOutboundIps = template?.static_outbound_ips ?? entry.static_outbound_ips;

  // Normalize domains from template and entry
  let templateDomains: Array<{ domain: string; targetPort?: number }> = [];
  if (template) {
    const tplDomain = template.domain
      ? (expandParamsDeep(template.domain, params) as DomainEntry)
      : undefined;
    const tplDomains = template.domains
      ? (expandParamsDeep(template.domains, params) as DomainEntry[])
      : undefined;
    templateDomains = normalizeDomains(tplDomain, tplDomains);
  }
  const entryDomains = normalizeDomains(entry.domain, entry.domains);

  // Inline source override
  if (entry.source) source = entry.source;

  // Entry domains override template domains if specified
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
  const resolvedVars = resolveEnvVars(mergedVars);

  // Resolve ${ENV_VAR} in domains if present, and deduplicate by domain name
  const resolvedDomainsRaw = domains.map((d) => ({
    domain: resolveEnvVarString(d.domain),
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
      username: resolveEnvVarString(registryCredentials.username),
      password: resolveEnvVarString(registryCredentials.password),
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
  // Normalize tcp_proxy / tcp_proxies into tcpProxies
  const allTcpPorts: number[] = [];
  if (tcpProxies) allTcpPorts.push(...tcpProxies);
  if (tcpProxy !== undefined && !allTcpPorts.includes(tcpProxy)) allTcpPorts.push(tcpProxy);
  if (allTcpPorts.length > 0) service.tcpProxies = allTcpPorts;
  if (limits) {
    service.limits = {
      ...(limits.memory_gb !== undefined ? { memoryGB: limits.memory_gb } : {}),
      ...(limits.vcpus !== undefined ? { vCPUs: limits.vcpus } : {}),
    };
  }
  if (railwayConfigFile) service.railwayConfigFile = railwayConfigFile;
  if (staticOutboundIps !== undefined) service.staticOutboundIps = staticOutboundIps;

  return { service, deleted };
}
