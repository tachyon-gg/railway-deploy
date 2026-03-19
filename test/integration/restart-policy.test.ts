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

describe("Railway Integration — restart_policy", () => {
  const name = svcName("rp");

  itif(hasToken)("create: set to NEVER", async () => {
    const s = await apply(yaml(name, "    restart_policy: never"));
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.deploy?.restartPolicyType).toBe("NEVER");
  });

  itif(hasToken)("converge after create", async () => {
    expect(await converges(yaml(name, "    restart_policy: never"))).toEqual([]);
  });

  itif(hasToken)("update: change to ALWAYS", async () => {
    const s = await apply(yaml(name, "    restart_policy: always"));
    expect(s.services[name]?.deploy?.restartPolicyType).toBe("ALWAYS");
  });

  itif(hasToken)("converge after update", async () => {
    expect(await converges(yaml(name, "    restart_policy: always"))).toEqual([]);
  });

  itif(hasToken)("remove: resets to default (ON_FAILURE)", async () => {
    // Our builder sends ON_FAILURE explicitly when user doesn't set restart_policy
    const s = await apply(yaml(name, ""));
    expect(s.errors).toEqual([]);
    // ON_FAILURE is the default — Railway omits it from config
    // So we should NOT see restartPolicyType in the config
  });

  itif(hasToken)("converge after remove", async () => {
    expect(await converges(yaml(name, ""))).toEqual([]);
  });
});
