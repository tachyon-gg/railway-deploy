import { describe, expect, test } from "bun:test";
import { computeChangeset } from "../src/reconcile/diff.js";
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

describe("computeChangeset", () => {
  test("returns empty changeset when states match", () => {
    const state = makeState({
      sharedVariables: { APP_ENV: "alpha" },
      services: {
        web: {
          name: "web",
          id: "svc-1",
          source: { image: "nginx:latest" },
          variables: { PORT: "3000" },
          domains: [],
        },
      },
    });

    const changeset = computeChangeset(state, state, {}, [], {});
    expect(changeset.changes).toEqual([]);
  });

  test("creates service when missing from current state", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          source: { image: "nginx:latest" },
          variables: { PORT: "3000" },
          domains: ["app.example.com"],
        },
      },
    });
    const current = makeState();

    const changeset = computeChangeset(desired, current, {}, [], {});

    const createSvc = changeset.changes.find((c) => c.type === "create-service");
    expect(createSvc).toBeDefined();
    expect(createSvc?.type).toBe("create-service");
    if (createSvc?.type === "create-service") {
      expect(createSvc?.name).toBe("web");
      expect(createSvc?.source).toEqual({ image: "nginx:latest" });
    }

    const upsertVars = changeset.changes.find((c) => c.type === "upsert-variables");
    expect(upsertVars).toBeDefined();
    if (upsertVars?.type === "upsert-variables") {
      expect(upsertVars?.variables).toEqual({ PORT: "3000" });
    }

    // Domain should be created for new service
    const createDomain = changeset.changes.find((c) => c.type === "create-domain");
    expect(createDomain).toBeDefined();
    if (createDomain?.type === "create-domain") {
      expect(createDomain?.domain).toBe("app.example.com");
    }
  });

  test("deletes service when missing from desired state", () => {
    const desired = makeState();
    const current = makeState({
      services: {
        old: {
          name: "old",
          id: "svc-old",
          variables: {},
          domains: [],
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});
    const del = changeset.changes.find((c) => c.type === "delete-service");
    expect(del).toBeDefined();
    if (del?.type === "delete-service") {
      expect(del?.name).toBe("old");
      expect(del?.serviceId).toBe("svc-old");
    }
  });

  test("upserts changed variables", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: { PORT: "8080", NEW: "val" },
          domains: [],
        },
      },
    });
    const current = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: { PORT: "3000", OLD: "gone" },
          domains: [],
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});

    const upsert = changeset.changes.find((c) => c.type === "upsert-variables");
    expect(upsert).toBeDefined();
    if (upsert?.type === "upsert-variables") {
      expect(upsert?.variables).toEqual({ PORT: "8080", NEW: "val" });
    }

    const del = changeset.changes.find((c) => c.type === "delete-variables");
    expect(del).toBeDefined();
    if (del?.type === "delete-variables") {
      expect(del?.variableNames).toContain("OLD");
    }
  });

  test("handles explicitly deleted variables (null in YAML)", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: { KEEP: "yes" },
          domains: [],
        },
      },
    });
    const current = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: { KEEP: "yes", EXPLICIT_DEL: "was here" },
          domains: [],
        },
      },
    });

    const changeset = computeChangeset(desired, current, { web: ["EXPLICIT_DEL"] }, [], {});

    const del = changeset.changes.find((c) => c.type === "delete-variables");
    expect(del).toBeDefined();
    if (del?.type === "delete-variables") {
      expect(del?.variableNames).toContain("EXPLICIT_DEL");
    }
  });

  test("diffs shared variables", () => {
    const desired = makeState({ sharedVariables: { APP: "alpha", NEW: "v" } });
    const current = makeState({ sharedVariables: { APP: "beta", OLD: "x" } });

    const changeset = computeChangeset(desired, current, {}, [], {});

    const upsert = changeset.changes.find((c) => c.type === "upsert-shared-variables");
    expect(upsert).toBeDefined();
    if (upsert?.type === "upsert-shared-variables") {
      expect(upsert?.variables).toEqual({ APP: "alpha", NEW: "v" });
    }

    const del = changeset.changes.find((c) => c.type === "delete-shared-variables");
    expect(del).toBeDefined();
    if (del?.type === "delete-shared-variables") {
      expect(del?.variableNames).toContain("OLD");
    }
  });

  test("creates domain when missing", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: ["app.example.com"],
        },
      },
    });
    const current = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});
    const dom = changeset.changes.find((c) => c.type === "create-domain");
    expect(dom).toBeDefined();
    if (dom?.type === "create-domain") {
      expect(dom?.domain).toBe("app.example.com");
    }
  });

  test("deletes domain not in desired state", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
        },
      },
    });
    const current = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: ["old.example.com"],
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {
      web: [{ id: "dom-1", domain: "old.example.com" }],
    });

    const del = changeset.changes.find((c) => c.type === "delete-domain");
    expect(del).toBeDefined();
    if (del?.type === "delete-domain") {
      expect(del?.domain).toBe("old.example.com");
      expect(del?.domainId).toBe("dom-1");
    }
  });

  test("detects service settings changes", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          source: { image: "nginx:v2" },
          cronSchedule: "*/10 * * * *",
        },
      },
    });
    const current = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          source: { image: "nginx:v1" },
          cronSchedule: "*/5 * * * *",
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});
    const update = changeset.changes.find((c) => c.type === "update-service-settings");
    expect(update).toBeDefined();
    if (update?.type === "update-service-settings") {
      expect(update?.settings.source).toEqual({ image: "nginx:v2" });
      expect(update?.settings.cronSchedule).toBe("*/10 * * * *");
    }
  });

  test("creates service with volume and cron", () => {
    const desired = makeState({
      services: {
        worker: {
          name: "worker",
          variables: {},
          domains: [],
          volume: { mount: "/data", name: "vol" },
          cronSchedule: "*/5 * * * *",
        },
      },
    });
    const current = makeState();

    const changeset = computeChangeset(desired, current, {}, [], {});
    const create = changeset.changes.find((c) => c.type === "create-service");
    expect(create).toBeDefined();
    if (create?.type === "create-service") {
      expect(create?.volume).toEqual({ mount: "/data", name: "vol" });
      expect(create?.cronSchedule).toBe("*/5 * * * *");
    }
  });

  // --- New tests ---

  test("RAILWAY_* variables are filtered from diff", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: { APP: "yes" },
          domains: [],
        },
      },
    });
    const current = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: { APP: "yes", RAILWAY_SERVICE_ID: "xxx", RAILWAY_ENVIRONMENT: "prod" },
          domains: [],
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});
    // RAILWAY_* vars should NOT be deleted
    expect(changeset.changes).toEqual([]);
  });

  test("deep equality with different key orderings produces no diff", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          source: { image: "nginx:latest", repo: undefined },
          healthcheck: { path: "/health", timeout: 300 },
        },
      },
    });
    const current = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          // Same values but potentially different key order
          source: { repo: undefined, image: "nginx:latest" },
          healthcheck: { timeout: 300, path: "/health" },
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});
    expect(changeset.changes).toEqual([]);
  });

  test("multiple domains diff — create, delete, no-op", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: ["a.example.com", "b.example.com"],
        },
      },
    });
    const current = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: ["a.example.com", "c.example.com"],
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {
      web: [
        { id: "dom-a", domain: "a.example.com" },
        { id: "dom-c", domain: "c.example.com" },
      ],
    });

    // b.example.com should be created
    const createDomains = changeset.changes.filter((c) => c.type === "create-domain");
    expect(createDomains.length).toBe(1);
    if (createDomains[0].type === "create-domain") {
      expect(createDomains[0].domain).toBe("b.example.com");
    }

    // c.example.com should be deleted
    const deleteDomains = changeset.changes.filter((c) => c.type === "delete-domain");
    expect(deleteDomains.length).toBe(1);
    if (deleteDomains[0].type === "delete-domain") {
      expect(deleteDomains[0].domain).toBe("c.example.com");
    }
  });

  test("empty config produces no changes against empty state", () => {
    const desired = makeState();
    const current = makeState();

    const changeset = computeChangeset(desired, current, {}, [], {});
    expect(changeset.changes).toEqual([]);
  });

  test("service without ID is not deleted", () => {
    const desired = makeState();
    const current = makeState({
      services: {
        orphan: {
          name: "orphan",
          variables: {},
          domains: [],
          // No id — should not trigger delete
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});
    const deletes = changeset.changes.filter((c) => c.type === "delete-service");
    expect(deletes).toEqual([]);
  });

  test("volume removal produces delete-volume change", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          // No volume in desired
        },
      },
    });
    const current = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          volume: { mount: "/data", name: "vol" },
        },
      },
    });

    const changeset = computeChangeset(
      desired,
      current,
      {},
      [],
      {},
      {
        web: { volumeId: "vol-1", mount: "/data", name: "vol" },
      },
    );

    const volDel = changeset.changes.find((c) => c.type === "delete-volume");
    expect(volDel).toBeDefined();
    if (volDel?.type === "delete-volume") {
      expect(volDel?.volumeId).toBe("vol-1");
      expect(volDel?.serviceName).toBe("web");
    }
  });

  test("bucket diff — creates missing buckets", () => {
    const desired = makeState({
      buckets: {
        "my-bucket": { id: "", name: "my-bucket" },
      },
    });
    const current = makeState();

    const changeset = computeChangeset(desired, current, {}, [], {});
    const create = changeset.changes.find((c) => c.type === "create-bucket");
    expect(create).toBeDefined();
    if (create?.type === "create-bucket") {
      expect(create?.bucketName).toBe("my-bucket");
    }
  });

  test("bucket diff — no-op when bucket exists", () => {
    const desired = makeState({
      buckets: {
        "my-bucket": { id: "", name: "my-bucket" },
      },
    });
    const current = makeState({
      buckets: {
        "my-bucket": { id: "bucket-1", name: "my-bucket" },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});
    const bucketChanges = changeset.changes.filter(
      (c) => c.type === "create-bucket" || c.type === "delete-bucket",
    );
    expect(bucketChanges).toEqual([]);
  });

  test("detects volume mount change (delete + create)", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          volume: { mount: "/new-data", name: "vol" },
        },
      },
    });
    const current = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          volume: { mount: "/data", name: "vol" },
        },
      },
    });

    const changeset = computeChangeset(
      desired,
      current,
      {},
      [],
      {},
      { web: { volumeId: "vol-1", mount: "/data", name: "vol" } },
    );

    const volDel = changeset.changes.find((c) => c.type === "delete-volume");
    expect(volDel).toBeDefined();
    const volCreate = changeset.changes.find((c) => c.type === "create-volume");
    expect(volCreate).toBeDefined();
    if (volCreate?.type === "create-volume") {
      expect(volCreate.mount).toBe("/new-data");
    }
  });

  test("detects volume name change (delete + create)", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          volume: { mount: "/data", name: "new-vol" },
        },
      },
    });
    const current = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          volume: { mount: "/data", name: "vol" },
        },
      },
    });

    const changeset = computeChangeset(
      desired,
      current,
      {},
      [],
      {},
      { web: { volumeId: "vol-1", mount: "/data", name: "vol" } },
    );

    const volDel = changeset.changes.find((c) => c.type === "delete-volume");
    expect(volDel).toBeDefined();
    const volCreate = changeset.changes.find((c) => c.type === "create-volume");
    expect(volCreate).toBeDefined();
    if (volCreate?.type === "create-volume") {
      expect(volCreate.name).toBe("new-vol");
    }
  });

  test("no volume change when volume matches", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          volume: { mount: "/data", name: "vol" },
        },
      },
    });
    const current = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          volume: { mount: "/data", name: "vol" },
        },
      },
    });

    const changeset = computeChangeset(
      desired,
      current,
      {},
      [],
      {},
      { web: { volumeId: "vol-1", mount: "/data", name: "vol" } },
    );

    const volChanges = changeset.changes.filter(
      (c) => c.type === "delete-volume" || c.type === "create-volume",
    );
    expect(volChanges).toEqual([]);
  });

  test("adds volume when desired has volume but current doesn't", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          volume: { mount: "/data", name: "vol" },
        },
      },
    });
    const current = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});

    const volCreate = changeset.changes.find((c) => c.type === "create-volume");
    expect(volCreate).toBeDefined();
    if (volCreate?.type === "create-volume") {
      expect(volCreate.mount).toBe("/data");
      expect(volCreate.name).toBe("vol");
    }
  });

  test("removing healthcheck from config generates null clear", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          // No healthcheck in desired
        },
      },
    });
    const current = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          healthcheck: { path: "/health", timeout: 300 },
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});
    const update = changeset.changes.find((c) => c.type === "update-service-settings");
    expect(update).toBeDefined();
    if (update?.type === "update-service-settings") {
      expect(update.settings.healthcheck).toBeNull();
    }
  });

  test("removing restartPolicy from config generates null clear", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
        },
      },
    });
    const current = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          restartPolicy: "ALWAYS",
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});
    const update = changeset.changes.find((c) => c.type === "update-service-settings");
    expect(update).toBeDefined();
    if (update?.type === "update-service-settings") {
      expect(update.settings.restartPolicy).toBeNull();
    }
  });

  test("removing source from config generates null clear", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
        },
      },
    });
    const current = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          source: { image: "nginx:latest" },
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});
    const update = changeset.changes.find((c) => c.type === "update-service-settings");
    expect(update).toBeDefined();
    if (update?.type === "update-service-settings") {
      expect(update.settings.source).toBeNull();
    }
  });

  test("removing cronSchedule from config generates null clear", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
        },
      },
    });
    const current = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          cronSchedule: "*/5 * * * *",
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});
    const update = changeset.changes.find((c) => c.type === "update-service-settings");
    expect(update).toBeDefined();
    if (update?.type === "update-service-settings") {
      expect(update.settings.cronSchedule).toBeNull();
    }
  });

  test("removing startCommand from config generates null clear", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
        },
      },
    });
    const current = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          startCommand: "npm start",
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});
    const update = changeset.changes.find((c) => c.type === "update-service-settings");
    expect(update).toBeDefined();
    if (update?.type === "update-service-settings") {
      expect(update.settings.startCommand).toBeNull();
    }
  });

  test("removing region from config generates null clear", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
        },
      },
    });
    const current = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          region: { region: "us-east-1", numReplicas: 1 },
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});
    const update = changeset.changes.find((c) => c.type === "update-service-settings");
    expect(update).toBeDefined();
    if (update?.type === "update-service-settings") {
      expect(update.settings.region).toBeNull();
    }
  });

  test("no changes when both desired and current lack optional fields", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
        },
      },
    });
    const current = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});
    expect(changeset.changes).toEqual([]);
  });

  test("detects dockerfilePath change", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          dockerfilePath: "Dockerfile.prod",
        },
      },
    });
    const current = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          dockerfilePath: "Dockerfile",
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});
    const update = changeset.changes.find((c) => c.type === "update-service-settings");
    expect(update).toBeDefined();
    if (update?.type === "update-service-settings") {
      expect(update.settings.dockerfilePath).toBe("Dockerfile.prod");
    }
  });

  test("preDeployCommand compared as array with deepEqual", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          preDeployCommand: ["npm run migrate"],
        },
      },
    });
    const current = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          preDeployCommand: ["npm run migrate"],
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});
    expect(changeset.changes).toEqual([]);
  });

  test("preDeployCommand change detected when arrays differ", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          preDeployCommand: ["npm run migrate", "npm run seed"],
        },
      },
    });
    const current = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          preDeployCommand: ["npm run migrate"],
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});
    const update = changeset.changes.find((c) => c.type === "update-service-settings");
    expect(update).toBeDefined();
    if (update?.type === "update-service-settings") {
      expect(update.settings.preDeployCommand).toEqual(["npm run migrate", "npm run seed"]);
    }
  });

  test("new service includes settings in update-service-settings change", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          variables: {},
          domains: [],
          source: { image: "nginx:latest" },
          startCommand: "npm start",
          buildCommand: "npm run build",
          restartPolicy: "ON_FAILURE",
        },
      },
    });
    const current = makeState();

    const changeset = computeChangeset(desired, current, {}, [], {});
    const create = changeset.changes.find((c) => c.type === "create-service");
    expect(create).toBeDefined();

    const update = changeset.changes.find((c) => c.type === "update-service-settings");
    expect(update).toBeDefined();
    if (update?.type === "update-service-settings") {
      expect(update?.settings.startCommand).toBe("npm start");
      expect(update?.settings.buildCommand).toBe("npm run build");
      expect(update?.settings.restartPolicy).toBe("ON_FAILURE");
      expect(update?.serviceId).toBe(""); // Resolved at apply time
    }
  });

  test("detects new service settings changes (startCommand, buildCommand, etc.)", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          startCommand: "npm start",
          buildCommand: "npm run build",
          rootDirectory: "/app",
          sleepApplication: true,
        },
      },
    });
    const current = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});
    const update = changeset.changes.find((c) => c.type === "update-service-settings");
    expect(update).toBeDefined();
    if (update?.type === "update-service-settings") {
      expect(update?.settings.startCommand).toBe("npm start");
      expect(update?.settings.buildCommand).toBe("npm run build");
      expect(update?.settings.rootDirectory).toBe("/app");
      expect(update?.settings.sleepApplication).toBe(true);
    }
  });
});
