import { beforeAll, describe, expect, test } from "bun:test";
import {
  fetchCurrentState,
  resolveEnvironmentId,
  resolveProjectId,
} from "../../src/railway/queries.js";
import {
  client,
  ENV_ID,
  ENV_NAME,
  hasToken,
  initClient,
  itif,
  PROJECT_ID,
  PROJECT_NAME,
} from "./helpers.js";

beforeAll(() => initClient());

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
    const id = await resolveEnvironmentId(client, PROJECT_ID, ENV_NAME);
    expect(id).toBe(ENV_ID);
  });

  itif(hasToken)("throws on unknown environment name", async () => {
    await expect(resolveEnvironmentId(client, PROJECT_ID, "nonexistent-env")).rejects.toThrow(
      "not found",
    );
  });

  itif(hasToken)("fetches current state with correct structure", async () => {
    const { state } = await fetchCurrentState(client, PROJECT_ID, ENV_ID);
    expect(state.projectId).toBe(PROJECT_ID);
    expect(state.environmentId).toBe(ENV_ID);
    expect(typeof state.services).toBe("object");
    expect(typeof state.sharedVariables).toBe("object");
    expect(typeof state.buckets).toBe("object");
  });
});
