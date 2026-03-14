import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { changeLabel, printApplyResult, printChangeset } from "../src/reconcile/format.js";
import type { Change, Changeset } from "../src/types/changeset.js";

// Capture console.log output
let logOutput: string[];
let originalLog: typeof console.log;

beforeEach(() => {
  logOutput = [];
  originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logOutput.push(args.map(String).join(" "));
  };
});

afterEach(() => {
  console.log = originalLog;
});

function allOutput(): string {
  return logOutput.join("\n");
}

// ---------------------------------------------------------------------------
// changeLabel
// ---------------------------------------------------------------------------
describe("changeLabel", () => {
  test("create-service", () => {
    const change: Change = { type: "create-service", name: "web" };
    expect(changeLabel(change)).toBe("create-service: web");
  });

  test("delete-service", () => {
    const change: Change = { type: "delete-service", name: "api", serviceId: "svc-123" };
    expect(changeLabel(change)).toBe("delete-service: api");
  });

  test("upsert-variables", () => {
    const change: Change = {
      type: "upsert-variables",
      serviceName: "web",
      variables: { FOO: "bar", BAZ: "qux" },
    };
    expect(changeLabel(change)).toBe("upsert-variables: web (2 vars)");
  });

  test("delete-variables", () => {
    const change: Change = {
      type: "delete-variables",
      serviceName: "web",
      variableNames: ["OLD_VAR"],
    };
    expect(changeLabel(change)).toBe("delete-variables: web (1 vars)");
  });

  test("upsert-shared-variables", () => {
    const change: Change = {
      type: "upsert-shared-variables",
      variables: { SHARED_A: "1", SHARED_B: "2", SHARED_C: "3" },
    };
    expect(changeLabel(change)).toBe("upsert-shared-variables (3 vars)");
  });

  test("delete-shared-variables", () => {
    const change: Change = {
      type: "delete-shared-variables",
      variableNames: ["X", "Y"],
    };
    expect(changeLabel(change)).toBe("delete-shared-variables (2 vars)");
  });

  test("create-domain", () => {
    const change: Change = {
      type: "create-domain",
      serviceName: "web",
      domain: "example.com",
    };
    expect(changeLabel(change)).toBe("create-domain: web → example.com");
  });

  test("delete-domain", () => {
    const change: Change = {
      type: "delete-domain",
      serviceName: "web",
      domain: "old.example.com",
      domainId: "dom-1",
    };
    expect(changeLabel(change)).toBe("delete-domain: web → old.example.com");
  });

  test("update-service-settings", () => {
    const change: Change = {
      type: "update-service-settings",
      serviceName: "api",
      serviceId: "svc-1",
      settings: { startCommand: "node index.js", buildCommand: "npm run build" },
    };
    expect(changeLabel(change)).toBe("update-settings: api (startCommand, buildCommand)");
  });

  test("create-volume", () => {
    const change: Change = {
      type: "create-volume",
      serviceName: "db",
      serviceId: "svc-2",
      mount: "/data",
      name: "pg-data",
    };
    expect(changeLabel(change)).toBe("create-volume: db (/data)");
  });

  test("delete-volume", () => {
    const change: Change = {
      type: "delete-volume",
      serviceName: "db",
      serviceId: "svc-2",
      volumeId: "vol-1",
    };
    expect(changeLabel(change)).toBe("delete-volume: db");
  });

  test("create-bucket", () => {
    const change: Change = {
      type: "create-bucket",
      name: "assets",
      bucketName: "my-bucket",
    };
    expect(changeLabel(change)).toBe("create-bucket: my-bucket");
  });

  test("delete-bucket", () => {
    const change: Change = {
      type: "delete-bucket",
      name: "old-bucket",
      bucketId: "bkt-1",
    };
    expect(changeLabel(change)).toBe("delete-bucket: old-bucket");
  });
});

