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

describe("Railway Integration — serverless", () => {
  const name = svcName("sleep");

  itif(hasToken)("create: serverless true", async () => {
    const s = await apply(yaml(name, "    serverless: true"));
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.deploy?.sleepApplication).toBe(true);
  });

  itif(hasToken)("converge after create", async () => {
    expect(await converges(yaml(name, "    serverless: true"))).toEqual([]);
  });

  itif(hasToken)("update: serverless false", async () => {
    const s = await apply(yaml(name, "    serverless: false"));
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.deploy?.sleepApplication).toBe(false);
  });

  itif(hasToken)("converge after update", async () => {
    expect(await converges(yaml(name, "    serverless: false"))).toEqual([]);
  });

  itif(hasToken)("remove: no serverless in config", async () => {
    const s = await apply(yaml(name, ""));
    expect(s.errors).toEqual([]);
    // After removing serverless, the value should be falsy (false, null, or undefined)
    const val = s.services[name]?.deploy?.sleepApplication;
    expect(!val).toBe(true);
  });

  itif(hasToken)("converge after remove", async () => {
    expect(await converges(yaml(name, ""))).toEqual([]);
  });
});
