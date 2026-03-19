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

describe("Railway Integration — metal", () => {
  const name = svcName("metal");

  const createFields = "    build:\n      builder: railpack\n      metal: true";

  itif(hasToken)("create: metal true", async () => {
    const s = await apply(yaml(name, createFields));
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.build?.buildEnvironment).toBe("V3");
  });

  itif(hasToken)("converge after create", async () => {
    expect(await converges(yaml(name, createFields))).toEqual([]);
  });

  itif(hasToken)("remove: no metal in config (non-clearable)", async () => {
    const s = await apply(yaml(name, ""));
    expect(s.errors).toEqual([]);
    // buildEnvironment is non-clearable — Railway retains V3 after we stop managing it.
  });

  itif(hasToken)("converge after remove", async () => {
    expect(await converges(yaml(name, ""))).toEqual([]);
  });
});