// ---------------------------------------------------------------------------
// printChangeset
// ---------------------------------------------------------------------------
describe("printChangeset", () => {
  test("empty changeset prints no changes needed", () => {
    const changeset: Changeset = { changes: [] };
    printChangeset(changeset, { noColor: true });
    const output = allOutput();
    expect(output).toContain("No changes needed");
  });

  test("non-empty changeset prints change count", () => {
    const changeset: Changeset = {
      changes: [
        { type: "create-service", name: "web", source: { image: "node:18" } },
        {
          type: "upsert-variables",
          serviceName: "web",
          variables: { PORT: "3000" },
        },
      ],
    };
    printChangeset(changeset, { noColor: true });
    const output = allOutput();
    expect(output).toContain("2 changes");
  });

  test("sensitive variable values are masked in verbose mode", () => {
    const changeset: Changeset = {
      changes: [
        {
          type: "upsert-variables",
          serviceName: "api",
          variables: {
            DB_PASSWORD: "super-secret-123",
            APP_SECRET: "my-secret-value",
            NORMAL_VAR: "visible-value",
          },
        },
      ],
    };
    printChangeset(changeset, {
      noColor: true,
      verbose: true,
      currentState: {
        services: {
          api: { variables: { DB_PASSWORD: "old-pass", NORMAL_VAR: "old-val" } },
        },
        sharedVariables: {},
      },
    });
    const output = allOutput();
    // Sensitive values should be masked
    expect(output).toContain("***");
    expect(output).not.toContain("super-secret-123");
    expect(output).not.toContain("my-secret-value");
    expect(output).not.toContain("old-pass");
    // Normal values should be visible
    expect(output).toContain("visible-value");
  });

  test("sensitive shared variable values are masked in verbose mode", () => {
    const changeset: Changeset = {
      changes: [
        {
          type: "upsert-shared-variables",
          variables: {
            API_TOKEN: "tok-abc123",
            PUBLIC_URL: "https://example.com",
          },
        },
      ],
    };
    printChangeset(changeset, {
      noColor: true,
      verbose: true,
      currentState: {
        services: {},
        sharedVariables: { API_TOKEN: "old-token" },
      },
    });
    const output = allOutput();
    expect(output).not.toContain("tok-abc123");
    expect(output).not.toContain("old-token");
    expect(output).toContain("https://example.com");
  });

  test("non-verbose mode does not show variable values", () => {
    const changeset: Changeset = {
      changes: [
        {
          type: "upsert-variables",
          serviceName: "web",
          variables: { PORT: "3000", HOST: "0.0.0.0" },
        },
      ],
    };
    printChangeset(changeset, { noColor: true });
    const output = allOutput();
    // Should show variable names but not values
    expect(output).toContain("PORT");
    expect(output).toContain("HOST");
    expect(output).not.toContain("3000");
    expect(output).not.toContain("0.0.0.0");
  });

  test("prints create and delete services", () => {
    const changeset: Changeset = {
      changes: [
        { type: "create-service", name: "frontend", source: { repo: "github.com/org/app" } },
        { type: "delete-service", name: "legacy", serviceId: "svc-old" },
      ],
    };
    printChangeset(changeset, { noColor: true });
    const output = allOutput();
    expect(output).toContain("CREATE services");
    expect(output).toContain("frontend");
    expect(output).toContain("github.com/org/app");
    expect(output).toContain("DELETE services");
    expect(output).toContain("legacy");
  });

  test("prints domain changes", () => {
    const changeset: Changeset = {
      changes: [
        { type: "create-domain", serviceName: "web", domain: "app.example.com" },
        { type: "delete-domain", serviceName: "web", domain: "old.example.com", domainId: "d-1" },
      ],
    };
    printChangeset(changeset, { noColor: true });
    const output = allOutput();
    expect(output).toContain("DOMAINS");
    expect(output).toContain("app.example.com");
    expect(output).toContain("old.example.com");
  });

  test("prints volume changes", () => {
    const changeset: Changeset = {
      changes: [
        {
          type: "create-volume",
          serviceName: "db",
          serviceId: "s1",
          mount: "/var/data",
          name: "pgdata",
        },
        { type: "delete-volume", serviceName: "cache", serviceId: "s2", volumeId: "v1" },
      ],
    };
    printChangeset(changeset, { noColor: true });
    const output = allOutput();
    expect(output).toContain("VOLUMES");
    expect(output).toContain("/var/data");
    expect(output).toContain("cache");
  });

  test("prints bucket changes", () => {
    const changeset: Changeset = {
      changes: [
        { type: "create-bucket", name: "uploads", bucketName: "my-uploads" },
        { type: "delete-bucket", name: "old-assets", bucketId: "bkt-old" },
      ],
    };
    printChangeset(changeset, { noColor: true });
    const output = allOutput();
    expect(output).toContain("BUCKETS");
    expect(output).toContain("my-uploads");
    expect(output).toContain("old-assets");
  });

  test("prints settings changes", () => {
    const changeset: Changeset = {
      changes: [
        {
          type: "update-service-settings",
          serviceName: "api",
          serviceId: "svc-1",
          settings: { startCommand: "node server.js" },
        },
      ],
    };
    printChangeset(changeset, { noColor: true });
    const output = allOutput();
    expect(output).toContain("UPDATE service settings");
    expect(output).toContain("api");
    expect(output).toContain("startCommand");
  });

  test("create-service with no source shows 'empty'", () => {
    const changeset: Changeset = {
      changes: [{ type: "create-service", name: "worker" }],
    };
    printChangeset(changeset, { noColor: true });
    const output = allOutput();
    expect(output).toContain("worker");
    expect(output).toContain("empty");
  });

  test("verbose settings shows old and new values", () => {
    const changeset: Changeset = {
      changes: [
        {
          type: "update-service-settings",
          serviceName: "api",
          serviceId: "svc-1",
          settings: { startCommand: "npm start" },
        },
      ],
    };
    printChangeset(changeset, {
      noColor: true,
      verbose: true,
      currentState: {
        services: {
          api: { variables: {}, startCommand: "node index.js" },
        },
        sharedVariables: {},
      },
    });
    const output = allOutput();
    expect(output).toContain('"node index.js"');
    expect(output).toContain('"npm start"');
    expect(output).toContain("startCommand");
  });

  test("verbose settings shows (unset) for null values", () => {
    const changeset: Changeset = {
      changes: [
        {
          type: "update-service-settings",
          serviceName: "api",
          serviceId: "svc-1",
          settings: { healthcheck: null },
        },
      ],
    };
    printChangeset(changeset, {
      noColor: true,
      verbose: true,
      currentState: {
        services: {
          api: { variables: {}, healthcheck: { path: "/health" } },
        },
        sharedVariables: {},
      },
    });
    const output = allOutput();
    expect(output).toContain("(unset)");
    expect(output).toContain("healthcheck");
  });

  test("non-verbose shared variable upsert shows just keys", () => {
    const changeset: Changeset = {
      changes: [
        {
          type: "upsert-shared-variables",
          variables: { SHARED_KEY: "some-value" },
        },
      ],
    };
    printChangeset(changeset, { noColor: true, verbose: false });
    const output = allOutput();
    expect(output).toContain("SHARED_KEY");
    expect(output).not.toContain("some-value");
  });

  test("delete-shared-variables prints variable names", () => {
    const changeset: Changeset = {
      changes: [
        {
          type: "delete-shared-variables",
          variableNames: ["OLD_SHARED", "DEPRECATED"],
        },
      ],
    };
    printChangeset(changeset, { noColor: true });
    const output = allOutput();
    expect(output).toContain("OLD_SHARED");
    expect(output).toContain("DEPRECATED");
  });

  test("delete-variables prints service name and variable names", () => {
    const changeset: Changeset = {
      changes: [
        {
          type: "delete-variables",
          serviceName: "api",
          variableNames: ["STALE_VAR", "UNUSED"],
        },
      ],
    };
    printChangeset(changeset, { noColor: true });
    const output = allOutput();
    expect(output).toContain("api");
    expect(output).toContain("delete");
    expect(output).toContain("STALE_VAR");
    expect(output).toContain("UNUSED");
  });
});

