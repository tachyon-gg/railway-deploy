import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { logger } from "../src/logger.js";
import type { ApplyResult } from "../src/reconcile/format.js";
import { printApplyResult, printConfigDiff } from "../src/reconcile/format.js";
import type { ConfigDiff } from "../src/types/changeset.js";

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

describe("printConfigDiff", () => {
  let logged: string[];

  beforeEach(() => {
    logged = [];
    logger.info = (...args: unknown[]) => logged.push(args.join(" "));
    logger.warn = (...args: unknown[]) => logged.push(`WARN: ${args.join(" ")}`);
    logger.success = (...args: unknown[]) => logged.push(`OK: ${args.join(" ")}`);
  });

  afterEach(() => {
    logger.level = 3;
  });

  test("prints no changes message when diff is empty", () => {
    printConfigDiff(emptyDiff());
    expect(logged.some((l) => l.includes("No changes needed"))).toBe(true);
  });

  test("prints shared variable changes", () => {
    const diff: ConfigDiff = {
      ...emptyDiff(),
      entries: [
        {
          path: "sharedVariables.APP_ENV",
          action: "add",
          serviceName: null,
          category: "shared-variable",
          newValue: "alpha",
        },
      ],
    };
    printConfigDiff(diff);
    expect(logged.some((l) => l.includes("Shared variable") && l.includes("APP_ENV"))).toBe(true);
  });

  test("groups entries by service", () => {
    const diff: ConfigDiff = {
      ...emptyDiff(),
      entries: [
        {
          path: "variables.PORT",
          action: "add",
          serviceName: "web",
          category: "variable",
          newValue: "3000",
        },
        {
          path: "variables.HOST",
          action: "add",
          serviceName: "web",
          category: "variable",
          newValue: "0.0.0.0",
        },
      ],
    };
    printConfigDiff(diff);
    expect(logged.some((l) => l.includes("web:"))).toBe(true);
  });

  test("shows verbose values when verbose option is set", () => {
    const diff: ConfigDiff = {
      ...emptyDiff(),
      entries: [
        {
          path: "variables.PORT",
          action: "update",
          serviceName: "web",
          category: "variable",
          oldValue: "2000",
          newValue: "3000",
        },
      ],
    };
    printConfigDiff(diff, { verbose: true });
    expect(logged.some((l) => l.includes("2000") && l.includes("3000"))).toBe(true);
  });

  test("masks sensitive variable values", () => {
    const diff: ConfigDiff = {
      ...emptyDiff(),
      entries: [
        {
          path: "sharedVariables.JWT_SECRET",
          action: "update",
          serviceName: null,
          category: "shared-variable",
          oldValue: "old-secret",
          newValue: "new-secret",
        },
      ],
    };
    printConfigDiff(diff, { verbose: true });
    expect(logged.some((l) => l.includes("***"))).toBe(true);
    expect(logged.every((l) => !l.includes("old-secret"))).toBe(true);
  });

  test("prints summary line", () => {
    const diff: ConfigDiff = {
      ...emptyDiff(),
      entries: [
        { path: "v.A", action: "add", serviceName: "web", category: "variable", newValue: "1" },
        {
          path: "v.B",
          action: "update",
          serviceName: "web",
          category: "variable",
          oldValue: "1",
          newValue: "2",
        },
        { path: "v.C", action: "remove", serviceName: "web", category: "variable", oldValue: "3" },
      ],
    };
    printConfigDiff(diff);
    expect(logged.some((l) => l.includes("to create") && l.includes("to delete"))).toBe(true);
  });

  test("prints domain entries", () => {
    const diff: ConfigDiff = {
      ...emptyDiff(),
      entries: [
        {
          path: "networking.customDomains.app.example.com",
          action: "add",
          serviceName: "web",
          category: "domain",
          newValue: { port: 8080 },
        },
      ],
    };
    printConfigDiff(diff);
    expect(logged.some((l) => l.includes("domain") && l.includes("app.example.com"))).toBe(true);
  });

  test("prints setting entries with verbose old/new values", () => {
    const diff: ConfigDiff = {
      ...emptyDiff(),
      entries: [
        {
          path: "deploy.startCommand",
          action: "update",
          serviceName: "web",
          category: "setting",
          oldValue: "node app.js",
          newValue: "npm start",
        },
      ],
    };
    printConfigDiff(diff, { verbose: true });
    expect(logged.some((l) => l.includes("node app.js") && l.includes("npm start"))).toBe(true);
  });

  test("prints setting entry with verbose sensitive field masked", () => {
    const diff: ConfigDiff = {
      ...emptyDiff(),
      entries: [
        {
          path: "deploy.registryCredentials",
          action: "update",
          serviceName: "web",
          category: "setting",
          oldValue: { password: "old" },
          newValue: { password: "new" },
        },
      ],
    };
    printConfigDiff(diff, { verbose: true });
    // registryCredentials contains "CREDENTIAL" so should be masked
    expect(logged.some((l) => l.includes("***"))).toBe(true);
  });

  test("prints setting entry non-verbose with remove action", () => {
    const diff: ConfigDiff = {
      ...emptyDiff(),
      entries: [
        {
          path: "deploy.cronSchedule",
          action: "remove",
          serviceName: "web",
          category: "setting",
          oldValue: "0 * * * *",
        },
      ],
    };
    printConfigDiff(diff);
    expect(logged.some((l) => l.includes("(unset)"))).toBe(true);
  });

  test("prints setting entry non-verbose with add action", () => {
    const diff: ConfigDiff = {
      ...emptyDiff(),
      entries: [
        {
          path: "deploy.startCommand",
          action: "add",
          serviceName: "web",
          category: "setting",
          newValue: "npm start",
        },
      ],
    };
    printConfigDiff(diff);
    expect(logged.some((l) => l.includes("startCommand") && l.includes("npm start"))).toBe(true);
  });

  test("prints setting entry verbose with null newValue shows (unset)", () => {
    const diff: ConfigDiff = {
      ...emptyDiff(),
      entries: [
        {
          path: "deploy.cronSchedule",
          action: "update",
          serviceName: "web",
          category: "setting",
          oldValue: "0 * * * *",
          newValue: null,
        },
      ],
    };
    printConfigDiff(diff, { verbose: true });
    expect(logged.some((l) => l.includes("(unset)"))).toBe(true);
  });

  test("prints volume add entry", () => {
    const diff: ConfigDiff = {
      ...emptyDiff(),
      entries: [
        {
          path: "volumeMounts.vol-1",
          action: "add",
          serviceName: "db",
          category: "volume",
          newValue: "/data",
        },
      ],
    };
    printConfigDiff(diff);
    expect(logged.some((l) => l.includes("volume") && l.includes("/data"))).toBe(true);
  });

  test("prints volume remove entry", () => {
    const diff: ConfigDiff = {
      ...emptyDiff(),
      entries: [
        {
          path: "volumeMounts.vol-1",
          action: "remove",
          serviceName: "db",
          category: "volume",
          oldValue: "/data",
        },
      ],
    };
    printConfigDiff(diff);
    expect(logged.some((l) => l.includes("volume") && l.includes("remove"))).toBe(true);
  });

  test("prints volume update entry", () => {
    const diff: ConfigDiff = {
      ...emptyDiff(),
      entries: [
        {
          path: "volumeMounts.vol-1",
          action: "update",
          serviceName: "db",
          category: "volume",
          oldValue: "/old",
          newValue: "/new",
        },
      ],
    };
    printConfigDiff(diff);
    expect(logged.some((l) => l.includes("/old") && l.includes("/new"))).toBe(true);
  });

  test("prints bucket entry", () => {
    const diff: ConfigDiff = {
      ...emptyDiff(),
      entries: [
        {
          path: "buckets.media",
          action: "add",
          serviceName: null,
          category: "bucket",
          newValue: "iad",
        },
      ],
    };
    printConfigDiff(diff);
    expect(logged.some((l) => l.includes("bucket") && l.includes("add"))).toBe(true);
  });

  test("prints service create entry", () => {
    const diff: ConfigDiff = {
      ...emptyDiff(),
      entries: [
        {
          path: "service",
          action: "add",
          serviceName: "web",
          category: "service",
          newValue: "nginx:latest",
        },
      ],
    };
    printConfigDiff(diff);
    expect(logged.some((l) => l.includes("web"))).toBe(true);
  });

  test("prints service delete entry", () => {
    const diff: ConfigDiff = {
      ...emptyDiff(),
      entries: [
        {
          path: "service",
          action: "remove",
          serviceName: "old-svc",
          category: "service",
        },
      ],
    };
    printConfigDiff(diff);
    expect(logged.some((l) => l.includes("old-svc"))).toBe(true);
  });

  test("prints domain remove entry", () => {
    const diff: ConfigDiff = {
      ...emptyDiff(),
      entries: [
        {
          path: "networking.customDomains.old.example.com",
          action: "remove",
          serviceName: "web",
          category: "domain",
          oldValue: {},
        },
      ],
    };
    printConfigDiff(diff);
    expect(
      logged.some(
        (l) => l.includes("domain") && l.includes("remove") && l.includes("old.example.com"),
      ),
    ).toBe(true);
  });
});

