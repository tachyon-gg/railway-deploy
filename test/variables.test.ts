import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import {
  getDeletedVariables,
  loadEnvFile,
  resolveEnvVarString,
  resolveEnvVars,
} from "../src/config/variables.js";

describe("resolveEnvVarString", () => {
  test("resolves ${VAR} from env", () => {
    const result = resolveEnvVarString("password=${SECRET}", { SECRET: "hunter2" });
    expect(result).toBe("password=hunter2");
  });

  test("resolves multiple ${} references", () => {
    const result = resolveEnvVarString("${A}:${B}", { A: "x", B: "y" });
    expect(result).toBe("x:y");
  });

  test("passes through ${{}} Railway references", () => {
    const result = resolveEnvVarString("${{Postgres.DATABASE_URL}}", {});
    expect(result).toBe("${{Postgres.DATABASE_URL}}");
  });

  test("handles mixed ${} and ${{}} in same string", () => {
    const result = resolveEnvVarString("http://${{svc.HOST}}:${PORT}", { PORT: "8080" });
    expect(result).toBe("http://${{svc.HOST}}:8080");
  });

  test("throws on missing env var", () => {
    expect(() => resolveEnvVarString("${MISSING}", {})).toThrow(
      'Environment variable "MISSING" is not set',
    );
  });

  test("lenient mode leaves missing env vars as-is", () => {
    const result = resolveEnvVarString("${MISSING}", {}, true);
    expect(result).toBe("${MISSING}");
  });

  test("lenient mode still resolves available env vars", () => {
    const result = resolveEnvVarString("${FOUND}:${MISSING}", { FOUND: "ok" }, true);
    expect(result).toBe("ok:${MISSING}");
  });

  test("leaves plain strings untouched", () => {
    const result = resolveEnvVarString("no vars here", {});
    expect(result).toBe("no vars here");
  });

  test("${VAR} in domain strings", () => {
    const result = resolveEnvVarString("${SUBDOMAIN}.example.com", { SUBDOMAIN: "api" });
    expect(result).toBe("api.example.com");
  });

  test("empty var name ${} is left as-is", () => {
    // The regex requires at least one char in the name, so ${} is not matched
    const result = resolveEnvVarString("${}", {});
    expect(result).toBe("${}");
  });

  test("unclosed brace ${VAR is not resolved", () => {
    // Unclosed brace doesn't match regex, so left as-is
    const result = resolveEnvVarString("${VAR", {});
    expect(result).toBe("${VAR");
  });
});

describe("resolveEnvVars", () => {
  test("resolves all string values", () => {
    const result = resolveEnvVars(
      { DB: "${DB_URL}", STATIC: "value" },
      { DB_URL: "postgres://localhost" },
    );
    expect(result).toEqual({
      DB: "postgres://localhost",
      STATIC: "value",
    });
  });

  test("skips null values (deletions)", () => {
    const result = resolveEnvVars({ KEEP: "yes", DELETE: null }, {});
    expect(result).toEqual({ KEEP: "yes" });
    expect("DELETE" in result).toBe(false);
  });

  test("lenient mode leaves missing vars as-is", () => {
    const result = resolveEnvVars({ DB: "${MISSING_URL}", STATIC: "value" }, {}, true);
    expect(result).toEqual({ DB: "${MISSING_URL}", STATIC: "value" });
  });
});

describe("getDeletedVariables", () => {
  test("returns keys with null values", () => {
    const result = getDeletedVariables({
      KEEP: "yes",
      DEL1: null,
      DEL2: null,
    });
    expect(result).toEqual(["DEL1", "DEL2"]);
  });

  test("returns empty array when no nulls", () => {
    const result = getDeletedVariables({ A: "1", B: "2" });
    expect(result).toEqual([]);
  });
});

describe("loadEnvFile", () => {
  const TMP_DIR = join(import.meta.dir, "__env_fixtures__");

  beforeAll(() => {
    mkdirSync(TMP_DIR, { recursive: true });
  });

  afterAll(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  test("parses basic .env file", () => {
    const envPath = join(TMP_DIR, "basic.env");
    writeFileSync(
      envPath,
      `
# A comment
FOO=bar
BAZ=qux
`,
    );
    const result = loadEnvFile(envPath);
    expect(result.FOO).toBe("bar");
    expect(result.BAZ).toBe("qux");
  });

  test("handles quoted values", () => {
    const envPath = join(TMP_DIR, "quoted.env");
    writeFileSync(
      envPath,
      `
DOUBLE="hello world"
SINGLE='single quoted'
`,
    );
    const result = loadEnvFile(envPath);
    expect(result.DOUBLE).toBe("hello world");
    expect(result.SINGLE).toBe("single quoted");
  });

  test("handles empty values", () => {
    const envPath = join(TMP_DIR, "empty.env");
    writeFileSync(envPath, `EMPTY=\n`);
    const result = loadEnvFile(envPath);
    expect(result.EMPTY).toBe("");
  });
});
