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

describe("Railway Integration — start_command", () => {
  const name = svcName("startcmd");

  itif(hasToken)("create: sets start_command", async () => {
    const s = await apply(yaml(name, "    start_command: echo hi"));
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.deploy?.startCommand).toBe("echo hi");
  });

  itif(hasToken)("converge after create", async () => {
    expect(await converges(yaml(name, "    start_command: echo hi"))).toEqual([]);
  });

  itif(hasToken)("update: changes start_command", async () => {
    const s = await apply(yaml(name, "    start_command: echo bye"));
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.deploy?.startCommand).toBe("echo bye");
  });

  itif(hasToken)("converge after update", async () => {
    expect(await converges(yaml(name, "    start_command: echo bye"))).toEqual([]);
  });

  itif(hasToken)("remove: clears start_command", async () => {
    const s = await apply(yaml(name, ""));
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.deploy?.startCommand).toBeFalsy();
  });

  itif(hasToken)("converge after remove", async () => {
    expect(await converges(yaml(name, ""))).toEqual([]);
  });
});
