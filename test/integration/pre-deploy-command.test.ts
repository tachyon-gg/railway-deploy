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

describe("Railway Integration — pre_deploy_command", () => {
  const name = svcName("predeploy");

  itif(hasToken)("create: sets pre_deploy_command", async () => {
    const s = await apply(yaml(name, "    pre_deploy_command: echo migrate"));
    expect(s.errors).toEqual([]);
    const raw = s.services[name]?.deploy?.preDeployCommand;
    const cmd = Array.isArray(raw) ? raw.join(" ") : raw;
    expect(cmd).toBe("echo migrate");
  });

  itif(hasToken)("converge after create", async () => {
    expect(await converges(yaml(name, "    pre_deploy_command: echo migrate"))).toEqual([]);
  });

  itif(hasToken)("update: changes pre_deploy_command", async () => {
    const s = await apply(yaml(name, "    pre_deploy_command: echo seed"));
    expect(s.errors).toEqual([]);
    const raw = s.services[name]?.deploy?.preDeployCommand;
    const cmd = Array.isArray(raw) ? raw.join(" ") : raw;
    expect(cmd).toBe("echo seed");
  });

  itif(hasToken)("converge after update", async () => {
    expect(await converges(yaml(name, "    pre_deploy_command: echo seed"))).toEqual([]);
  });

  itif(hasToken)("remove: clears pre_deploy_command", async () => {
    const s = await apply(yaml(name, ""));
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.deploy?.preDeployCommand).toBeFalsy();
  });

  itif(hasToken)("converge after remove", async () => {
    expect(await converges(yaml(name, ""))).toEqual([]);
  });
});
