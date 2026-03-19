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

describe("Railway Integration — build_command", () => {
  const name = svcName("buildcmd");

  itif(hasToken)("create: sets build command", async () => {
    const s = await apply(
      yaml(name, "    build:\n      builder: railpack\n      command: npm build"),
    );
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.build?.buildCommand).toBe("npm build");
  });

  itif(hasToken)("converge after create", async () => {
    expect(
      await converges(yaml(name, "    build:\n      builder: railpack\n      command: npm build")),
    ).toEqual([]);
  });

  itif(hasToken)("update: changes build command", async () => {
    const s = await apply(yaml(name, "    build:\n      builder: railpack\n      command: make"));
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.build?.buildCommand).toBe("make");
  });

  itif(hasToken)("converge after update", async () => {
    expect(
      await converges(yaml(name, "    build:\n      builder: railpack\n      command: make")),
    ).toEqual([]);
  });

  itif(hasToken)("remove: clears build_command", async () => {
    const s = await apply(yaml(name, ""));
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.build?.buildCommand).toBeFalsy();
  });

  itif(hasToken)("converge after remove", async () => {
    expect(await converges(yaml(name, ""))).toEqual([]);
  });
});
