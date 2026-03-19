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

describe("Railway Integration — tcp_proxy", () => {
  const name = svcName("tcp");

  itif(hasToken)("create: sets tcp_proxy: 5432", async () => {
    const s = await apply(yaml(name, "    tcp_proxy: 5432"));
    expect(s.errors).toEqual([]);
    const proxies = s.services[name]?.networking?.tcpProxies;
    expect(proxies).toBeDefined();
    expect("5432" in (proxies ?? {})).toBe(true);
  });

  itif(hasToken)("converge after create", async () => {
    expect(await converges(yaml(name, "    tcp_proxy: 5432"))).toEqual([]);
  });

  itif(hasToken)("update: changes to tcp_proxy: 6379", async () => {
    const s = await apply(yaml(name, "    tcp_proxy: 6379"));
    expect(s.errors).toEqual([]);
    const proxies = s.services[name]?.networking?.tcpProxies;
    expect(proxies).toBeDefined();
    expect("6379" in (proxies ?? {})).toBe(true);
    expect("5432" in (proxies ?? {})).toBe(false);
  });

  itif(hasToken)("converge after update", async () => {
    expect(await converges(yaml(name, "    tcp_proxy: 6379"))).toEqual([]);
  });

  itif(hasToken)("remove: clears tcp_proxy", async () => {
    const s = await apply(yaml(name, ""));
    expect(s.errors).toEqual([]);
    const proxies = s.services[name]?.networking?.tcpProxies;
    const hasPorts = proxies && Object.keys(proxies).length > 0;
    expect(!hasPorts).toBe(true);
  });

  itif(hasToken)("converge after remove", async () => {
    expect(await converges(yaml(name, ""))).toEqual([]);
  });
});
