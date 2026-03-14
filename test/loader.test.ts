import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { loadEnvironmentConfig } from "../src/config/loader.js";

const TEST_DIR = join(import.meta.dir, "__fixtures__");
const SERVICES_DIR = join(TEST_DIR, "services");
const ENVS_DIR = join(TEST_DIR, "environments");

beforeAll(() => {
  mkdirSync(SERVICES_DIR, { recursive: true });
  mkdirSync(ENVS_DIR, { recursive: true });

  // Write a service template
  writeFileSync(
    join(SERVICES_DIR, "web.yaml"),
    `
params:
  environment:
    required: true
  replicas:
    default: "1"

source:
  image: ghcr.io/org/web:%{environment}

variables:
  APP_ENV: "%{environment}"
  DB_URL: \${{Postgres.DATABASE_URL}}
  REPLICAS: "%{replicas}"

domain: "%{environment}.example.com"
`,
  );

  // Write a template with new service settings
  writeFileSync(
    join(SERVICES_DIR, "worker.yaml"),
    `
params:
  tag:
    default: latest

source:
  image: redis:%{tag}

variables:
  ROLE: worker

start_command: "npm run worker"
build_command: "npm run build"
root_directory: "/packages/worker"
`,
  );

  // Write a simple environment file
  writeFileSync(
    join(ENVS_DIR, "alpha.yaml"),
    `
project: Test Project
environment: alpha

shared_variables:
  APP_ENVIRONMENT: alpha

services:
  web:
    template: ../services/web.yaml
    params:
      environment: alpha
      replicas: "3"
    variables:
      EXTRA: "added"
      REPLICAS: null

  redis:
    source:
      image: bitnami/redis:7.4
    variables:
      ALLOW_EMPTY_PASSWORD: "yes"
    volume:
      mount: /data
      name: redis-data
`,
  );

  // Write an environment file with multiple domains
  writeFileSync(
    join(ENVS_DIR, "multi-domain.yaml"),
    `
project: Test Project
environment: alpha

services:
  web:
    source:
      image: nginx:latest
    domains:
      - app.example.com
      - www.example.com
`,
  );

  // Write an environment file with new service settings
  writeFileSync(
    join(ENVS_DIR, "settings.yaml"),
    `
project: Test Project
environment: alpha

services:
  worker:
    template: ../services/worker.yaml
    params:
      tag: "7"
    sleep_application: true
    pre_deploy_command: "npm run migrate"
`,
  );

  // Write an environment file with buckets
  writeFileSync(
    join(ENVS_DIR, "buckets.yaml"),
    `
project: Test Project
environment: alpha

services:
  web:
    source:
      image: nginx:latest

buckets:
  terraform-state:
    name: tachyon-terraform
  media:
    name: media-uploads
`,
  );
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("loadEnvironmentConfig", () => {
  test("loads and resolves a full environment config", () => {
    const result = loadEnvironmentConfig(join(ENVS_DIR, "alpha.yaml"));

    expect(result.projectName).toBe("Test Project");
    expect(result.environmentName).toBe("alpha");
  });

  test("resolves template params in source image", () => {
    const result = loadEnvironmentConfig(join(ENVS_DIR, "alpha.yaml"));
    const web = result.state.services["web"];

    expect(web.source).toEqual({ image: "ghcr.io/org/web:alpha" });
  });

  test("resolves template params in variables", () => {
    const result = loadEnvironmentConfig(join(ENVS_DIR, "alpha.yaml"));
    const web = result.state.services["web"];

    expect(web.variables["APP_ENV"]).toBe("alpha");
  });

  test("passes through Railway ${{}} references", () => {
    const result = loadEnvironmentConfig(join(ENVS_DIR, "alpha.yaml"));
    const web = result.state.services["web"];

    expect(web.variables["DB_URL"]).toBe("${{Postgres.DATABASE_URL}}");
  });

  test("merges environment variables into template", () => {
    const result = loadEnvironmentConfig(join(ENVS_DIR, "alpha.yaml"));
    const web = result.state.services["web"];

    // EXTRA was added by env file
    expect(web.variables["EXTRA"]).toBe("added");
  });

  test("handles null variable overrides (deletions)", () => {
    const result = loadEnvironmentConfig(join(ENVS_DIR, "alpha.yaml"));
    const web = result.state.services["web"];

    // REPLICAS was set to null in env file, should be absent from resolved vars
    expect("REPLICAS" in web.variables).toBe(false);
    // Should appear in deletedVars
    expect(result.deletedVars["web"]).toContain("REPLICAS");
  });

  test("resolves domain from template params into domains array", () => {
    const result = loadEnvironmentConfig(join(ENVS_DIR, "alpha.yaml"));
    const web = result.state.services["web"];

    expect(web.domains).toEqual(["alpha.example.com"]);
  });

  test("handles inline services without templates", () => {
    const result = loadEnvironmentConfig(join(ENVS_DIR, "alpha.yaml"));
    const redis = result.state.services["redis"];

    expect(redis.source).toEqual({ image: "bitnami/redis:7.4" });
    expect(redis.variables["ALLOW_EMPTY_PASSWORD"]).toBe("yes");
    expect(redis.volume).toEqual({ mount: "/data", name: "redis-data" });
  });

  test("resolves shared variables", () => {
    const result = loadEnvironmentConfig(join(ENVS_DIR, "alpha.yaml"));

    expect(result.state.sharedVariables).toEqual({
      APP_ENVIRONMENT: "alpha",
    });
  });

  test("sets projectId and environmentId to empty (resolved later)", () => {
    const result = loadEnvironmentConfig(join(ENVS_DIR, "alpha.yaml"));

    expect(result.state.projectId).toBe("");
    expect(result.state.environmentId).toBe("");
  });

  test("loads multiple domains", () => {
    const result = loadEnvironmentConfig(join(ENVS_DIR, "multi-domain.yaml"));
    const web = result.state.services["web"];

    expect(web.domains).toEqual(["app.example.com", "www.example.com"]);
  });

  test("loads new service settings from template and inline", () => {
    const result = loadEnvironmentConfig(join(ENVS_DIR, "settings.yaml"));
    const worker = result.state.services["worker"];

    expect(worker.startCommand).toBe("npm run worker");
    expect(worker.buildCommand).toBe("npm run build");
    expect(worker.rootDirectory).toBe("/packages/worker");
    expect(worker.sleepApplication).toBe(true);
    expect(worker.preDeployCommand).toBe("npm run migrate");
  });

  test("loads bucket config into state", () => {
    const result = loadEnvironmentConfig(join(ENVS_DIR, "buckets.yaml"));

    expect(result.projectName).toBe("Test Project");
    expect(result.state.buckets).toEqual({
      "terraform-state": { id: "", name: "tachyon-terraform" },
      media: { id: "", name: "media-uploads" },
    });
  });

  test("throws on missing config file", () => {
    expect(() => loadEnvironmentConfig(join(ENVS_DIR, "nonexistent.yaml"))).toThrow(
      "Config file not found",
    );
  });

  test("throws on missing template file", () => {
    writeFileSync(
      join(ENVS_DIR, "bad-template.yaml"),
      `
project: Test
environment: alpha
services:
  web:
    template: ../services/nonexistent.yaml
`,
    );

    expect(() => loadEnvironmentConfig(join(ENVS_DIR, "bad-template.yaml"))).toThrow(
      "Template not found",
    );
  });

  test("throws on malformed YAML", () => {
    writeFileSync(join(ENVS_DIR, "bad.yaml"), "{{{{not yaml");

    expect(() => loadEnvironmentConfig(join(ENVS_DIR, "bad.yaml"))).toThrow();
  });

  test("throws on missing required field", () => {
    writeFileSync(
      join(ENVS_DIR, "no-project.yaml"),
      `
environment: alpha
services:
  web:
    source:
      image: nginx:latest
`,
    );

    expect(() => loadEnvironmentConfig(join(ENVS_DIR, "no-project.yaml"))).toThrow();
  });

  test("throws on invalid restart_policy", () => {
    writeFileSync(
      join(ENVS_DIR, "bad-restart.yaml"),
      `
project: Test
environment: alpha
services:
  web:
    source:
      image: nginx:latest
    restart_policy: INVALID
`,
    );

    expect(() => loadEnvironmentConfig(join(ENVS_DIR, "bad-restart.yaml"))).toThrow();
  });
});
