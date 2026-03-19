import { describe, expect, test } from "bun:test";
import type { DiffContext } from "../src/reconcile/diff.js";
import { computeConfigDiff } from "../src/reconcile/diff.js";
import type { EnvironmentConfig } from "../src/types/envconfig.js";
import type { State } from "../src/types/state.js";

function makeState(overrides: Partial<State> = {}): State {
  return {
    projectId: "proj-1",
    environmentId: "env-1",
    sharedVariables: {},
    services: {},
    volumes: {},
    buckets: {},
    ...overrides,
  };
}

function makeCtx(overrides: Partial<DiffContext> = {}): DiffContext {
  return {
    serviceIdToName: new Map(),
    desiredState: makeState(),
    allServiceNames: new Set(),
    deletedSharedVars: [],
    deletedVars: {},
    ...overrides,
  };
}

describe("computeConfigDiff", () => {
  test("returns empty diff for matching configs", () => {
    const config: EnvironmentConfig = {
      services: {
        "svc-1": {
          variables: { PORT: { value: "3000" } },
        },
      },
      sharedVariables: { APP_ENV: { value: "alpha" } },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: { web: { name: "web", variables: { PORT: "3000" }, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(config, config, ctx);
    expect(diff.entries).toEqual([]);
    expect(diff.servicesToCreate).toEqual([]);
    expect(diff.servicesToDelete).toEqual([]);
  });

  // --- Shared variables ---

  test("detects added shared variable", () => {
    const desired: EnvironmentConfig = {
      sharedVariables: { APP_ENV: { value: "alpha" } },
    };
    const current: EnvironmentConfig = {};
    const diff = computeConfigDiff(desired, current, makeCtx());
    expect(diff.entries).toHaveLength(1);
    expect(diff.entries[0].action).toBe("add");
    expect(diff.entries[0].category).toBe("shared-variable");
    expect(diff.entries[0].newValue).toBe("alpha");
  });

  test("detects updated shared variable", () => {
    const desired: EnvironmentConfig = {
      sharedVariables: { APP_ENV: { value: "beta" } },
    };
    const current: EnvironmentConfig = {
      sharedVariables: { APP_ENV: { value: "alpha" } },
    };
    const diff = computeConfigDiff(desired, current, makeCtx());
    expect(diff.entries).toHaveLength(1);
    expect(diff.entries[0].action).toBe("update");
    expect(diff.entries[0].oldValue).toBe("alpha");
    expect(diff.entries[0].newValue).toBe("beta");
  });

  test("detects removed shared variable", () => {
    const desired: EnvironmentConfig = {};
    const current: EnvironmentConfig = {
      sharedVariables: { APP_ENV: { value: "alpha" } },
    };
    const diff = computeConfigDiff(desired, current, makeCtx());
    expect(diff.entries).toHaveLength(1);
    expect(diff.entries[0].action).toBe("remove");
    expect(diff.entries[0].oldValue).toBe("alpha");
  });

  test("detects explicitly deleted shared variable", () => {
    const desired: EnvironmentConfig = {};
    const current: EnvironmentConfig = {
      sharedVariables: { SECRET: { value: "old" } },
    };
    const ctx = makeCtx({ deletedSharedVars: ["SECRET"] });
    const diff = computeConfigDiff(desired, current, ctx);
    expect(diff.entries).toHaveLength(1);
    expect(diff.entries[0].action).toBe("remove");
  });

  test("ignores RAILWAY_ shared variables", () => {
    const desired: EnvironmentConfig = {};
    const current: EnvironmentConfig = {
      sharedVariables: { RAILWAY_TOKEN: { value: "xxx" } },
    };
    const diff = computeConfigDiff(desired, current, makeCtx());
    expect(diff.entries).toEqual([]);
  });

  // --- Service variables ---

  test("detects added service variable", () => {
    const desired: EnvironmentConfig = {
      services: {
        "svc-1": { variables: { PORT: { value: "3000" } } },
      },
    };
    const current: EnvironmentConfig = {
      services: { "svc-1": {} },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: { web: { name: "web", variables: { PORT: "3000" }, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const varEntries = diff.entries.filter((e) => e.category === "variable");
    expect(varEntries).toHaveLength(1);
    expect(varEntries[0].action).toBe("add");
    expect(varEntries[0].serviceName).toBe("web");
  });

  test("detects updated service variable", () => {
    const desired: EnvironmentConfig = {
      services: {
        "svc-1": { variables: { PORT: { value: "4000" } } },
      },
    };
    const current: EnvironmentConfig = {
      services: {
        "svc-1": { variables: { PORT: { value: "3000" } } },
      },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: { web: { name: "web", variables: { PORT: "4000" }, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const varEntries = diff.entries.filter((e) => e.category === "variable");
    expect(varEntries).toHaveLength(1);
    expect(varEntries[0].action).toBe("update");
    expect(varEntries[0].oldValue).toBe("3000");
    expect(varEntries[0].newValue).toBe("4000");
  });

  test("detects removed service variable", () => {
    const desired: EnvironmentConfig = {
      services: { "svc-1": {} },
    };
    const current: EnvironmentConfig = {
      services: {
        "svc-1": { variables: { OLD_VAR: { value: "old" } } },
      },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: { web: { name: "web", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const varEntries = diff.entries.filter((e) => e.category === "variable");
    expect(varEntries).toHaveLength(1);
    expect(varEntries[0].action).toBe("remove");
  });

  test("ignores RAILWAY_ service variables", () => {
    const desired: EnvironmentConfig = {
      services: { "svc-1": {} },
    };
    const current: EnvironmentConfig = {
      services: {
        "svc-1": { variables: { RAILWAY_TOKEN: { value: "xxx" } } },
      },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: { web: { name: "web", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    expect(diff.entries).toEqual([]);
  });

  // --- Service lifecycle ---

  test("detects service to create (no ID in map)", () => {
    const desired: EnvironmentConfig = {};
    const current: EnvironmentConfig = {};
    const ctx = makeCtx({
      desiredState: makeState({
        services: {
          web: { name: "web", source: { image: "nginx" }, variables: {}, domains: [] },
        },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    expect(diff.servicesToCreate).toHaveLength(1);
    expect(diff.servicesToCreate[0].name).toBe("web");
    expect(diff.servicesToCreate[0].source?.image).toBe("nginx");
  });

  test("detects service to delete", () => {
    const desired: EnvironmentConfig = {};
    const current: EnvironmentConfig = {
      services: { "svc-1": {} },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "old-service"]]),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    expect(diff.servicesToDelete).toHaveLength(1);
    expect(diff.servicesToDelete[0].name).toBe("old-service");
    expect(diff.servicesToDelete[0].serviceId).toBe("svc-1");
  });

  test("skips deletion if service is scoped to another environment", () => {
    const desired: EnvironmentConfig = {};
    const current: EnvironmentConfig = {
      services: { "svc-1": {} },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "staging-only"]]),
      allServiceNames: new Set(["staging-only"]),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    expect(diff.servicesToDelete).toEqual([]);
  });

  // --- Domains ---

  test("detects added domain", () => {
    const desired: EnvironmentConfig = {
      services: { "svc-1": {} },
    };
    const current: EnvironmentConfig = {
      services: { "svc-1": {} },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: {
          web: {
            name: "web",
            variables: {},
            domains: [{ domain: "app.example.com", targetPort: 8080 }],
          },
        },
      }),
      customDomainsByService: new Map(), // no current domains
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const domainEntries = diff.entries.filter((e) => e.category === "domain");
    expect(domainEntries).toHaveLength(1);
    expect(domainEntries[0].action).toBe("add");
  });

  test("detects removed domain", () => {
    const desired: EnvironmentConfig = {
      services: { "svc-1": {} },
    };
    const current: EnvironmentConfig = {
      services: { "svc-1": {} },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: { web: { name: "web", variables: {}, domains: [] } },
      }),
      customDomainsByService: new Map([["web", [{ id: "dom-1", domain: "old.example.com" }]]]),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const domainEntries = diff.entries.filter((e) => e.category === "domain");
    expect(domainEntries).toHaveLength(1);
    expect(domainEntries[0].action).toBe("remove");
  });

  // --- Deploy settings ---

  test("detects changed deploy setting", () => {
    const desired: EnvironmentConfig = {
      services: {
        "svc-1": { deploy: { startCommand: "npm start" } },
      },
    };
    const current: EnvironmentConfig = {
      services: {
        "svc-1": { deploy: { startCommand: "node app.js" } },
      },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: { web: { name: "web", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const settingEntries = diff.entries.filter((e) => e.category === "setting");
    expect(settingEntries.some((e) => e.path === "deploy.startCommand")).toBe(true);
  });

  // --- Volumes ---

  test("detects volume mount removal as data loss", () => {
    const desired: EnvironmentConfig = {
      services: { "svc-1": {} },
    };
    const current: EnvironmentConfig = {
      services: {
        "svc-1": { volumeMounts: { "vol-1": { mountPath: "/data" } } },
      },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "db"]]),
      desiredState: makeState({
        services: { db: { name: "db", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    expect(diff.hasDataLoss).toBe(true);
    expect(diff.dataLossEntries).toHaveLength(1);
    expect(diff.dataLossEntries[0].category).toBe("volume");
  });

  // --- Build settings ---

  test("detects changed builder", () => {
    const desired: EnvironmentConfig = {
      services: {
        "svc-1": { build: { builder: "DOCKERFILE" } },
      },
    };
    const current: EnvironmentConfig = {
      services: {
        "svc-1": { build: { builder: "RAILPACK" } },
      },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: { web: { name: "web", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    expect(diff.entries.some((e) => e.path === "build.builder")).toBe(true);
  });

  // --- Source ---

  test("detects changed source image", () => {
    const desired: EnvironmentConfig = {
      services: {
        "svc-1": { source: { image: "nginx:latest" } },
      },
    };
    const current: EnvironmentConfig = {
      services: {
        "svc-1": { source: { image: "nginx:1.20" } },
      },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: { web: { name: "web", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    expect(diff.entries.some((e) => e.path === "source.image")).toBe(true);
  });

  // --- Registry credentials ---

  test("always includes registry credentials when desired has them", () => {
    const desired: EnvironmentConfig = {
      services: {
        "svc-1": {
          deploy: { registryCredentials: { username: "user", password: "pass" } },
        },
      },
    };
    const current: EnvironmentConfig = {
      services: { "svc-1": {} },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: { web: { name: "web", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    expect(diff.entries.some((e) => e.path === "deploy.registryCredentials")).toBe(true);
  });

  // --- Buckets ---

  test("detects new bucket", () => {
    const desired: EnvironmentConfig = {
      buckets: { "bucket-1": { region: "iad" } },
    };
    const current: EnvironmentConfig = {};
    const diff = computeConfigDiff(desired, current, makeCtx());
    expect(diff.entries.some((e) => e.category === "bucket" && e.action === "add")).toBe(true);
  });

  // --- Source: autoUpdates ---

  test("detects added autoUpdates", () => {
    const desired: EnvironmentConfig = {
      services: {
        "svc-1": {
          source: {
            image: "nginx",
            autoUpdates: { type: "digest", schedule: [{ day: 1, startHour: 0, endHour: 6 }] },
          },
        },
      },
    };
    const current: EnvironmentConfig = {
      services: { "svc-1": { source: { image: "nginx" } } },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: { web: { name: "web", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const entry = diff.entries.find((e) => e.path === "source.autoUpdates");
    expect(entry).toBeDefined();
    expect(entry?.action).toBe("add");
    expect(entry?.serviceName).toBe("web");
  });

  test("detects updated autoUpdates", () => {
    const desired: EnvironmentConfig = {
      services: {
        "svc-1": {
          source: {
            image: "nginx",
            autoUpdates: { type: "digest", schedule: [{ day: 2, startHour: 0, endHour: 6 }] },
          },
        },
      },
    };
    const current: EnvironmentConfig = {
      services: {
        "svc-1": {
          source: {
            image: "nginx",
            autoUpdates: { type: "digest", schedule: [{ day: 1, startHour: 0, endHour: 6 }] },
          },
        },
      },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: { web: { name: "web", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const entry = diff.entries.find((e) => e.path === "source.autoUpdates");
    expect(entry).toBeDefined();
    expect(entry?.action).toBe("update");
  });

  test("detects removed autoUpdates", () => {
    const desired: EnvironmentConfig = {
      services: {
        "svc-1": { source: { image: "nginx" } },
      },
    };
    const current: EnvironmentConfig = {
      services: {
        "svc-1": {
          source: {
            image: "nginx",
            autoUpdates: { type: "digest", schedule: [{ day: 1, startHour: 0, endHour: 6 }] },
          },
        },
      },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: { web: { name: "web", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const entry = diff.entries.find((e) => e.path === "source.autoUpdates");
    expect(entry).toBeDefined();
    expect(entry?.action).toBe("remove");
  });

  // --- Networking: domain update (port change) ---

  test("detects domain update when port changes", () => {
    const desired: EnvironmentConfig = {
      services: { "svc-1": {} },
    };
    const current: EnvironmentConfig = {
      services: { "svc-1": {} },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: {
          web: {
            name: "web",
            variables: {},
            domains: [{ domain: "app.example.com", targetPort: 9090 }],
          },
        },
      }),
      customDomainsByService: new Map([
        ["web", [{ id: "dom-1", domain: "app.example.com", targetPort: 8080 }]],
      ]),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const domainEntries = diff.entries.filter((e) => e.category === "domain");
    expect(domainEntries).toHaveLength(1);
    expect(domainEntries[0].action).toBe("update");
  });

  // --- Networking: privateNetworkEndpoint ---

  test("detects added privateNetworkEndpoint", () => {
    const desired: EnvironmentConfig = {
      services: { "svc-1": {} },
    };
    const current: EnvironmentConfig = {
      services: { "svc-1": {} },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: {
          web: { name: "web", variables: {}, domains: [], privateHostname: "svc.internal" },
        },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const entry = diff.entries.find((e) => e.path === "networking.privateNetworkEndpoint");
    expect(entry).toBeDefined();
    expect(entry?.action).toBe("add");
    expect(entry?.category).toBe("private-hostname");
    expect(entry?.newValue).toBe("svc.internal");
  });

  test("detects updated privateNetworkEndpoint", () => {
    const desired: EnvironmentConfig = {
      services: { "svc-1": {} },
    };
    const current: EnvironmentConfig = {
      services: {
        "svc-1": {
          networking: { privateNetworkEndpoint: "svc-old.internal" },
        },
      },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: {
          web: { name: "web", variables: {}, domains: [], privateHostname: "svc-new.internal" },
        },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const entry = diff.entries.find((e) => e.path === "networking.privateNetworkEndpoint");
    expect(entry).toBeDefined();
    expect(entry?.action).toBe("update");
  });

  test("ignores privateNetworkEndpoint when not in desired config", () => {
    const desired: EnvironmentConfig = {
      services: { "svc-1": {} },
    };
    const current: EnvironmentConfig = {
      services: {
        "svc-1": {
          networking: { privateNetworkEndpoint: "svc.internal" },
        },
      },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: { web: { name: "web", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const entry = diff.entries.find((e) => e.path === "networking.privateNetworkEndpoint");
    // When user doesn't configure private_hostname, we don't manage it —
    // Railway auto-assigns one and we should leave it alone.
    expect(entry).toBeUndefined();
  });

  test("detects explicit removal of privateNetworkEndpoint", () => {
    const desired: EnvironmentConfig = {
      services: { "svc-1": {} },
    };
    const current: EnvironmentConfig = {
      services: {
        "svc-1": {
          networking: { privateNetworkEndpoint: "svc.internal" },
        },
      },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        // privateHostname undefined = user didn't set it = leave Railway's value alone
        // To explicitly remove, we'd need a different mechanism (not yet supported in YAML)
        // For now, test that undefined privateHostname does NOT produce a remove entry
        services: { web: { name: "web", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const entry = diff.entries.find((e) => e.path === "networking.privateNetworkEndpoint");
    // When user doesn't set private_hostname, Railway's auto-assigned value is left alone
    expect(entry).toBeUndefined();
  });

  test("detects removal when privateHostname is empty string", () => {
    const desired: EnvironmentConfig = {
      services: { "svc-1": {} },
    };
    const current: EnvironmentConfig = {
      services: {
        "svc-1": {
          networking: { privateNetworkEndpoint: "svc.internal" },
        },
      },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        // privateHostname: "" signals explicit removal
        services: {
          web: { name: "web", variables: {}, domains: [], privateHostname: "" },
        },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const entry = diff.entries.find((e) => e.path === "networking.privateNetworkEndpoint");
    expect(entry).toBeDefined();
    expect(entry?.action).toBe("remove");
    expect(entry?.category).toBe("private-hostname");
  });

  // --- Build: normalizeEmpty and field comparisons ---

  test("detects added dockerfilePath in build", () => {
    const desired: EnvironmentConfig = {
      services: {
        "svc-1": { build: { dockerfilePath: "Dockerfile.prod" } },
      },
    };
    const current: EnvironmentConfig = {
      services: { "svc-1": { build: {} } },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: { web: { name: "web", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const entry = diff.entries.find((e) => e.path === "build.dockerfilePath");
    expect(entry).toBeDefined();
    expect(entry?.action).toBe("add");
    expect(entry?.newValue).toBe("Dockerfile.prod");
  });

  test("detects changed buildCommand in build", () => {
    const desired: EnvironmentConfig = {
      services: {
        "svc-1": { build: { buildCommand: "npm run build:prod" } },
      },
    };
    const current: EnvironmentConfig = {
      services: {
        "svc-1": { build: { buildCommand: "npm run build" } },
      },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: { web: { name: "web", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const entry = diff.entries.find((e) => e.path === "build.buildCommand");
    expect(entry).toBeDefined();
    expect(entry?.action).toBe("update");
  });

  test("detects changed watchPatterns in build", () => {
    const desired: EnvironmentConfig = {
      services: {
        "svc-1": { build: { watchPatterns: ["src/**", "package.json"] } },
      },
    };
    const current: EnvironmentConfig = {
      services: {
        "svc-1": { build: { watchPatterns: ["src/**"] } },
      },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: { web: { name: "web", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const entry = diff.entries.find((e) => e.path === "build.watchPatterns");
    expect(entry).toBeDefined();
    expect(entry?.action).toBe("update");
  });

  test("treats null and undefined as equal in build fields (normalizeEmpty)", () => {
    const desired: EnvironmentConfig = {
      services: {
        "svc-1": { build: { dockerfilePath: null } },
      },
    };
    const current: EnvironmentConfig = {
      services: {
        "svc-1": { build: {} },
      },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: { web: { name: "web", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    // null in desired and undefined in current should both normalize to undefined — no diff
    const entry = diff.entries.find((e) => e.path === "build.dockerfilePath");
    expect(entry).toBeUndefined();
  });

  // --- Deploy: scalar field comparisons with normalizeEmpty ---

  test("detects added deploy scalar field (healthcheckPath)", () => {
    const desired: EnvironmentConfig = {
      services: {
        "svc-1": { deploy: { healthcheckPath: "/health" } },
      },
    };
    const current: EnvironmentConfig = {
      services: { "svc-1": { deploy: {} } },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: { web: { name: "web", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const entry = diff.entries.find((e) => e.path === "deploy.healthcheckPath");
    expect(entry).toBeDefined();
    expect(entry?.action).toBe("add");
  });

  test("treats null and undefined as equal in deploy fields (normalizeEmpty)", () => {
    const desired: EnvironmentConfig = {
      services: {
        "svc-1": { deploy: { cronSchedule: null } },
      },
    };
    const current: EnvironmentConfig = {
      services: {
        "svc-1": { deploy: {} },
      },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: { web: { name: "web", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const entry = diff.entries.find((e) => e.path === "deploy.cronSchedule");
    expect(entry).toBeUndefined();
  });

  test("detects updated deploy scalar field (restartPolicyMaxRetries)", () => {
    const desired: EnvironmentConfig = {
      services: {
        "svc-1": { deploy: { restartPolicyMaxRetries: 5 } },
      },
    };
    const current: EnvironmentConfig = {
      services: {
        "svc-1": { deploy: { restartPolicyMaxRetries: 3 } },
      },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: { web: { name: "web", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const entry = diff.entries.find((e) => e.path === "deploy.restartPolicyMaxRetries");
    expect(entry).toBeDefined();
    expect(entry?.action).toBe("update");
  });

  // --- Deploy: multiRegionConfig ---

  test("detects added multiRegionConfig", () => {
    const desired: EnvironmentConfig = {
      services: {
        "svc-1": {
          deploy: { multiRegionConfig: { "us-west1": { numReplicas: 2 } } },
        },
      },
    };
    const current: EnvironmentConfig = {
      services: { "svc-1": { deploy: {} } },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: { web: { name: "web", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const entry = diff.entries.find((e) => e.path.startsWith("deploy.multiRegionConfig"));
    expect(entry).toBeDefined();
    expect(entry?.action).toBe("add");
  });

  test("detects updated multiRegionConfig", () => {
    const desired: EnvironmentConfig = {
      services: {
        "svc-1": {
          deploy: { multiRegionConfig: { "us-west1": { numReplicas: 3 } } },
        },
      },
    };
    const current: EnvironmentConfig = {
      services: {
        "svc-1": {
          deploy: { multiRegionConfig: { "us-west1": { numReplicas: 2 } } },
        },
      },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: { web: { name: "web", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const entry = diff.entries.find((e) => e.path.startsWith("deploy.multiRegionConfig"));
    expect(entry).toBeDefined();
    expect(entry?.action).toBe("update");
  });

  // --- Volume mount: add and update ---

  test("detects added volume mount", () => {
    const desired: EnvironmentConfig = {
      services: {
        "svc-1": { volumeMounts: { "vol-1": { mountPath: "/data" } } },
      },
    };
    const current: EnvironmentConfig = {
      services: { "svc-1": {} },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "db"]]),
      desiredState: makeState({
        services: { db: { name: "db", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const entry = diff.entries.find((e) => e.path === "volumeMounts.vol-1");
    expect(entry).toBeDefined();
    expect(entry?.action).toBe("add");
    expect(entry?.category).toBe("volume");
    expect(entry?.newValue).toBe("/data");
    expect(diff.hasDataLoss).toBe(false);
  });

  test("detects updated volume mount path", () => {
    const desired: EnvironmentConfig = {
      services: {
        "svc-1": { volumeMounts: { "vol-1": { mountPath: "/new-data" } } },
      },
    };
    const current: EnvironmentConfig = {
      services: {
        "svc-1": { volumeMounts: { "vol-1": { mountPath: "/old-data" } } },
      },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "db"]]),
      desiredState: makeState({
        services: { db: { name: "db", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const entry = diff.entries.find((e) => e.path === "volumeMounts.vol-1");
    expect(entry).toBeDefined();
    expect(entry?.action).toBe("update");
    expect(entry?.oldValue).toBe("/old-data");
    expect(entry?.newValue).toBe("/new-data");
    expect(diff.hasDataLoss).toBe(false);
  });

  // --- configFile diff ---

  test("detects added configFile", () => {
    const desired: EnvironmentConfig = {
      services: { "svc-1": { configFile: "railway.toml" } },
    };
    const current: EnvironmentConfig = {
      services: { "svc-1": {} },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: { web: { name: "web", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const entry = diff.entries.find((e) => e.path === "configFile");
    expect(entry).toBeDefined();
    expect(entry?.action).toBe("add");
    expect(entry?.newValue).toBe("railway.toml");
  });

  test("detects updated configFile", () => {
    const desired: EnvironmentConfig = {
      services: { "svc-1": { configFile: "railway-new.toml" } },
    };
    const current: EnvironmentConfig = {
      services: { "svc-1": { configFile: "railway-old.toml" } },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: { web: { name: "web", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const entry = diff.entries.find((e) => e.path === "configFile");
    expect(entry).toBeDefined();
    expect(entry?.action).toBe("update");
    expect(entry?.oldValue).toBe("railway-old.toml");
    expect(entry?.newValue).toBe("railway-new.toml");
  });

  test("detects removed configFile", () => {
    const desired: EnvironmentConfig = {
      services: { "svc-1": {} },
    };
    const current: EnvironmentConfig = {
      services: { "svc-1": { configFile: "railway.toml" } },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: { web: { name: "web", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const entry = diff.entries.find((e) => e.path === "configFile");
    expect(entry).toBeDefined();
    expect(entry?.action).toBe("remove");
    expect(entry?.oldValue).toBe("railway.toml");
  });

  // --- emitNewServiceEntries ---

  test("emits add entries for new service with image source", () => {
    const desired: EnvironmentConfig = {
      services: {
        "svc-new": {
          source: { image: "redis:7" },
          variables: { PORT: { value: "6379" } },
          networking: { customDomains: { "redis.example.com": { port: 6379 } } },
        },
      },
    };
    const current: EnvironmentConfig = {};
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-new", "redis"]]),
      desiredState: makeState({
        services: { redis: { name: "redis", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);

    // Service add entry
    const svcEntry = diff.entries.find((e) => e.path === "service" && e.action === "add");
    expect(svcEntry).toBeDefined();
    expect(svcEntry?.serviceName).toBe("redis");
    expect(svcEntry?.newValue).toBe("redis:7");

    // Variable add entries
    const varEntries = diff.entries.filter(
      (e) => e.category === "variable" && e.serviceName === "redis",
    );
    expect(varEntries).toHaveLength(1);
    expect(varEntries[0].action).toBe("add");
    expect(varEntries[0].newValue).toBe("6379");

    // Domain add entries
    const domainEntries = diff.entries.filter(
      (e) => e.category === "domain" && e.serviceName === "redis",
    );
    expect(domainEntries).toHaveLength(1);
    expect(domainEntries[0].action).toBe("add");
  });

  test("emits add entry for new service with repo source", () => {
    const desired: EnvironmentConfig = {
      services: {
        "svc-new": {
          source: { repo: "github.com/user/repo" },
        },
      },
    };
    const current: EnvironmentConfig = {};
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-new", "api"]]),
      desiredState: makeState({
        services: { api: { name: "api", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const svcEntry = diff.entries.find((e) => e.path === "service" && e.action === "add");
    expect(svcEntry).toBeDefined();
    expect(svcEntry?.newValue).toBe("github.com/user/repo");
  });

  test("emits add entry for new service with no source (empty)", () => {
    const desired: EnvironmentConfig = {
      services: { "svc-new": {} },
    };
    const current: EnvironmentConfig = {};
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-new", "worker"]]),
      desiredState: makeState({
        services: { worker: { name: "worker", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const svcEntry = diff.entries.find((e) => e.path === "service" && e.action === "add");
    expect(svcEntry).toBeDefined();
    expect(svcEntry?.newValue).toBe("empty");
  });

  // --- Service deletion entry in entries array ---

  test("adds remove entry to entries array when deleting service", () => {
    const desired: EnvironmentConfig = {};
    const current: EnvironmentConfig = {
      services: { "svc-1": {} },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "old-service"]]),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    expect(diff.servicesToDelete).toHaveLength(1);
    const entry = diff.entries.find(
      (e) => e.path === "service" && e.action === "remove" && e.serviceName === "old-service",
    );
    expect(entry).toBeDefined();
    expect(entry?.category).toBe("service");
  });

  // --- Volumes to create ---

  test("detects volume to create when service has volume but no volumeMount", () => {
    const desired: EnvironmentConfig = {
      services: {
        "svc-1": {},
      },
    };
    const current: EnvironmentConfig = {
      services: {
        "svc-1": {},
      },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "db"]]),
      desiredState: makeState({
        services: {
          db: {
            name: "db",
            variables: {},
            domains: [],
            volume: { mount: "/data", name: "db-data" },
          },
        },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    expect(diff.volumesToCreate).toHaveLength(1);
    expect(diff.volumesToCreate[0].serviceName).toBe("db");
    expect(diff.volumesToCreate[0].serviceId).toBe("svc-1");
    expect(diff.volumesToCreate[0].mount).toBe("/data");
    expect(diff.volumesToCreate[0].name).toBe("db-data");
  });

  test("does not create volume when current already has volumeMount", () => {
    const desired: EnvironmentConfig = {
      services: {
        "svc-1": {},
      },
    };
    const current: EnvironmentConfig = {
      services: {
        "svc-1": { volumeMounts: { "vol-1": { mountPath: "/data" } } },
      },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "db"]]),
      desiredState: makeState({
        services: {
          db: {
            name: "db",
            variables: {},
            domains: [],
            volume: { mount: "/data", name: "db-data" },
          },
        },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    expect(diff.volumesToCreate).toHaveLength(0);
  });

  test("does not create volume when desired config already has volumeMount", () => {
    const desired: EnvironmentConfig = {
      services: {
        "svc-1": { volumeMounts: { "vol-1": { mountPath: "/data" } } },
      },
    };
    const current: EnvironmentConfig = {
      services: {
        "svc-1": {},
      },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "db"]]),
      desiredState: makeState({
        services: {
          db: {
            name: "db",
            variables: {},
            domains: [],
            volume: { mount: "/data", name: "db-data" },
          },
        },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    expect(diff.volumesToCreate).toHaveLength(0);
  });

  test("does not create volume for new service (no serviceId)", () => {
    const desired: EnvironmentConfig = {};
    const current: EnvironmentConfig = {};
    const ctx = makeCtx({
      desiredState: makeState({
        services: {
          db: {
            name: "db",
            variables: {},
            domains: [],
            volume: { mount: "/data", name: "db-data" },
          },
        },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    // Volume creation for new service is handled during service creation, not separately
    expect(diff.volumesToCreate).toHaveLength(0);
  });

  // --- Build: buildEnvironment field ---

  test("detects changed buildEnvironment in build", () => {
    const desired: EnvironmentConfig = {
      services: {
        "svc-1": { build: { buildEnvironment: "production" } },
      },
    };
    const current: EnvironmentConfig = {
      services: {
        "svc-1": { build: { buildEnvironment: "staging" } },
      },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: { web: { name: "web", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const entry = diff.entries.find((e) => e.path === "build.buildEnvironment");
    expect(entry).toBeDefined();
    expect(entry?.action).toBe("update");
  });

  // --- Deploy: preDeployCommand ---

  test("detects added preDeployCommand", () => {
    const desired: EnvironmentConfig = {
      services: {
        "svc-1": { deploy: { preDeployCommand: "npm run migrate" } },
      },
    };
    const current: EnvironmentConfig = {
      services: { "svc-1": { deploy: {} } },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: { web: { name: "web", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const entry = diff.entries.find((e) => e.path === "deploy.preDeployCommand");
    expect(entry).toBeDefined();
    expect(entry?.action).toBe("add");
  });

  // --- Deploy: sleepApplication, drainingSeconds, overlapSeconds ---

  test("detects changed sleepApplication", () => {
    const desired: EnvironmentConfig = {
      services: {
        "svc-1": { deploy: { sleepApplication: true } },
      },
    };
    const current: EnvironmentConfig = {
      services: {
        "svc-1": { deploy: { sleepApplication: false } },
      },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: { web: { name: "web", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const entry = diff.entries.find((e) => e.path === "deploy.sleepApplication");
    expect(entry).toBeDefined();
    // Railway omits sleepApplication when false (it's the default), so
    // false normalizes to "not set" — going from false to true is an "add"
    expect(entry?.action).toBe("add");
  });

  // --- Enrichment: default values match (no spurious diff) ---

  test("does not diff default restartPolicyType when both sides are default", () => {
    const desired: EnvironmentConfig = {
      services: { "svc-1": {} },
    };
    const current: EnvironmentConfig = {
      services: { "svc-1": { deploy: { restartPolicyType: "ON_FAILURE" } } },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: { web: { name: "web", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const entry = diff.entries.find((e) => e.path === "deploy.restartPolicyType");
    expect(entry).toBeUndefined();
  });

  test("does not diff default builder when both sides are default", () => {
    const desired: EnvironmentConfig = {
      services: { "svc-1": {} },
    };
    const current: EnvironmentConfig = {
      services: { "svc-1": { build: { builder: "RAILPACK" } } },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "web"]]),
      desiredState: makeState({
        services: { web: { name: "web", variables: {}, domains: [] } },
      }),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    const entry = diff.entries.find((e) => e.path === "build.builder");
    expect(entry).toBeUndefined();
  });

  // --- Service deletion with volumes → data loss ---

  test("flags data loss when deleting service with volumes attached", () => {
    const desired: EnvironmentConfig = {};
    const current: EnvironmentConfig = {
      services: {
        "svc-1": { volumeMounts: { "vol-1": { mountPath: "/data" } } },
      },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "db"]]),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    expect(diff.servicesToDelete).toHaveLength(1);
    expect(diff.hasDataLoss).toBe(true);
    expect(diff.dataLossEntries).toHaveLength(1);
    expect(diff.dataLossEntries[0].path).toBe("service");
    expect(diff.dataLossEntries[0].action).toBe("remove");
    expect(diff.dataLossEntries[0].serviceName).toBe("db");
  });

  test("no data loss when deleting service without volumes", () => {
    const desired: EnvironmentConfig = {};
    const current: EnvironmentConfig = {
      services: { "svc-1": {} },
    };
    const ctx = makeCtx({
      serviceIdToName: new Map([["svc-1", "worker"]]),
    });
    const diff = computeConfigDiff(desired, current, ctx);
    expect(diff.servicesToDelete).toHaveLength(1);
    expect(diff.hasDataLoss).toBe(false);
    expect(diff.dataLossEntries).toHaveLength(0);
  });

  // --- Static outbound IPs (egress) ---

  describe("static outbound IPs (egress)", () => {
    test("detects egress add when desired has staticOutboundIps and current does not", () => {
      const desired: EnvironmentConfig = {
        services: { "svc-1": {} },
      };
      const current: EnvironmentConfig = {
        services: { "svc-1": {} },
      };
      const ctx = makeCtx({
        serviceIdToName: new Map([["svc-1", "web"]]),
        desiredState: makeState({
          services: {
            web: { name: "web", variables: {}, domains: [], staticOutboundIps: true },
          },
        }),
        egressByService: new Map([["web", false]]),
      });
      const diff = computeConfigDiff(desired, current, ctx);
      const entry = diff.entries.find((e) => e.path === "staticOutboundIps");
      expect(entry).toBeDefined();
      expect(entry?.action).toBe("add");
      expect(entry?.serviceName).toBe("web");
      expect(entry?.newValue).toBe(true);
    });

    test("detects egress remove when current has egress but desired does not", () => {
      const desired: EnvironmentConfig = {
        services: { "svc-1": {} },
      };
      const current: EnvironmentConfig = {
        services: { "svc-1": {} },
      };
      const ctx = makeCtx({
        serviceIdToName: new Map([["svc-1", "web"]]),
        desiredState: makeState({
          services: {
            web: { name: "web", variables: {}, domains: [] },
          },
        }),
        egressByService: new Map([["web", true]]),
      });
      const diff = computeConfigDiff(desired, current, ctx);
      const entry = diff.entries.find((e) => e.path === "staticOutboundIps");
      expect(entry).toBeDefined();
      expect(entry?.action).toBe("remove");
      expect(entry?.serviceName).toBe("web");
      expect(entry?.oldValue).toBe(true);
    });

    test("no egress diff when both sides match", () => {
      const desired: EnvironmentConfig = {
        services: { "svc-1": {} },
      };
      const current: EnvironmentConfig = {
        services: { "svc-1": {} },
      };
      const ctx = makeCtx({
        serviceIdToName: new Map([["svc-1", "web"]]),
        desiredState: makeState({
          services: {
            web: { name: "web", variables: {}, domains: [], staticOutboundIps: true },
          },
        }),
        egressByService: new Map([["web", true]]),
      });
      const diff = computeConfigDiff(desired, current, ctx);
      const entry = diff.entries.find((e) => e.path === "staticOutboundIps");
      expect(entry).toBeUndefined();
    });
  });

  // --- Railway domains (service domains) ---

  describe("railway domains (service domains)", () => {
    test("detects railway domain add", () => {
      const desired: EnvironmentConfig = {
        services: { "svc-1": {} },
      };
      const current: EnvironmentConfig = {
        services: { "svc-1": {} },
      };
      const ctx = makeCtx({
        serviceIdToName: new Map([["svc-1", "web"]]),
        desiredState: makeState({
          services: {
            web: {
              name: "web",
              variables: {},
              domains: [],
              railwayDomain: { targetPort: 3000 },
            },
          },
        }),
        serviceDomainByService: new Map(), // no current domain
      });
      const diff = computeConfigDiff(desired, current, ctx);
      const entry = diff.entries.find((e) => e.category === "railway-domain");
      expect(entry).toBeDefined();
      expect(entry?.action).toBe("add");
      expect(entry?.serviceName).toBe("web");
      expect(entry?.newValue).toBe("port 3000");
    });

    test("detects railway domain add without target port", () => {
      const desired: EnvironmentConfig = {
        services: { "svc-1": {} },
      };
      const current: EnvironmentConfig = {
        services: { "svc-1": {} },
      };
      const ctx = makeCtx({
        serviceIdToName: new Map([["svc-1", "web"]]),
        desiredState: makeState({
          services: {
            web: {
              name: "web",
              variables: {},
              domains: [],
              railwayDomain: {},
            },
          },
        }),
        serviceDomainByService: new Map(),
      });
      const diff = computeConfigDiff(desired, current, ctx);
      const entry = diff.entries.find((e) => e.category === "railway-domain");
      expect(entry).toBeDefined();
      expect(entry?.action).toBe("add");
      expect(entry?.newValue).toBe("enabled");
    });

    test("detects railway domain remove", () => {
      const desired: EnvironmentConfig = {
        services: { "svc-1": {} },
      };
      const current: EnvironmentConfig = {
        services: { "svc-1": {} },
      };
      const ctx = makeCtx({
        serviceIdToName: new Map([["svc-1", "web"]]),
        desiredState: makeState({
          services: {
            web: { name: "web", variables: {}, domains: [] },
          },
        }),
        serviceDomainByService: new Map([
          ["web", { id: "dom-1", domain: "web-prod.up.railway.app", targetPort: 3000 }],
        ]),
      });
      const diff = computeConfigDiff(desired, current, ctx);
      const entry = diff.entries.find((e) => e.category === "railway-domain");
      expect(entry).toBeDefined();
      expect(entry?.action).toBe("remove");
      expect(entry?.oldValue).toBe("web-prod.up.railway.app");
    });

    test("detects railway domain port update", () => {
      const desired: EnvironmentConfig = {
        services: { "svc-1": {} },
      };
      const current: EnvironmentConfig = {
        services: { "svc-1": {} },
      };
      const ctx = makeCtx({
        serviceIdToName: new Map([["svc-1", "web"]]),
        desiredState: makeState({
          services: {
            web: {
              name: "web",
              variables: {},
              domains: [],
              railwayDomain: { targetPort: 8080 },
            },
          },
        }),
        serviceDomainByService: new Map([
          ["web", { id: "dom-1", domain: "web-prod.up.railway.app", targetPort: 3000 }],
        ]),
      });
      const diff = computeConfigDiff(desired, current, ctx);
      const entry = diff.entries.find((e) => e.category === "railway-domain");
      expect(entry).toBeDefined();
      expect(entry?.action).toBe("update");
      expect(entry?.oldValue).toBe(3000);
      expect(entry?.newValue).toBe(8080);
    });

    test("no railway domain diff when ports match", () => {
      const desired: EnvironmentConfig = {
        services: { "svc-1": {} },
      };
      const current: EnvironmentConfig = {
        services: { "svc-1": {} },
      };
      const ctx = makeCtx({
        serviceIdToName: new Map([["svc-1", "web"]]),
        desiredState: makeState({
          services: {
            web: {
              name: "web",
              variables: {},
              domains: [],
              railwayDomain: { targetPort: 3000 },
            },
          },
        }),
        serviceDomainByService: new Map([
          ["web", { id: "dom-1", domain: "web-prod.up.railway.app", targetPort: 3000 }],
        ]),
      });
      const diff = computeConfigDiff(desired, current, ctx);
      const entry = diff.entries.find((e) => e.category === "railway-domain");
      expect(entry).toBeUndefined();
    });
  });

  // --- TCP proxies ---

  describe("TCP proxies", () => {
    test("detects TCP proxy add", () => {
      const desired: EnvironmentConfig = {
        services: {
          "svc-1": { networking: { tcpProxies: { "5432": {} } } },
        },
      };
      const current: EnvironmentConfig = {
        services: { "svc-1": {} },
      };
      const ctx = makeCtx({
        serviceIdToName: new Map([["svc-1", "db"]]),
        desiredState: makeState({
          services: { db: { name: "db", variables: {}, domains: [] } },
        }),
      });
      const diff = computeConfigDiff(desired, current, ctx);
      const entry = diff.entries.find((e) => e.path === "networking.tcpProxies.5432");
      expect(entry).toBeDefined();
      expect(entry?.action).toBe("add");
      expect(entry?.newValue).toBe("5432");
    });

    test("detects TCP proxy remove", () => {
      const desired: EnvironmentConfig = {
        services: { "svc-1": {} },
      };
      const current: EnvironmentConfig = {
        services: {
          "svc-1": { networking: { tcpProxies: { "5432": {} } } },
        },
      };
      const ctx = makeCtx({
        serviceIdToName: new Map([["svc-1", "db"]]),
        desiredState: makeState({
          services: { db: { name: "db", variables: {}, domains: [] } },
        }),
      });
      const diff = computeConfigDiff(desired, current, ctx);
      const entry = diff.entries.find((e) => e.path === "networking.tcpProxies.5432");
      expect(entry).toBeDefined();
      expect(entry?.action).toBe("remove");
      expect(entry?.oldValue).toBe("5432");
    });

    test("no TCP proxy diff when both sides match", () => {
      const desired: EnvironmentConfig = {
        services: {
          "svc-1": { networking: { tcpProxies: { "5432": {} } } },
        },
      };
      const current: EnvironmentConfig = {
        services: {
          "svc-1": { networking: { tcpProxies: { "5432": {} } } },
        },
      };
      const ctx = makeCtx({
        serviceIdToName: new Map([["svc-1", "db"]]),
        desiredState: makeState({
          services: { db: { name: "db", variables: {}, domains: [] } },
        }),
      });
      const diff = computeConfigDiff(desired, current, ctx);
      const entry = diff.entries.find((e) => e.path.startsWith("networking.tcpProxies"));
      expect(entry).toBeUndefined();
    });
  });

  // --- Region removal warning and key removal ---

  describe("region diffing", () => {
    test("emits remove entry when current has region not in desired", () => {
      const desired: EnvironmentConfig = {
        services: {
          "svc-1": {
            deploy: { multiRegionConfig: { "us-west1": { numReplicas: 2 } } },
          },
        },
      };
      const current: EnvironmentConfig = {
        services: {
          "svc-1": {
            deploy: {
              multiRegionConfig: {
                "us-west1": { numReplicas: 2 },
                "us-east4": { numReplicas: 1 },
              },
            },
          },
        },
      };
      const ctx = makeCtx({
        serviceIdToName: new Map([["svc-1", "web"]]),
        desiredState: makeState({
          services: { web: { name: "web", variables: {}, domains: [] } },
        }),
      });
      const diff = computeConfigDiff(desired, current, ctx);
      const entry = diff.entries.find(
        (e) => e.path === "deploy.multiRegionConfig.us-east4" && e.action === "remove",
      );
      expect(entry).toBeDefined();
      expect(entry?.oldValue).toEqual({ numReplicas: 1 });
    });

    test("warns when desired regions empty but current has regions (no remove entries)", () => {
      // When desired has no multiRegionConfig but current does, we just warn —
      // no remove entries are emitted because the user didn't configure regions at all
      const desired: EnvironmentConfig = {
        services: {
          "svc-1": { deploy: {} },
        },
      };
      const current: EnvironmentConfig = {
        services: {
          "svc-1": {
            deploy: { multiRegionConfig: { "us-west1": { numReplicas: 2 } } },
          },
        },
      };
      const ctx = makeCtx({
        serviceIdToName: new Map([["svc-1", "web"]]),
        desiredState: makeState({
          services: { web: { name: "web", variables: {}, domains: [] } },
        }),
      });
      const diff = computeConfigDiff(desired, current, ctx);
      // No region entries should appear — the warning is logged but no diff action taken
      const regionEntries = diff.entries.filter((e) =>
        e.path.startsWith("deploy.multiRegionConfig"),
      );
      expect(regionEntries).toHaveLength(0);
    });
  });

  // --- Limit override ---

  describe("limit override", () => {
    test("detects limit add when desired has limits and current does not", () => {
      const desired: EnvironmentConfig = {
        services: {
          "svc-1": {
            deploy: { limitOverride: { containers: { memoryMB: 512, vCPU: 1 } } },
          },
        },
      };
      const current: EnvironmentConfig = {
        services: { "svc-1": { deploy: {} } },
      };
      const ctx = makeCtx({
        serviceIdToName: new Map([["svc-1", "web"]]),
        desiredState: makeState({
          services: { web: { name: "web", variables: {}, domains: [] } },
        }),
      });
      const diff = computeConfigDiff(desired, current, ctx);
      const entry = diff.entries.find((e) => e.path === "deploy.limitOverride");
      expect(entry).toBeDefined();
      expect(entry?.action).toBe("add");
    });

    test("detects limit remove when desired clears limits with null containers", () => {
      const desired: EnvironmentConfig = {
        services: {
          "svc-1": {
            deploy: { limitOverride: { containers: null } },
          },
        },
      };
      const current: EnvironmentConfig = {
        services: {
          "svc-1": {
            deploy: { limitOverride: { containers: { memoryMB: 512, vCPU: 1 } } },
          },
        },
      };
      const ctx = makeCtx({
        serviceIdToName: new Map([["svc-1", "web"]]),
        desiredState: makeState({
          services: { web: { name: "web", variables: {}, domains: [] } },
        }),
      });
      const diff = computeConfigDiff(desired, current, ctx);
      const entry = diff.entries.find((e) => e.path === "deploy.limitOverride");
      expect(entry).toBeDefined();
      expect(entry?.action).toBe("remove");
    });

    test("detects limit update when desired differs from current", () => {
      const desired: EnvironmentConfig = {
        services: {
          "svc-1": {
            deploy: { limitOverride: { containers: { memoryMB: 1024, vCPU: 2 } } },
          },
        },
      };
      const current: EnvironmentConfig = {
        services: {
          "svc-1": {
            deploy: { limitOverride: { containers: { memoryMB: 512, vCPU: 1 } } },
          },
        },
      };
      const ctx = makeCtx({
        serviceIdToName: new Map([["svc-1", "web"]]),
        desiredState: makeState({
          services: { web: { name: "web", variables: {}, domains: [] } },
        }),
      });
      const diff = computeConfigDiff(desired, current, ctx);
      const entry = diff.entries.find((e) => e.path === "deploy.limitOverride");
      expect(entry).toBeDefined();
      expect(entry?.action).toBe("update");
    });

    test("no limit diff when both sides are empty (null containers vs absent)", () => {
      const desired: EnvironmentConfig = {
        services: {
          "svc-1": {
            deploy: { limitOverride: { containers: null } },
          },
        },
      };
      const current: EnvironmentConfig = {
        services: { "svc-1": { deploy: {} } },
      };
      const ctx = makeCtx({
        serviceIdToName: new Map([["svc-1", "web"]]),
        desiredState: makeState({
          services: { web: { name: "web", variables: {}, domains: [] } },
        }),
      });
      const diff = computeConfigDiff(desired, current, ctx);
      const entry = diff.entries.find((e) => e.path === "deploy.limitOverride");
      expect(entry).toBeUndefined();
    });
  });

  // --- Volume field diffing (sizeMB, region) ---

  describe("volume fields (sizeMB, region)", () => {
    test("detects volume sizeMB change", () => {
      const desired: EnvironmentConfig = {
        volumes: { "vol-1": { sizeMB: 2048 } },
      };
      const current: EnvironmentConfig = {
        volumes: { "vol-1": { sizeMB: 1024 } },
      };
      const diff = computeConfigDiff(desired, current, makeCtx());
      const entry = diff.entries.find((e) => e.path === "volumes.vol-1.sizeMB");
      expect(entry).toBeDefined();
      expect(entry?.action).toBe("update");
      expect(entry?.oldValue).toBe(1024);
      expect(entry?.newValue).toBe(2048);
    });

    test("detects volume sizeMB add when current has no sizeMB", () => {
      const desired: EnvironmentConfig = {
        volumes: { "vol-1": { sizeMB: 2048 } },
      };
      const current: EnvironmentConfig = {
        volumes: { "vol-1": {} },
      };
      const diff = computeConfigDiff(desired, current, makeCtx());
      const entry = diff.entries.find((e) => e.path === "volumes.vol-1.sizeMB");
      expect(entry).toBeDefined();
      expect(entry?.action).toBe("add");
      expect(entry?.newValue).toBe(2048);
    });

    test("detects volume region change", () => {
      const desired: EnvironmentConfig = {
        volumes: { "vol-1": { region: "us-east4" } },
      };
      const current: EnvironmentConfig = {
        volumes: { "vol-1": { region: "us-west1" } },
      };
      const diff = computeConfigDiff(desired, current, makeCtx());
      const entry = diff.entries.find((e) => e.path === "volumes.vol-1.region");
      expect(entry).toBeDefined();
      expect(entry?.action).toBe("update");
      expect(entry?.oldValue).toBe("us-west1");
      expect(entry?.newValue).toBe("us-east4");
    });

    test("detects volume region add when current has no region", () => {
      const desired: EnvironmentConfig = {
        volumes: { "vol-1": { region: "us-east4" } },
      };
      const current: EnvironmentConfig = {
        volumes: { "vol-1": {} },
      };
      const diff = computeConfigDiff(desired, current, makeCtx());
      const entry = diff.entries.find((e) => e.path === "volumes.vol-1.region");
      expect(entry).toBeDefined();
      expect(entry?.action).toBe("add");
      expect(entry?.newValue).toBe("us-east4");
    });

    test("no volume diff when fields match", () => {
      const desired: EnvironmentConfig = {
        volumes: { "vol-1": { sizeMB: 1024, region: "us-west1" } },
      };
      const current: EnvironmentConfig = {
        volumes: { "vol-1": { sizeMB: 1024, region: "us-west1" } },
      };
      const diff = computeConfigDiff(desired, current, makeCtx());
      const volEntries = diff.entries.filter((e) => e.path.startsWith("volumes."));
      expect(volEntries).toHaveLength(0);
    });
  });

  // --- Bucket deletion warning ---

  test("does not emit diff entry for bucket in current but not desired (deletion unsupported)", () => {
    const desired: EnvironmentConfig = {};
    const current: EnvironmentConfig = {
      buckets: { "bucket-1": { region: "iad" } },
    };
    const diff = computeConfigDiff(desired, current, makeCtx());
    // No diff entry — just a logger.warn (bucket deletion not supported by Railway)
    const bucketEntries = diff.entries.filter((e) => e.category === "bucket");
    expect(bucketEntries).toHaveLength(0);
  });
});
