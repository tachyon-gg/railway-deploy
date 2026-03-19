import { afterAll, beforeAll, describe, expect } from "bun:test";
import {
  apply,
  converges,
  createTestEnvironment,
  deleteTestEnvironment,
  hasToken,
  initClient,
  itif,
  PROJECT_NAME,
  svcName,
  TEST_ENV_NAME,
  yaml,
} from "./helpers.js";

beforeAll(async () => {
  initClient();
  if (hasToken) await createTestEnvironment();
});

afterAll(async () => {
  if (hasToken) await deleteTestEnvironment();
});

function twoServiceYaml(name1: string, name2: string) {
  return `project: ${PROJECT_NAME}
environments:
  - ${TEST_ENV_NAME}
services:
  ${name1}:
    source:
      image: nginx:latest
  ${name2}:
    source:
      image: nginx:latest
`;
}

describe("Railway Integration — service lifecycle", () => {
  const svc1 = svcName("lifecycle-a");
  const svc2 = svcName("lifecycle-b");

  itif(hasToken)("create: both services exist after apply", async () => {
    const s = await apply(twoServiceYaml(svc1, svc2));
    expect(s.errors).toEqual([]);
    expect(s.servicesCreated).toContain(svc1);
    expect(s.servicesCreated).toContain(svc2);
    expect(s.services[svc1]).toBeDefined();
    expect(s.services[svc2]).toBeDefined();
  });

  itif(hasToken)("converge after create", async () => {
    const changes = await converges(twoServiceYaml(svc1, svc2));
    expect(changes).toEqual([]);
  });

  itif(hasToken)("delete: removing a service from config deletes it", async () => {
    const s = await apply(yaml(svc1, ""));
    expect(s.errors).toEqual([]);
    expect(s.servicesDeleted).toContain(svc2);
    expect(s.services[svc1]).toBeDefined();
    expect(s.services[svc2]).toBeUndefined();
  });

  itif(hasToken)("converge after delete", async () => {
    const changes = await converges(yaml(svc1, ""));
    expect(changes).toEqual([]);
  });
});
