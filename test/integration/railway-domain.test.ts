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

describe("Railway Integration — railway_domain", () => {
  const name = svcName("rwd");

  itif(hasToken)("create: enables railway_domain", async () => {
    const s = await apply(yaml(name, "    railway_domain:\n      target_port: 8080"));
    expect(s.errors).toEqual([]);
    const domain = s.serviceDomains[name];
    expect(domain).toBeDefined();
    expect(domain.domain).toContain(".up.railway.app");
    expect(domain.targetPort).toBe(8080);
  });

  itif(hasToken)("converge after create: no changes on re-run", async () => {
    const changes = await converges(yaml(name, "    railway_domain:\n      target_port: 8080"));
    expect(changes).toEqual([]);
  });

  itif(hasToken)("update: change target_port", async () => {
    const s = await apply(yaml(name, "    railway_domain:\n      target_port: 3000"));
    expect(s.errors).toEqual([]);
    const domain = s.serviceDomains[name];
    expect(domain).toBeDefined();
    expect(domain.domain).toContain(".up.railway.app");
    expect(domain.targetPort).toBe(3000);
  });

  itif(hasToken)("converge after update", async () => {
    const changes = await converges(yaml(name, "    railway_domain:\n      target_port: 3000"));
    expect(changes).toEqual([]);
  });

  itif(hasToken)("remove: clears railway_domain", async () => {
    const s = await apply(yaml(name, ""));
    expect(s.errors).toEqual([]);
    expect(s.serviceDomains[name]).toBeUndefined();
  });

  itif(hasToken)("converge after remove: no changes on re-run", async () => {
    const changes = await converges(yaml(name, ""));
    expect(changes).toEqual([]);
  });
});
