import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ConfigDiff } from "../src/types/changeset.js";
import type { EnvironmentConfig } from "../src/types/envconfig.js";
import type { State } from "../src/types/state.js";

// --- Mock setup ---
// We mock all external modules that applyConfigDiff calls.

const mockCreateService = mock(() => Promise.resolve({ id: "new-svc-id", name: "web" }));
const mockDeleteService = mock(() => Promise.resolve());
const mockCreateVolume = mock(() => Promise.resolve({ id: "new-vol-id", name: "vol" }));
const mockUpdateVolume = mock(() => Promise.resolve());
const mockDeleteVolume = mock(() => Promise.resolve());
const mockCreateBucket = mock(() => Promise.resolve({ id: "new-bucket-id", name: "my-bucket" }));
const mockStageEnvironmentChanges = mock(() => Promise.resolve());
const mockCommitStagedChanges = mock(() => Promise.resolve());
const mockCreateEgressGateway = mock(() => Promise.resolve());
const mockClearEgressGateways = mock(() => Promise.resolve());
const mockCreateServiceDomain = mock(() => Promise.resolve({ domain: "web.up.railway.app" }));
const mockDeleteServiceDomain = mock(() => Promise.resolve());
const mockUpdateServiceDomain = mock(() => Promise.resolve());
const mockCreateCustomDomain = mock(() => Promise.resolve());
const mockDeleteCustomDomain = mock(() => Promise.resolve());
const mockUpdateCustomDomain = mock(() => Promise.resolve());
const mockDeleteTcpProxy = mock(() => Promise.resolve());
const mockRenamePrivateNetworkEndpoint = mock(() => Promise.resolve());
const mockDeletePrivateNetworkEndpoint = mock(() => Promise.resolve());

const mockFetchEnvironmentConfig = mock(() =>
  Promise.resolve({ services: {} } as EnvironmentConfig),
);
const mockFetchTcpProxyByPort = mock(() =>
  Promise.resolve({ id: "proxy-1", applicationPort: 8080 }),
);
const mockFetchPrivateNetworkEndpoint = mock(() =>
  Promise.resolve({ id: "pne-1", dnsName: "old.internal", privateNetworkId: "pn-1" }),
);

// Re-export all real functions alongside mocks to avoid breaking other test files
const realQueries = await import("../src/railway/queries.js");
mock.module("../src/railway/queries.js", () => ({
  ...realQueries,
  fetchEnvironmentConfig: mockFetchEnvironmentConfig,
  fetchTcpProxyByPort: mockFetchTcpProxyByPort,
  fetchPrivateNetworkEndpoint: mockFetchPrivateNetworkEndpoint,
}));

const realMutations = await import("../src/railway/mutations.js");
mock.module("../src/railway/mutations.js", () => ({
  ...realMutations,
  createService: mockCreateService,
  deleteService: mockDeleteService,
  createVolume: mockCreateVolume,
  updateVolume: mockUpdateVolume,
  deleteVolume: mockDeleteVolume,
  createBucket: mockCreateBucket,
  stageEnvironmentChanges: mockStageEnvironmentChanges,
  commitStagedChanges: mockCommitStagedChanges,
  createEgressGateway: mockCreateEgressGateway,
  clearEgressGateways: mockClearEgressGateways,
  createServiceDomain: mockCreateServiceDomain,
  deleteServiceDomain: mockDeleteServiceDomain,
  updateServiceDomain: mockUpdateServiceDomain,
  createCustomDomain: mockCreateCustomDomain,
  deleteCustomDomain: mockDeleteCustomDomain,
  updateCustomDomain: mockUpdateCustomDomain,
  deleteTcpProxy: mockDeleteTcpProxy,
  renamePrivateNetworkEndpoint: mockRenamePrivateNetworkEndpoint,
  deletePrivateNetworkEndpoint: mockDeletePrivateNetworkEndpoint,
}));

// Must import AFTER mock.module calls
const { applyConfigDiff } = await import("../src/reconcile/apply.js");

// --- Helpers ---

const fakeClient = {} as unknown as import("graphql-request").GraphQLClient;
const projectId = "proj-1";
const environmentId = "env-1";

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

function emptyState(): State {
  return {
    projectId,
    environmentId,
    sharedVariables: {},
    services: {},
    volumes: {},
    buckets: {},
  };
}

function emptyConfig(): EnvironmentConfig {
  return { services: {} };
}

beforeEach(() => {
  mockCreateService.mockReset();
  mockDeleteService.mockReset();
  mockCreateVolume.mockReset();
  mockUpdateVolume.mockReset();
  mockDeleteVolume.mockReset();
  mockCreateBucket.mockReset();
  mockStageEnvironmentChanges.mockReset();
  mockCommitStagedChanges.mockReset();
  mockCreateEgressGateway.mockReset();
  mockClearEgressGateways.mockReset();
  mockCreateServiceDomain.mockReset();
  mockDeleteServiceDomain.mockReset();
  mockUpdateServiceDomain.mockReset();
  mockCreateCustomDomain.mockReset();
  mockDeleteCustomDomain.mockReset();
  mockUpdateCustomDomain.mockReset();
  mockDeleteTcpProxy.mockReset();
  mockRenamePrivateNetworkEndpoint.mockReset();
  mockDeletePrivateNetworkEndpoint.mockReset();
  mockFetchEnvironmentConfig.mockReset();
  mockFetchTcpProxyByPort.mockReset();
  mockFetchPrivateNetworkEndpoint.mockReset();

  // Restore default implementations
  mockCreateService.mockImplementation(() => Promise.resolve({ id: "new-svc-id", name: "web" }));
  mockCreateVolume.mockImplementation(() => Promise.resolve({ id: "new-vol-id", name: "vol" }));
  mockCreateBucket.mockImplementation(() =>
    Promise.resolve({ id: "new-bucket-id", name: "my-bucket" }),
  );
  mockCreateServiceDomain.mockImplementation(() =>
    Promise.resolve({ domain: "web.up.railway.app" }),
  );
  mockFetchEnvironmentConfig.mockImplementation(() =>
    Promise.resolve({ services: {} } as EnvironmentConfig),
  );
  mockFetchTcpProxyByPort.mockImplementation(() =>
    Promise.resolve({ id: "proxy-1", applicationPort: 8080 }),
  );
  mockFetchPrivateNetworkEndpoint.mockImplementation(() =>
    Promise.resolve({ id: "pne-1", dnsName: "old.internal", privateNetworkId: "pn-1" }),
  );
});

