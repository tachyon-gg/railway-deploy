/**
 * Integration test harness for railway-deploy.
 *
 * Input: YAML config → Output: Railway state
 * Every test goes through the FULL pipeline.
 */

import { mkdirSync, writeFileSync } from "fs";
import type { GraphQLClient } from "graphql-request";
import { join } from "path";
import { loadProjectConfig } from "../../src/config/loader.js";
import { createClient } from "../../src/railway/client.js";
import { createEnvironment, deleteEnvironment } from "../../src/railway/mutations.js";
import {
  fetchEnvironmentConfig,
  fetchServiceMap,
  fetchTcpProxies,
  hasEgressGateways,
} from "../../src/railway/queries.js";
import { applyConfigDiff } from "../../src/reconcile/apply.js";
import { buildEnvironmentConfig } from "../../src/reconcile/config.js";
import type { DiffContext } from "../../src/reconcile/diff.js";
import { computeConfigDiff } from "../../src/reconcile/diff.js";
import type { EnvConfigService, EnvironmentConfig } from "../../src/types/envconfig.js";

export const TOKEN = process.env.RAILWAY_TOKEN ?? "";
export const PROJECT_ID = process.env.RAILWAY_TEST_PROJECT_ID ?? "";
export const PROJECT_NAME = process.env.RAILWAY_TEST_PROJECT_NAME ?? "";

export const hasToken = !!TOKEN;
export const itif = (cond: boolean) => (cond ? test : test.skip);

export const TEST_PREFIX = `t${Date.now().toString(36)}`;

export let client: GraphQLClient;
export let ENV_ID = "";
export let TEST_ENV_NAME = "";

const FIXTURE_DIR = join(import.meta.dir, "__integration_fixtures__");

export function initClient() {
  if (hasToken) {
    client = createClient(TOKEN);
  }
}

