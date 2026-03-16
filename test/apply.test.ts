import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { GraphQLClient } from "graphql-request";
import { logger } from "../src/logger.js";
import { applyChangeset } from "../src/reconcile/apply.js";
import type { Change, Changeset } from "../src/types/changeset.js";

function makeChangeset(changes: Change[]): Changeset {
  return { changes };
}

interface MockCall {
  document: unknown;
  variables: Record<string, Record<string, unknown>> | undefined;
}

function mockClient(
  requestFn?: (document: unknown, variables?: Record<string, unknown>) => Promise<unknown>,
) {
  const calls: MockCall[] = [];
  const defaultRequest = async (
    document: unknown,
    variables?: Record<string, unknown>,
  ): Promise<unknown> => {
    calls.push({ document, variables: variables as MockCall["variables"] });
    // Default: return shapes that satisfy createService, createVolume, createBucket
    return {
      serviceCreate: { id: "mock-svc-id" },
      volumeCreate: { id: "mock-vol-id", name: "auto-generated" },
      bucketCreate: { id: "mock-bucket-id" },
    };
  };
  return {
    calls,
    client: {
      request: requestFn
        ? async (document: unknown, variables?: Record<string, unknown>) => {
            calls.push({ document, variables: variables as MockCall["variables"] });
            return requestFn(document, variables);
          }
        : defaultRequest,
    } as GraphQLClient,
  };
}

/** Helper to extract the `input` field from a mock call's variables. */
function inputOf(call: MockCall): Record<string, unknown> {
  return call.variables?.input as Record<string, unknown>;
}

const PROJECT_ID = "proj-test";
const ENV_ID = "env-test";

