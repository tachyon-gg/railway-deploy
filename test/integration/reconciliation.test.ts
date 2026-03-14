import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "fs";
import { join } from "path";
import { loadEnvironmentConfig } from "../../src/config/loader.js";
import { fetchCurrentState } from "../../src/railway/queries.js";
import { applyChangeset, printChangeset } from "../../src/reconcile/apply.js";
import { computeChangeset } from "../../src/reconcile/diff.js";
import {
  cleanProject,
  client,
  ENV_ID,
  ENV_NAME,
  ENVS_DIR,
  FIXTURE_DIR,
  hasToken,
  initClient,
  itif,
  PROJECT_ID,
  PROJECT_NAME,
  SERVICES_DIR,
  setupFixtures,
} from "./helpers.js";

beforeAll(() => {
  initClient();
  if (hasToken) setupFixtures();
});

afterAll(async () => {
  if (!hasToken) return;
  await cleanProject();
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

describe("Railway Integration — full reconciliation", () => {
  beforeAll(async () => {
    if (!hasToken) return;
    await cleanProject();
  });

  itif(hasToken)(
    "applies a config and reaches desired state",
    async () => {
      writeFileSync(
        join(ENVS_DIR, "test.yaml"),
        `project: ${PROJECT_NAME}
environment: ${ENV_NAME}

shared_variables:
  APP_ENVIRONMENT: test

services:
  web:
    template: ../services/web.yaml
    params:
      tag: alpine

  worker:
    template: ../services/worker.yaml
    params:
      tag: "7"
    variables:
      EXTRA: "yes"
`,
      );

      const {
        state: desiredState,
        deletedVars,
        deletedSharedVars,
      } = loadEnvironmentConfig(join(ENVS_DIR, "test.yaml"));
      desiredState.projectId = PROJECT_ID;
      desiredState.environmentId = ENV_ID;

      const {
        state: currentState,
        domainMap,
        volumeMap,
      } = await fetchCurrentState(client, PROJECT_ID, ENV_ID);

      const changeset = computeChangeset(
        desiredState,
        currentState,
        deletedVars,
        deletedSharedVars,
        domainMap,
        volumeMap,
      );

      expect(changeset.changes.length).toBeGreaterThan(0);
      printChangeset(changeset);

      const result = await applyChangeset(client, changeset, PROJECT_ID, ENV_ID);
      expect(result.failed).toEqual([]);

      // Verify idempotency
      const {
        state: afterState,
        domainMap: afterDomains,
        volumeMap: afterVolumes,
      } = await fetchCurrentState(client, PROJECT_ID, ENV_ID);

      const secondDiff = computeChangeset(
        desiredState,
        afterState,
        deletedVars,
        deletedSharedVars,
        afterDomains,
        afterVolumes,
      );
      printChangeset(secondDiff);
      expect(secondDiff.changes).toEqual([]);
    },
    30000,
  );

  itif(hasToken)(
    "handles updates to existing config",
    async () => {
      writeFileSync(
        join(ENVS_DIR, "test.yaml"),
        `project: ${PROJECT_NAME}
environment: ${ENV_NAME}

shared_variables:
  APP_ENVIRONMENT: test-v2

services:
  web:
    template: ../services/web.yaml
    params:
      tag: stable
    variables:
      UPDATED: "true"

  worker:
    template: ../services/worker.yaml
    params:
      tag: "7"
    variables:
      EXTRA: "yes"
`,
      );

      const {
        state: desiredState,
        deletedVars,
        deletedSharedVars,
      } = loadEnvironmentConfig(join(ENVS_DIR, "test.yaml"));
      desiredState.projectId = PROJECT_ID;
      desiredState.environmentId = ENV_ID;

      const {
        state: currentState,
        domainMap,
        volumeMap,
      } = await fetchCurrentState(client, PROJECT_ID, ENV_ID);

      const changeset = computeChangeset(
        desiredState,
        currentState,
        deletedVars,
        deletedSharedVars,
        domainMap,
        volumeMap,
      );

      expect(changeset.changes.length).toBeGreaterThan(0);

      const result = await applyChangeset(client, changeset, PROJECT_ID, ENV_ID);
      expect(result.failed).toEqual([]);

      const {
        state: afterState,
        domainMap: afterDomains,
        volumeMap: afterVolumes,
      } = await fetchCurrentState(client, PROJECT_ID, ENV_ID);

      const secondDiff = computeChangeset(
        desiredState,
        afterState,
        deletedVars,
        deletedSharedVars,
        afterDomains,
        afterVolumes,
      );
      expect(secondDiff.changes).toEqual([]);
    },
    30000,
  );

  itif(hasToken)(
    "handles service removal",
    async () => {
      writeFileSync(
        join(ENVS_DIR, "test.yaml"),
        `project: ${PROJECT_NAME}
environment: ${ENV_NAME}

shared_variables:
  APP_ENVIRONMENT: test-v2

services:
  web:
    template: ../services/web.yaml
    params:
      tag: stable
    variables:
      UPDATED: "true"
`,
      );

      const {
        state: desiredState,
        deletedVars,
        deletedSharedVars,
      } = loadEnvironmentConfig(join(ENVS_DIR, "test.yaml"));
      desiredState.projectId = PROJECT_ID;
      desiredState.environmentId = ENV_ID;

      const {
        state: currentState,
        domainMap,
        volumeMap,
      } = await fetchCurrentState(client, PROJECT_ID, ENV_ID);

      const changeset = computeChangeset(
        desiredState,
        currentState,
        deletedVars,
        deletedSharedVars,
        domainMap,
        volumeMap,
      );

      const deletes = changeset.changes.filter((c) => c.type === "delete-service");
      expect(deletes.length).toBe(1);
      if (deletes[0].type === "delete-service") {
        expect(deletes[0].name).toBe("worker");
      }

      const result = await applyChangeset(client, changeset, PROJECT_ID, ENV_ID);
      expect(result.failed).toEqual([]);

      const { state: afterState } = await fetchCurrentState(client, PROJECT_ID, ENV_ID);
      expect(afterState.services["worker"]).toBeUndefined();
      expect(afterState.services["web"]).toBeDefined();
    },
    30000,
  );
});
