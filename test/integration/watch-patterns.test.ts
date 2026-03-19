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

describe("Railway Integration — watch_patterns", () => {
  const name = svcName("watchpat");

  itif(hasToken)("create: sets watch_patterns", async () => {
    const s = await apply(
      repoYaml(
        name,
        '    build:\n      builder: railpack\n      watch_patterns:\n        - "src/**"',
      ),
    );
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.build?.watchPatterns).toEqual(["src/**"]);
  });

  itif(hasToken)("converge after create", async () => {
    expect(
      await converges(
        repoYaml(
          name,
          '    build:\n      builder: railpack\n      watch_patterns:\n        - "src/**"',
        ),
      ),
    ).toEqual([]);
  });

  itif(hasToken)("update: changes watch_patterns", async () => {
    const s = await apply(
      repoYaml(
        name,
        '    build:\n      builder: railpack\n      watch_patterns:\n        - "lib/**"',
      ),
    );
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.build?.watchPatterns).toEqual(["lib/**"]);
  });

  itif(hasToken)("converge after update", async () => {
    expect(
      await converges(
        repoYaml(
          name,
          '    build:\n      builder: railpack\n      watch_patterns:\n        - "lib/**"',
        ),
      ),
    ).toEqual([]);
  });

  itif(hasToken)("remove: clears watch_patterns", async () => {
    const s = await apply(repoYaml(name, ""));
    expect(s.errors).toEqual([]);
    // After removal, watchPatterns should be absent or empty
    const wp = s.services[name]?.build?.watchPatterns;
    expect(!wp || wp.length === 0).toBe(true);
  });

  itif(hasToken)("converge after remove", async () => {
    expect(await converges(repoYaml(name, ""))).toEqual([]);
  });
});
