import { afterAll, beforeAll, describe, expect } from "bun:test";
import {
  clearEgressGateways,
  createEgressGateway,
  createService,
} from "../../src/railway/mutations.js";
import { hasEgressGateways } from "../../src/railway/queries.js";
import {
  client,
  createTestEnvironment,
  deleteTestEnvironment,
  ENV_ID,
  hasToken,
  initClient,
  itif,
  PROJECT_ID,
  patchAndFetch,
  TEST_PREFIX,
  waitForConfig,
} from "./helpers.js";

beforeAll(async () => {
  initClient();
  if (hasToken) await createTestEnvironment();
});

afterAll(async () => {
  if (hasToken) await deleteTestEnvironment();
});

describe("Railway Integration — settings", () => {
  let serviceId: string;

  beforeAll(async () => {
    if (!hasToken) return;
    const result = await createService(
      client,
      PROJECT_ID,
      `${TEST_PREFIX}-settings`,
      { image: "nginx:latest" },
      ENV_ID,
    );
    serviceId = result.id;
    await waitForConfig((c) => c.services?.[serviceId] !== undefined);
  });

  itif(hasToken)("applies deploy settings (non-cron)", async () => {
    const config = await patchAndFetch(
      {
        services: {
          [serviceId]: {
            deploy: {
              startCommand: "nginx -g 'daemon off;'",
              healthcheckPath: "/health",
              healthcheckTimeout: 60,
              sleepApplication: true,
              drainingSeconds: 30,
              overlapSeconds: 15,
              ipv6EgressEnabled: true,
              preDeployCommand: "echo migrate",
              multiRegionConfig: { "us-west1": { numReplicas: 2 } },
            },
          },
        },
      },
      (c) => c.services?.[serviceId]?.deploy?.startCommand === "nginx -g 'daemon off;'",
    );
    const deploy = config.services?.[serviceId]?.deploy;
    expect(deploy?.startCommand).toBe("nginx -g 'daemon off;'");
    expect(deploy?.healthcheckPath).toBe("/health");
    expect(deploy?.healthcheckTimeout).toBe(60);
    expect(deploy?.sleepApplication).toBe(true);
    expect(deploy?.drainingSeconds).toBe(30);
    expect(deploy?.overlapSeconds).toBe(15);
    expect(deploy?.ipv6EgressEnabled).toBe(true);
    expect(deploy?.preDeployCommand).toEqual(["echo migrate"]);
    expect(deploy?.multiRegionConfig?.["us-west1"]?.numReplicas).toBe(2);
  });

  itif(hasToken)("applies cron schedule (forces restartPolicy NEVER, disables sleep)", async () => {
    // cronSchedule forces restartPolicyType=NEVER and disables sleepApplication
    const config = await patchAndFetch(
      {
        services: {
          [serviceId]: {
            deploy: {
              cronSchedule: "*/5 * * * *",
            },
          },
        },
      },
      (c) => c.services?.[serviceId]?.deploy?.cronSchedule === "*/5 * * * *",
    );
    const deploy = config.services?.[serviceId]?.deploy;
    expect(deploy?.cronSchedule).toBe("*/5 * * * *");
    // Railway forces NEVER for cron jobs
    expect(deploy?.restartPolicyType).toBe("NEVER");
  });

  itif(hasToken)("applies build settings", async () => {
    const config = await patchAndFetch(
      {
        services: {
          [serviceId]: {
            build: {
              watchPatterns: ["src/**", "package.json"],
              buildEnvironment: "V3",
            },
          },
        },
      },
      (c) => c.services?.[serviceId]?.build?.buildEnvironment === "V3",
    );
    const build = config.services?.[serviceId]?.build;
    expect(build?.watchPatterns).toEqual(["src/**", "package.json"]);
    expect(build?.buildEnvironment).toBe("V3");
  });

  itif(hasToken)("applies source image change", async () => {
    const config = await patchAndFetch(
      { services: { [serviceId]: { source: { image: "redis:7" } } } },
      (c) => c.services?.[serviceId]?.source?.image === "redis:7",
    );
    expect(config.services?.[serviceId]?.source?.image).toBe("redis:7");
  });

  itif(hasToken)("applies resource limits via limitOverride", async () => {
    const config = await patchAndFetch(
      {
        services: {
          [serviceId]: {
            deploy: {
              limitOverride: {
                containers: { cpu: 2, memoryBytes: 2000000000 },
              },
            },
          },
        },
      },
      (c) =>
        (c.services?.[serviceId]?.deploy as Record<string, unknown>)?.limitOverride !== undefined,
    );
    const limitOverride = config.services?.[serviceId]?.deploy?.limitOverride;
    expect(limitOverride?.containers?.cpu).toBe(2);
    expect(limitOverride?.containers?.memoryBytes).toBe(2000000000);
  });

  itif(hasToken)("applies TCP proxy via networking.tcpProxies", async () => {
    const config = await patchAndFetch(
      {
        services: {
          [serviceId]: {
            networking: {
              tcpProxies: { "5432": {} },
            },
          },
        },
      },
      (c) => {
        const proxies = c.services?.[serviceId]?.networking?.tcpProxies;
        return proxies !== undefined && "5432" in proxies;
      },
    );
    expect(config.services?.[serviceId]?.networking?.tcpProxies?.["5432"]).toBeDefined();
  });

  itif(hasToken)("creates railway domain via networking.serviceDomains", async () => {
    const config = await patchAndFetch(
      {
        services: {
          [serviceId]: {
            networking: {
              serviceDomains: { _: { port: 8080 } },
            },
          },
        },
      },
      (c) => {
        const domains = c.services?.[serviceId]?.networking?.serviceDomains;
        return domains !== undefined && Object.keys(domains).length > 0;
      },
    );
    const serviceDomains = config.services?.[serviceId]?.networking?.serviceDomains;
    expect(serviceDomains).toBeDefined();
    // Railway assigns its own domain name — check that at least one exists with port 8080
    const entries = Object.values(serviceDomains ?? {});
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.port).toBe(8080);
  });

  itif(hasToken)("enables and disables static outbound IPs via egress gateway", async () => {
    // Use a fresh service — egress can fail on heavily-patched services
    const freshSvc = await createService(
      client,
      PROJECT_ID,
      `${TEST_PREFIX}-egress`,
      { image: "nginx:latest" },
      ENV_ID,
    );
    await waitForConfig((c) => c.services?.[freshSvc.id] !== undefined);

    // Enable
    const result = await createEgressGateway(client, freshSvc.id, ENV_ID);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].ipv4).toBeDefined();

    const enabled = await hasEgressGateways(client, freshSvc.id, ENV_ID);
    expect(enabled).toBe(true);

    // Disable
    await clearEgressGateways(client, freshSvc.id, ENV_ID);
    const disabled = await hasEgressGateways(client, freshSvc.id, ENV_ID);
    expect(disabled).toBe(false);
  });
});
