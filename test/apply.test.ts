import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { GraphQLClient } from "graphql-request";
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
    // Default: return a shape that satisfies createService (serviceCreate.id)
    return { serviceCreate: { id: "mock-svc-id" }, bucketCreate: { id: "mock-bucket-id" } };
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
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
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
    // One call for createService, one for createVolume
    expect(calls).toHaveLength(2);
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

    // First (shared) should have skipDeploys=true since it's before the last var change
    expect(inputOf(captured[0]).skipDeploys).toBe(true);

    // Last var change should not have skipDeploys
    expect(inputOf(captured[1]).skipDeploys).toBeFalsy();
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
    expect(calls).toHaveLength(1);
    expect(inputOf(calls[0]).mountPath).toBe("/var/lib/data");
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
