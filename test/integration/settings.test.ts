import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "fs";
import { join } from "path";
import { loadEnvironmentConfig } from "../../src/config/loader.js";
import { createService } from "../../src/railway/mutations.js";
import { fetchCurrentState } from "../../src/railway/queries.js";
import { applyChangeset } from "../../src/reconcile/apply.js";
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

describe("Railway Integration — service settings", () => {
  beforeAll(async () => {
    if (!hasToken) return;
    await cleanProject();
  });

  itif(hasToken)(
    "startCommand: set, verify, idempotency",
    async () => {
      writeFileSync(
        join(ENVS_DIR, "settings.yaml"),
        `project: ${PROJECT_NAME}
environment: ${ENV_NAME}
services:
  web:
    source:
      image: nginx:alpine
    start_command: "nginx -g 'daemon off;'"
`,
      );

      const {
        state: desired,
        deletedVars,
        deletedSharedVars,
      } = loadEnvironmentConfig(join(ENVS_DIR, "settings.yaml"));
      desired.projectId = PROJECT_ID;
      desired.environmentId = ENV_ID;

      const {
        state: current,
        domainMap,
        volumeMap,
      } = await fetchCurrentState(client, PROJECT_ID, ENV_ID);
      const changeset = computeChangeset(
        desired,
        current,
        deletedVars,
        deletedSharedVars,
        domainMap,
        volumeMap,
      );
      expect(changeset.changes.length).toBeGreaterThan(0);

      const result = await applyChangeset(client, changeset, PROJECT_ID, ENV_ID);
      expect(result.failed).toEqual([]);

      const {
        state: after,
        domainMap: afterDomains,
        volumeMap: afterVolumes,
      } = await fetchCurrentState(client, PROJECT_ID, ENV_ID);
      expect(after.services["web"].startCommand).toBe("nginx -g 'daemon off;'");

      const secondDiff = computeChangeset(
        desired,
        after,
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
    "source image change and idempotency",
    async () => {
      writeFileSync(
        join(ENVS_DIR, "settings.yaml"),
        `project: ${PROJECT_NAME}
environment: ${ENV_NAME}
services:
  web:
    source:
      image: nginx:stable
    start_command: "nginx -g 'daemon off;'"
`,
      );

      const {
        state: desired,
        deletedVars,
        deletedSharedVars,
      } = loadEnvironmentConfig(join(ENVS_DIR, "settings.yaml"));
      desired.projectId = PROJECT_ID;
      desired.environmentId = ENV_ID;

      const {
        state: current,
        domainMap,
        volumeMap,
      } = await fetchCurrentState(client, PROJECT_ID, ENV_ID);
      const changeset = computeChangeset(
        desired,
        current,
        deletedVars,
        deletedSharedVars,
        domainMap,
        volumeMap,
      );
      expect(changeset.changes.length).toBeGreaterThan(0);

      const result = await applyChangeset(client, changeset, PROJECT_ID, ENV_ID);
      expect(result.failed).toEqual([]);

      const {
        state: after,
        domainMap: afterDomains,
        volumeMap: afterVolumes,
      } = await fetchCurrentState(client, PROJECT_ID, ENV_ID);
      expect(after.services["web"].source?.image).toBe("nginx:stable");

      const secondDiff = computeChangeset(
        desired,
        after,
        deletedVars,
        deletedSharedVars,
        afterDomains,
        afterVolumes,
      );
      expect(secondDiff.changes).toEqual([]);
    },
    30000,
  );
});

describe("Railway Integration — variables edge cases", () => {
  beforeAll(async () => {
    if (!hasToken) return;
    await cleanProject();
  });

  itif(hasToken)(
    "RAILWAY_* variables don't cause spurious deletes",
    async () => {
      await createService(client, PROJECT_ID, "test-svc", { image: "nginx:latest" });

      const {
        state: current,
        domainMap,
        volumeMap,
      } = await fetchCurrentState(client, PROJECT_ID, ENV_ID);

      const desired = {
        ...current,
        services: {
          "test-svc": {
            name: "test-svc",
            variables: {},
            domains: [] as string[],
          },
        },
      };

      const changeset = computeChangeset(desired, current, {}, [], domainMap, volumeMap);

      const delVars = changeset.changes.filter((c) => c.type === "delete-variables");
      for (const dv of delVars) {
        if (dv.type === "delete-variables") {
          for (const name of dv.variableNames) {
            expect(name.startsWith("RAILWAY_")).toBe(false);
          }
        }
      }
    },
    30000,
  );
});
