import { afterAll, beforeAll, describe, expect } from "bun:test";
import {
  fetchEnvironmentConfig,
  fetchServiceMap,
  resolveEnvironmentId,
  resolveProjectId,
} from "../../src/railway/queries.js";
import {
  client,
  createTestEnvironment,
  deleteTestEnvironment,
  ENV_ID,
  hasToken,
  initClient,
  itif,
  PROJECT_ID,
  PROJECT_NAME,
  TEST_ENV_NAME,
} from "./helpers.js";

beforeAll(async () => {
  initClient();
  if (hasToken) await createTestEnvironment();
});

afterAll(async () => {
  if (hasToken) await deleteTestEnvironment();
});

describe("Railway Integration — queries", () => {
  itif(hasToken)("resolves project ID by name", async () => {
    const id = await resolveProjectId(client, PROJECT_NAME);
    expect(id).toBe(PROJECT_ID);
  });

  itif(hasToken)("throws on unknown project name", async () => {
    await expect(resolveProjectId(client, "nonexistent-project-12345")).rejects.toThrow(
      "not found",
    );
  });

  itif(hasToken)("resolves environment ID by name", async () => {
    const id = await resolveEnvironmentId(client, PROJECT_ID, TEST_ENV_NAME);
    expect(id).toBe(ENV_ID);
  });

  itif(hasToken)("throws on unknown environment name", async () => {
    await expect(resolveEnvironmentId(client, PROJECT_ID, "nonexistent-env")).rejects.toThrow(
      "not found",
    );
  });

  itif(hasToken)("fetches service map with correct structure", async () => {
    const map = await fetchServiceMap(client, PROJECT_ID, ENV_ID);
    expect(map.serviceNameToId).toBeInstanceOf(Map);
    expect(map.serviceIdToName).toBeInstanceOf(Map);
    expect(map.currentServiceNames).toBeInstanceOf(Set);
    expect(map.bucketNameToId).toBeInstanceOf(Map);
    expect(map.volumeIdByService).toBeInstanceOf(Map);
  });

  itif(hasToken)("fetches environment config as valid object", async () => {
    const config = await fetchEnvironmentConfig(client, ENV_ID);
    expect(typeof config).toBe("object");
    expect(config).toBeDefined();
  });
});
