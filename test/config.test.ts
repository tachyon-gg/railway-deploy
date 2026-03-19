import { describe, expect, test } from "bun:test";
import { buildEnvironmentConfig, buildServiceConfig } from "../src/reconcile/config.js";
import type { State } from "../src/types/state.js";

function makeState(overrides: Partial<State> = {}): State {
  return {
    projectId: "proj-1",
    environmentId: "env-1",
    sharedVariables: {},
    services: {},
    buckets: {},
    ...overrides,
  };
}

describe("buildEnvironmentConfig", () => {
  test("builds empty config for empty state", () => {
    const state = makeState();
    const config = buildEnvironmentConfig(state, {
      serviceNameToId: new Map(),
      volumeIdByService: new Map(),
    });
    expect(config).toEqual({ sharedVariables: {} });
  });

  test("includes shared variables", () => {
    const state = makeState({ sharedVariables: { APP_ENV: "alpha", PORT: "3000" } });
    const config = buildEnvironmentConfig(state, {
      serviceNameToId: new Map(),
      volumeIdByService: new Map(),
    });
    expect(config.sharedVariables).toEqual({
      APP_ENV: { value: "alpha" },
      PORT: { value: "3000" },
    });
  });

  test("includes service with variables", () => {
    const state = makeState({
      services: {
        web: {
          name: "web",
          variables: { PORT: "3000" },
          domains: [],
        },
      },
    });
    const config = buildEnvironmentConfig(state, {
      serviceNameToId: new Map([["web", "svc-1"]]),
      volumeIdByService: new Map(),
    });
    expect(config.services?.["svc-1"]?.variables).toEqual({
      PORT: { value: "3000" },
    });
  });

  test("skips services without ID (new services)", () => {
    const state = makeState({
      services: {
        web: { name: "web", variables: {}, domains: [] },
      },
    });
    const config = buildEnvironmentConfig(state, {
      serviceNameToId: new Map(),
      volumeIdByService: new Map(),
    });
    expect(config.services).toBeUndefined();
  });

  test("maps source fields correctly", () => {
    const state = makeState({
      services: {
        web: {
          name: "web",
          source: { image: "nginx:latest" },
          variables: {},
          domains: [],
        },
      },
    });
    const config = buildEnvironmentConfig(state, {
      serviceNameToId: new Map([["web", "svc-1"]]),
      volumeIdByService: new Map(),
    });
    expect(config.services?.["svc-1"]?.source?.image).toBe("nginx:latest");
  });

  test("maps branch and rootDirectory into source", () => {
    const state = makeState({
      services: {
        web: {
          name: "web",
          source: { repo: "user/repo" },
          branch: "main",
          rootDirectory: "/app",
          waitForCi: false,
          variables: {},
          domains: [],
        },
      },
    });
    const config = buildEnvironmentConfig(state, {
      serviceNameToId: new Map([["web", "svc-1"]]),
      volumeIdByService: new Map(),
    });
    const source = config.services?.["svc-1"]?.source;
    expect(source?.repo).toBe("user/repo");
    expect(source?.branch).toBe("main");
    expect(source?.rootDirectory).toBe("/app");
    expect(source?.checkSuites).toBe(false);
  });

  test("domains are NOT included in config builder (handled via separate mutations)", () => {
    const state = makeState({
      services: {
        web: {
          name: "web",
          variables: {},
          domains: [{ domain: "app.example.com", targetPort: 8080 }, { domain: "api.example.com" }],
        },
      },
    });
    const config = buildEnvironmentConfig(state, {
      serviceNameToId: new Map([["web", "svc-1"]]),
      volumeIdByService: new Map(),
    });
    // Custom domains are handled via separate mutations, not EnvironmentConfig patches
    expect(config.services?.["svc-1"]?.networking?.customDomains).toBeUndefined();
  });

  test("maps deploy settings", () => {
    const state = makeState({
      services: {
        web: {
          name: "web",
          variables: {},
          domains: [],
          startCommand: "npm start",
          restartPolicy: "ON_FAILURE",
          cronSchedule: "0 * * * *",
          healthcheck: { path: "/health", timeout: 60 },
          serverless: true,
          regions: { "us-east4": 2 },
        },
      },
    });
    const config = buildEnvironmentConfig(state, {
      serviceNameToId: new Map([["web", "svc-1"]]),
      volumeIdByService: new Map(),
    });
    const deploy = config.services?.["svc-1"]?.deploy;
    expect(deploy?.startCommand).toBe("npm start");
    // Cron services: Railway forces restartPolicyType to NEVER
    expect(deploy?.restartPolicyType).toBe("NEVER");
    expect(deploy?.cronSchedule).toBe("0 * * * *");
    expect(deploy?.healthcheckPath).toBe("/health");
    expect(deploy?.healthcheckTimeout).toBe(60);
    expect(deploy?.sleepApplication).toBe(true);
    expect(deploy?.multiRegionConfig).toEqual({ "us-east4": { numReplicas: 2 } });
  });

  test("maps build settings", () => {
    const state = makeState({
      services: {
        web: {
          name: "web",
          variables: {},
          domains: [],
          builder: "DOCKERFILE",
          dockerfilePath: "Dockerfile.prod",
          buildCommand: "make build",
          watchPatterns: ["src/**"],
        },
      },
    });
    const config = buildEnvironmentConfig(state, {
      serviceNameToId: new Map([["web", "svc-1"]]),
      volumeIdByService: new Map(),
    });
    const build = config.services?.["svc-1"]?.build;
    expect(build?.builder).toBe("DOCKERFILE");
    expect(build?.dockerfilePath).toBe("Dockerfile.prod");
    expect(build?.buildCommand).toBe("make build");
    expect(build?.watchPatterns).toEqual(["src/**"]);
  });

  test("maps volume mounts with volume ID", () => {
    const state = makeState({
      services: {
        db: {
          name: "db",
          variables: {},
          domains: [],
          volume: { mount: "/data", name: "db-data" },
        },
      },
    });
    const config = buildEnvironmentConfig(state, {
      serviceNameToId: new Map([["db", "svc-1"]]),
      volumeIdByService: new Map([["db", "vol-1"]]),
    });
    expect(config.services?.["svc-1"]?.volumeMounts).toEqual({
      "vol-1": { mountPath: "/data" },
    });
  });

  test("skips volume mounts without volume ID", () => {
    const state = makeState({
      services: {
        db: {
          name: "db",
          variables: {},
          domains: [],
          volume: { mount: "/data", name: "db-data" },
        },
      },
    });
    const config = buildEnvironmentConfig(state, {
      serviceNameToId: new Map([["db", "svc-1"]]),
      volumeIdByService: new Map(),
    });
    expect(config.services?.["svc-1"]?.volumeMounts).toBeUndefined();
  });

  test("maps buckets with existing IDs", () => {
    const state = makeState({
      buckets: {
        blobs: { id: "bucket-1", name: "blobs" },
      },
    });
    const config = buildEnvironmentConfig(state, {
      serviceNameToId: new Map(),
      volumeIdByService: new Map(),
    });
    expect(config.buckets).toEqual({
      "bucket-1": { region: "iad", isCreated: true },
    });
  });

  test("maps registry credentials into deploy", () => {
    const state = makeState({
      services: {
        web: {
          name: "web",
          variables: {},
          domains: [],
          registryCredentials: { username: "user", password: "pass" },
        },
      },
    });
    const config = buildEnvironmentConfig(state, {
      serviceNameToId: new Map([["web", "svc-1"]]),
      volumeIdByService: new Map(),
    });
    expect(config.services?.["svc-1"]?.deploy?.registryCredentials).toEqual({
      username: "user",
      password: "pass",
    });
  });

  test("maps volumes top-level config from state", () => {
    const state = makeState({
      services: {
        db: {
          name: "db",
          variables: {},
          domains: [],
          volume: { mount: "/data", name: "db-data" },
        },
      },
      volumes: {
        "db-data": { sizeMB: 2048, region: "iad" },
      },
    });
    const config = buildEnvironmentConfig(state, {
      serviceNameToId: new Map([["db", "svc-1"]]),
      volumeIdByService: new Map([["db", "vol-1"]]),
    });
    expect(config.volumes).toEqual({
      "vol-1": { sizeMB: 2048, region: "iad" },
    });
  });

  test("skips volumes without matching service volume ID", () => {
    const state = makeState({
      services: {
        db: {
          name: "db",
          variables: {},
          domains: [],
        },
      },
      volumes: {
        "db-data": { sizeMB: 2048, region: "iad" },
      },
    });
    const config = buildEnvironmentConfig(state, {
      serviceNameToId: new Map([["db", "svc-1"]]),
      volumeIdByService: new Map(),
    });
    expect(config.volumes).toBeUndefined();
  });

  test("maps privateHostname into networking.privateNetworkEndpoint", () => {
    const state = makeState({
      services: {
        web: {
          name: "web",
          variables: {},
          domains: [],
          privateHostname: "web.internal",
        },
      },
    });
    const config = buildEnvironmentConfig(state, {
      serviceNameToId: new Map([["web", "svc-1"]]),
      volumeIdByService: new Map(),
    });
    // privateNetworkEndpoint is handled via dedicated mutations, not in config builder
    expect(config.services?.["svc-1"]?.networking?.privateNetworkEndpoint).toBeUndefined();
  });

  test("maps tcpProxy into networking.tcpProxies", () => {
    const state = makeState({
      services: {
        db: {
          name: "db",
          variables: {},
          domains: [],
          tcpProxy: 5432,
        },
      },
    });
    const config = buildEnvironmentConfig(state, {
      serviceNameToId: new Map([["db", "svc-1"]]),
      volumeIdByService: new Map(),
    });
    expect(config.services?.["svc-1"]?.networking?.tcpProxies).toEqual({ "5432": {} });
  });

  test("maps metal into build.buildEnvironment=V3", () => {
    const state = makeState({
      services: {
        web: {
          name: "web",
          variables: {},
          domains: [],
          metal: true,
        },
      },
    });
    const config = buildEnvironmentConfig(state, {
      serviceNameToId: new Map([["web", "svc-1"]]),
      volumeIdByService: new Map(),
    });
    expect(config.services?.["svc-1"]?.build?.buildEnvironment).toBe("V3");
  });

  test("maps autoUpdates into source config", () => {
    const state = makeState({
      services: {
        web: {
          name: "web",
          source: { image: "nginx:latest" },
          variables: {},
          domains: [],
          autoUpdates: {
            type: "patch",
            schedule: [{ day: 1, startHour: 0, endHour: 6 }],
          },
        },
      },
    });
    const config = buildEnvironmentConfig(state, {
      serviceNameToId: new Map([["web", "svc-1"]]),
      volumeIdByService: new Map(),
    });
    expect(config.services?.["svc-1"]?.source?.autoUpdates).toEqual({
      type: "patch",
      schedule: [{ day: 1, startHour: 0, endHour: 6 }],
    });
  });

  test("volumes with empty properties are not included in volumes config", () => {
    const state = makeState({
      services: {
        db: {
          name: "db",
          variables: {},
          domains: [],
          volume: { mount: "/data", name: "db-data" },
        },
      },
      volumes: {
        "db-data": {},
      },
    });
    const config = buildEnvironmentConfig(state, {
      serviceNameToId: new Map([["db", "svc-1"]]),
      volumeIdByService: new Map([["db", "vol-1"]]),
    });
    // Empty volume config means no sizeMB/region, so volConfig has no keys and shouldn't be added
    expect(config.volumes).toBeUndefined();
  });
});

describe("buildServiceConfig", () => {
  test("builds config for a new service", () => {
    const svc = {
      name: "web",
      source: { image: "nginx" },
      variables: { PORT: "3000" },
      domains: [{ domain: "app.example.com" }],
      startCommand: "nginx",
    };
    const config = buildServiceConfig(svc);
    expect(config.source?.image).toBe("nginx");
    expect(config.variables?.PORT).toEqual({ value: "3000" });
    // Custom domains handled via separate mutations, not in config builder
    expect(config.networking?.customDomains).toBeUndefined();
    expect(config.deploy?.startCommand).toBe("nginx");
  });
});
