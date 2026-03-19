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

describe("Railway Integration — ipv6_egress", () => {
  const name = svcName("ipv6");

  itif(hasToken)("create: ipv6_egress enabled", async () => {
    const s = await apply(yaml(name, "    ipv6_egress: true"));
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.deploy?.ipv6EgressEnabled).toBe(true);
  });

  itif(hasToken)("converge after create", async () => {
    expect(await converges(yaml(name, "    ipv6_egress: true"))).toEqual([]);
  });

  itif(hasToken)("update: disable ipv6_egress", async () => {
    const s = await apply(yaml(name, "    ipv6_egress: false"));
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.deploy?.ipv6EgressEnabled).toBe(false);
  });

  itif(hasToken)("converge after update", async () => {
    expect(await converges(yaml(name, "    ipv6_egress: false"))).toEqual([]);
  });

  itif(hasToken)("remove: omit ipv6_egress from config resets to false", async () => {
    const s = await apply(yaml(name, ""));
    expect(s.errors).toEqual([]);
    // ipv6EgressEnabled defaults to false — Railway may omit it from config
    // Either absent (undefined) or explicitly false is acceptable
    const val = s.services[name]?.deploy?.ipv6EgressEnabled;
    expect(val === false || val === undefined).toBe(true);
  });

  itif(hasToken)("converge after remove", async () => {
    expect(await converges(yaml(name, ""))).toEqual([]);
  });
});
