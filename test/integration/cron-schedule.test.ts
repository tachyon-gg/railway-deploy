import { afterAll, beforeAll, describe, expect } from "bun:test";
import {
  apply,
  converges,
  createTestEnvironment,
  deleteTestEnvironment,
  hasToken,
  initClient,
  itif,
  svcName,
  yaml,
} from "./helpers.js";

beforeAll(async () => {
  initClient();
  if (hasToken) await createTestEnvironment();
});
afterAll(async () => {
  if (hasToken) await deleteTestEnvironment();
});

describe("Railway Integration — cron_schedule", () => {
  const name = svcName("cron");

  itif(hasToken)("create: set cron_schedule to */5 * * * *", async () => {
    const s = await apply(yaml(name, '    cron_schedule: "*/5 * * * *"'));
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.deploy?.cronSchedule).toBe("*/5 * * * *");
    // Railway forces restartPolicyType to NEVER for cron services
    expect(s.services[name]?.deploy?.restartPolicyType).toBe("NEVER");
  });

  itif(hasToken)("converge after create", async () => {
    expect(await converges(yaml(name, '    cron_schedule: "*/5 * * * *"'))).toEqual([]);
  });

  itif(hasToken)("update: change cron_schedule to 0 0 * * *", async () => {
    const s = await apply(yaml(name, '    cron_schedule: "0 0 * * *"'));
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.deploy?.cronSchedule).toBe("0 0 * * *");
    expect(s.services[name]?.deploy?.restartPolicyType).toBe("NEVER");
  });

  itif(hasToken)("converge after update", async () => {
    expect(await converges(yaml(name, '    cron_schedule: "0 0 * * *"'))).toEqual([]);
  });

  itif(hasToken)("remove: clear cron_schedule", async () => {
    // First apply to send the removal
    const s1 = await apply(yaml(name, ""));
    expect(s1.errors).toEqual([]);
    // Railway may take time to process cron removal — apply again to ensure convergence
    const s2 = await apply(yaml(name, ""));
    expect(s2.errors).toEqual([]);
    const cron = s2.services[name]?.deploy?.cronSchedule;
    expect(cron == null || cron === undefined).toBe(true);
  });

  itif(hasToken)("converge after remove", async () => {
    expect(await converges(yaml(name, ""))).toEqual([]);
  });
});
