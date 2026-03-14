import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createService,
  deleteService,
  deleteSharedVariable,
  deleteVariable,
  updateServiceInstance,
  upsertSharedVariables,
  upsertVariables,
} from "../../src/railway/mutations.js";
import { fetchCurrentState } from "../../src/railway/queries.js";
import { cleanProject, client, ENV_ID, hasToken, initClient, itif, PROJECT_ID } from "./helpers.js";

beforeAll(() => initClient());

describe("Railway Integration — service lifecycle", () => {
  let serviceId: string;

  beforeAll(async () => {
    if (!hasToken) return;
    await cleanProject();
  });

  itif(hasToken)("creates a service", async () => {
    const result = await createService(client, PROJECT_ID, "test-svc", {
      image: "nginx:latest",
    });
    serviceId = result.id;
    expect(result.name).toBe("test-svc");
    expect(result.id).toBeTruthy();
  });

  itif(hasToken)("service appears in current state", async () => {
    const { state } = await fetchCurrentState(client, PROJECT_ID, ENV_ID);
    expect(state.services["test-svc"]).toBeDefined();
    expect(state.services["test-svc"].id).toBe(serviceId);
  });

  itif(hasToken)("upserts variables on a service", async () => {
    await upsertVariables(client, PROJECT_ID, ENV_ID, serviceId, {
      FOO: "bar",
      BAZ: "qux",
    });

    const { state } = await fetchCurrentState(client, PROJECT_ID, ENV_ID);
    expect(state.services["test-svc"].variables["FOO"]).toBe("bar");
    expect(state.services["test-svc"].variables["BAZ"]).toBe("qux");
  });

  itif(hasToken)("deletes a variable", async () => {
    await deleteVariable(client, PROJECT_ID, ENV_ID, serviceId, "BAZ");

    const { state } = await fetchCurrentState(client, PROJECT_ID, ENV_ID);
    expect(state.services["test-svc"].variables["BAZ"]).toBeUndefined();
    expect(state.services["test-svc"].variables["FOO"]).toBe("bar");
  });

  itif(hasToken)("updates service instance settings", async () => {
    await updateServiceInstance(client, serviceId, ENV_ID, {
      cronSchedule: "*/10 * * * *",
    });

    const { state } = await fetchCurrentState(client, PROJECT_ID, ENV_ID);
    expect(state.services["test-svc"].cronSchedule).toBe("*/10 * * * *");
  });

  itif(hasToken)("deletes a service", async () => {
    await deleteService(client, serviceId);

    const { state } = await fetchCurrentState(client, PROJECT_ID, ENV_ID);
    expect(state.services["test-svc"]).toBeUndefined();
  });
});

describe("Railway Integration — shared variables", () => {
  beforeAll(async () => {
    if (!hasToken) return;
    await cleanProject();
  });

  itif(hasToken)("upserts shared variables", async () => {
    await upsertSharedVariables(client, PROJECT_ID, ENV_ID, {
      SHARED_KEY: "shared_value",
    });

    const { state } = await fetchCurrentState(client, PROJECT_ID, ENV_ID);
    expect(state.sharedVariables["SHARED_KEY"]).toBe("shared_value");
  });

  itif(hasToken)("deletes a shared variable", async () => {
    await deleteSharedVariable(client, PROJECT_ID, ENV_ID, "SHARED_KEY");

    const { state } = await fetchCurrentState(client, PROJECT_ID, ENV_ID);
    expect(state.sharedVariables["SHARED_KEY"]).toBeUndefined();
  });
});
