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

describe("Railway Integration — region", () => {
  const name = svcName("region");

  itif(hasToken)("create: region us-west1 with 2 replicas", async () => {
    const s = await apply(yaml(name, "    regions:\n      us-west1: 2"));
    expect(s.errors).toEqual([]);
    const mrc = s.services[name]?.deploy?.multiRegionConfig;
    expect(mrc).toBeDefined();
    expect((mrc as Record<string, unknown>)["us-west1"]).toEqual({ numReplicas: 2 });
  });

  itif(hasToken)("converge after create", async () => {
    const remaining = await converges(yaml(name, "    regions:\n      us-west1: 2"));
    expect(remaining).toEqual([]);
  });

  itif(hasToken)("update: change replicas to 3", async () => {
    const s = await apply(yaml(name, "    regions:\n      us-west1: 3"));
    expect(s.errors).toEqual([]);
    const mrc = s.services[name]?.deploy?.multiRegionConfig;
    expect(mrc).toBeDefined();
    expect((mrc as Record<string, unknown>)["us-west1"]).toEqual({ numReplicas: 3 });
  });

  itif(hasToken)("converge after update", async () => {
    const remaining = await converges(yaml(name, "    regions:\n      us-west1: 3"));
    expect(remaining).toEqual([]);
  });

  itif(hasToken)("remove: omit region from config", async () => {
    const s = await apply(yaml(name, ""));
    expect(s.errors).toEqual([]);
  });

  itif(hasToken)("converge after remove", async () => {
    const remaining = await converges(yaml(name, ""));
    expect(remaining).toEqual([]);
  });
});
