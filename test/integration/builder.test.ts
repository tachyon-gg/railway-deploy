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

describe("Railway Integration — dockerfile_path", () => {
  const name = svcName("bld");

  const createFields =
    "    build:\n      builder: dockerfile\n      dockerfile_path: Dockerfile.prod";
  const updateFields =
    "    build:\n      builder: dockerfile\n      dockerfile_path: Dockerfile.staging";

  itif(hasToken)("create: sets dockerfile_path", async () => {
    const s = await apply(yaml(name, createFields));
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.build?.dockerfilePath).toBe("Dockerfile.prod");
  });

  itif(hasToken)("converge after create", async () => {
    expect(await converges(yaml(name, createFields))).toEqual([]);
  });

  itif(hasToken)("update: changes dockerfile_path", async () => {
    const s = await apply(yaml(name, updateFields));
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.build?.dockerfilePath).toBe("Dockerfile.staging");
  });

  itif(hasToken)("converge after update", async () => {
    expect(await converges(yaml(name, updateFields))).toEqual([]);
  });

  itif(hasToken)("remove: clears dockerfile_path", async () => {
    const s = await apply(yaml(name, ""));
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.build?.dockerfilePath).toBeFalsy();
  });

  itif(hasToken)("converge after remove", async () => {
    expect(await converges(yaml(name, ""))).toEqual([]);
  });
});
