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

describe("Railway Integration — healthcheck", () => {
  const name = svcName("hc");

  itif(hasToken)("create", async () => {
    const s = await apply(yaml(name, "    healthcheck:\n      path: /health\n      timeout: 30"));
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.deploy?.healthcheckPath).toBe("/health");
    expect(s.services[name]?.deploy?.healthcheckTimeout).toBe(30);
  });

  itif(hasToken)("converge after create", async () => {
    expect(
      await converges(yaml(name, "    healthcheck:\n      path: /health\n      timeout: 30")),
    ).toEqual([]);
  });

  itif(hasToken)("update", async () => {
    const s = await apply(yaml(name, "    healthcheck:\n      path: /ready\n      timeout: 60"));
    expect(s.services[name]?.deploy?.healthcheckPath).toBe("/ready");
    expect(s.services[name]?.deploy?.healthcheckTimeout).toBe(60);
  });

  itif(hasToken)("converge after update", async () => {
    expect(
      await converges(yaml(name, "    healthcheck:\n      path: /ready\n      timeout: 60")),
    ).toEqual([]);
  });

  itif(hasToken)("remove", async () => {
    const s = await apply(yaml(name, ""));
    expect(s.services[name]?.deploy?.healthcheckPath).toBeFalsy();
    expect(s.services[name]?.deploy?.healthcheckTimeout).toBeFalsy();
  });

  itif(hasToken)("converge after remove", async () => {
    expect(await converges(yaml(name, ""))).toEqual([]);
  });
});
