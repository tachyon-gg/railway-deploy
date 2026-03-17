import { mkdirSync, writeFileSync } from "fs";
import type { GraphQLClient } from "graphql-request";
import { join } from "path";
import { createClient } from "../../src/railway/client.js";
import {
  commitStagedChanges,
  createEnvironment,
  deleteEnvironment,
  stageEnvironmentChanges,
} from "../../src/railway/mutations.js";
import { fetchEnvironmentConfig } from "../../src/railway/queries.js";
import type { EnvironmentConfig } from "../../src/types/envconfig.js";

export const TOKEN = process.env.RAILWAY_TOKEN ?? "";
export const PROJECT_ID = process.env.RAILWAY_TEST_PROJECT_ID ?? "";
export const PROJECT_NAME = process.env.RAILWAY_TEST_PROJECT_NAME ?? "";
export const ENV_NAME = process.env.RAILWAY_TEST_ENV_NAME ?? "";

export const hasToken = !!TOKEN;
export const itif = (cond: boolean) => (cond ? test : test.skip);

/** Unique prefix for this test run — prevents service name collisions */
export const TEST_PREFIX = `t${Date.now().toString(36)}`;

export let client: GraphQLClient;
/** The test environment ID — created fresh for each test suite */
export let ENV_ID = "";
/** The test environment name — set by createTestEnvironment */
export let TEST_ENV_NAME = "";

export function initClient() {
  if (hasToken) {
    client = createClient(TOKEN);
  }
}

/**
 * Create a fresh environment with a random name for testing.
 * Call in beforeAll. Returns the new environment ID.
 */
export async function createTestEnvironment(): Promise<string> {
  const name = `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const env = await createEnvironment(client, PROJECT_ID, name);
  ENV_ID = env.id;
  TEST_ENV_NAME = name;
  return env.id;
}

/**
 * Delete the test environment. Call in afterAll.
 */
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

/**
 * Poll the environment config until a predicate is satisfied.
 * Uses exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, 64s (max 7 retries, ~127s total).
 */
export async function waitForConfig(
  predicate: (config: EnvironmentConfig) => boolean,
  maxRetries = 7,
): Promise<EnvironmentConfig> {
  let delay = 1000;
  for (let i = 0; i <= maxRetries; i++) {
    const config = await fetchEnvironmentConfig(client, ENV_ID);
    if (predicate(config)) return config;
    if (i < maxRetries) {
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
    }
  }
  return fetchEnvironmentConfig(client, ENV_ID);
}

/**
 * Stage and commit a patch, then poll until the config reflects the change.
 */
export async function patchAndFetch(
  patch: EnvironmentConfig,
  verify?: (config: EnvironmentConfig) => boolean,
): Promise<EnvironmentConfig> {
  await stageEnvironmentChanges(client, ENV_ID, patch, true);
  await commitStagedChanges(client, ENV_ID, "test patch");

  if (verify) {
    return waitForConfig(verify);
  }
  await new Promise((r) => setTimeout(r, 3000));
  return fetchEnvironmentConfig(client, ENV_ID);
}

export const FIXTURE_DIR = join(import.meta.dir, "__integration_fixtures__");
export const SERVICES_DIR = join(FIXTURE_DIR, "services");

export function setupFixtures() {
  mkdirSync(SERVICES_DIR, { recursive: true });

  writeFileSync(
    join(SERVICES_DIR, "web.yaml"),
    `params:
  tag:
    required: true

source:
  image: nginx:%{tag}

variables:
  APP_NAME: integration-test
  TAG: "%{tag}"
`,
  );
}