describe("printApplyResult", () => {
  let logged: string[];

  beforeEach(() => {
    logged = [];
    logger.info = (...args: unknown[]) => logged.push(args.join(" "));
    logger.error = (...args: unknown[]) => logged.push(`ERROR: ${args.join(" ")}`);
    logger.success = (...args: unknown[]) => logged.push(`OK: ${args.join(" ")}`);
  });

  test("prints success result", () => {
    const result: ApplyResult = {
      staged: true,
      committed: true,
      servicesCreated: [],
      servicesDeleted: [],
      volumesCreated: [],
      errors: [],
    };
    printApplyResult(result);
    expect(logged.some((l) => l.includes("staged"))).toBe(true);
    expect(logged.some((l) => l.includes("committed"))).toBe(true);
  });

  test("prints errors", () => {
    const result: ApplyResult = {
      staged: false,
      committed: false,
      servicesCreated: [],
      servicesDeleted: [],
      volumesCreated: [],
      errors: [{ step: "stage", error: "permission denied" }],
    };
    printApplyResult(result);
    expect(logged.some((l) => l.includes("error"))).toBe(true);
    expect(logged.some((l) => l.includes("permission denied"))).toBe(true);
  });

  test("prints created and deleted services", () => {
    const result: ApplyResult = {
      staged: true,
      committed: true,
      servicesCreated: ["new-svc"],
      servicesDeleted: ["old-svc"],
      volumesCreated: [],
      errors: [],
    };
    printApplyResult(result);
    expect(logged.some((l) => l.includes("Created 1 service"))).toBe(true);
    expect(logged.some((l) => l.includes("Deleted 1 service"))).toBe(true);
  });
});
