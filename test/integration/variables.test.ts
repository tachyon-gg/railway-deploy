import { afterAll, beforeAll, describe, expect } from "bun:test";
import { createService } from "../../src/railway/mutations.js";
import {
  client,
  createTestEnvironment,
  deleteTestEnvironment,
  ENV_ID,
  hasToken,
  initClient,
  itif,
  PROJECT_ID,
  patchAndFetch,
  TEST_PREFIX,
  waitForConfig,
} from "./helpers.js";

const SVC_VAR = `${TEST_PREFIX}-var`;

beforeAll(async () => {
  initClient();
  if (hasToken) await createTestEnvironment();
});

afterAll(async () => {
  if (hasToken) await deleteTestEnvironment();
});

describe("Railway Integration — service variables", () => {
  let serviceId: string;

  beforeAll(async () => {
    if (!hasToken) return;
    const result = await createService(
      client,
      PROJECT_ID,
      SVC_VAR,
      { image: "nginx:latest" },
      ENV_ID,
    );
    serviceId = result.id;
    await waitForConfig((c) => c.services?.[serviceId] !== undefined);
  });

  itif(hasToken)("adds variables", async () => {
    const config = await patchAndFetch(
      {
        services: {
          [serviceId]: {
            variables: {
              PORT: { value: "3000" },
              HOST: { value: "0.0.0.0" },
              DB_URL: { value: "postgres://localhost/test" },
            },
          },
        },
      },
      (c) => c.services?.[serviceId]?.variables?.PORT?.value === "3000",
    );
    expect(config.services?.[serviceId]?.variables?.PORT?.value).toBe("3000");
    expect(config.services?.[serviceId]?.variables?.HOST?.value).toBe("0.0.0.0");
    expect(config.services?.[serviceId]?.variables?.DB_URL?.value).toBe(
      "postgres://localhost/test",
    );
  });

  itif(hasToken)("updates a variable value (merge preserves others)", async () => {
    const config = await patchAndFetch({
      services: {
        [serviceId]: {
          variables: {
            PORT: { value: "8080" },
          },
        },
      },
    });
    expect(config.services?.[serviceId]?.variables?.PORT?.value).toBe("8080");
    // Others should still exist with merge:true
    expect(config.services?.[serviceId]?.variables?.HOST?.value).toBe("0.0.0.0");
    expect(config.services?.[serviceId]?.variables?.DB_URL?.value).toBe(
      "postgres://localhost/test",
    );
  });

  itif(hasToken)("deletes variable with null value in merge mode", async () => {
    const config = await patchAndFetch({
      services: {
        [serviceId]: {
          variables: {
            DB_URL: null as unknown as { value: string },
          },
        },
      },
    });
    // null with merge:true deletes the variable
    expect(config.services?.[serviceId]?.variables?.DB_URL).toBeUndefined();
    // Other variables should still exist
    expect(config.services?.[serviceId]?.variables?.PORT?.value).toBe("8080");
    expect(config.services?.[serviceId]?.variables?.HOST?.value).toBe("0.0.0.0");
  });

  itif(hasToken)("handles Railway reference syntax in values", async () => {
    const config = await patchAndFetch({
      services: {
        [serviceId]: {
          variables: {
            REDIS_URL: { value: "${{Redis.REDIS_URL}}" },
            ENV: { value: "${{RAILWAY_ENVIRONMENT}}" },
          },
        },
      },
    });
    expect(config.services?.[serviceId]?.variables?.REDIS_URL?.value).toBe("${{Redis.REDIS_URL}}");
    expect(config.services?.[serviceId]?.variables?.ENV?.value).toBe("${{RAILWAY_ENVIRONMENT}}");
  });
});

describe("Railway Integration — shared variables", () => {
  itif(hasToken)("adds shared variables", async () => {
    const config = await patchAndFetch({
      sharedVariables: {
        ADMIN_PORT: { value: "8081" },
        APP_ENV: { value: "test" },
      },
    });
    expect(config.sharedVariables?.ADMIN_PORT?.value).toBe("8081");
    expect(config.sharedVariables?.APP_ENV?.value).toBe("test");
  });

  itif(hasToken)("updates shared variable (merge preserves others)", async () => {
    const config = await patchAndFetch({
      sharedVariables: {
        APP_ENV: { value: "production" },
      },
    });
    expect(config.sharedVariables?.APP_ENV?.value).toBe("production");
    expect(config.sharedVariables?.ADMIN_PORT?.value).toBe("8081");
  });

  itif(hasToken)("deletes shared variable with null in merge mode", async () => {
    const config = await patchAndFetch({
      sharedVariables: {
        ADMIN_PORT: null as unknown as { value: string },
      },
    });
    expect(config.sharedVariables?.ADMIN_PORT).toBeUndefined();
    // Other shared variable should still exist
    expect(config.sharedVariables?.APP_ENV?.value).toBe("production");
  });
});
