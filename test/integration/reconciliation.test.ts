import { afterAll, beforeAll, describe, expect } from "bun:test";
import { rmSync, writeFileSync } from "fs";
import { join } from "path";
import { loadProjectConfig } from "../../src/config/loader.js";
import { fetchEnvironmentConfig, fetchServiceMap } from "../../src/railway/queries.js";
import { applyConfigDiff } from "../../src/reconcile/apply.js";
import { buildEnvironmentConfig } from "../../src/reconcile/config.js";
import type { DiffContext } from "../../src/reconcile/diff.js";
import { computeConfigDiff } from "../../src/reconcile/diff.js";
import { printConfigDiff } from "../../src/reconcile/format.js";
import {
  client,
  createTestEnvironment,
  deleteTestEnvironment,
  ENV_ID,
  FIXTURE_DIR,
  hasToken,
  initClient,
  itif,
  PROJECT_ID,
  PROJECT_NAME,
  SERVICES_DIR,
  setupFixtures,
  TEST_ENV_NAME,
  TEST_PREFIX,
} from "./helpers.js";

beforeAll(async () => {
  initClient();
  if (hasToken) {
    setupFixtures();
    await createTestEnvironment();
  }
});

afterAll(async () => {
  if (hasToken) {
    await deleteTestEnvironment();
  }
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

/** Helper: run the full pipeline (load → build → diff → apply) and return the diff + result */
async function runPipeline(configPath: string) {
  const { state, deletedVars, deletedSharedVars, allServiceNames } = loadProjectConfig(
    configPath,
    TEST_ENV_NAME,
  );
  state.projectId = PROJECT_ID;
  state.environmentId = ENV_ID;

  const serviceMap = await fetchServiceMap(client, PROJECT_ID, ENV_ID);
  const currentConfig = await fetchEnvironmentConfig(client, ENV_ID);

  const desiredConfig = buildEnvironmentConfig(state, {
    serviceNameToId: serviceMap.serviceNameToId,
    volumeIdByService: serviceMap.volumeIdByService,
  });

  const ctx: DiffContext = {
    serviceIdToName: serviceMap.serviceIdToName,
    desiredState: state,
    allServiceNames,
    deletedSharedVars,
    deletedVars,
  };
  const diff = computeConfigDiff(desiredConfig, currentConfig, ctx);
  printConfigDiff(diff);

  const result = await applyConfigDiff(
    client,
    diff,
    desiredConfig,
    PROJECT_ID,
    ENV_ID,
    state,
    serviceMap.serviceNameToId,
  );
  // Railway config propagation is async — wait for changes to appear
  await new Promise((r) => setTimeout(r, 3000));
  return { diff, result, state };
}

/** Helper: check convergence (re-run pipeline, should have no changes) */
async function assertConverged(configPath: string) {
  const { state, deletedVars, deletedSharedVars, allServiceNames } = loadProjectConfig(
    configPath,
    TEST_ENV_NAME,
  );
  state.projectId = PROJECT_ID;
  state.environmentId = ENV_ID;

  const serviceMap = await fetchServiceMap(client, PROJECT_ID, ENV_ID);
  const currentConfig = await fetchEnvironmentConfig(client, ENV_ID);

  const desiredConfig = buildEnvironmentConfig(state, {
    serviceNameToId: serviceMap.serviceNameToId,
    volumeIdByService: serviceMap.volumeIdByService,
  });

  const ctx: DiffContext = {
    serviceIdToName: serviceMap.serviceIdToName,
    desiredState: state,
    allServiceNames,
    deletedSharedVars,
    deletedVars,
  };
  const diff = computeConfigDiff(desiredConfig, currentConfig, ctx);

  // Filter out registry credentials (never returned by Railway) and
  // fields Railway sets automatically that we don't manage
  const ignorePaths = new Set(["deploy.registryCredentials"]);
  const actionable = diff.entries.filter((e) => !ignorePaths.has(e.path));

  return {
    actionable,
    servicesToCreate: diff.servicesToCreate,
    servicesToDelete: diff.servicesToDelete,
  };
}

describe("Railway Integration — full reconciliation", () => {
  let testNum = 0;
  function svcName(base: string) {
    return `${TEST_PREFIX}-r${testNum}-${base}`;
  }

  itif(hasToken)("creates service from config and reaches convergence", async () => {
    testNum++;
    const configPath = join(FIXTURE_DIR, "basic.yaml");
    writeFileSync(
      configPath,
      `project: ${PROJECT_NAME}
environments:
  - ${TEST_ENV_NAME}
services:
  ${svcName("web")}:
    source:
      image: nginx:latest
    variables:
      PORT: "3000"
      APP_ENV: test
`,
    );

    const { diff, result } = await runPipeline(configPath);
    expect(diff.servicesToCreate.length).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.servicesCreated).toContain(`${svcName("web")}`);

    // Second run should converge
    const check = await assertConverged(configPath);
    expect(check.actionable).toEqual([]);
    expect(check.servicesToCreate).toEqual([]);
  });

  itif(hasToken)("updates service settings and converges", async () => {
    testNum++;
    const configPath = join(FIXTURE_DIR, "basic.yaml");
    writeFileSync(
      configPath,
      `project: ${PROJECT_NAME}
environments:
  - ${TEST_ENV_NAME}
services:
  ${svcName("web")}:
    source:
      image: nginx:latest
    variables:
      PORT: "8080"
      APP_ENV: test
      NEW_VAR: added
    start_command: "nginx -g 'daemon off;'"
    healthcheck:
      path: /health
      timeout: 30
    draining_seconds: 15
`,
    );

    const { result } = await runPipeline(configPath);
    expect(result.errors).toEqual([]);

    // Should converge
    const check = await assertConverged(configPath);
    expect(check.actionable).toEqual([]);
  });

  itif(hasToken)("handles shared variables", async () => {
    testNum++;
    const configPath = join(FIXTURE_DIR, "shared.yaml");
    writeFileSync(
      configPath,
      `project: ${PROJECT_NAME}
environments:
  - ${TEST_ENV_NAME}
shared_variables:
  SHARED_PORT: "9090"
  SHARED_ENV: test
services:
  ${svcName("web")}:
    source:
      image: nginx:latest
`,
    );

    const { result } = await runPipeline(configPath);
    expect(result.errors).toEqual([]);

    const check = await assertConverged(configPath);
    expect(check.actionable).toEqual([]);
  });

  itif(hasToken)("handles multiple services", async () => {
    testNum++;
    const configPath = join(FIXTURE_DIR, "multi.yaml");
    writeFileSync(
      configPath,
      `project: ${PROJECT_NAME}
environments:
  - ${TEST_ENV_NAME}
services:
  ${svcName("web")}:
    source:
      image: nginx:latest
    variables:
      ROLE: web
  ${svcName("worker")}:
    source:
      image: redis:latest
    variables:
      ROLE: worker
`,
    );

    const { diff, result } = await runPipeline(configPath);
    expect(diff.servicesToCreate.length).toBe(2);
    expect(result.errors).toEqual([]);
    expect(result.servicesCreated).toContain(`${svcName("web")}`);
    expect(result.servicesCreated).toContain(`${svcName("worker")}`);

    const check = await assertConverged(configPath);
    expect(check.actionable).toEqual([]);
    expect(check.servicesToCreate).toEqual([]);
  });

  itif(hasToken)("deletes services not in config", async () => {
    testNum++;
    // First, create both services so we have something to delete
    const configPath = join(FIXTURE_DIR, "multi.yaml");
    writeFileSync(
      configPath,
      `project: ${PROJECT_NAME}
environments:
  - ${TEST_ENV_NAME}
services:
  ${svcName("web")}:
    source:
      image: nginx:latest
    variables:
      ROLE: web
  ${svcName("worker")}:
    source:
      image: redis:latest
    variables:
      ROLE: worker
`,
    );

    const setup = await runPipeline(configPath);
    expect(setup.result.errors).toEqual([]);
    expect(setup.result.servicesCreated).toContain(`${svcName("web")}`);
    expect(setup.result.servicesCreated).toContain(`${svcName("worker")}`);

    // Now remove worker from config — should detect deletion
    writeFileSync(
      configPath,
      `project: ${PROJECT_NAME}
environments:
  - ${TEST_ENV_NAME}
services:
  ${svcName("web")}:
    source:
      image: nginx:latest
    variables:
      ROLE: web
`,
    );

    const { diff, result } = await runPipeline(configPath);
    expect(diff.servicesToDelete.length).toBe(1);
    expect(diff.servicesToDelete[0].name).toBe(`${svcName("worker")}`);
    expect(result.errors).toEqual([]);
    expect(result.servicesDeleted).toContain(`${svcName("worker")}`);
  });

  itif(hasToken)("converges when removing variables from config", async () => {
    testNum++;
    // First create a service with variables
    const configPath = join(FIXTURE_DIR, "var-remove.yaml");
    writeFileSync(
      configPath,
      `project: ${PROJECT_NAME}
environments:
  - ${TEST_ENV_NAME}
services:
  ${svcName("web")}:
    source:
      image: nginx:latest
    variables:
      PORT: "3000"
      HOST: "0.0.0.0"
      TEMP_VAR: "will-be-removed"
`,
    );

    const setup = await runPipeline(configPath);
    expect(setup.result.errors).toEqual([]);

    // Now remove TEMP_VAR from config
    writeFileSync(
      configPath,
      `project: ${PROJECT_NAME}
environments:
  - ${TEST_ENV_NAME}
services:
  ${svcName("web")}:
    source:
      image: nginx:latest
    variables:
      PORT: "3000"
      HOST: "0.0.0.0"
`,
    );

    const { diff, result } = await runPipeline(configPath);
    expect(result.errors).toEqual([]);
    // Should detect TEMP_VAR removal
    const varRemoval = diff.entries.find(
      (e) => e.path === "variables.TEMP_VAR" && e.action === "remove",
    );
    expect(varRemoval).toBeDefined();

    const check = await assertConverged(configPath);
    expect(check.actionable).toEqual([]);
  });

  itif(hasToken)("converges when removing shared variables", async () => {
    testNum++;
    const configPath = join(FIXTURE_DIR, "shared-remove.yaml");
    writeFileSync(
      configPath,
      `project: ${PROJECT_NAME}
environments:
  - ${TEST_ENV_NAME}
shared_variables:
  KEEP_VAR: "keep"
  DROP_VAR: "drop"
services:
  ${svcName("web")}:
    source:
      image: nginx:latest
`,
    );

    const setup = await runPipeline(configPath);
    expect(setup.result.errors).toEqual([]);

    // Remove DROP_VAR
    writeFileSync(
      configPath,
      `project: ${PROJECT_NAME}
environments:
  - ${TEST_ENV_NAME}
shared_variables:
  KEEP_VAR: "keep"
services:
  ${svcName("web")}:
    source:
      image: nginx:latest
`,
    );

    const { result } = await runPipeline(configPath);
    expect(result.errors).toEqual([]);

    const check = await assertConverged(configPath);
    expect(check.actionable).toEqual([]);
  });

  itif(hasToken)("converges with deploy settings", async () => {
    testNum++;
    const configPath = join(FIXTURE_DIR, "deploy-converge.yaml");
    writeFileSync(
      configPath,
      `project: ${PROJECT_NAME}
environments:
  - ${TEST_ENV_NAME}
services:
  ${svcName("web")}:
    source:
      image: nginx:latest
    start_command: "nginx -g 'daemon off;'"
    healthcheck:
      path: /health
      timeout: 30
    serverless: true
    draining_seconds: 15
    overlap_seconds: 5
    metal: true
`,
    );

    const { result } = await runPipeline(configPath);
    expect(result.errors).toEqual([]);

    const check = await assertConverged(configPath);
    expect(check.actionable).toEqual([]);
  });

  itif(hasToken)("handles template-based services", async () => {
    testNum++;
    const configPath = join(FIXTURE_DIR, "template.yaml");
    writeFileSync(
      configPath,
      `project: ${PROJECT_NAME}
environments:
  - ${TEST_ENV_NAME}
services:
  ${svcName("web")}:
    template: ${join(SERVICES_DIR, "web.yaml")}
    params:
      tag: latest
`,
    );

    const { result } = await runPipeline(configPath);
    expect(result.errors).toEqual([]);

    // Verify template variables were expanded
    const config = await fetchEnvironmentConfig(client, ENV_ID);
    const serviceMap = await fetchServiceMap(client, PROJECT_ID, ENV_ID);
    const svcId = serviceMap.serviceNameToId.get(`${svcName("web")}`) ?? "";
    expect(svcId).not.toBe("");
    expect(config.services?.[svcId]?.variables?.TAG?.value).toBe("latest");
    expect(config.services?.[svcId]?.variables?.APP_NAME?.value).toBe("integration-test");
    expect(config.services?.[svcId]?.source?.image).toBe("nginx:latest");
  });

  itif(hasToken)("creates service with volume via full pipeline", async () => {
    testNum++;
    const configPath = join(FIXTURE_DIR, "with-volume.yaml");
    writeFileSync(
      configPath,
      `project: ${PROJECT_NAME}
environments:
  - ${TEST_ENV_NAME}
volumes:
  data:
    size_mb: 1000
services:
  ${svcName("db")}:
    source:
      image: postgres:17
    volume:
      name: data
      mount: /var/lib/postgresql/data
    variables:
      POSTGRES_DB: railway
`,
    );

    const { result } = await runPipeline(configPath);
    expect(result.errors).toEqual([]);
    expect(result.servicesCreated).toContain(`${svcName("db")}`);

    // Verify volume was created and mounted
    const serviceMap = await fetchServiceMap(client, PROJECT_ID, ENV_ID);
    const svcId = serviceMap.serviceNameToId.get(`${svcName("db")}`) ?? "";
    expect(svcId).not.toBe("");

    const config = await fetchEnvironmentConfig(client, ENV_ID);
    const volumeMounts = config.services?.[svcId]?.volumeMounts;
    expect(volumeMounts).toBeDefined();
    const mountEntries = Object.values(volumeMounts ?? {});
    expect(mountEntries.length).toBe(1);
    expect(mountEntries[0]?.mountPath).toBe("/var/lib/postgresql/data");

    // Verify variables
    expect(config.services?.[svcId]?.variables?.POSTGRES_DB?.value).toBe("railway");
  });

  itif(hasToken)("creates service with all settings via full pipeline", async () => {
    testNum++;
    const configPath = join(FIXTURE_DIR, "full-service.yaml");
    writeFileSync(
      configPath,
      `project: ${PROJECT_NAME}
environments:
  - ${TEST_ENV_NAME}
services:
  ${svcName("full")}:
    source:
      image: nginx:latest
    variables:
      PORT: "8080"
      APP_ENV: test
    start_command: "nginx -g 'daemon off;'"
    healthcheck:
      path: /health
      timeout: 30
    serverless: true
    draining_seconds: 10
    overlap_seconds: 5
    metal: true
shared_variables:
  SHARED_KEY: "shared-value"
`,
    );

    const { result } = await runPipeline(configPath);
    expect(result.errors).toEqual([]);
    expect(result.servicesCreated).toContain(`${svcName("full")}`);

    // Verify all settings were applied
    const serviceMap = await fetchServiceMap(client, PROJECT_ID, ENV_ID);
    const svcId = serviceMap.serviceNameToId.get(`${svcName("full")}`) ?? "";
    const config = await fetchEnvironmentConfig(client, ENV_ID);
    const svc = config.services?.[svcId];

    expect(svc?.variables?.PORT?.value).toBe("8080");
    expect(svc?.variables?.APP_ENV?.value).toBe("test");
    expect(svc?.deploy?.startCommand).toBe("nginx -g 'daemon off;'");
    expect(svc?.deploy?.healthcheckPath).toBe("/health");
    expect(svc?.deploy?.healthcheckTimeout).toBe(30);
    expect(svc?.deploy?.sleepApplication).toBe(true);
    expect(svc?.deploy?.drainingSeconds).toBe(10);
    expect(svc?.deploy?.overlapSeconds).toBe(5);
    expect(svc?.build?.buildEnvironment).toBe("V3");
    expect(config.sharedVariables?.SHARED_KEY?.value).toBe("shared-value");

    // Should converge
    const check = await assertConverged(configPath);
    expect(check.actionable).toEqual([]);
  });

  itif(hasToken)("adds volume to existing service", async () => {
    testNum++;
    const configPath = join(FIXTURE_DIR, "add-volume.yaml");

    // Step 1: Create service WITHOUT a volume
    writeFileSync(
      configPath,
      `project: ${PROJECT_NAME}
environments:
  - ${TEST_ENV_NAME}
services:
  ${svcName("db")}:
    source:
      image: postgres:17
    variables:
      PGDATA: /var/lib/postgresql/data
`,
    );

    const setup = await runPipeline(configPath);
    expect(setup.result.errors).toEqual([]);
    expect(setup.result.servicesCreated).toContain(`${svcName("db")}`);

    // Step 2: Update config to ADD a volume to the existing service
    writeFileSync(
      configPath,
      `project: ${PROJECT_NAME}
environments:
  - ${TEST_ENV_NAME}
volumes:
  pgdata: {}
services:
  ${svcName("db")}:
    source:
      image: postgres:17
    volume:
      name: pgdata
      mount: /var/lib/postgresql/data
    variables:
      PGDATA: /var/lib/postgresql/data
`,
    );

    const { result } = await runPipeline(configPath);
    expect(result.errors).toEqual([]);
    // Volume should have been created for the existing service
    expect(result.volumesCreated).toContain(`${svcName("db")}`);

    // Verify volume is mounted
    const serviceMap = await fetchServiceMap(client, PROJECT_ID, ENV_ID);
    const svcId = serviceMap.serviceNameToId.get(`${svcName("db")}`) ?? "";
    const config = await fetchEnvironmentConfig(client, ENV_ID);
    const volumeMounts = config.services?.[svcId]?.volumeMounts;
    expect(volumeMounts).toBeDefined();
    const mountEntries = Object.values(volumeMounts ?? {});
    expect(mountEntries.length).toBe(1);
    expect(mountEntries[0]?.mountPath).toBe("/var/lib/postgresql/data");

    // Should converge
    const check = await assertConverged(configPath);
    expect(check.actionable).toEqual([]);
  });
});
