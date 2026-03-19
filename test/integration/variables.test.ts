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

describe("Railway Integration — service variables", () => {
  const name = svcName("vars");

  itif(hasToken)("create: sets PORT and HOST", async () => {
    const s = await apply(
      yaml(
        name,
        `    variables:
      PORT: "3000"
      HOST: "0.0.0.0"`,
      ),
    );
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.variables?.PORT?.value).toBe("3000");
    expect(s.services[name]?.variables?.HOST?.value).toBe("0.0.0.0");
  });

  itif(hasToken)("converge after create", async () => {
    expect(
      await converges(
        yaml(
          name,
          `    variables:
      PORT: "3000"
      HOST: "0.0.0.0"`,
        ),
      ),
    ).toEqual([]);
  });

  itif(hasToken)("update: changes PORT value", async () => {
    const s = await apply(
      yaml(
        name,
        `    variables:
      PORT: "8080"
      HOST: "0.0.0.0"`,
      ),
    );
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.variables?.PORT?.value).toBe("8080");
    expect(s.services[name]?.variables?.HOST?.value).toBe("0.0.0.0");
  });

  itif(hasToken)("converge after update", async () => {
    expect(
      await converges(
        yaml(
          name,
          `    variables:
      PORT: "8080"
      HOST: "0.0.0.0"`,
        ),
      ),
    ).toEqual([]);
  });

  itif(hasToken)("remove: deletes HOST via null-injection", async () => {
    const s = await apply(
      yaml(
        name,
        `    variables:
      PORT: "8080"`,
      ),
    );
    expect(s.errors).toEqual([]);
    expect(s.services[name]?.variables?.PORT?.value).toBe("8080");
    expect(s.services[name]?.variables?.HOST).toBeUndefined();
  });

  itif(hasToken)("converge after remove", async () => {
    expect(
      await converges(
        yaml(
          name,
          `    variables:
      PORT: "8080"`,
        ),
      ),
    ).toEqual([]);
  });
});

describe("Railway Integration — shared variables", () => {
  const name = svcName("shvar");

  itif(hasToken)("create: sets AUDIT_KEY shared variable", async () => {
    const s = await apply(
      yaml(
        name,
        "",
        `shared_variables:
  AUDIT_KEY: "key-abc-123"
`,
      ),
    );
    expect(s.errors).toEqual([]);
    expect(s.sharedVariables?.AUDIT_KEY?.value).toBe("key-abc-123");
  });

  itif(hasToken)("converge after create", async () => {
    expect(
      await converges(
        yaml(
          name,
          "",
          `shared_variables:
  AUDIT_KEY: "key-abc-123"
`,
        ),
      ),
    ).toEqual([]);
  });

  itif(hasToken)("update: changes AUDIT_KEY value", async () => {
    const s = await apply(
      yaml(
        name,
        "",
        `shared_variables:
  AUDIT_KEY: "key-xyz-789"
`,
      ),
    );
    expect(s.errors).toEqual([]);
    expect(s.sharedVariables?.AUDIT_KEY?.value).toBe("key-xyz-789");
  });

  itif(hasToken)("converge after update", async () => {
    expect(
      await converges(
        yaml(
          name,
          "",
          `shared_variables:
  AUDIT_KEY: "key-xyz-789"
`,
        ),
      ),
    ).toEqual([]);
  });

  itif(hasToken)("remove: deletes AUDIT_KEY", async () => {
    const s = await apply(yaml(name, ""));
    expect(s.errors).toEqual([]);
    expect(s.sharedVariables?.AUDIT_KEY).toBeUndefined();
  });

  itif(hasToken)("converge after remove", async () => {
    expect(await converges(yaml(name, ""))).toEqual([]);
  });
});
