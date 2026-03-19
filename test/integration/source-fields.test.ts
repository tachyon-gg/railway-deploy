import { afterAll, beforeAll, describe, expect } from "bun:test";
import {
  apply,
  converges,
  createTestEnvironment,
  deleteTestEnvironment,
  hasToken,
  initClient,
  itif,
  repoYaml,
  svcName,
} from "./helpers.js";

beforeAll(async () => {
  initClient();
  if (hasToken) await createTestEnvironment();
});

afterAll(async () => {
  if (hasToken) await deleteTestEnvironment();
});

describe("Railway Integration — source fields (branch, root_directory, wait_for_ci)", () => {
  const name = svcName("srcfields");

  itif(hasToken)("create: sets branch, root_directory, wait_for_ci", async () => {
    const s = await apply(
      repoYaml(name, "      branch: main\n      root_directory: /app\n      wait_for_ci: true"),
    );
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.source?.branch).toBe("main");
    expect(s.services[name]?.source?.rootDirectory).toBe("/app");
    expect(s.services[name]?.source?.checkSuites).toBe(true);
  });

  itif(hasToken)("converge after create", async () => {
    expect(
      await converges(
        repoYaml(name, "      branch: main\n      root_directory: /app\n      wait_for_ci: true"),
      ),
    ).toEqual([]);
  });

  itif(hasToken)("update: changes branch, root_directory, wait_for_ci", async () => {
    const s = await apply(
      repoYaml(name, "      branch: develop\n      root_directory: /pkg\n      wait_for_ci: false"),
    );
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.source?.branch).toBe("develop");
    expect(s.services[name]?.source?.rootDirectory).toBe("/pkg");
    expect(s.services[name]?.source?.checkSuites).toBe(false);
  });

  itif(hasToken)("converge after update", async () => {
    expect(
      await converges(
        repoYaml(
          name,
          "      branch: develop\n      root_directory: /pkg\n      wait_for_ci: false",
        ),
      ),
    ).toEqual([]);
  });

  itif(hasToken)("remove: clears branch, root_directory, wait_for_ci", async () => {
    const s = await apply(repoYaml(name, ""));
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.source?.branch).toBeFalsy();
    expect(s.services[name]?.source?.rootDirectory).toBeFalsy();
    expect(s.services[name]?.source?.checkSuites).toBeFalsy();
  });

  itif(hasToken)("converge after remove", async () => {
    expect(await converges(repoYaml(name, ""))).toEqual([]);
  });
});