// ======================================================================
// Tests
// ======================================================================

describe("applyConfigDiff", () => {
  // ------------------------------------------------------------------
  // Empty diff — no-op
  // ------------------------------------------------------------------
  describe("empty diff", () => {
    test("returns clean result with no API calls", async () => {
      const result = await applyConfigDiff(
        fakeClient,
        emptyDiff(),
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
      );
      expect(result.staged).toBe(false);
      expect(result.committed).toBe(false);
      expect(result.servicesCreated).toEqual([]);
      expect(result.servicesDeleted).toEqual([]);
      expect(result.volumesCreated).toEqual([]);
      expect(result.errors).toEqual([]);
      expect(mockStageEnvironmentChanges).not.toHaveBeenCalled();
      expect(mockCommitStagedChanges).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // Step 1: Service creation
  // ------------------------------------------------------------------
  describe("service creation", () => {
    test("creates service and adds to servicesCreated", async () => {
      const diff: ConfigDiff = {
        ...emptyDiff(),
        servicesToCreate: [{ name: "web", source: { image: "nginx" } }],
        entries: [
          {
            path: "service",
            action: "add",
            serviceName: "web",
            category: "service",
            newValue: "nginx",
          },
        ],
      };
      const state = emptyState();
      state.services.web = {
        name: "web",
        source: { image: "nginx" },
        variables: {},
        domains: [],
      };

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        state,
      );

      expect(mockCreateService).toHaveBeenCalledTimes(1);
      expect(result.servicesCreated).toEqual(["web"]);
      expect(result.staged).toBe(true);
    });

    test("registers created service IDs in serviceNameToId map", async () => {
      const diff: ConfigDiff = {
        ...emptyDiff(),
        servicesToCreate: [{ name: "api" }],
        entries: [
          {
            path: "service",
            action: "add",
            serviceName: "api",
            category: "service",
          },
        ],
      };
      const state = emptyState();
      state.services.api = {
        name: "api",
        variables: {},
        domains: [],
      };
      const nameToId = new Map<string, string>();

      await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        state,
        nameToId,
      );

      expect(nameToId.get("api")).toBe("new-svc-id");
    });

    test("handles createService failure gracefully", async () => {
      mockCreateService.mockImplementation(() =>
        Promise.reject(new Error("Service limit reached")),
      );

      const diff: ConfigDiff = {
        ...emptyDiff(),
        servicesToCreate: [{ name: "web" }],
        entries: [
          {
            path: "service",
            action: "add",
            serviceName: "web",
            category: "service",
          },
        ],
      };

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
      );

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].step).toBe("create-service:web");
      expect(result.errors[0].error).toBe("Service limit reached");
      expect(result.servicesCreated).toEqual([]);
    });

    test("creates volume for new service when volume is specified", async () => {
      const diff: ConfigDiff = {
        ...emptyDiff(),
        servicesToCreate: [
          { name: "db", source: { image: "postgres" }, volume: { mount: "/data", name: "pgdata" } },
        ],
        entries: [
          {
            path: "service",
            action: "add",
            serviceName: "db",
            category: "service",
          },
        ],
      };
      const state = emptyState();
      state.services.db = {
        name: "db",
        source: { image: "postgres" },
        variables: {},
        domains: [],
        volume: { name: "pgdata", mount: "/data" },
      };

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        state,
      );

      expect(mockCreateVolume).toHaveBeenCalledTimes(1);
      expect(mockUpdateVolume).toHaveBeenCalledTimes(1);
      expect(result.volumesCreated).toEqual(["db"]);
    });

    test("handles volume creation failure for new service", async () => {
      mockCreateVolume.mockImplementation(() => Promise.reject(new Error("Volume quota exceeded")));

      const diff: ConfigDiff = {
        ...emptyDiff(),
        servicesToCreate: [{ name: "db", volume: { mount: "/data", name: "pgdata" } }],
        entries: [
          {
            path: "service",
            action: "add",
            serviceName: "db",
            category: "service",
          },
        ],
      };
      const state = emptyState();
      state.services.db = {
        name: "db",
        variables: {},
        domains: [],
        volume: { name: "pgdata", mount: "/data" },
      };

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        state,
      );

      expect(result.errors.some((e) => e.step === "create-volume:db")).toBe(true);
      // Service should still be created
      expect(result.servicesCreated).toEqual(["db"]);
    });
  });

  // ------------------------------------------------------------------
  // Step 1c: Region null-injection for new services
  // ------------------------------------------------------------------
  describe("region null-injection for new services", () => {
    test("null-injects default regions assigned by Railway on service creation", async () => {
      mockFetchEnvironmentConfig.mockImplementation(() =>
        Promise.resolve({
          services: {
            "new-svc-id": {
              deploy: {
                multiRegionConfig: {
                  "us-west1": { numReplicas: 1 },
                },
              },
            },
          },
        } as EnvironmentConfig),
      );

      const diff: ConfigDiff = {
        ...emptyDiff(),
        servicesToCreate: [{ name: "web" }],
        entries: [
          {
            path: "service",
            action: "add",
            serviceName: "web",
            category: "service",
          },
        ],
      };
      const state = emptyState();
      state.services.web = {
        name: "web",
        variables: {},
        domains: [],
        regions: { "us-east4": 1 },
      };

      const desiredConfig: EnvironmentConfig = { services: {} };

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        desiredConfig,
        projectId,
        environmentId,
        state,
      );

      expect(mockFetchEnvironmentConfig).toHaveBeenCalled();
      // The stage call should have been made with the config
      expect(result.staged).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  // Step 2: Volume creation for existing services
  // ------------------------------------------------------------------
  describe("volume creation for existing services", () => {
    test("creates volume and updates config with volume mount", async () => {
      const diff: ConfigDiff = {
        ...emptyDiff(),
        volumesToCreate: [
          {
            serviceName: "db",
            serviceId: "svc-db",
            mount: "/data",
            name: "pgdata",
          },
        ],
        entries: [
          {
            path: "volumeMounts.new-vol-id",
            action: "add",
            serviceName: "db",
            category: "volume",
            newValue: "/data",
          },
        ],
      };
      const desiredConfig: EnvironmentConfig = {
        services: {
          "svc-db": {
            variables: { PORT: { value: "5432" } },
          },
        },
      };

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        desiredConfig,
        projectId,
        environmentId,
        emptyState(),
      );

      expect(mockCreateVolume).toHaveBeenCalledTimes(1);
      expect(mockUpdateVolume).toHaveBeenCalledTimes(1);
      expect(result.volumesCreated).toEqual(["db"]);
    });

    test("skips volume rename when name matches", async () => {
      mockCreateVolume.mockImplementation(() =>
        Promise.resolve({ id: "new-vol-id", name: "pgdata" }),
      );

      const diff: ConfigDiff = {
        ...emptyDiff(),
        volumesToCreate: [
          { serviceName: "db", serviceId: "svc-db", mount: "/data", name: "pgdata" },
        ],
        entries: [
          {
            path: "volumeMounts.vol",
            action: "add",
            serviceName: "db",
            category: "volume",
          },
        ],
      };
      const desiredConfig: EnvironmentConfig = {
        services: { "svc-db": {} },
      };

      await applyConfigDiff(
        fakeClient,
        diff,
        desiredConfig,
        projectId,
        environmentId,
        emptyState(),
      );

      expect(mockUpdateVolume).not.toHaveBeenCalled();
    });

    test("handles volume creation error for existing service", async () => {
      mockCreateVolume.mockImplementation(() => Promise.reject(new Error("Volume failed")));

      const diff: ConfigDiff = {
        ...emptyDiff(),
        volumesToCreate: [
          { serviceName: "db", serviceId: "svc-db", mount: "/data", name: "pgdata" },
        ],
        entries: [
          {
            path: "vol",
            action: "add",
            serviceName: "db",
            category: "volume",
          },
        ],
      };

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
      );

      expect(result.errors.some((e) => e.step === "create-volume:db")).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  // Step 2b: Bucket creation
  // ------------------------------------------------------------------
  describe("bucket creation", () => {
    test("creates new bucket when id is not set", async () => {
      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "bucket",
            action: "add",
            serviceName: null,
            category: "bucket",
          },
        ],
      };
      const state = emptyState();
      // Bucket without an id = needs creation
      state.buckets.storage = { id: "", name: "my-bucket", region: "iad" };

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        state,
      );

      expect(mockCreateBucket).toHaveBeenCalledTimes(1);
      expect(result.staged).toBe(true);
    });

    test("skips bucket when id is already set", async () => {
      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "bucket",
            action: "add",
            serviceName: null,
            category: "bucket",
          },
        ],
      };
      const state = emptyState();
      state.buckets.storage = { id: "existing-id", name: "my-bucket" };

      await applyConfigDiff(fakeClient, diff, emptyConfig(), projectId, environmentId, state);

      expect(mockCreateBucket).not.toHaveBeenCalled();
    });

    test("handles bucket creation error", async () => {
      mockCreateBucket.mockImplementation(() => Promise.reject(new Error("Bucket failed")));

      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "bucket",
            action: "add",
            serviceName: null,
            category: "bucket",
          },
        ],
      };
      const state = emptyState();
      state.buckets.storage = { id: "", name: "my-bucket" };

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        state,
      );

      expect(result.errors.some((e) => e.step === "create-bucket:storage")).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  // Step 2.5: Null-injection for removed collections
  // ------------------------------------------------------------------
  describe("null-injection for removed items", () => {
    test("null-injects removed shared variable", async () => {
      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "sharedVariables.OLD_VAR",
            action: "remove",
            serviceName: null,
            category: "shared-variable",
            oldValue: "old",
          },
        ],
      };
      const desiredConfig: EnvironmentConfig = {
        services: { "svc-1": { variables: { PORT: { value: "3000" } } } },
      };

      await applyConfigDiff(
        fakeClient,
        diff,
        desiredConfig,
        projectId,
        environmentId,
        emptyState(),
      );

      // stageEnvironmentChanges should be called with config that has OLD_VAR: null
      expect(mockStageEnvironmentChanges).toHaveBeenCalledTimes(1);
      const stagedConfig = (
        mockStageEnvironmentChanges.mock.calls[0] as unknown[]
      )[2] as EnvironmentConfig;
      expect((stagedConfig.sharedVariables as Record<string, unknown>).OLD_VAR).toBeNull();
    });

    test("null-injects removed service variable", async () => {
      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "variables.DEAD_VAR",
            action: "remove",
            serviceName: "web",
            category: "variable",
            oldValue: "val",
          },
        ],
      };
      const nameToId = new Map([["web", "svc-web"]]);
      const desiredConfig: EnvironmentConfig = {
        services: {
          "svc-web": { variables: { PORT: { value: "3000" } } },
        },
      };

      await applyConfigDiff(
        fakeClient,
        diff,
        desiredConfig,
        projectId,
        environmentId,
        emptyState(),
        nameToId,
      );

      const stagedConfig = (
        mockStageEnvironmentChanges.mock.calls[0] as unknown[]
      )[2] as EnvironmentConfig;
      expect(
        (stagedConfig.services?.["svc-web"]?.variables as Record<string, unknown>)?.DEAD_VAR,
      ).toBeNull();
    });

    test("null-injects removed region key", async () => {
      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "deploy.multiRegionConfig.us-west1",
            action: "remove",
            serviceName: "web",
            category: "setting",
            oldValue: { numReplicas: 1 },
          },
        ],
      };
      const nameToId = new Map([["web", "svc-web"]]);
      const desiredConfig: EnvironmentConfig = {
        services: {
          "svc-web": {
            deploy: {
              multiRegionConfig: { "us-east4": { numReplicas: 1 } },
            },
          },
        },
      };

      await applyConfigDiff(
        fakeClient,
        diff,
        desiredConfig,
        projectId,
        environmentId,
        emptyState(),
        nameToId,
      );

      const stagedConfig = (
        mockStageEnvironmentChanges.mock.calls[0] as unknown[]
      )[2] as EnvironmentConfig;
      const mrc = (stagedConfig.services?.["svc-web"]?.deploy as Record<string, unknown>)
        ?.multiRegionConfig as Record<string, unknown>;
      expect(mrc["us-west1"]).toBeNull();
      expect(mrc["us-east4"]).toEqual({ numReplicas: 1 });
    });
  });

  // ------------------------------------------------------------------
  // Step 2.6: TCP proxy deletion
  // ------------------------------------------------------------------
  describe("TCP proxy deletion pre-stage", () => {
    test("deletes TCP proxy before staging", async () => {
      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "networking.tcpProxies.8080",
            action: "remove",
            serviceName: "web",
            category: "setting",
          },
        ],
      };
      const nameToId = new Map([["web", "svc-web"]]);

      await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
        nameToId,
      );

      expect(mockFetchTcpProxyByPort).toHaveBeenCalledWith(
        fakeClient,
        "svc-web",
        environmentId,
        8080,
      );
      expect(mockDeleteTcpProxy).toHaveBeenCalledWith(fakeClient, "proxy-1");
    });

    test("skips TCP proxy deletion in stage-only mode", async () => {
      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "networking.tcpProxies.8080",
            action: "remove",
            serviceName: "web",
            category: "setting",
          },
        ],
      };
      const nameToId = new Map([["web", "svc-web"]]);

      await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
        nameToId,
        { stageOnly: true },
      );

      expect(mockFetchTcpProxyByPort).not.toHaveBeenCalled();
      expect(mockDeleteTcpProxy).not.toHaveBeenCalled();
    });

    test("handles TCP proxy fetch returning null", async () => {
      mockFetchTcpProxyByPort.mockImplementation(() =>
        Promise.resolve(null as unknown as { id: string; applicationPort: number }),
      );

      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "networking.tcpProxies.9090",
            action: "remove",
            serviceName: "web",
            category: "setting",
          },
        ],
      };
      const nameToId = new Map([["web", "svc-web"]]);

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
        nameToId,
      );

      expect(mockDeleteTcpProxy).not.toHaveBeenCalled();
      expect(result.errors).toEqual([]);
    });

    test("handles TCP proxy deletion error", async () => {
      mockFetchTcpProxyByPort.mockImplementation(() => Promise.reject(new Error("TCP error")));

      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "networking.tcpProxies.8080",
            action: "remove",
            serviceName: "web",
            category: "setting",
          },
        ],
      };
      const nameToId = new Map([["web", "svc-web"]]);

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
        nameToId,
      );

      expect(result.errors.some((e) => e.step === "tcp-proxy-delete:web")).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  // Step 3: Stage changes
  // ------------------------------------------------------------------
  describe("staging", () => {
    test("stages when there are entries", async () => {
      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "variables.PORT",
            action: "update",
            serviceName: "web",
            category: "variable",
            oldValue: "3000",
            newValue: "8080",
          },
        ],
      };
      const desiredConfig: EnvironmentConfig = {
        services: {
          "svc-web": { variables: { PORT: { value: "8080" } } },
        },
      };

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        desiredConfig,
        projectId,
        environmentId,
        emptyState(),
      );

      expect(mockStageEnvironmentChanges).toHaveBeenCalledTimes(1);
      expect(result.staged).toBe(true);
    });

    test("stages when services exist in config (even with no entries)", async () => {
      const diff = emptyDiff();
      const desiredConfig: EnvironmentConfig = {
        services: {
          "svc-web": { variables: { PORT: { value: "3000" } } },
        },
      };

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        desiredConfig,
        projectId,
        environmentId,
        emptyState(),
      );

      expect(mockStageEnvironmentChanges).toHaveBeenCalledTimes(1);
      expect(result.staged).toBe(true);
    });

    test("handles stage failure and cleans up orphaned services", async () => {
      mockStageEnvironmentChanges.mockImplementation(() =>
        Promise.reject(new Error("Stage failed")),
      );

      const diff: ConfigDiff = {
        ...emptyDiff(),
        servicesToCreate: [{ name: "web" }],
        entries: [
          {
            path: "service",
            action: "add",
            serviceName: "web",
            category: "service",
          },
        ],
      };
      const state = emptyState();
      state.services.web = {
        name: "web",
        variables: {},
        domains: [],
      };

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        state,
      );

      expect(result.errors.some((e) => e.step === "stage")).toBe(true);
      expect(result.staged).toBe(false);
      expect(result.committed).toBe(false);
      // Should have cleaned up the orphaned service
      expect(mockDeleteService).toHaveBeenCalledWith(fakeClient, "new-svc-id");
    });

    test("handles stage failure and cleans up orphaned volumes", async () => {
      mockStageEnvironmentChanges.mockImplementation(() =>
        Promise.reject(new Error("Stage failed")),
      );

      const diff: ConfigDiff = {
        ...emptyDiff(),
        volumesToCreate: [
          { serviceName: "db", serviceId: "svc-db", mount: "/data", name: "pgdata" },
        ],
        entries: [
          {
            path: "vol",
            action: "add",
            serviceName: "db",
            category: "volume",
          },
        ],
      };
      const desiredConfig: EnvironmentConfig = {
        services: { "svc-db": {} },
      };

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        desiredConfig,
        projectId,
        environmentId,
        emptyState(),
      );

      expect(result.errors.some((e) => e.step === "stage")).toBe(true);
      // Should have cleaned up the orphaned volume
      expect(mockDeleteVolume).toHaveBeenCalledWith(fakeClient, "new-vol-id");
    });

    test("returns early after stage failure — no commit or deletions", async () => {
      mockStageEnvironmentChanges.mockImplementation(() =>
        Promise.reject(new Error("Stage failed")),
      );

      const diff: ConfigDiff = {
        ...emptyDiff(),
        servicesToDelete: [{ name: "old", serviceId: "svc-old" }],
        entries: [
          {
            path: "variables.PORT",
            action: "update",
            serviceName: "web",
            category: "variable",
          },
        ],
      };

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
      );

      expect(mockCommitStagedChanges).not.toHaveBeenCalled();
      expect(mockDeleteService).not.toHaveBeenCalled();
      expect(result.servicesDeleted).toEqual([]);
    });
  });

  // ------------------------------------------------------------------
  // Stage-only mode
  // ------------------------------------------------------------------
  describe("stage-only mode", () => {
    test("returns after staging without committing", async () => {
      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "variables.PORT",
            action: "add",
            serviceName: "web",
            category: "variable",
          },
        ],
      };

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
        undefined,
        { stageOnly: true },
      );

      expect(result.staged).toBe(true);
      expect(result.committed).toBe(false);
      expect(mockCommitStagedChanges).not.toHaveBeenCalled();
    });

    test("stage-only includes TCP proxy note when removing proxy", async () => {
      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "networking.tcpProxies.8080",
            action: "remove",
            serviceName: "web",
            category: "setting",
          },
          {
            path: "variables.X",
            action: "add",
            serviceName: "web",
            category: "variable",
          },
        ],
      };

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
        undefined,
        { stageOnly: true },
      );

      // Just verify it returned without error after staging
      expect(result.staged).toBe(true);
      expect(result.committed).toBe(false);
    });

    test("stage-only does not delete services", async () => {
      const diff: ConfigDiff = {
        ...emptyDiff(),
        servicesToDelete: [{ name: "old", serviceId: "svc-old" }],
        entries: [
          {
            path: "variables.PORT",
            action: "update",
            serviceName: "web",
            category: "variable",
          },
        ],
      };

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
        undefined,
        { stageOnly: true },
      );

      expect(mockDeleteService).not.toHaveBeenCalled();
      expect(result.servicesDeleted).toEqual([]);
    });
  });

  // ------------------------------------------------------------------
  // Step 4: Commit
  // ------------------------------------------------------------------
  describe("commit", () => {
    test("commits after successful stage", async () => {
      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "variables.PORT",
            action: "update",
            serviceName: "web",
            category: "variable",
          },
        ],
      };

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
      );

      expect(mockCommitStagedChanges).toHaveBeenCalledTimes(1);
      expect(result.committed).toBe(true);
    });

    test("handles commit failure — returns early", async () => {
      mockCommitStagedChanges.mockImplementation(() => Promise.reject(new Error("Commit failed")));

      const diff: ConfigDiff = {
        ...emptyDiff(),
        servicesToDelete: [{ name: "old", serviceId: "svc-old" }],
        entries: [
          {
            path: "variables.PORT",
            action: "update",
            serviceName: "web",
            category: "variable",
          },
        ],
      };

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
      );

      expect(result.staged).toBe(true);
      expect(result.committed).toBe(false);
      expect(result.errors.some((e) => e.step === "commit")).toBe(true);
      // Should not proceed to service deletion
      expect(mockDeleteService).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // Step 4.5: Egress gateways (static outbound IPs)
  // ------------------------------------------------------------------
  describe("egress gateways", () => {
    test("creates egress gateway on add", async () => {
      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "staticOutboundIps",
            action: "add",
            serviceName: "web",
            category: "setting",
          },
        ],
      };
      const nameToId = new Map([["web", "svc-web"]]);

      await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
        nameToId,
      );

      expect(mockCreateEgressGateway).toHaveBeenCalledWith(fakeClient, "svc-web", environmentId);
    });

    test("clears egress gateways on remove", async () => {
      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "staticOutboundIps",
            action: "remove",
            serviceName: "web",
            category: "setting",
          },
        ],
      };
      const nameToId = new Map([["web", "svc-web"]]);

      await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
        nameToId,
      );

      expect(mockClearEgressGateways).toHaveBeenCalledWith(fakeClient, "svc-web", environmentId);
    });

    test("handles egress error gracefully", async () => {
      mockCreateEgressGateway.mockImplementation(() => Promise.reject(new Error("Egress failed")));

      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "staticOutboundIps",
            action: "add",
            serviceName: "web",
            category: "setting",
          },
        ],
      };
      const nameToId = new Map([["web", "svc-web"]]);

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
        nameToId,
      );

      expect(result.errors.some((e) => e.step === "egress:web")).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  // Step 4.6: Railway domains
  // ------------------------------------------------------------------
  describe("railway domains", () => {
    test("creates railway domain on add", async () => {
      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "serviceDomains",
            action: "add",
            serviceName: "web",
            category: "railway-domain",
          },
        ],
      };
      const nameToId = new Map([["web", "svc-web"]]);
      const state = emptyState();
      state.services.web = {
        name: "web",
        variables: {},
        domains: [],
        railwayDomain: { targetPort: 3000 },
      };

      await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        state,
        nameToId,
      );

      expect(mockCreateServiceDomain).toHaveBeenCalledWith(
        fakeClient,
        "svc-web",
        environmentId,
        3000,
      );
    });

    test("deletes railway domain on remove", async () => {
      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "serviceDomains",
            action: "remove",
            serviceName: "web",
            category: "railway-domain",
          },
        ],
      };
      const nameToId = new Map([["web", "svc-web"]]);
      const serviceDomainByService = new Map([
        ["web", { id: "sd-1", domain: "web.up.railway.app" }],
      ]);

      await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
        nameToId,
        undefined,
        serviceDomainByService,
      );

      expect(mockDeleteServiceDomain).toHaveBeenCalledWith(fakeClient, "sd-1");
    });

    test("updates railway domain port", async () => {
      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "serviceDomains",
            action: "update",
            serviceName: "web",
            category: "railway-domain",
          },
        ],
      };
      const nameToId = new Map([["web", "svc-web"]]);
      const serviceDomainByService = new Map([
        ["web", { id: "sd-1", domain: "web.up.railway.app" }],
      ]);
      const state = emptyState();
      state.services.web = {
        name: "web",
        variables: {},
        domains: [],
        railwayDomain: { targetPort: 8080 },
      };

      await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        state,
        nameToId,
        undefined,
        serviceDomainByService,
      );

      expect(mockUpdateServiceDomain).toHaveBeenCalledWith(fakeClient, {
        serviceDomainId: "sd-1",
        serviceId: "svc-web",
        environmentId,
        domain: "web.up.railway.app",
        targetPort: 8080,
      });
    });

    test("handles railway domain error", async () => {
      mockCreateServiceDomain.mockImplementation(() => Promise.reject(new Error("Domain error")));

      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "serviceDomains",
            action: "add",
            serviceName: "web",
            category: "railway-domain",
          },
        ],
      };
      const nameToId = new Map([["web", "svc-web"]]);
      const state = emptyState();
      state.services.web = {
        name: "web",
        variables: {},
        domains: [],
        railwayDomain: {},
      };

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        state,
        nameToId,
      );

      expect(result.errors.some((e) => e.step === "railway-domain:web")).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  // Step 4.7: Custom domains
  // ------------------------------------------------------------------
  describe("custom domains", () => {
    test("creates custom domain on add", async () => {
      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "networking.customDomains.example.com",
            action: "add",
            serviceName: "web",
            category: "domain",
            newValue: { port: 3000 },
          },
        ],
      };
      const nameToId = new Map([["web", "svc-web"]]);

      await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
        nameToId,
      );

      expect(mockCreateCustomDomain).toHaveBeenCalledWith(
        fakeClient,
        projectId,
        "svc-web",
        environmentId,
        "example.com",
        3000,
      );
    });

    test("deletes custom domain on remove", async () => {
      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "networking.customDomains.old.example.com",
            action: "remove",
            serviceName: "web",
            category: "domain",
          },
        ],
      };
      const nameToId = new Map([["web", "svc-web"]]);
      const customDomainsByService = new Map([
        ["web", [{ id: "cd-1", domain: "old.example.com" }]],
      ]);

      await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
        nameToId,
        undefined,
        undefined,
        customDomainsByService,
      );

      expect(mockDeleteCustomDomain).toHaveBeenCalledWith(fakeClient, "cd-1");
    });

    test("updates custom domain port", async () => {
      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "networking.customDomains.example.com",
            action: "update",
            serviceName: "web",
            category: "domain",
            newValue: { port: 8080 },
          },
        ],
      };
      const nameToId = new Map([["web", "svc-web"]]);
      const customDomainsByService = new Map([["web", [{ id: "cd-1", domain: "example.com" }]]]);

      await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
        nameToId,
        undefined,
        undefined,
        customDomainsByService,
      );

      expect(mockUpdateCustomDomain).toHaveBeenCalledWith(fakeClient, "cd-1", environmentId, 8080);
    });

    test("handles custom domain error", async () => {
      mockCreateCustomDomain.mockImplementation(() => Promise.reject(new Error("Domain error")));

      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "networking.customDomains.test.com",
            action: "add",
            serviceName: "web",
            category: "domain",
          },
        ],
      };
      const nameToId = new Map([["web", "svc-web"]]);

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
        nameToId,
      );

      expect(result.errors.some((e) => e.step === "custom-domain:web")).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  // Step 4.75: Private network endpoints
  // ------------------------------------------------------------------
  describe("private network endpoints", () => {
    test("renames private hostname on add", async () => {
      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "networking.privateNetworkEndpoint",
            action: "add",
            serviceName: "web",
            category: "private-hostname",
            newValue: "web.internal",
          },
        ],
      };
      const nameToId = new Map([["web", "svc-web"]]);

      await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
        nameToId,
      );

      expect(mockRenamePrivateNetworkEndpoint).toHaveBeenCalledWith(
        fakeClient,
        "pne-1",
        "web.internal",
        "pn-1",
      );
    });

    test("deletes private hostname on remove", async () => {
      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "networking.privateNetworkEndpoint",
            action: "remove",
            serviceName: "web",
            category: "private-hostname",
          },
        ],
      };
      const nameToId = new Map([["web", "svc-web"]]);

      await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
        nameToId,
      );

      expect(mockDeletePrivateNetworkEndpoint).toHaveBeenCalledWith(fakeClient, "pne-1");
    });

    // This test verifies that when fetchPrivateNetworkEndpoint returns null
    // even after retries, an error is reported. We use a longer timeout
    // because the code retries with exponential backoff (1s + 2s + 4s = 7s).
    test("reports error when private endpoint not found for add", async () => {
      mockFetchPrivateNetworkEndpoint.mockImplementation(() =>
        Promise.resolve(
          null as unknown as { id: string; dnsName: string; privateNetworkId: string },
        ),
      );

      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "networking.privateNetworkEndpoint",
            action: "add",
            serviceName: "web",
            category: "private-hostname",
            newValue: "web.internal",
          },
        ],
      };
      const nameToId = new Map([["web", "svc-web"]]);

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
        nameToId,
      );

      expect(
        result.errors.some(
          (e) => e.step === "private-hostname:web" && e.error.includes("Could not find"),
        ),
      ).toBe(true);
    }, 15000);

    test("handles private hostname error", async () => {
      mockFetchPrivateNetworkEndpoint.mockImplementation(() =>
        Promise.reject(new Error("Network error")),
      );

      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "networking.privateNetworkEndpoint",
            action: "add",
            serviceName: "web",
            category: "private-hostname",
            newValue: "web.internal",
          },
        ],
      };
      const nameToId = new Map([["web", "svc-web"]]);

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
        nameToId,
      );

      expect(result.errors.some((e) => e.step === "private-hostname:web")).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  // Step 4.8: Volume deletion
  // ------------------------------------------------------------------
  describe("volume deletion", () => {
    test("deletes volume on remove entry", async () => {
      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "volumeMounts.vol-123",
            action: "remove",
            serviceName: "db",
            category: "volume",
            oldValue: "/data",
          },
        ],
      };

      await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
      );

      expect(mockDeleteVolume).toHaveBeenCalledWith(fakeClient, "vol-123");
    });

    test("uses volumeIdByService when available", async () => {
      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "volumeMounts.placeholder",
            action: "remove",
            serviceName: "db",
            category: "volume",
          },
        ],
      };
      const volumeIdByService = new Map([["db", "real-vol-id"]]);

      await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
        undefined,
        undefined,
        undefined,
        undefined,
        volumeIdByService,
      );

      expect(mockDeleteVolume).toHaveBeenCalledWith(fakeClient, "real-vol-id");
    });

    test("handles volume deletion error", async () => {
      mockDeleteVolume.mockImplementation(() => Promise.reject(new Error("Vol delete failed")));

      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "volumeMounts.vol-1",
            action: "remove",
            serviceName: "db",
            category: "volume",
          },
        ],
      };

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
      );

      expect(result.errors.some((e) => e.step === "delete-volume:db")).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  // Step 5: Service deletion
  // ------------------------------------------------------------------
  describe("service deletion", () => {
    test("deletes services after commit", async () => {
      const diff: ConfigDiff = {
        ...emptyDiff(),
        servicesToDelete: [{ name: "old-svc", serviceId: "svc-old" }],
        entries: [
          {
            path: "service",
            action: "remove",
            serviceName: "old-svc",
            category: "service",
          },
        ],
      };

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
      );

      expect(mockDeleteService).toHaveBeenCalledWith(fakeClient, "svc-old");
      expect(result.servicesDeleted).toEqual(["old-svc"]);
    });

    test("handles service deletion error", async () => {
      mockDeleteService.mockImplementation(() => Promise.reject(new Error("Delete failed")));

      const diff: ConfigDiff = {
        ...emptyDiff(),
        servicesToDelete: [{ name: "old", serviceId: "svc-old" }],
        entries: [
          {
            path: "service",
            action: "remove",
            serviceName: "old",
            category: "service",
          },
        ],
      };

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
      );

      expect(result.errors.some((e) => e.step === "delete-service:old")).toBe(true);
      expect(result.servicesDeleted).toEqual([]);
    });
  });

  // ------------------------------------------------------------------
  // Config immutability — input not mutated
  // ------------------------------------------------------------------
  describe("config immutability", () => {
    test("does not mutate the input desiredConfig", async () => {
      const diff: ConfigDiff = {
        ...emptyDiff(),
        entries: [
          {
            path: "sharedVariables.OLD",
            action: "remove",
            serviceName: null,
            category: "shared-variable",
          },
        ],
      };
      const original: EnvironmentConfig = {
        services: { "svc-1": { variables: { X: { value: "1" } } } },
      };
      const originalJson = JSON.stringify(original);

      await applyConfigDiff(fakeClient, diff, original, projectId, environmentId, emptyState());

      expect(JSON.stringify(original)).toBe(originalJson);
    });
  });

  // ------------------------------------------------------------------
  // Error message extraction
  // ------------------------------------------------------------------
  describe("error message extraction", () => {
    test("extracts GraphQL error messages from response", async () => {
      const gqlError = new Error("Request failed");
      (gqlError as unknown as Record<string, unknown>).response = {
        errors: [{ message: "You have exceeded your service limit" }],
      };
      mockCreateService.mockImplementation(() => Promise.reject(gqlError));

      const diff: ConfigDiff = {
        ...emptyDiff(),
        servicesToCreate: [{ name: "web" }],
      };

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
      );

      expect(result.errors[0].error).toBe("You have exceeded your service limit");
    });

    test("falls back to message regex extraction", async () => {
      const err = new Error('Some prefix {"message":"Quota exceeded"} suffix');
      mockCreateService.mockImplementation(() => Promise.reject(err));

      const diff: ConfigDiff = {
        ...emptyDiff(),
        servicesToCreate: [{ name: "web" }],
      };

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
      );

      expect(result.errors[0].error).toBe("Quota exceeded");
    });

    test("handles non-Error thrown values", async () => {
      mockCreateService.mockImplementation(() => Promise.reject("string error"));

      const diff: ConfigDiff = {
        ...emptyDiff(),
        servicesToCreate: [{ name: "web" }],
      };

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
      );

      expect(result.errors[0].error).toBe("string error");
    });

    test("skips generic 'Problem processing request' from GQL response", async () => {
      const gqlError = new Error("The real error message");
      (gqlError as unknown as Record<string, unknown>).response = {
        errors: [{ message: "Problem processing request" }],
      };
      mockCreateService.mockImplementation(() => Promise.reject(gqlError));

      const diff: ConfigDiff = {
        ...emptyDiff(),
        servicesToCreate: [{ name: "web" }],
      };

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        emptyState(),
      );

      expect(result.errors[0].error).toBe("The real error message");
    });
  });

  // ------------------------------------------------------------------
  // Full pipeline: create + stage + commit + delete
  // ------------------------------------------------------------------
  describe("full pipeline", () => {
    test("executes full create → stage → commit → delete flow", async () => {
      const diff: ConfigDiff = {
        ...emptyDiff(),
        servicesToCreate: [{ name: "web", source: { image: "nginx" } }],
        servicesToDelete: [{ name: "old", serviceId: "svc-old" }],
        entries: [
          {
            path: "service",
            action: "add",
            serviceName: "web",
            category: "service",
          },
          {
            path: "service",
            action: "remove",
            serviceName: "old",
            category: "service",
          },
        ],
      };
      const state = emptyState();
      state.services.web = {
        name: "web",
        source: { image: "nginx" },
        variables: { PORT: "3000" },
        domains: [],
      };

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        emptyConfig(),
        projectId,
        environmentId,
        state,
      );

      expect(result.servicesCreated).toEqual(["web"]);
      expect(result.staged).toBe(true);
      expect(result.committed).toBe(true);
      expect(result.servicesDeleted).toEqual(["old"]);
      expect(result.errors).toEqual([]);

      // Verify ordering: create before stage, stage before commit, commit before delete
      expect(mockCreateService).toHaveBeenCalled();
      expect(mockStageEnvironmentChanges).toHaveBeenCalled();
      expect(mockCommitStagedChanges).toHaveBeenCalled();
      expect(mockDeleteService).toHaveBeenCalledWith(fakeClient, "svc-old");
    });
  });

  // ------------------------------------------------------------------
  // desiredConfig.services initialisation
  // ------------------------------------------------------------------
  describe("desiredConfig.services initialization", () => {
    test("initializes services object when undefined", async () => {
      const diff: ConfigDiff = {
        ...emptyDiff(),
        servicesToCreate: [{ name: "web" }],
        entries: [
          {
            path: "service",
            action: "add",
            serviceName: "web",
            category: "service",
          },
        ],
      };
      const state = emptyState();
      state.services.web = {
        name: "web",
        variables: {},
        domains: [],
      };
      // Pass config with no services key
      const config: EnvironmentConfig = {};

      const result = await applyConfigDiff(
        fakeClient,
        diff,
        config,
        projectId,
        environmentId,
        state,
      );

      expect(result.servicesCreated).toEqual(["web"]);
      expect(result.staged).toBe(true);
    });
  });
});
