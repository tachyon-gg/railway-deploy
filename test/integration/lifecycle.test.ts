import { afterAll, beforeAll, describe, expect } from "bun:test";
import {
  createService,
  createVolume,
  deleteService,
  updateVolume,
} from "../../src/railway/mutations.js";
import { fetchEnvironmentConfig, fetchServiceMap } from "../../src/railway/queries.js";
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
} from "./helpers.js";

const SVC_LIFECYCLE = `${TEST_PREFIX}-lifecycle`;
const SVC_VOL = `${TEST_PREFIX}-vol`;

beforeAll(async () => {
  initClient();
  if (hasToken) await createTestEnvironment();
});

afterAll(async () => {
  if (hasToken) await deleteTestEnvironment();
});

describe("Railway Integration — service lifecycle", () => {
  let serviceId: string;

  itif(hasToken)("creates a service via serviceCreate", async () => {
    const result = await createService(
      client,
      PROJECT_ID,
      SVC_LIFECYCLE,
      { image: "nginx:latest" },
      ENV_ID,
    );
    serviceId = result.id;
    expect(serviceId).toBeDefined();
    expect(result.name).toBe(SVC_LIFECYCLE);
  });

  itif(hasToken)("service appears in service map", async () => {
    const map = await fetchServiceMap(client, PROJECT_ID, ENV_ID);
    expect(map.serviceNameToId.get(SVC_LIFECYCLE)).toBe(serviceId);
    expect(map.serviceIdToName.get(serviceId)).toBe(SVC_LIFECYCLE);
  });

  itif(hasToken)("service appears in environment config", async () => {
    const config = await fetchEnvironmentConfig(client, ENV_ID);
    expect(config.services?.[serviceId]).toBeDefined();
  });

  itif(hasToken)("patches service variables via stage+commit", async () => {
    const config = await patchAndFetch({
      services: {
        [serviceId]: {
          variables: {
            TEST_VAR: { value: "hello" },
            PORT: { value: "3000" },
          },
        },
      },
    });
    expect(config.services?.[serviceId]?.variables?.TEST_VAR?.value).toBe("hello");
    expect(config.services?.[serviceId]?.variables?.PORT?.value).toBe("3000");
  });

  itif(hasToken)("updates existing variable value", async () => {
    const config = await patchAndFetch({
      services: {
        [serviceId]: {
          variables: {
            TEST_VAR: { value: "updated" },
          },
        },
      },
    });
    expect(config.services?.[serviceId]?.variables?.TEST_VAR?.value).toBe("updated");
    // PORT should still be present (merge mode)
    expect(config.services?.[serviceId]?.variables?.PORT?.value).toBe("3000");
  });

  itif(hasToken)("deletes the service", async () => {
    await deleteService(client, serviceId);
    const map = await fetchServiceMap(client, PROJECT_ID, ENV_ID);
    expect(map.serviceNameToId.has(SVC_LIFECYCLE)).toBe(false);
  });
});

describe("Railway Integration — volume lifecycle", () => {
  let serviceId: string;
  let volumeId: string;

  beforeAll(async () => {
    if (!hasToken) return;
    const result = await createService(
      client,
      PROJECT_ID,
      SVC_VOL,
      { image: "nginx:latest" },
      ENV_ID,
    );
    serviceId = result.id;
  });

  itif(hasToken)("creates a volume on a service", async () => {
    const vol = await createVolume(client, PROJECT_ID, serviceId, ENV_ID, "/data");
    volumeId = vol.id;
    expect(volumeId).toBeDefined();
  });

  itif(hasToken)("renames a volume", async () => {
    const uniqueName = `vol-test-${Date.now()}`;
    await updateVolume(client, volumeId, uniqueName);
  });

  itif(hasToken)("volume appears in environment config", async () => {
    const config = await fetchEnvironmentConfig(client, ENV_ID);
    expect(config.services?.[serviceId]?.volumeMounts?.[volumeId]).toBeDefined();
    expect(config.services?.[serviceId]?.volumeMounts?.[volumeId]?.mountPath).toBe("/data");
    // Top-level volume entry
    expect(config.volumes?.[volumeId]).toBeDefined();
  });

  itif(hasToken)("volume ID appears in service map", async () => {
    const map = await fetchServiceMap(client, PROJECT_ID, ENV_ID);
    expect(map.volumeIdByService.get(SVC_VOL)).toBe(volumeId);
  });

  itif(hasToken)("cleanup", async () => {
    await deleteService(client, serviceId);
  });
});
