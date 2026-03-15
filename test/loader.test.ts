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

domains:
  - "%{environment}.example.com"
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

  // Write a template with invalid YAML content
  writeFileSync(join(SERVICES_DIR, "bad-yaml.yaml"), "{{{{not yaml at all");

  // Write an environment file that references the bad YAML template
  writeFileSync(
    join(ENVS_DIR, "bad-template-yaml.yaml"),
    `
project: Test
environment: alpha
services:
  web:
    template: ../services/bad-yaml.yaml
`,
  );

  // Write an environment file with region config
  writeFileSync(
    join(ENVS_DIR, "region.yaml"),
    `
project: Test Project
environment: alpha

services:
  web:
    source:
      image: nginx:latest
    region:
      region: us-west-2
      num_replicas: 3
`,
  );

  // Write an environment file with healthcheck config
  writeFileSync(
    join(ENVS_DIR, "healthcheck.yaml"),
    `
project: Test Project
environment: alpha

services:
  web:
    source:
      image: nginx:latest
    healthcheck:
      path: /health
      timeout: 60
`,
  );

  // Write an environment file with builder, watch_patterns, draining/overlap, ipv6
  writeFileSync(
    join(ENVS_DIR, "new-settings.yaml"),
    `
project: Test Project
environment: alpha

services:
  web:
    source:
      image: nginx:latest
    builder: NIXPACKS
    watch_patterns:
      - "src/**"
      - "package.json"
    draining_seconds: 30
    overlap_seconds: 10
    ipv6_egress: true
`,
  );

  // Write an environment file with branch
  writeFileSync(
    join(ENVS_DIR, "branch.yaml"),
    `
project: Test Project
environment: alpha

services:
  web:
    source:
      repo: github.com/org/app
    branch: develop
`,
  );

  // Write an environment file with railway_domain: true
  writeFileSync(
    join(ENVS_DIR, "railway-domain-bool.yaml"),
    `
project: Test Project
environment: alpha

services:
  web:
    source:
      image: nginx:latest
    railway_domain: true
`,
  );

  // Write an environment file with railway_domain object
  writeFileSync(
    join(ENVS_DIR, "railway-domain-obj.yaml"),
    `
project: Test Project
environment: alpha

services:
  web:
    source:
      image: nginx:latest
    railway_domain:
      target_port: 8080
`,
  );

  // Write an environment file with tcp_proxies (single port)
  writeFileSync(
    join(ENVS_DIR, "tcp-proxy-single.yaml"),
    `
project: Test Project
environment: alpha

services:
  db:
    source:
      image: postgres:16
    tcp_proxies:
      - 5432
`,
  );

  // Write an environment file with tcp_proxies (plural)
  writeFileSync(
    join(ENVS_DIR, "tcp-proxies-multi.yaml"),
    `
project: Test Project
environment: alpha

services:
  db:
    source:
      image: postgres:16
    tcp_proxies:
      - 5432
      - 6379
`,
  );

  // Write an environment file with limits
  writeFileSync(
    join(ENVS_DIR, "limits.yaml"),
    `
project: Test Project
environment: alpha

services:
  web:
    source:
      image: nginx:latest
    limits:
      memory_gb: 8
      vcpus: 4
`,
  );

  // Write an environment file with domain objects (target_port)
  writeFileSync(
    join(ENVS_DIR, "domain-objects.yaml"),
    `
project: Test Project
environment: alpha

services:
  web:
    source:
      image: nginx:latest
    domains:
      - domain: app.example.com
        target_port: 3000
      - api.example.com
`,
  );

  // Write a template with an invalid/unknown field
  writeFileSync(
    join(SERVICES_DIR, "invalid-field.yaml"),
    `
source:
  image: nginx:latest
unknown_field: "foo"
`,
  );

  // Write an environment file that references the invalid-field template
  writeFileSync(
    join(ENVS_DIR, "invalid-template-field.yaml"),
    `
project: Test
environment: alpha
services:
  web:
    template: ../services/invalid-field.yaml
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
    const web = result.state.services.web;

    expect(web.source).toEqual({ image: "ghcr.io/org/web:alpha" });
  });

  test("resolves template params in variables", () => {
    const result = loadEnvironmentConfig(join(ENVS_DIR, "alpha.yaml"));
    const web = result.state.services.web;

    expect(web.variables.APP_ENV).toBe("alpha");
  });

  test("passes through Railway ${{}} references", () => {
    const result = loadEnvironmentConfig(join(ENVS_DIR, "alpha.yaml"));
    const web = result.state.services.web;

    expect(web.variables.DB_URL).toBe("${{Postgres.DATABASE_URL}}");
  });

  test("merges environment variables into template", () => {
    const result = loadEnvironmentConfig(join(ENVS_DIR, "alpha.yaml"));
    const web = result.state.services.web;

    // EXTRA was added by env file
    expect(web.variables.EXTRA).toBe("added");
  });

  test("handles null variable overrides (deletions)", () => {
    const result = loadEnvironmentConfig(join(ENVS_DIR, "alpha.yaml"));
    const web = result.state.services.web;

    // REPLICAS was set to null in env file, should be absent from resolved vars
    expect("REPLICAS" in web.variables).toBe(false);
    // Should appear in deletedVars
    expect(result.deletedVars.web).toContain("REPLICAS");
  });

  test("resolves domain from template params into domains array", () => {
    const result = loadEnvironmentConfig(join(ENVS_DIR, "alpha.yaml"));
    const web = result.state.services.web;

    expect(web.domains).toEqual([{ domain: "alpha.example.com" }]);
  });

  test("handles inline services without templates", () => {
    const result = loadEnvironmentConfig(join(ENVS_DIR, "alpha.yaml"));
    const redis = result.state.services.redis;

    expect(redis.source).toEqual({ image: "bitnami/redis:7.4" });
    expect(redis.variables.ALLOW_EMPTY_PASSWORD).toBe("yes");
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
    const web = result.state.services.web;

    expect(web.domains).toEqual([{ domain: "app.example.com" }, { domain: "www.example.com" }]);
  });

  test("loads new service settings from template and inline", () => {
    const result = loadEnvironmentConfig(join(ENVS_DIR, "settings.yaml"));
    const worker = result.state.services.worker;

    expect(worker.startCommand).toBe("npm run worker");
    expect(worker.buildCommand).toBe("npm run build");
    expect(worker.rootDirectory).toBe("/packages/worker");
    expect(worker.sleepApplication).toBe(true);
    expect(worker.preDeployCommand).toEqual(["npm run migrate"]);
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

  test("throws on invalid YAML in template file", () => {
    expect(() => loadEnvironmentConfig(join(ENVS_DIR, "bad-template-yaml.yaml"))).toThrow(
      "Invalid YAML in template",
    );
  });

  test("loads region with num_replicas", () => {
    const result = loadEnvironmentConfig(join(ENVS_DIR, "region.yaml"));
    const web = result.state.services.web;

    expect(web.region).toEqual({
      region: "us-west-2",
      numReplicas: 3,
    });
  });

  test("loads healthcheck with timeout", () => {
    const result = loadEnvironmentConfig(join(ENVS_DIR, "healthcheck.yaml"));
    const web = result.state.services.web;

    expect(web.healthcheck).toEqual({
      path: "/health",
      timeout: 60,
    });
  });

  test("throws on invalid service template with unknown field", () => {
    expect(() => loadEnvironmentConfig(join(ENVS_DIR, "invalid-template-field.yaml"))).toThrow(
      "Invalid service template",
    );
  });

  test("throws on invalid cron schedule", () => {
    writeFileSync(
      join(ENVS_DIR, "bad-cron.yaml"),
      `
project: Test
environment: alpha
services:
  web:
    source:
      image: nginx:latest
    cron_schedule: "not a cron"
`,
    );

    expect(() => loadEnvironmentConfig(join(ENVS_DIR, "bad-cron.yaml"))).toThrow();
  });

  test("accepts valid cron schedule", () => {
    writeFileSync(
      join(ENVS_DIR, "good-cron.yaml"),
      `
project: Test
environment: alpha
services:
  worker:
    source:
      image: nginx:latest
    cron_schedule: "*/5 * * * *"
`,
    );

    const result = loadEnvironmentConfig(join(ENVS_DIR, "good-cron.yaml"));
    expect(result.state.services.worker.cronSchedule).toBe("*/5 * * * *");
  });

  test("loads builder, watch_patterns, draining_seconds, overlap_seconds, ipv6_egress", () => {
    const result = loadEnvironmentConfig(join(ENVS_DIR, "new-settings.yaml"));
    const web = result.state.services.web;

    expect(web.builder).toBe("NIXPACKS");
    expect(web.watchPatterns).toEqual(["src/**", "package.json"]);
    expect(web.drainingSeconds).toBe(30);
    expect(web.overlapSeconds).toBe(10);
    expect(web.ipv6EgressEnabled).toBe(true);
  });

  test("loads branch from config", () => {
    const result = loadEnvironmentConfig(join(ENVS_DIR, "branch.yaml"));
    const web = result.state.services.web;

    expect(web.branch).toBe("develop");
  });

  test("loads railway_domain: true as railwayDomain: {}", () => {
    const result = loadEnvironmentConfig(join(ENVS_DIR, "railway-domain-bool.yaml"));
    const web = result.state.services.web;

    expect(web.railwayDomain).toEqual({});
  });

  test("loads railway_domain object with target_port as railwayDomain with targetPort", () => {
    const result = loadEnvironmentConfig(join(ENVS_DIR, "railway-domain-obj.yaml"));
    const web = result.state.services.web;

    expect(web.railwayDomain).toEqual({ targetPort: 8080 });
  });

  test("loads tcp_proxies (single port) into tcpProxies array", () => {
    const result = loadEnvironmentConfig(join(ENVS_DIR, "tcp-proxy-single.yaml"));
    const db = result.state.services.db;

    expect(db.tcpProxies).toEqual([5432]);
  });

  test("loads tcp_proxies (plural) into tcpProxies array", () => {
    const result = loadEnvironmentConfig(join(ENVS_DIR, "tcp-proxies-multi.yaml"));
    const db = result.state.services.db;

    expect(db.tcpProxies).toEqual([5432, 6379]);
  });

  test("loads limits with memory_gb and vcpus", () => {
    const result = loadEnvironmentConfig(join(ENVS_DIR, "limits.yaml"));
    const web = result.state.services.web;

    expect(web.limits).toEqual({ memoryGB: 8, vCPUs: 4 });
  });

  test("loads domain objects with target_port into domains array with targetPort", () => {
    const result = loadEnvironmentConfig(join(ENVS_DIR, "domain-objects.yaml"));
    const web = result.state.services.web;

    expect(web.domains).toEqual([
      { domain: "app.example.com", targetPort: 3000 },
      { domain: "api.example.com" },
    ]);
  });

  test("lenient mode does not throw on missing env vars", () => {
    writeFileSync(
      join(ENVS_DIR, "env-vars.yaml"),
      `
project: Test
environment: alpha
services:
  web:
    source:
      image: nginx:latest
    variables:
      SECRET: "\${UNDEFINED_SECRET}"
`,
    );

    // Strict mode throws
    expect(() => loadEnvironmentConfig(join(ENVS_DIR, "env-vars.yaml"))).toThrow(
      "UNDEFINED_SECRET",
    );

    // Lenient mode succeeds
    const result = loadEnvironmentConfig(join(ENVS_DIR, "env-vars.yaml"), { lenient: true });
    expect(result.state.services.web.variables.SECRET).toBe("${UNDEFINED_SECRET}");
  });

  test("%{service_name} is automatically available in templates", () => {
    writeFileSync(
      join(SERVICES_DIR, "self-ref.yaml"),
      `
source:
  image: nginx:latest
variables:
  NAME: "%{service_name}"
domains:
  - "%{service_name}.example.com"
`,
    );
    writeFileSync(
      join(ENVS_DIR, "self-ref.yaml"),
      `
project: Test
environment: alpha
services:
  my-api:
    template: ../services/self-ref.yaml
`,
    );

    const result = loadEnvironmentConfig(join(ENVS_DIR, "self-ref.yaml"));
    const svc = result.state.services["my-api"];
    expect(svc.variables.NAME).toBe("my-api");
    expect(svc.domains[0].domain).toBe("my-api.example.com");
  });

  test("overriding service_name as a param throws", () => {
    writeFileSync(
      join(ENVS_DIR, "override-service-name.yaml"),
      `
project: Test
environment: alpha
services:
  web:
    template: ../services/self-ref.yaml
    params:
      service_name: custom
`,
    );

    expect(() => loadEnvironmentConfig(join(ENVS_DIR, "override-service-name.yaml"))).toThrow(
      "built-in parameter",
    );
  });

  test("defining service_name in template params throws", () => {
    writeFileSync(
      join(SERVICES_DIR, "bad-param.yaml"),
      `
params:
  service_name:
    default: oops
source:
  image: nginx:latest
`,
    );
    writeFileSync(
      join(ENVS_DIR, "bad-template-param.yaml"),
      `
project: Test
environment: alpha
services:
  web:
    template: ../services/bad-param.yaml
`,
    );

    expect(() => loadEnvironmentConfig(join(ENVS_DIR, "bad-template-param.yaml"))).toThrow(
      "built-in parameter",
    );
  });

  test("param placeholders accepted in validated fields (cron, builder, restart_policy, volume mount)", () => {
    writeFileSync(
      join(SERVICES_DIR, "param-validated.yaml"),
      `
params:
  schedule:
    required: true
  policy:
    required: true
  build:
    required: true
  mount:
    required: true

source:
  image: nginx:latest
cron_schedule: "%{schedule}"
restart_policy: "%{policy}"
builder: "%{build}"
volume:
  mount: "%{mount}"
  name: data
`,
    );
    writeFileSync(
      join(ENVS_DIR, "param-validated.yaml"),
      `
project: Test
environment: alpha
services:
  worker:
    template: ../services/param-validated.yaml
    params:
      schedule: "*/5 * * * *"
      policy: ON_FAILURE
      build: NIXPACKS
      mount: /data
`,
    );

    const result = loadEnvironmentConfig(join(ENVS_DIR, "param-validated.yaml"));
    const svc = result.state.services.worker;
    expect(svc.cronSchedule).toBe("*/5 * * * *");
    expect(svc.restartPolicy).toBe("ON_FAILURE");
    expect(svc.builder).toBe("NIXPACKS");
    expect(svc.volume?.mount).toBe("/data");
  });
});