describe("applyChangeset", () => {
  beforeEach(() => {
    logger.mockTypes(() => () => {});
  });

  afterEach(() => {
    logger.restoreAll();
  });

  test("empty changeset produces empty results", async () => {
    const { client } = mockClient();
    const result = await applyChangeset(client, makeChangeset([]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });
    expect(result.applied).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  test("create-service change calls client and tracks service ID", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "create-service",
      name: "web",
      source: { image: "nginx:latest" },
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(1);
    expect(result.applied[0].type).toBe("create-service");
    expect(result.failed).toHaveLength(0);
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  test("create-service with volume calls client twice", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "create-service",
      name: "db",
      source: { image: "postgres:16" },
      volume: { mount: "/data", name: "db-data" },
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(1);
    // One call for createService, one for createVolume, one for updateVolume (set name)
    expect(calls).toHaveLength(3);
  });

  test("create-service with cronSchedule calls updateServiceInstance", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "create-service",
      name: "cron-job",
      cronSchedule: "0 * * * *",
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(1);
    // One call for createService, one for updateServiceInstance
    expect(calls).toHaveLength(2);
  });

  test("upsert-variables resolves service ID from createdServiceIds map", async () => {
    const { client } = mockClient();
    const changes: Change[] = [
      { type: "create-service", name: "api", source: { image: "node:20" } },
      {
        type: "upsert-variables",
        serviceName: "api",
        // serviceId intentionally omitted — should resolve from createdServiceIds
        variables: { PORT: "3000" },
      },
    ];

    const result = await applyChangeset(client, makeChangeset(changes), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(2);
    expect(result.failed).toHaveLength(0);
  });

  test("upsert-variables with explicit serviceId uses it directly", async () => {
    const { client } = mockClient();
    const change: Change = {
      type: "upsert-variables",
      serviceName: "web",
      serviceId: "svc-existing",
      variables: { PORT: "8080" },
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
  });

  test("upsert-variables throws when no service ID is available", async () => {
    const { client } = mockClient();
    const change: Change = {
      type: "upsert-variables",
      serviceName: "unknown-service",
      // no serviceId, no prior create-service
      variables: { KEY: "value" },
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toContain("No service ID");
    expect(result.failed[0].error).toContain("unknown-service");
  });

  test("delete-service calls the client", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "delete-service",
      name: "old-service",
      serviceId: "svc-delete-me",
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].variables).toEqual({ id: "svc-delete-me" });
  });

  test("failed changes are tracked in the failed array", async () => {
    const { client } = mockClient(async () => {
      throw new Error("API rate limit exceeded");
    });
    const change: Change = {
      type: "delete-service",
      name: "failing",
      serviceId: "svc-fail",
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toBe("API rate limit exceeded");
    expect(result.failed[0].change).toBe(change);
  });

  test("skipDeploys optimization — variable changes before last get skipDeploys=true", async () => {
    const captured: MockCall[] = [];
    const testClient = {
      request: async (document: unknown, variables?: Record<string, unknown>) => {
        captured.push({ document, variables: variables as MockCall["variables"] });
        return { serviceCreate: { id: "mock-svc-id" } };
      },
    } as GraphQLClient;

    const changes: Change[] = [
      {
        type: "upsert-variables",
        serviceName: "web",
        serviceId: "svc-1",
        variables: { A: "1" },
      },
      {
        type: "upsert-variables",
        serviceName: "web",
        serviceId: "svc-1",
        variables: { B: "2" },
      },
      {
        type: "upsert-variables",
        serviceName: "web",
        serviceId: "svc-1",
        variables: { C: "3" },
      },
    ];

    const result = await applyChangeset(testClient, makeChangeset(changes), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(3);

    // First two should have skipDeploys=true, last one should not
    expect(inputOf(captured[0]).skipDeploys).toBe(true);
    expect(inputOf(captured[1]).skipDeploys).toBe(true);
    // Last variable change should NOT have skipDeploys
    expect(inputOf(captured[2]).skipDeploys).toBeFalsy();
  });

  test("skipDeploys applies to upsert-shared-variables too", async () => {
    const captured: MockCall[] = [];
    const testClient = {
      request: async (document: unknown, variables?: Record<string, unknown>) => {
        captured.push({ document, variables: variables as MockCall["variables"] });
        return {};
      },
    } as GraphQLClient;

    const changes: Change[] = [
      {
        type: "upsert-shared-variables",
        variables: { SHARED_A: "1" },
      },
      {
        type: "upsert-variables",
        serviceName: "web",
        serviceId: "svc-1",
        variables: { B: "2" },
      },
    ];

    const result = await applyChangeset(testClient, makeChangeset(changes), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(2);

    // Per-service tracking: shared is the only shared var change, so no skip
    expect(inputOf(captured[0]).skipDeploys).toBeFalsy();

    // web's only var change, so no skip either
    expect(inputOf(captured[1]).skipDeploys).toBeFalsy();
  });

  test("skipDeploys is per-service — different services don't skip each other", async () => {
    const captured: MockCall[] = [];
    const testClient = {
      request: async (document: unknown, variables?: Record<string, unknown>) => {
        captured.push({ document, variables: variables as MockCall["variables"] });
        return {};
      },
    } as GraphQLClient;

    const changes: Change[] = [
      { type: "upsert-variables", serviceName: "a", serviceId: "svc-a", variables: { X: "1" } },
      { type: "upsert-variables", serviceName: "b", serviceId: "svc-b", variables: { Y: "2" } },
    ];

    const result = await applyChangeset(testClient, makeChangeset(changes), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(2);
    // Each is the only var change for its service — neither should skip
    expect(inputOf(captured[0]).skipDeploys).toBeFalsy();
    expect(inputOf(captured[1]).skipDeploys).toBeFalsy();
  });

  test("skipDeploys per-service with interleaved changes", async () => {
    const captured: MockCall[] = [];
    const testClient = {
      request: async (document: unknown, variables?: Record<string, unknown>) => {
        captured.push({ document, variables: variables as MockCall["variables"] });
        return {};
      },
    } as GraphQLClient;

    // A's first change, then B's only change, then A's second (last) change
    const changes: Change[] = [
      { type: "upsert-variables", serviceName: "a", serviceId: "svc-a", variables: { X: "1" } },
      { type: "upsert-variables", serviceName: "b", serviceId: "svc-b", variables: { Y: "2" } },
      { type: "upsert-variables", serviceName: "a", serviceId: "svc-a", variables: { Z: "3" } },
    ];

    const result = await applyChangeset(testClient, makeChangeset(changes), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(3);
    // A's first change should skip (not the last for service A)
    expect(inputOf(captured[0]).skipDeploys).toBe(true);
    // B's only change should NOT skip
    expect(inputOf(captured[1]).skipDeploys).toBeFalsy();
    // A's last change should NOT skip
    expect(inputOf(captured[2]).skipDeploys).toBeFalsy();
  });

  test("delete-bucket throws 'not supported' error", async () => {
    const { client } = mockClient();
    const change: Change = {
      type: "delete-bucket",
      name: "my-bucket",
      bucketId: "bucket-123",
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toContain("not supported");
  });

  test("create-volume change calls the client", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "create-volume",
      serviceName: "db",
      serviceId: "svc-db",
      mount: "/var/lib/data",
      name: "db-volume",
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(1);
    // One call for createVolume, one for updateVolume (set name)
    expect(calls).toHaveLength(2);
    expect(inputOf(calls[0]).mountPath).toBe("/var/lib/data");
    // Second call renames the volume
    expect(calls[1].variables).toEqual({
      volumeId: "mock-vol-id",
      input: { name: "db-volume" },
    });
  });

  test("delete-volume change calls the client", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "delete-volume",
      serviceName: "db",
      serviceId: "svc-db",
      volumeId: "vol-123",
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].variables).toEqual({ volumeId: "vol-123" });
  });

  test("update-service-settings applies all settings fields", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "update-service-settings",
      serviceName: "web",
      serviceId: "svc-1",
      settings: {
        source: { image: "node:20" },
        restartPolicy: "ON_FAILURE",
        healthcheck: { path: "/health", timeout: 30 },
        cronSchedule: "*/5 * * * *",
        region: { region: "us-east-1", numReplicas: 2 },
        startCommand: "npm start",
        buildCommand: "npm run build",
        rootDirectory: "/app",
        dockerfilePath: "Dockerfile.prod",
        preDeployCommand: ["npm run migrate"],
        restartPolicyMaxRetries: 3,
        sleepApplication: false,
      },
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(1);
    expect(calls).toHaveLength(1);

    const input = inputOf(calls[0]);
    expect(input.source).toEqual({ image: "node:20" });
    expect(input.restartPolicyType).toBe("ON_FAILURE");
    expect(input.healthcheckPath).toBe("/health");
    expect(input.healthcheckTimeout).toBe(30);
    expect(input.cronSchedule).toBe("*/5 * * * *");
    expect(input.region).toBe("us-east-1");
    expect(input.numReplicas).toBe(2);
    expect(input.startCommand).toBe("npm start");
    expect(input.buildCommand).toBe("npm run build");
    expect(input.rootDirectory).toBe("/app");
    expect(input.dockerfilePath).toBe("Dockerfile.prod");
    expect(input.preDeployCommand).toEqual(["npm run migrate"]);
    expect(input.restartPolicyMaxRetries).toBe(3);
    expect(input.sleepApplication).toBe(false);
  });

  test("create-domain calls client with correct parameters", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "create-domain",
      serviceName: "web",
      serviceId: "svc-1",
      domain: "example.com",
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(1);
    expect(calls).toHaveLength(1);
    const input = inputOf(calls[0]);
    expect(input.domain).toBe("example.com");
    expect(input.serviceId).toBe("svc-1");
  });

  test("delete-domain calls client", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "delete-domain",
      serviceName: "web",
      serviceId: "svc-1",
      domain: "old.example.com",
      domainId: "dom-123",
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].variables).toEqual({ id: "dom-123" });
  });

  test("delete-variables calls client for each variable", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "delete-variables",
      serviceName: "web",
      serviceId: "svc-1",
      variableNames: ["OLD_VAR", "DEPRECATED_VAR"],
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(1);
    // One call per variable name
    expect(calls).toHaveLength(2);
  });

  test("delete-shared-variables calls client for each variable", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "delete-shared-variables",
      variableNames: ["SHARED_OLD", "SHARED_DEPRECATED"],
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  test("create-bucket calls client", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "create-bucket",
      name: "storage",
      bucketName: "my-bucket",
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(inputOf(calls[0]).name).toBe("my-bucket");
  });

  test("create-domain without serviceId resolves from createdServiceIds", async () => {
    const { client } = mockClient();
    const changes: Change[] = [
      { type: "create-service", name: "web", source: { image: "nginx" } },
      { type: "create-domain", serviceName: "web", domain: "example.com" },
    ];

    const result = await applyChangeset(client, makeChangeset(changes), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(2);
    expect(result.failed).toHaveLength(0);
  });

  test("create-domain without serviceId and no prior create throws", async () => {
    const { client } = mockClient();
    const change: Change = {
      type: "create-domain",
      serviceName: "missing",
      domain: "example.com",
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toContain("No service ID");
  });

  test("partial failures — successful changes still tracked", async () => {
    let callCount = 0;
    const { client } = mockClient(async () => {
      callCount++;
      if (callCount === 2) {
        throw new Error("Second call fails");
      }
      return { serviceCreate: { id: "mock-svc-id" } };
    });

    const changes: Change[] = [
      { type: "delete-service", name: "a", serviceId: "svc-a" },
      { type: "delete-service", name: "b", serviceId: "svc-b" },
      { type: "delete-service", name: "c", serviceId: "svc-c" },
    ];

    const result = await applyChangeset(client, makeChangeset(changes), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(2);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].change.name).toBe("b");
  });

  test("single variable change does not get skipDeploys", async () => {
    const captured: MockCall[] = [];
    const testClient = {
      request: async (document: unknown, variables?: Record<string, unknown>) => {
        captured.push({ document, variables: variables as MockCall["variables"] });
        return {};
      },
    } as GraphQLClient;

    const changes: Change[] = [
      {
        type: "upsert-variables",
        serviceName: "web",
        serviceId: "svc-1",
        variables: { ONLY: "one" },
      },
    ];

    const result = await applyChangeset(testClient, makeChangeset(changes), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(1);
    expect(inputOf(captured[0]).skipDeploys).toBeFalsy();
  });

  test("delete-variables without serviceId throws", async () => {
    const { client } = mockClient();
    const change: Change = {
      type: "delete-variables",
      serviceName: "ghost-service",
      variableNames: ["VAR_A"],
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toContain("No service ID");
    expect(result.failed[0].error).toContain("ghost-service");
  });

  test("update-service-settings without serviceId throws", async () => {
    const { client } = mockClient();
    const change: Change = {
      type: "update-service-settings",
      serviceName: "no-id-service",
      serviceId: "",
      settings: { startCommand: "npm start" },
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toContain("No service ID");
    expect(result.failed[0].error).toContain("no-id-service");
  });

  test("update-service-settings clears healthcheck when null", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "update-service-settings",
      serviceName: "web",
      serviceId: "svc-1",
      settings: { healthcheck: null },
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(1);
    expect(calls).toHaveLength(1);
    const input = inputOf(calls[0]);
    expect(input.healthcheckPath).toBeNull();
    expect(input.healthcheckTimeout).toBeNull();
  });

  test("update-service-settings clears region when null", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "update-service-settings",
      serviceName: "web",
      serviceId: "svc-1",
      settings: { region: null },
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(1);
    expect(calls).toHaveLength(1);
    const input = inputOf(calls[0]);
    expect(input.region).toBeNull();
    expect(input.numReplicas).toBeNull();
  });

  test("create-service with branch passes branch to mutation", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "create-service",
      name: "web",
      source: { repo: "github.com/org/app" },
      branch: "develop",
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(1);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0].variables?.input.branch).toBe("develop");
  });

  test("create-service with registryCredentials passes credentials", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "create-service",
      name: "web",
      source: { image: "registry.example.com/app:latest" },
      registryCredentials: { username: "user", password: "pass" },
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(1);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const input = inputOf(calls[0]);
    expect(input.registryCredentials).toEqual({ username: "user", password: "pass" });
  });

  test("update-deployment-trigger calls mutation", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "update-deployment-trigger",
      serviceName: "web",
      serviceId: "svc-1",
      triggerId: "trigger-1",
      branch: "main",
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  test("create-service-domain calls mutation", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "create-service-domain",
      serviceName: "web",
      serviceId: "svc-1",
      targetPort: 3000,
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  test("delete-service-domain calls mutation", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "delete-service-domain",
      serviceName: "web",
      serviceId: "svc-1",
      domainId: "svcdom-123",
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  test("create-tcp-proxy calls mutation", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "create-tcp-proxy",
      serviceName: "db",
      serviceId: "svc-db",
      applicationPort: 5432,
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  test("delete-tcp-proxy calls mutation", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "delete-tcp-proxy",
      serviceName: "db",
      serviceId: "svc-db",
      proxyId: "proxy-123",
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  test("update-service-limits calls mutation", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "update-service-limits",
      serviceName: "web",
      serviceId: "svc-1",
      limits: { memoryGB: 8, vCPUs: 4 },
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(1);
    expect(calls).toHaveLength(1);
    const input = inputOf(calls[0]);
    expect(input.memoryGB).toBe(8);
    expect(input.vCPUs).toBe(4);
  });

  test("update-service-settings with new Group 1 fields", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "update-service-settings",
      serviceName: "web",
      serviceId: "svc-1",
      settings: {
        builder: "NIXPACKS",
        watchPatterns: ["src/**", "package.json"],
        drainingSeconds: 30,
        overlapSeconds: 10,
        ipv6EgressEnabled: true,
      },
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(1);
    expect(calls).toHaveLength(1);

    const input = inputOf(calls[0]);
    expect(input.builder).toBe("NIXPACKS");
    expect(input.watchPatterns).toEqual(["src/**", "package.json"]);
    expect(input.drainingSeconds).toBe(30);
    expect(input.overlapSeconds).toBe(10);
    expect(input.ipv6EgressEnabled).toBe(true);
  });

  test("update-service-settings clears builder when null", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "update-service-settings",
      serviceName: "web",
      serviceId: "svc-1",
      settings: { builder: null },
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(1);
    expect(calls).toHaveLength(1);
    const input = inputOf(calls[0]);
    expect(input.builder).toBeNull();
  });

  test("update-service-settings with registryCredentials", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "update-service-settings",
      serviceName: "web",
      serviceId: "svc-1",
      settings: {
        registryCredentials: { username: "deploy-user", password: "deploy-pass" },
      },
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(1);
    expect(calls).toHaveLength(1);
    const input = inputOf(calls[0]);
    expect(input.registryCredentials).toEqual({ username: "deploy-user", password: "deploy-pass" });
  });

  test("delete-service-domain calls mutation", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "delete-service-domain",
      serviceName: "web",
      domainId: "svcdom-1",
    };
    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });
    expect(result.applied).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].variables).toEqual({ id: "svcdom-1" });
  });

  test("delete-tcp-proxy calls mutation", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "delete-tcp-proxy",
      serviceName: "db",
      proxyId: "proxy-1",
    };
    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });
    expect(result.applied).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].variables).toEqual({ id: "proxy-1" });
  });

  test("enable-static-ips calls mutation", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "enable-static-ips",
      serviceName: "web",
      serviceId: "svc-1",
    };
    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });
    expect(result.applied).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  test("disable-static-ips calls mutation", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "disable-static-ips",
      serviceName: "web",
      serviceId: "svc-1",
    };
    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });
    expect(result.applied).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  test("create-service-domain without serviceId throws", async () => {
    const { client } = mockClient();
    const change: Change = {
      type: "create-service-domain",
      serviceName: "ghost",
    };
    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toContain("No service ID");
  });

  test("create-tcp-proxy without serviceId throws", async () => {
    const { client } = mockClient();
    const change: Change = {
      type: "create-tcp-proxy",
      serviceName: "ghost",
      applicationPort: 5432,
    };
    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toContain("No service ID");
  });

  test("enable-static-ips without serviceId throws", async () => {
    const { client } = mockClient();
    const change: Change = {
      type: "enable-static-ips",
      serviceName: "ghost",
      serviceId: "",
    };
    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toContain("No service ID");
  });

  test("disable-static-ips without serviceId throws", async () => {
    const { client } = mockClient();
    const change: Change = {
      type: "disable-static-ips",
      serviceName: "ghost",
      serviceId: "",
    };
    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toContain("No service ID");
  });

  test("update-service-limits without serviceId throws", async () => {
    const { client } = mockClient();
    const change: Change = {
      type: "update-service-limits",
      serviceName: "ghost",
      serviceId: "",
      limits: { memoryGB: 8 },
    };
    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toContain("No service ID");
  });

  test("update-domain calls updateCustomDomain with correct parameters", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "update-domain",
      serviceName: "web",
      serviceId: "svc-1",
      domain: "example.com",
      domainId: "dom-456",
      targetPort: 8080,
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].variables).toEqual({
      id: "dom-456",
      environmentId: ENV_ID,
      targetPort: 8080,
    });
  });

  test("update-service-domain calls updateServiceDomain with correct parameters", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "update-service-domain",
      serviceName: "api",
      serviceId: "svc-2",
      domainId: "svcdom-789",
      domain: "api.example.com",
      targetPort: 3000,
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(inputOf(calls[0])).toEqual({
      serviceDomainId: "svcdom-789",
      serviceId: "svc-2",
      environmentId: ENV_ID,
      domain: "api.example.com",
      targetPort: 3000,
    });
  });

  test("update-service-domain without serviceId throws", async () => {
    const { client } = mockClient();
    const change: Change = {
      type: "update-service-domain",
      serviceName: "ghost",
      domainId: "svcdom-1",
      domain: "ghost.example.com",
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toContain("No service ID");
  });

  test("update-volume with name change calls updateVolume", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "update-volume",
      serviceName: "db",
      serviceId: "svc-db",
      volumeId: "vol-100",
      name: "new-vol-name",
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].variables).toEqual({
      volumeId: "vol-100",
      input: { name: "new-vol-name" },
    });
  });

  test("update-volume with mount change calls updateVolumeInstance", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "update-volume",
      serviceName: "db",
      serviceId: "svc-db",
      volumeId: "vol-200",
      mount: "/new/mount/path",
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].variables).toEqual({
      volumeId: "vol-200",
      environmentId: ENV_ID,
      input: { mountPath: "/new/mount/path" },
    });
  });

  test("update-volume with both name and mount calls both mutations", async () => {
    const { client, calls } = mockClient();
    const change: Change = {
      type: "update-volume",
      serviceName: "db",
      serviceId: "svc-db",
      volumeId: "vol-300",
      name: "renamed-vol",
      mount: "/updated/path",
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    // One call for updateVolume (name), one for updateVolumeInstance (mount)
    expect(calls).toHaveLength(2);
    expect(calls[0].variables).toEqual({
      volumeId: "vol-300",
      input: { name: "renamed-vol" },
    });
    expect(calls[1].variables).toEqual({
      volumeId: "vol-300",
      environmentId: ENV_ID,
      input: { mountPath: "/updated/path" },
    });
  });

  test("create-volume without serviceId throws", async () => {
    const { client } = mockClient();
    const change: Change = {
      type: "create-volume",
      serviceName: "orphan-service",
      serviceId: "",
      mount: "/data",
      name: "vol-1",
    };

    const result = await applyChangeset(client, makeChangeset([change]), PROJECT_ID, ENV_ID, {
      noColor: true,
    });

    expect(result.applied).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toContain("No service ID");
    expect(result.failed[0].error).toContain("orphan-service");
  });
});

describe("createEnvironment", () => {
  test("sends EnvironmentCreateDocument with correct input", async () => {
    const { createEnvironment } = await import("../src/railway/mutations.js");
    const { EnvironmentCreateDocument } = await import("../src/generated/graphql.js");

    const calls: Array<{ document: unknown; variables: unknown }> = [];
    const client = {
      request: async (document: unknown, variables: unknown) => {
        calls.push({ document, variables });
        return { environmentCreate: { id: "env-123", name: "gamma" } };
      },
    } as GraphQLClient;

    const result = await createEnvironment(client, "proj-1", "gamma");

    expect(result).toEqual({ id: "env-123", name: "gamma" });
    expect(calls).toHaveLength(1);
    expect(calls[0].document).toBe(EnvironmentCreateDocument);
    expect(calls[0].variables).toEqual({ input: { projectId: "proj-1", name: "gamma" } });
  });
});
