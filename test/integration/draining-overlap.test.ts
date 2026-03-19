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

describe("Railway Integration — draining_seconds / overlap_seconds", () => {
  const name = svcName("drain");

  itif(hasToken)("create: set draining_seconds=30, overlap_seconds=10", async () => {
    const s = await apply(yaml(name, "    draining_seconds: 30\n    overlap_seconds: 10"));
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.deploy?.drainingSeconds).toBe(30);
    expect(s.services[name]?.deploy?.overlapSeconds).toBe(10);
  });

  itif(hasToken)("converge after create", async () => {
    expect(
      await converges(yaml(name, "    draining_seconds: 30\n    overlap_seconds: 10")),
    ).toEqual([]);
  });

  itif(hasToken)("update: change to draining_seconds=60, overlap_seconds=20", async () => {
    const s = await apply(yaml(name, "    draining_seconds: 60\n    overlap_seconds: 20"));
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.deploy?.drainingSeconds).toBe(60);
    expect(s.services[name]?.deploy?.overlapSeconds).toBe(20);
  });

  itif(hasToken)("converge after update", async () => {
    expect(
      await converges(yaml(name, "    draining_seconds: 60\n    overlap_seconds: 20")),
    ).toEqual([]);
  });

  itif(hasToken)("remove: resets to null (Railway default)", async () => {
    const s = await apply(yaml(name, ""));
    expect(s.errors).toEqual([]);
    // When set to null, Railway omits the field or returns null
    const draining = s.services[name]?.deploy?.drainingSeconds;
    const overlap = s.services[name]?.deploy?.overlapSeconds;
    expect(draining == null || draining === 0).toBe(true);
    expect(overlap == null || overlap === 0).toBe(true);
  });

  itif(hasToken)("converge after remove", async () => {
    expect(await converges(yaml(name, ""))).toEqual([]);
  });
});
