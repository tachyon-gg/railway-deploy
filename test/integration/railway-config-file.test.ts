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

describe("Railway Integration — railway_config_file", () => {
  const name = svcName("configfile");

  itif(hasToken)("create: sets railway_config_file", async () => {
    const s = await apply(yaml(name, "    railway_config_file: railway.toml"));
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.configFile).toBe("railway.toml");
  });

  itif(hasToken)("converge after create", async () => {
    expect(await converges(yaml(name, "    railway_config_file: railway.toml"))).toEqual([]);
  });

  itif(hasToken)("update: changes railway_config_file", async () => {
    const s = await apply(yaml(name, "    railway_config_file: railway.json"));
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.configFile).toBe("railway.json");
  });

  itif(hasToken)("converge after update", async () => {
    expect(await converges(yaml(name, "    railway_config_file: railway.json"))).toEqual([]);
  });

  itif(hasToken)("remove: clears railway_config_file", async () => {
    const s = await apply(yaml(name, ""));
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.configFile).toBeFalsy();
  });

  itif(hasToken)("converge after remove", async () => {
    expect(await converges(yaml(name, ""))).toEqual([]);
  });
});
