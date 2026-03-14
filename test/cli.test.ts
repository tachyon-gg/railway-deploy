import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const BIN = join(import.meta.dir, "..", "src", "index.ts");
const FIXTURE_DIR = join(import.meta.dir, "__cli_fixtures__");

beforeAll(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });

  writeFileSync(
    join(FIXTURE_DIR, "valid.yaml"),
    `
project: Test
environment: alpha
services:
  web:
    source:
      image: nginx:latest
`,
  );

  writeFileSync(
    join(FIXTURE_DIR, "invalid.yaml"),
    `
environment: alpha
services:
  web:
    source:
      image: nginx:latest
`,
  );
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

async function run(
  args: string[],
  envOverrides?: Record<string, string | undefined>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const env: Record<string, string> = {};
  // Build a clean env without RAILWAY_TOKEN
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== "RAILWAY_TOKEN" && v !== undefined) {
      env[k] = v;
    }
  }
  if (envOverrides) {
    for (const [k, v] of Object.entries(envOverrides)) {
      if (v !== undefined) {
        env[k] = v;
      }
    }
  }
  const proc = Bun.spawn(["bun", "run", BIN, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

describe("CLI", () => {
  test("--help shows usage", async () => {
    const { stdout, exitCode } = await run(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("railway-deploy");
    expect(stdout).toContain("--apply");
  });

  test("missing config file shows error", async () => {
    const { stderr, exitCode } = await run([]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("required");
  });

  test("unknown flag shows error", async () => {
    const { stderr, exitCode } = await run(["config.yaml", "--unknown"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("unknown");
  });

  test("--validate with valid config exits 0", async () => {
    const { stdout, exitCode } = await run([join(FIXTURE_DIR, "valid.yaml"), "--validate"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("valid");
  });

  test("--validate with invalid config exits 1", async () => {
    const { exitCode } = await run([join(FIXTURE_DIR, "invalid.yaml"), "--validate"]);
    expect(exitCode).toBe(1);
  });

  test("nonexistent config file exits 1", async () => {
    const { stderr, exitCode } = await run([join(FIXTURE_DIR, "does-not-exist.yaml")]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
  });
});
