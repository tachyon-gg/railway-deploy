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

describe("Railway Integration — volume", () => {
  const name = svcName("vol");
  const volName = svcName("data");

  const volBlock = `volumes:
  ${volName}: {}
`;

  const svcFields = `    volume:
      name: ${volName}
      mount: /data`;

  itif(hasToken)("create: service with volume mount", async () => {
    const s = await apply(yaml(name, svcFields, volBlock));
    expect(s.errors).toEqual([]);
    expect(s.servicesCreated).toContain(name);

    // volumeMounts should have exactly one entry with the right mountPath
    const svc = s.services[name];
    expect(svc).toBeDefined();
    const mounts = svc?.volumeMounts ?? {};
    const mountEntries = Object.values(mounts);
    expect(mountEntries).toHaveLength(1);
    expect(mountEntries[0].mountPath).toBe("/data");
  });

  itif(hasToken)("converge after create", async () => {
    const changes = await converges(yaml(name, svcFields, volBlock));
    expect(changes).toEqual([]);
  });

  itif(hasToken)("update: change mount path", async () => {
    const updatedFields = `    volume:
      name: ${volName}
      mount: /data2`;
    const s = await apply(yaml(name, updatedFields, volBlock));
    expect(s.errors).toEqual([]);

    const svc = s.services[name];
    expect(svc).toBeDefined();
    const mounts = svc?.volumeMounts ?? {};
    const mountEntries = Object.values(mounts);
    expect(mountEntries).toHaveLength(1);
    expect(mountEntries[0].mountPath).toBe("/data2");
  });

  itif(hasToken)("converge after update", async () => {
    const updatedFields = `    volume:
      name: ${volName}
      mount: /data2`;
    const changes = await converges(yaml(name, updatedFields, volBlock));
    expect(changes).toEqual([]);
  });

  itif(hasToken)("remove: detach volume from service", async () => {
    const s = await apply(yaml(name, ""));
    expect(s.errors).toEqual([]);

    const svc = s.services[name];
    expect(svc).toBeDefined();
    const mounts = svc?.volumeMounts;
    // After removing volume config, there should be no mounts
    expect(mounts === undefined || Object.keys(mounts).length === 0).toBe(true);
  });

  itif(hasToken)("converge after remove", async () => {
    const changes = await converges(yaml(name, ""));
    expect(changes).toEqual([]);
  });
});