export async function createTestEnvironment(): Promise<string> {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const name = `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const env = await createEnvironment(client, PROJECT_ID, name);
  ENV_ID = env.id;
  TEST_ENV_NAME = name;
  return env.id;
}

export async function deleteTestEnvironment(): Promise<void> {
  if (ENV_ID) {
    try {
      await deleteEnvironment(client, ENV_ID);
    } catch {
      // Best effort
    }
    ENV_ID = "";
    TEST_ENV_NAME = "";
  }
}

let counter = 0;
export function svcName(base: string) {
  return `${TEST_PREFIX}-${(++counter).toString(36)}-${base}`;
}

// ============================================================
// TCP proxy injection (Railway doesn't return these in the config blob)
// ============================================================

async function injectTcpProxies(
  config: EnvironmentConfig,
  serviceNameToId: Map<string, string>,
  environmentId: string,
): Promise<void> {
  for (const [, svcId] of serviceNameToId) {
    const ports = await fetchTcpProxies(client, svcId, environmentId);
    if (ports.length > 0) {
      if (!config.services) config.services = {};
      if (!config.services[svcId]) config.services[svcId] = {};
      if (!config.services[svcId].networking) config.services[svcId].networking = {};
      const networking = config.services[svcId].networking;
      if (networking) {
        networking.tcpProxies = {};
        for (const port of ports) {
          networking.tcpProxies[String(port)] = {};
        }
      }
    }
  }
}

// ============================================================
// Core pipeline runner
// ============================================================

async function runFullPipeline(configPath: string) {
  const { state, deletedVars, deletedSharedVars, allServiceNames } = loadProjectConfig(
    configPath,
    TEST_ENV_NAME,
  );
  state.projectId = PROJECT_ID;
  state.environmentId = ENV_ID;

  const serviceMap = await fetchServiceMap(client, PROJECT_ID, ENV_ID);
  const currentConfig = await fetchEnvironmentConfig(client, ENV_ID);

  for (const [key, bucket] of Object.entries(state.buckets)) {
    const existingId = serviceMap.bucketNameToId.get(bucket.name);
    if (existingId) state.buckets[key] = { ...bucket, id: existingId };
  }

  // Fetch egress for all existing services (to detect removal)
  const egressMap = new Map<string, boolean>();
  for (const [name] of Object.entries(state.services)) {
    const svcId = serviceMap.serviceNameToId.get(name);
    if (svcId) egressMap.set(name, await hasEgressGateways(client, svcId, ENV_ID));
  }

  // Inject TCP proxies into currentConfig (Railway doesn't include them in the config blob)
  await injectTcpProxies(currentConfig, serviceMap.serviceNameToId, ENV_ID);

  const desiredConfig = buildEnvironmentConfig(state, {
    serviceNameToId: serviceMap.serviceNameToId,
    volumeIdByService: serviceMap.volumeIdByService,
  });

  const ctx: DiffContext = {
    serviceIdToName: serviceMap.serviceIdToName,
    desiredState: state,
    allServiceNames,
    deletedSharedVars,
    deletedVars,
    egressByService: egressMap,
    customDomainsByService: serviceMap.customDomainsByService,
    serviceDomainByService: serviceMap.serviceDomainByService,
  };

  const diff = computeConfigDiff(desiredConfig, currentConfig, ctx);

  const result = await applyConfigDiff(
    client,
    diff,
    desiredConfig,
    PROJECT_ID,
    ENV_ID,
    state,
    serviceMap.serviceNameToId,
    undefined,
    serviceMap.serviceDomainByService,
    serviceMap.customDomainsByService,
    serviceMap.volumeIdByService,
  );

  return { diff, result, state, serviceMap };
}

// ============================================================
// Public API
// ============================================================

export interface RailwayState {
  config: EnvironmentConfig;
  services: Record<string, EnvConfigService>;
  sharedVariables: Record<string, { value: string; generator?: string }>;
  bucketIds: Record<string, string>;
  customDomains: Record<string, Array<{ id: string; domain: string; targetPort?: number }>>;
  serviceDomains: Record<string, { id: string; domain: string; targetPort?: number }>;
  errors: string[];
  servicesCreated: string[];
  servicesDeleted: string[];
}

/**
 * Apply a YAML config through the full pipeline and return Railway state.
 *
 * Polls with exponential backoff for the service to appear (for new services)
 * instead of a fixed wait.
 */
export async function apply(yamlConfig: string): Promise<RailwayState> {
  const configPath = join(FIXTURE_DIR, `cfg-${Date.now()}-${(counter++).toString(36)}.yaml`);
  writeFileSync(configPath, yamlConfig);

  const { diff, result, state } = await runFullPipeline(configPath);

  // Poll until config reflects changes (2s, 4s, 8s — max 3 retries)
  let finalConfig: EnvironmentConfig = {};
  let delay = 2000;
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, delay));
    finalConfig = await fetchEnvironmentConfig(client, ENV_ID);
    // If we created services and they appear, we're done
    if (result.servicesCreated.length === 0 || Object.keys(finalConfig.services ?? {}).length > 0) {
      break;
    }
    delay *= 2;
  }

  const finalMap = await fetchServiceMap(client, PROJECT_ID, ENV_ID);

  // Inject TCP proxies into finalConfig (not returned by Railway's config blob).
  // TCP proxies take ~8s to provision/deprovision after commit — poll with backoff.
  // Build expected proxy counts from desired state
  const expectedProxies = new Map<string, number>(); // svcId → expected count
  for (const [svcName, svc] of Object.entries(state.services)) {
    const svcId = finalMap.serviceNameToId.get(svcName);
    if (svcId) expectedProxies.set(svcId, svc.tcpProxy ? 1 : 0);
  }
  const needsTcpPoll =
    (result.staged && [...expectedProxies.values()].some((n) => n > 0)) ||
    diff.entries.some((e) => e.path.startsWith("networking.tcpProxies.") && e.action === "remove");
  for (let attempt = 0; attempt < (needsTcpPoll ? 12 : 1); attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 3000));
    await injectTcpProxies(finalConfig, finalMap.serviceNameToId, ENV_ID);
    if (!needsTcpPoll) break;
    let allMatch = true;
    for (const [svcId, expected] of expectedProxies) {
      const actual = Object.keys(
        finalConfig.services?.[svcId]?.networking?.tcpProxies ?? {},
      ).length;
      if (actual !== expected) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) break;
  }

  // Poll for private hostname changes (mutations run after commit, may take time to propagate)
  const phnChanges = diff.entries.filter((e) => e.category === "private-hostname");
  if (phnChanges.length > 0) {
    for (let attempt = 0; attempt < 6; attempt++) {
      let allMatch = true;
      for (const e of phnChanges) {
        const svcId = finalMap.serviceNameToId.get(e.serviceName ?? "");
        if (!svcId) continue;
        const current = finalConfig.services?.[svcId]?.networking?.privateNetworkEndpoint;
        if (e.action === "remove") {
          // After removal, Railway re-assigns a default — just check old value is gone
          if (current === e.oldValue) {
            allMatch = false;
            break;
          }
        } else {
          if (current !== e.newValue) {
            allMatch = false;
            break;
          }
        }
      }
      if (allMatch) break;
      await new Promise((r) => setTimeout(r, 2000));
      finalConfig = await fetchEnvironmentConfig(client, ENV_ID);
    }
  }

  // Build service map by NAME
  const services: Record<string, EnvConfigService> = {};
  for (const [name, id] of finalMap.serviceNameToId) {
    const svc = finalConfig.services?.[id];
    if (svc) services[name] = svc;
  }

  const bucketIds: Record<string, string> = {};
  for (const [name, id] of finalMap.bucketNameToId) {
    bucketIds[name] = id;
  }

  const customDomains: Record<
    string,
    Array<{ id: string; domain: string; targetPort?: number }>
  > = {};
  for (const [name, domains] of finalMap.customDomainsByService) {
    customDomains[name] = domains;
  }

  const serviceDomains: Record<string, { id: string; domain: string; targetPort?: number }> = {};
  for (const [name, domain] of finalMap.serviceDomainByService) {
    serviceDomains[name] = domain;
  }

  return {
    config: finalConfig,
    services,
    sharedVariables: (finalConfig.sharedVariables ?? {}) as Record<string, { value: string }>,
    bucketIds,
    customDomains,
    serviceDomains,
    errors: result.errors.map((e) => `${e.step}: ${e.error}`),
    servicesCreated: result.servicesCreated,
    servicesDeleted: result.servicesDeleted,
  };
}

/**
 * Check if a YAML config has reached convergence (re-run = zero changes).
 * Returns list of remaining diff entries (empty = converged).
 */
export async function converges(yamlConfig: string): Promise<string[]> {
  const configPath = join(FIXTURE_DIR, `conv-${Date.now()}-${(counter++).toString(36)}.yaml`);
  writeFileSync(configPath, yamlConfig);

  const { state, deletedVars, deletedSharedVars, allServiceNames } = loadProjectConfig(
    configPath,
    TEST_ENV_NAME,
  );
  state.projectId = PROJECT_ID;
  state.environmentId = ENV_ID;

  const serviceMap = await fetchServiceMap(client, PROJECT_ID, ENV_ID);
  const currentConfig = await fetchEnvironmentConfig(client, ENV_ID);

  for (const [key, bucket] of Object.entries(state.buckets)) {
    const existingId = serviceMap.bucketNameToId.get(bucket.name);
    if (existingId) state.buckets[key] = { ...bucket, id: existingId };
  }

  // Fetch egress for all existing services (to detect removal)
  const egressMap = new Map<string, boolean>();
  for (const [name] of Object.entries(state.services)) {
    const svcId = serviceMap.serviceNameToId.get(name);
    if (svcId) egressMap.set(name, await hasEgressGateways(client, svcId, ENV_ID));
  }

  // Inject TCP proxies into currentConfig (Railway doesn't include them in the config blob)
  await injectTcpProxies(currentConfig, serviceMap.serviceNameToId, ENV_ID);

  const desiredConfig = buildEnvironmentConfig(state, {
    serviceNameToId: serviceMap.serviceNameToId,
    volumeIdByService: serviceMap.volumeIdByService,
  });

  const ctx: DiffContext = {
    serviceIdToName: serviceMap.serviceIdToName,
    desiredState: state,
    allServiceNames,
    deletedSharedVars,
    deletedVars,
    egressByService: egressMap,
    customDomainsByService: serviceMap.customDomainsByService,
    serviceDomainByService: serviceMap.serviceDomainByService,
  };

  const diff = computeConfigDiff(desiredConfig, currentConfig, ctx);

  const ignore = new Set(["deploy.registryCredentials"]);
  return [
    ...diff.entries.filter((e) => !ignore.has(e.path)).map((e) => `${e.action} ${e.path}`),
    ...diff.servicesToCreate.map((s) => `create ${s.name}`),
  ];
}

/**
 * Check egress status for a service by name.
 * Only call this for tests that specifically test static_outbound_ips.
 */
export async function getEgressStatus(serviceName: string): Promise<boolean> {
  const serviceMap = await fetchServiceMap(client, PROJECT_ID, ENV_ID);
  const svcId = serviceMap.serviceNameToId.get(serviceName);
  if (!svcId) return false;
  return hasEgressGateways(client, svcId, ENV_ID);
}

/** Build YAML for an image-based service */
export function yaml(serviceName: string, fields: string, topLevel = "") {
  return `project: ${PROJECT_NAME}
environments:
  - ${TEST_ENV_NAME}
${topLevel}services:
  ${serviceName}:
    source:
      image: nginx:latest
${fields}`;
}

/** Build YAML for a repo-based service */
export function repoYaml(serviceName: string, fields: string, topLevel = "") {
  return `project: ${PROJECT_NAME}
environments:
  - ${TEST_ENV_NAME}
${topLevel}services:
  ${serviceName}:
    source:
      repo: tachyon-gg/railway-deploy
${fields}`;
}
