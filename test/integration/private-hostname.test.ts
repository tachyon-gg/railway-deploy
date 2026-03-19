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

describe("Railway Integration — private_hostname", () => {
  const name = svcName("phn");

  itif(hasToken)("create: sets private_hostname", async () => {
    const s = await apply(yaml(name, "    private_hostname: my-svc"));
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.networking?.privateNetworkEndpoint).toBe("my-svc");
  });

  itif(hasToken)("converge after create", async () => {
    expect(await converges(yaml(name, "    private_hostname: my-svc"))).toEqual([]);
  });

  itif(hasToken)("update: changes private_hostname", async () => {
    const s = await apply(yaml(name, "    private_hostname: updated"));
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.networking?.privateNetworkEndpoint).toBe("updated");
  });

  itif(hasToken)("converge after update", async () => {
    expect(await converges(yaml(name, "    private_hostname: updated"))).toEqual([]);
  });

  itif(hasToken)("remove: clears user-set private_hostname", async () => {
    // Use empty string to explicitly signal removal of the private hostname.
    // Omitting private_hostname entirely means "don't manage" (Railway keeps its value).
    const s = await apply(yaml(name, '    private_hostname: ""'));
    expect(s.errors).toEqual([]);
    // After deletion, the endpoint should no longer be "updated" (the user-set value).
    // Railway may re-assign a default hostname, so we only check the user-set value is gone.
    const endpoint = s.services[name]?.networking?.privateNetworkEndpoint;
    expect(endpoint).not.toBe("updated");
  });

  itif(hasToken)("converge after remove", async () => {
    // After removal, omitting private_hostname means "don't manage" — no diff expected.
    expect(await converges(yaml(name, ""))).toEqual([]);
  });
});
