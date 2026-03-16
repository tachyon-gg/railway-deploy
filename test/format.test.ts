import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { logger } from "../src/logger.js";
import { changeLabel, printApplyResult, printChangeset } from "../src/reconcile/format.js";
import type { Change, Changeset } from "../src/types/changeset.js";

// Capture logger output via consola's mockTypes
let logOutput: string[];

beforeEach(() => {
  logOutput = [];
  logger.mockTypes((_type) => (...args: unknown[]) => {
    logOutput.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  logger.restoreAll();
});

function allOutput(): string {
  return logOutput.join("\n");
}

// ---------------------------------------------------------------------------
// changeLabel
// ---------------------------------------------------------------------------
describe("changeLabel", () => {
  test("includes service name and summary for every change type", () => {
    const changes: Array<{ change: Change; mustContain: string[] }> = [
      { change: { type: "create-service", name: "web" }, mustContain: ["web", "create", "empty"] },
      {
        change: {
          type: "create-service",
          name: "api",
          source: { image: "node:20" },
          branch: "main",
        },
        mustContain: ["api", "node:20", "branch: main"],
      },
      {
        change: {
          type: "create-service",
          name: "db",
          source: { image: "postgres:16" },
          volume: { mount: "/data", name: "pg" },
        },
        mustContain: ["db", "postgres:16", "volume: /data"],
      },
      {
        change: {
          type: "create-service",
          name: "cron",
          source: { image: "alpine" },
          cronSchedule: "*/5 * * * *",
        },
        mustContain: ["cron", "alpine", "cron:"],
      },
      {
        change: { type: "delete-service", name: "old", serviceId: "svc-1" },
        mustContain: ["old", "delete"],
      },
      {
        change: { type: "upsert-variables", serviceName: "web", variables: { A: "1", B: "2" } },
        mustContain: ["web", "2 var", "A", "B"],
      },
      {
        change: { type: "delete-variables", serviceName: "web", variableNames: ["X"] },
        mustContain: ["web", "1 var", "X"],
      },
      {
        change: { type: "upsert-shared-variables", variables: { S: "1" } },
        mustContain: ["1 var", "S"],
      },
      {
        change: { type: "delete-shared-variables", variableNames: ["X", "Y"] },
        mustContain: ["2 var", "X", "Y"],
      },
      {
        change: { type: "create-domain", serviceName: "web", domain: "example.com" },
        mustContain: ["web", "example.com"],
      },
      {
        change: { type: "create-domain", serviceName: "web", domain: "api.com", targetPort: 8080 },
        mustContain: ["api.com", "8080"],
      },
      {
        change: { type: "delete-domain", serviceName: "web", domain: "old.com", domainId: "d1" },
        mustContain: ["web", "old.com"],
      },
      {
        change: {
          type: "update-domain",
          serviceName: "web",
          serviceId: "s1",
          domain: "updated.com",
          domainId: "d2",
          targetPort: 9090,
        },
        mustContain: ["web", "updated.com", "9090"],
      },
      {
        change: {
          type: "update-service-settings",
          serviceName: "api",
          serviceId: "s1",
          settings: { startCommand: "npm start" },
        },
        mustContain: ["api", "startCommand"],
      },
      {
        change: {
          type: "create-volume",
          serviceName: "db",
          serviceId: "s1",
          mount: "/data",
          name: "vol",
        },
        mustContain: ["db", "/data"],
      },
      {
        change: { type: "delete-volume", serviceName: "db", serviceId: "s1", volumeId: "v1" },
        mustContain: ["db", "volume"],
      },
      {
        change: {
          type: "update-volume",
          serviceName: "db",
          serviceId: "s1",
          volumeId: "v2",
          name: "new-name",
          mount: "/new/path",
        },
        mustContain: ["db", "name: new-name", "mount: /new/path"],
      },
      {
        change: {
          type: "update-deployment-trigger",
          serviceName: "web",
          serviceId: "s1",
          triggerId: "t1",
          branch: "develop",
        },
        mustContain: ["web", "develop"],
      },
      {
        change: {
          type: "update-deployment-trigger",
          serviceName: "web",
          serviceId: "s1",
          triggerId: "t1",
          checkSuites: true,
        },
        mustContain: ["web", "checkSuites", "true"],
      },
      {
        change: { type: "create-service-domain", serviceName: "web", targetPort: 3000 },
        mustContain: ["web", "3000"],
      },
      {
        change: { type: "create-service-domain", serviceName: "web" },
        mustContain: ["web", "domain"],
      },
      {
        change: { type: "delete-service-domain", serviceName: "web", domainId: "d1" },
        mustContain: ["web", "domain"],
      },
      {
        change: {
          type: "update-service-domain",
          serviceName: "web",
          serviceId: "s1",
          domainId: "sd1",
          domain: "custom.railway.app",
          targetPort: 4000,
        },
        mustContain: ["web", "custom.railway.app", "4000"],
      },
      {
        change: { type: "create-tcp-proxy", serviceName: "db", applicationPort: 5432 },
        mustContain: ["db", "5432"],
      },
      {
        change: { type: "delete-tcp-proxy", serviceName: "db", proxyId: "p1" },
        mustContain: ["db", "tcp proxy"],
      },
      {
        change: {
          type: "update-service-limits",
          serviceName: "web",
          serviceId: "s1",
          limits: { memoryGB: 8, vCPUs: 4 },
        },
        mustContain: ["web", "8GB", "vCPUs: 4"],
      },
      {
        change: { type: "enable-static-ips", serviceName: "web", serviceId: "s1" },
        mustContain: ["web", "enable"],
      },
      {
        change: { type: "disable-static-ips", serviceName: "web", serviceId: "s1" },
        mustContain: ["web", "disable"],
      },
      {
        change: { type: "create-bucket", name: "k", bucketName: "my-bucket" },
        mustContain: ["my-bucket"],
      },
      { change: { type: "delete-bucket", name: "old", bucketId: "b1" }, mustContain: ["old"] },
    ];

    for (const { change, mustContain } of changes) {
      const label = changeLabel(change);
      for (const text of mustContain) {
        expect(label).toContain(text);
      }
    }
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
    expect(output).toContain("frontend");
    expect(output).toContain("github.com/org/app");
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
    expect(output).toContain("/var/data");
    expect(output).toContain("cache");
  });

  test("verbose settings masks sensitive keys like registryCredentials", () => {
    const changeset: Changeset = {
      changes: [
        {
          type: "update-service-settings",
          serviceName: "api",
          serviceId: "svc-1",
          settings: { registryCredentials: { username: "user", password: "secret" } },
        },
      ],
    };
    printChangeset(changeset, {
      noColor: true,
      verbose: true,
      currentState: { services: {}, sharedVariables: {} },
    });
    const output = allOutput();
    expect(output).toContain("registryCredentials: ***");
    expect(output).not.toContain("secret");
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

  test("prints deployment trigger changes", () => {
    const changeset: Changeset = {
      changes: [
        {
          type: "update-deployment-trigger",
          serviceName: "api",
          serviceId: "svc-1",
          triggerId: "trig-1",
          branch: "develop",
        },
      ],
    };
    printChangeset(changeset, { noColor: true });
    const output = allOutput();
    expect(output).toContain("api");
    expect(output).toContain("develop");
  });

  test("prints railway domain changes", () => {
    const changeset: Changeset = {
      changes: [
        {
          type: "create-service-domain",
          serviceName: "web",
          serviceId: "svc-1",
          targetPort: 8080,
        },
        {
          type: "delete-service-domain",
          serviceName: "old",
          serviceId: "svc-2",
          domainId: "dom-1",
        },
      ],
    };
    printChangeset(changeset, { noColor: true });
    const output = allOutput();
    expect(output).toContain("web");
    expect(output).toContain("port 8080");
    expect(output).toContain("old");
  });

  test("prints TCP proxy changes", () => {
    const changeset: Changeset = {
      changes: [
        {
          type: "create-tcp-proxy",
          serviceName: "db",
          serviceId: "svc-1",
          applicationPort: 5432,
        },
        {
          type: "delete-tcp-proxy",
          serviceName: "cache",
          serviceId: "svc-2",
          proxyId: "proxy-1",
        },
      ],
    };
    printChangeset(changeset, { noColor: true });
    const output = allOutput();
    expect(output).toContain("db");
    expect(output).toContain("port 5432");
    expect(output).toContain("cache");
  });

  test("prints resource limits changes", () => {
    const changeset: Changeset = {
      changes: [
        {
          type: "update-service-limits",
          serviceName: "api",
          serviceId: "svc-1",
          limits: { memoryGB: 8, vCPUs: 4 },
        },
      ],
    };
    printChangeset(changeset, { noColor: true });
    const output = allOutput();
    expect(output).toContain("api");
    expect(output).toContain("memory: 8GB");
    expect(output).toContain("vCPUs: 4");
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
    expect(output).toContain("api:");
    expect(output).toContain("web:");
  });

  test("zero succeeded and zero failed", () => {
    printApplyResult({ applied: [], failed: [] }, true);
    const output = allOutput();
    expect(output).toContain("0 succeeded");
  });
});
