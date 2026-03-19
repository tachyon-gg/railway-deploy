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

describe("Railway Integration — limits", () => {
  const name = svcName("lim");

  itif(hasToken)("create: sets limits with memory_gb=2, vcpus=1", async () => {
    const s = await apply(yaml(name, "    limits:\n      memory_gb: 2\n      vcpus: 1"));
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.deploy?.limitOverride?.containers?.cpu).toBe(1);
    expect(s.services[name]?.deploy?.limitOverride?.containers?.memoryBytes).toBe(2_000_000_000);
  });

  itif(hasToken)("converge after create", async () => {
    expect(await converges(yaml(name, "    limits:\n      memory_gb: 2\n      vcpus: 1"))).toEqual(
      [],
    );
  });

  itif(hasToken)("update: changes limits to memory_gb=4, vcpus=2", async () => {
    const s = await apply(yaml(name, "    limits:\n      memory_gb: 4\n      vcpus: 2"));
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.deploy?.limitOverride?.containers?.cpu).toBe(2);
    expect(s.services[name]?.deploy?.limitOverride?.containers?.memoryBytes).toBe(4_000_000_000);
  });

  itif(hasToken)("converge after update", async () => {
    expect(await converges(yaml(name, "    limits:\n      memory_gb: 4\n      vcpus: 2"))).toEqual(
      [],
    );
  });

  itif(hasToken)("remove: clears limits from config", async () => {
    const s = await apply(yaml(name, ""));
    expect(s.errors).toEqual([]);
    // limitOverride persists in Railway but containers must be null (cleared)
    const lo = s.services[name]?.deploy?.limitOverride;
    expect(lo?.containers).toBeNull();
  });

  itif(hasToken)("converge after remove", async () => {
    expect(await converges(yaml(name, ""))).toEqual([]);
  });
});
