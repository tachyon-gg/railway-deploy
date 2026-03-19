import { afterAll, beforeAll, describe, expect } from "bun:test";
import {
  apply,
  converges,
  createTestEnvironment,
  deleteTestEnvironment,
  hasToken,
  initClient,
  itif,
  svcName,
  yaml,
} from "./helpers.js";

beforeAll(async () => {
  initClient();
  if (hasToken) await createTestEnvironment();
});

afterAll(async () => {
  if (hasToken) await deleteTestEnvironment();
});

describe("Railway Integration — buckets", () => {
  const bucketName = svcName("bucket");
  const serviceName = svcName("bkt-svc");

  itif(hasToken)("create: bucket appears in state.bucketIds", async () => {
    const bucketBlock = `buckets:\n  ${bucketName}: {}\n`;
    const s = await apply(yaml(serviceName, "", bucketBlock));
    expect(s.errors).toEqual([]);
    expect(Object.keys(s.bucketIds).length).toBeGreaterThanOrEqual(1);
    // The bucket should exist with our name as a key
    expect(s.bucketIds[bucketName]).toBeDefined();
    expect(typeof s.bucketIds[bucketName]).toBe("string");
  });

  itif(hasToken)("converge after create", async () => {
    const bucketBlock = `buckets:\n  ${bucketName}: {}\n`;
    const changes = await converges(yaml(serviceName, "", bucketBlock));
    // Filter out service-level noise unrelated to buckets
    const bucketChanges = changes.filter((c) => !c.includes("privateNetworkEndpoint"));
    expect(bucketChanges).toEqual([]);
  });
});
