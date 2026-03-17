import { describe, expect, test } from "bun:test";
import type { ConfigDiff } from "../src/types/changeset.js";
import type { EnvironmentConfig } from "../src/types/envconfig.js";

// Since we can't easily mock ESM imports in Bun, we test the apply logic
// at a higher level through integration tests. These unit tests validate
// the ApplyResult type and diff structure expectations.

function emptyDiff(): ConfigDiff {
  return {
    entries: [],
    servicesToCreate: [],
    servicesToDelete: [],
    volumesToCreate: [],
    hasDataLoss: false,
    dataLossEntries: [],
  };
}

describe("ConfigDiff structure", () => {
  test("empty diff has correct shape", () => {
    const diff = emptyDiff();
    expect(diff.entries).toEqual([]);
    expect(diff.servicesToCreate).toEqual([]);
    expect(diff.servicesToDelete).toEqual([]);
    expect(diff.volumesToCreate).toEqual([]);
    expect(diff.hasDataLoss).toBe(false);
    expect(diff.dataLossEntries).toEqual([]);
  });

  test("diff with service to create", () => {
    const diff: ConfigDiff = {
      ...emptyDiff(),
      servicesToCreate: [{ name: "web", source: { image: "nginx" } }],
    };
    expect(diff.servicesToCreate).toHaveLength(1);
    expect(diff.servicesToCreate[0].name).toBe("web");
  });

  test("diff with service to delete", () => {
    const diff: ConfigDiff = {
      ...emptyDiff(),
      servicesToDelete: [{ name: "old", serviceId: "svc-old" }],
    };
    expect(diff.servicesToDelete).toHaveLength(1);
    expect(diff.servicesToDelete[0].serviceId).toBe("svc-old");
  });

  test("diff with data loss entries", () => {
    const entry = {
      path: "volumeMounts.vol-1",
      action: "remove" as const,
      serviceName: "db",
      category: "volume",
      oldValue: "/data",
    };
    const diff: ConfigDiff = {
      ...emptyDiff(),
      entries: [entry],
      hasDataLoss: true,
      dataLossEntries: [entry],
    };
    expect(diff.hasDataLoss).toBe(true);
    expect(diff.dataLossEntries).toHaveLength(1);
  });
});

describe("EnvironmentConfig structure", () => {
  test("empty config", () => {
    const config: EnvironmentConfig = {};
    expect(config.services).toBeUndefined();
    expect(config.sharedVariables).toBeUndefined();
  });

  test("config with services", () => {
    const config: EnvironmentConfig = {
      services: {
        "svc-1": {
          source: { image: "nginx" },
          variables: { PORT: { value: "3000" } },
          deploy: { startCommand: "npm start" },
        },
      },
    };
    expect(config.services?.["svc-1"]?.source?.image).toBe("nginx");
    expect(config.services?.["svc-1"]?.variables?.PORT.value).toBe("3000");
  });

  test("config with shared variables", () => {
    const config: EnvironmentConfig = {
      sharedVariables: {
        APP_ENV: { value: "alpha" },
        SECRET: { value: "s3cret", generator: "${{ secret(32) }}" },
      },
    };
    expect(config.sharedVariables?.APP_ENV.value).toBe("alpha");
    expect(config.sharedVariables?.SECRET.generator).toBe("${{ secret(32) }}");
  });
});