// ---------------------------------------------------------------------------
// printApplyResult
// ---------------------------------------------------------------------------
describe("printApplyResult", () => {
  test("all succeeded shows success count", () => {
    const result = {
      applied: [
        { type: "create-service" as const, name: "web" },
        { type: "create-service" as const, name: "api" },
      ],
      failed: [],
    };
    printApplyResult(result, true);
    const output = allOutput();
    expect(output).toContain("2 succeeded");
    expect(output).not.toContain("failed:");
  });

  test("some failures shows failure details", () => {
    const applied: Change[] = [{ type: "create-service", name: "web" }];
    const failed = [
      {
        change: {
          type: "upsert-variables" as const,
          serviceName: "api",
          variables: { PORT: "3000" },
        },
        error: "API rate limit exceeded",
      },
      {
        change: {
          type: "create-domain" as const,
          serviceName: "web",
          domain: "example.com",
        },
        error: "Domain already taken",
      },
    ];
    printApplyResult({ applied, failed }, true);
    const output = allOutput();
    expect(output).toContain("1 succeeded");
    expect(output).toContain("2 failed:");
    expect(output).toContain("API rate limit exceeded");
    expect(output).toContain("Domain already taken");
    expect(output).toContain("upsert-variables: api");
    expect(output).toContain("create-domain: web");
  });

  test("zero succeeded and zero failed", () => {
    printApplyResult({ applied: [], failed: [] }, true);
    const output = allOutput();
    expect(output).toContain("0 succeeded");
  });
});
