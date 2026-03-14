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
          domains: [{ domain: "app.example.com" }],
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
          domains: [{ domain: "app.example.com" }],
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
          domains: [{ domain: "old.example.com" }],
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
          domains: [{ domain: "a.example.com" }, { domain: "b.example.com" }],
        },
      },
    });
    const current = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [{ domain: "a.example.com" }, { domain: "c.example.com" }],
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

  // --- Group 1: Scalar settings ---

  test("builder change detected", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          builder: "NIXPACKS",
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
          builder: "DOCKERFILE",
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});
    const update = changeset.changes.find((c) => c.type === "update-service-settings");
    expect(update).toBeDefined();
    if (update?.type === "update-service-settings") {
      expect(update.settings.builder).toBe("NIXPACKS");
    }
  });

  test("watchPatterns change detected (uses deepEqual)", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          watchPatterns: ["src/**", "package.json"],
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
          watchPatterns: ["src/**"],
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});
    const update = changeset.changes.find((c) => c.type === "update-service-settings");
    expect(update).toBeDefined();
    if (update?.type === "update-service-settings") {
      expect(update.settings.watchPatterns).toEqual(["src/**", "package.json"]);
    }
  });

  test("drainingSeconds change detected", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          drainingSeconds: 60,
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
          drainingSeconds: 30,
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});
    const update = changeset.changes.find((c) => c.type === "update-service-settings");
    expect(update).toBeDefined();
    if (update?.type === "update-service-settings") {
      expect(update.settings.drainingSeconds).toBe(60);
    }
  });

  test("overlapSeconds change detected", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          overlapSeconds: 10,
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
          overlapSeconds: 5,
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});
    const update = changeset.changes.find((c) => c.type === "update-service-settings");
    expect(update).toBeDefined();
    if (update?.type === "update-service-settings") {
      expect(update.settings.overlapSeconds).toBe(10);
    }
  });

  test("ipv6EgressEnabled change detected", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          ipv6EgressEnabled: true,
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
          ipv6EgressEnabled: false,
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});
    const update = changeset.changes.find((c) => c.type === "update-service-settings");
    expect(update).toBeDefined();
    if (update?.type === "update-service-settings") {
      expect(update.settings.ipv6EgressEnabled).toBe(true);
    }
  });

  test("removing builder/watchPatterns/etc from config generates null clear", () => {
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
          builder: "NIXPACKS",
          watchPatterns: ["src/**"],
          drainingSeconds: 30,
          overlapSeconds: 5,
          ipv6EgressEnabled: true,
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});
    const update = changeset.changes.find((c) => c.type === "update-service-settings");
    expect(update).toBeDefined();
    if (update?.type === "update-service-settings") {
      expect(update.settings.builder).toBeNull();
      expect(update.settings.watchPatterns).toBeNull();
      expect(update.settings.drainingSeconds).toBeNull();
      expect(update.settings.overlapSeconds).toBeNull();
      expect(update.settings.ipv6EgressEnabled).toBeNull();
    }
  });

  // --- Group 2: Branch ---

  test("new service with branch includes it in create-service change", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          source: { repo: "myorg/myrepo" },
          variables: {},
          domains: [],
          branch: "develop",
        },
      },
    });
    const current = makeState();

    const changeset = computeChangeset(desired, current, {}, [], {});
    const create = changeset.changes.find((c) => c.type === "create-service");
    expect(create).toBeDefined();
    if (create?.type === "create-service") {
      expect(create.branch).toBe("develop");
    }
  });

  test("existing service with changed branch generates update-deployment-trigger", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          source: { repo: "myorg/myrepo" },
          variables: {},
          domains: [],
          branch: "staging",
        },
      },
    });
    const current = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          source: { repo: "myorg/myrepo" },
          variables: {},
          domains: [],
          branch: "main",
          deploymentTriggerId: "trigger-1",
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});
    const trigger = changeset.changes.find((c) => c.type === "update-deployment-trigger");
    expect(trigger).toBeDefined();
    if (trigger?.type === "update-deployment-trigger") {
      expect(trigger.branch).toBe("staging");
      expect(trigger.serviceId).toBe("svc-1");
      expect(trigger.triggerId).toBe("trigger-1");
    }
  });

  test("no change when branch matches", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          source: { repo: "myorg/myrepo" },
          variables: {},
          domains: [],
          branch: "main",
        },
      },
    });
    const current = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          source: { repo: "myorg/myrepo" },
          variables: {},
          domains: [],
          branch: "main",
          deploymentTriggerId: "trigger-1",
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});
    const trigger = changeset.changes.find((c) => c.type === "update-deployment-trigger");
    expect(trigger).toBeUndefined();
  });

  // --- Group 3: Registry credentials ---

  test("new service with registryCredentials includes it in create-service", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          source: { image: "registry.example.com/app:latest" },
          variables: {},
          domains: [],
          registryCredentials: { username: "user", password: "pass" },
        },
      },
    });
    const current = makeState();

    const changeset = computeChangeset(desired, current, {}, [], {});
    const create = changeset.changes.find((c) => c.type === "create-service");
    expect(create).toBeDefined();
    if (create?.type === "create-service") {
      expect(create.registryCredentials).toEqual({ username: "user", password: "pass" });
    }
    // Also generates update-service-settings with registryCredentials
    const update = changeset.changes.find((c) => c.type === "update-service-settings");
    expect(update).toBeDefined();
    if (update?.type === "update-service-settings") {
      expect(update.settings.registryCredentials).toEqual({ username: "user", password: "pass" });
    }
  });

  test("existing service with registryCredentials always generates settings update", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          source: { image: "registry.example.com/app:latest" },
          variables: {},
          domains: [],
          registryCredentials: { username: "user", password: "pass" },
        },
      },
    });
    const current = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          source: { image: "registry.example.com/app:latest" },
          variables: {},
          domains: [],
          // registryCredentials not in current state (can't be read back from API)
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});
    const update = changeset.changes.find((c) => c.type === "update-service-settings");
    expect(update).toBeDefined();
    if (update?.type === "update-service-settings") {
      expect(update.settings.registryCredentials).toEqual({ username: "user", password: "pass" });
    }
  });

  test("no change when registryCredentials absent from both", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          source: { image: "nginx:latest" },
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
          source: { image: "nginx:latest" },
          variables: {},
          domains: [],
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});
    expect(changeset.changes).toEqual([]);
  });

  // --- Group 4A: Domains ---

  test("domain with targetPort creates domain with targetPort", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [{ domain: "app.example.com", targetPort: 8080 }],
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
      expect(dom.domain).toBe("app.example.com");
      expect(dom.targetPort).toBe(8080);
    }
  });

  test("domain targetPort change generates delete + create", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [{ domain: "app.example.com", targetPort: 9090 }],
        },
      },
    });
    const current = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [{ domain: "app.example.com", targetPort: 8080 }],
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {
      web: [{ id: "dom-1", domain: "app.example.com", targetPort: 8080 }],
    });

    const del = changeset.changes.find((c) => c.type === "delete-domain");
    expect(del).toBeDefined();
    if (del?.type === "delete-domain") {
      expect(del.domain).toBe("app.example.com");
      expect(del.domainId).toBe("dom-1");
    }

    const create = changeset.changes.find((c) => c.type === "create-domain");
    expect(create).toBeDefined();
    if (create?.type === "create-domain") {
      expect(create.domain).toBe("app.example.com");
      expect(create.targetPort).toBe(9090);
    }
  });

  test("railway domain: desired has railway_domain, current doesn't → create-service-domain", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          railwayDomain: { targetPort: 3000 },
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

    const changeset = computeChangeset(
      desired,
      current,
      {},
      [],
      {},
      undefined,
      undefined,
      undefined,
    );
    const create = changeset.changes.find((c) => c.type === "create-service-domain");
    expect(create).toBeDefined();
    if (create?.type === "create-service-domain") {
      expect(create.serviceName).toBe("web");
      expect(create.targetPort).toBe(3000);
    }
  });

  test("railway domain: desired doesn't, current has one → delete-service-domain", () => {
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
          railwayDomain: { targetPort: 3000 },
        },
      },
    });

    const changeset = computeChangeset(
      desired,
      current,
      {},
      [],
      {},
      undefined,
      { web: { id: "sdom-1", domain: "web-production.up.railway.app" } },
      undefined,
    );
    const del = changeset.changes.find((c) => c.type === "delete-service-domain");
    expect(del).toBeDefined();
    if (del?.type === "delete-service-domain") {
      expect(del.serviceName).toBe("web");
      expect(del.domainId).toBe("sdom-1");
    }
  });

  test("railway domain: both have → no change", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          railwayDomain: { targetPort: 3000 },
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
          railwayDomain: { targetPort: 3000 },
        },
      },
    });

    const changeset = computeChangeset(
      desired,
      current,
      {},
      [],
      {},
      undefined,
      { web: { id: "sdom-1", domain: "web-production.up.railway.app" } },
      undefined,
    );
    const serviceDomainChanges = changeset.changes.filter(
      (c) => c.type === "create-service-domain" || c.type === "delete-service-domain",
    );
    expect(serviceDomainChanges).toEqual([]);
  });

  // --- Group 4B: TCP proxies ---

  test("desired has tcp ports, current doesn't → create-tcp-proxy for each", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          tcpProxies: [5432, 6379],
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

    const changeset = computeChangeset(desired, current, {}, [], {}, undefined, undefined, {});
    const creates = changeset.changes.filter((c) => c.type === "create-tcp-proxy");
    expect(creates.length).toBe(2);
    const ports = creates.map((c) => (c as { applicationPort: number }).applicationPort).sort();
    expect(ports).toEqual([5432, 6379]);
  });

  test("current has tcp ports, desired doesn't → delete-tcp-proxy for each", () => {
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
          tcpProxies: [5432, 6379],
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {}, undefined, undefined, {
      web: [
        { id: "tcp-1", applicationPort: 5432 },
        { id: "tcp-2", applicationPort: 6379 },
      ],
    });
    const deletes = changeset.changes.filter((c) => c.type === "delete-tcp-proxy");
    expect(deletes.length).toBe(2);
    const proxyIds = deletes.map((c) => (c as { proxyId: string }).proxyId).sort();
    expect(proxyIds).toEqual(["tcp-1", "tcp-2"]);
  });

  test("mixed tcp proxies: some to create, some to delete, some matching", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          tcpProxies: [5432, 8080],
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
          tcpProxies: [5432, 6379],
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {}, undefined, undefined, {
      web: [
        { id: "tcp-1", applicationPort: 5432 },
        { id: "tcp-2", applicationPort: 6379 },
      ],
    });

    // 8080 should be created
    const creates = changeset.changes.filter((c) => c.type === "create-tcp-proxy");
    expect(creates.length).toBe(1);
    if (creates[0].type === "create-tcp-proxy") {
      expect(creates[0].applicationPort).toBe(8080);
    }

    // 6379 should be deleted
    const deletes = changeset.changes.filter((c) => c.type === "delete-tcp-proxy");
    expect(deletes.length).toBe(1);
    if (deletes[0].type === "delete-tcp-proxy") {
      expect(deletes[0].proxyId).toBe("tcp-2");
    }
  });

  // --- Group 4C: Resource limits ---

  test("limits change detected → update-service-limits", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          limits: { memoryGB: 4, vCPUs: 2 },
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
          limits: { memoryGB: 2, vCPUs: 1 },
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});
    const update = changeset.changes.find((c) => c.type === "update-service-limits");
    expect(update).toBeDefined();
    if (update?.type === "update-service-limits") {
      expect(update.limits.memoryGB).toBe(4);
      expect(update.limits.vCPUs).toBe(2);
    }
  });

  test("no change when limits match", () => {
    const desired = makeState({
      services: {
        web: {
          name: "web",
          id: "svc-1",
          variables: {},
          domains: [],
          limits: { memoryGB: 2, vCPUs: 1 },
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
          limits: { memoryGB: 2, vCPUs: 1 },
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});
    const limitsChanges = changeset.changes.filter((c) => c.type === "update-service-limits");
    expect(limitsChanges).toEqual([]);
  });

  test("limits removal generates update-service-limits", () => {
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
          limits: { memoryGB: 4, vCPUs: 2 },
        },
      },
    });

    const changeset = computeChangeset(desired, current, {}, [], {});
    const update = changeset.changes.find((c) => c.type === "update-service-limits");
    expect(update).toBeDefined();
    if (update?.type === "update-service-limits") {
      expect(update.limits.memoryGB).toBeNull();
      expect(update.limits.vCPUs).toBeNull();
    }
  });

  // --- New service creation with all new features ---

  test("new service with all new features generates correct changes", () => {
    const desired = makeState({
      services: {
        api: {
          name: "api",
          source: { image: "registry.example.com/api:latest" },
          variables: { PORT: "3000" },
          domains: [{ domain: "api.example.com", targetPort: 3000 }],
          branch: "main",
          registryCredentials: { username: "user", password: "pass" },
          railwayDomain: { targetPort: 3000 },
          tcpProxies: [5432, 6379],
          limits: { memoryGB: 4, vCPUs: 2 },
          builder: "NIXPACKS",
          watchPatterns: ["src/**"],
          drainingSeconds: 30,
          overlapSeconds: 5,
          ipv6EgressEnabled: true,
        },
      },
    });
    const current = makeState();

    const changeset = computeChangeset(desired, current, {}, [], {});

    // create-service with branch and registryCredentials
    const create = changeset.changes.find((c) => c.type === "create-service");
    expect(create).toBeDefined();
    if (create?.type === "create-service") {
      expect(create.branch).toBe("main");
      expect(create.registryCredentials).toEqual({ username: "user", password: "pass" });
    }

    // variables
    const vars = changeset.changes.find((c) => c.type === "upsert-variables");
    expect(vars).toBeDefined();

    // custom domain with targetPort
    const dom = changeset.changes.find((c) => c.type === "create-domain");
    expect(dom).toBeDefined();
    if (dom?.type === "create-domain") {
      expect(dom.domain).toBe("api.example.com");
      expect(dom.targetPort).toBe(3000);
    }

    // railway domain
    const sdom = changeset.changes.find((c) => c.type === "create-service-domain");
    expect(sdom).toBeDefined();
    if (sdom?.type === "create-service-domain") {
      expect(sdom.targetPort).toBe(3000);
    }

    // TCP proxies
    const tcpCreates = changeset.changes.filter((c) => c.type === "create-tcp-proxy");
    expect(tcpCreates.length).toBe(2);
    const tcpPorts = tcpCreates
      .map((c) => (c as { applicationPort: number }).applicationPort)
      .sort();
    expect(tcpPorts).toEqual([5432, 6379]);

    // update-service-settings with new scalar settings and registryCredentials
    const update = changeset.changes.find((c) => c.type === "update-service-settings");
    expect(update).toBeDefined();
    if (update?.type === "update-service-settings") {
      expect(update.settings.builder).toBe("NIXPACKS");
      expect(update.settings.watchPatterns).toEqual(["src/**"]);
      expect(update.settings.drainingSeconds).toBe(30);
      expect(update.settings.overlapSeconds).toBe(5);
      expect(update.settings.ipv6EgressEnabled).toBe(true);
      expect(update.settings.registryCredentials).toEqual({ username: "user", password: "pass" });
    }

    // Note: limits for new services are handled via update-service-settings or a separate mechanism;
    // the diff doesn't produce update-service-limits for new services since they have no current.id
  });
});
