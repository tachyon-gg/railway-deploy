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

describe("Railway Integration — auto_updates", () => {
  const name = svcName("autoupd");

  const createFields = `      auto_updates:
        monday:
          start_hour: 0
          end_hour: 6`;

  const updateFields = `      auto_updates:
        wednesday:
          start_hour: 2
          end_hour: 8`;

  itif(hasToken)("create: sets auto_updates", async () => {
    const s = await apply(yaml(name, createFields));
    expect(s.errors).toEqual([]);
    const autoUpdates = s.services[name]?.source?.autoUpdates;
    expect(autoUpdates?.type).toBe("patch");
    expect(autoUpdates?.schedule).toEqual([{ day: 1, startHour: 0, endHour: 6 }]);
  });

  itif(hasToken)("converge after create", async () => {
    expect(await converges(yaml(name, createFields))).toEqual([]);
  });

  itif(hasToken)("update: changes auto_updates schedule", async () => {
    const s = await apply(yaml(name, updateFields));
    expect(s.errors).toEqual([]);
    const autoUpdates = s.services[name]?.source?.autoUpdates;
    expect(autoUpdates?.type).toBe("patch");
    expect(autoUpdates?.schedule).toEqual([{ day: 3, startHour: 2, endHour: 8 }]);
  });

  itif(hasToken)("converge after update", async () => {
    expect(await converges(yaml(name, updateFields))).toEqual([]);
  });

  itif(hasToken)("remove: clears auto_updates", async () => {
    const s = await apply(yaml(name, ""));
    expect(s.errors).toEqual([]);
    const autoUpdates = s.services[name]?.source?.autoUpdates;
    expect(!autoUpdates).toBe(true);
  });

  itif(hasToken)("converge after remove", async () => {
    expect(await converges(yaml(name, ""))).toEqual([]);
  });
});
