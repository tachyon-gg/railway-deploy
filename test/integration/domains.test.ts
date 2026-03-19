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

describe("Railway Integration — custom domains", () => {
  const name = svcName("dom");

  itif(hasToken)("create: adds custom domain with target_port", async () => {
    const s = await apply(
      yaml(
        name,
        "    domains:\n      - domain: railway-deploy.tachyon.gg\n        target_port: 8080",
      ),
    );
    expect(s.errors).toEqual([]);
    const domains = s.customDomains[name] ?? [];
    expect(domains.length).toBe(1);
    expect(domains[0].domain).toBe("railway-deploy.tachyon.gg");
    expect(domains[0].targetPort).toBe(8080);
  });

  itif(hasToken)("converge after create: no changes on re-run", async () => {
    const changes = await converges(
      yaml(
        name,
        "    domains:\n      - domain: railway-deploy.tachyon.gg\n        target_port: 8080",
      ),
    );
    const domainChanges = changes.filter((c) => c.includes("customDomain"));
    expect(domainChanges).toEqual([]);
  });

  itif(hasToken)("update: change target_port", async () => {
    const s = await apply(
      yaml(
        name,
        "    domains:\n      - domain: railway-deploy.tachyon.gg\n        target_port: 3000",
      ),
    );
    expect(s.errors).toEqual([]);
    const domains = s.customDomains[name] ?? [];
    expect(domains.length).toBe(1);
    expect(domains[0].domain).toBe("railway-deploy.tachyon.gg");
    expect(domains[0].targetPort).toBe(3000);
  });

  itif(hasToken)("converge after update", async () => {
    const changes = await converges(
      yaml(
        name,
        "    domains:\n      - domain: railway-deploy.tachyon.gg\n        target_port: 3000",
      ),
    );
    const domainChanges = changes.filter((c) => c.includes("customDomain"));
    expect(domainChanges).toEqual([]);
  });

  itif(hasToken)("remove: clears all custom domains", async () => {
    const s = await apply(yaml(name, ""));
    expect(s.errors).toEqual([]);
    const domains = s.customDomains[name] ?? [];
    expect(domains.length).toBe(0);
  });

  itif(hasToken)("converge after remove: no changes on re-run", async () => {
    const changes = await converges(yaml(name, ""));
    const domainChanges = changes.filter((c) => c.includes("customDomain"));
    expect(domainChanges).toEqual([]);
  });
});
