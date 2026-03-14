import { mkdirSync, writeFileSync } from "fs";
import type { GraphQLClient } from "graphql-request";
import { join } from "path";
import { createClient } from "../../src/railway/client.js";
import { deleteService, deleteSharedVariable } from "../../src/railway/mutations.js";
import { fetchCurrentState } from "../../src/railway/queries.js";

export const TOKEN = process.env.RAILWAY_TOKEN;
export const PROJECT_ID = process.env.RAILWAY_TEST_PROJECT_ID!;
export const PROJECT_NAME = process.env.RAILWAY_TEST_PROJECT_NAME!;
export const ENV_NAME = process.env.RAILWAY_TEST_ENV_NAME!;
export const ENV_ID = process.env.RAILWAY_TEST_ENV_ID!;

export const hasToken = !!TOKEN;
export const itif = (cond: boolean) => (cond ? test : test.skip);

export let client: GraphQLClient;

export function initClient() {
  if (hasToken) {
    client = createClient(TOKEN!);
  }
}

export async function cleanProject() {
  const { state } = await fetchCurrentState(client, PROJECT_ID, ENV_ID);

  for (const svc of Object.values(state.services)) {
    if (svc.id) {
      await deleteService(client, svc.id);
    }
  }

  for (const key of Object.keys(state.sharedVariables)) {
    if (!key.startsWith("RAILWAY_")) {
      await deleteSharedVariable(client, PROJECT_ID, ENV_ID, key);
    }
  }
}

export const FIXTURE_DIR = join(import.meta.dir, "__integration_fixtures__");
export const SERVICES_DIR = join(FIXTURE_DIR, "services");
export const ENVS_DIR = join(FIXTURE_DIR, "environments");

export function setupFixtures() {
  mkdirSync(SERVICES_DIR, { recursive: true });
  mkdirSync(ENVS_DIR, { recursive: true });

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

  writeFileSync(
    join(SERVICES_DIR, "worker.yaml"),
    `params:
  tag:
    default: latest

source:
  image: redis:%{tag}

variables:
  ROLE: worker
`,
  );
}
