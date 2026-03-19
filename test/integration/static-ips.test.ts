import { afterAll, beforeAll, describe, expect } from "bun:test";
import {
  apply,
  converges,
  createTestEnvironment,
  deleteTestEnvironment,
  getEgressStatus,
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

describe("Railway Integration — static_outbound_ips", () => {
  const name = svcName("static-ips");

  itif(hasToken)("create: enable static outbound IPs", async () => {
    const s = await apply(yaml(name, "    static_outbound_ips: true"));
    expect(s.errors).toEqual([]);
    const hasEgress = await getEgressStatus(name);
    expect(hasEgress).toBe(true);
  });

  itif(hasToken)("converge after enable", async () => {
    const changes = await converges(yaml(name, "    static_outbound_ips: true"));
    // Filter out build.watchPatterns — Railway sets defaults for image-based services
    const relevant = changes.filter((c) => !c.includes("build.watchPatterns"));
    expect(relevant).toEqual([]);
  });

  itif(hasToken)("remove: omit static_outbound_ips from config", async () => {
    const s = await apply(yaml(name, ""));
    expect(s.errors).toEqual([]);
    const hasEgress = await getEgressStatus(name);
    expect(hasEgress).toBe(false);
  });

  itif(hasToken)("converge after removal", async () => {
    const changes = await converges(yaml(name, ""));
    const relevant = changes.filter((c) => !c.includes("build.watchPatterns"));
    expect(relevant).toEqual([]);
  });
});
