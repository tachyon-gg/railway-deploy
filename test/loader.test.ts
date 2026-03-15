import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { loadProjectConfig, mergeServiceEntry } from "../src/config/loader.js";
import { logger } from "../src/logger.js";

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
environments:
  - alpha

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
environments:
  - alpha

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
environments:
  - alpha

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
environments:
  - alpha

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
environments:
  - alpha
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
environments:
  - alpha

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
environments:
  - alpha

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
environments:
  - alpha

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
environments:
  - alpha

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
environments:
  - alpha

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
environments:
  - alpha

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
environments:
  - alpha

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
environments:
  - alpha

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
environments:
  - alpha

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
environments:
  - alpha

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
environments:
  - alpha
services:
  web:
    template: ../services/invalid-field.yaml
`,
  );
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("loadProjectConfig", () => {
  test("loads and resolves a full environment config", () => {
    const result = loadProjectConfig(join(ENVS_DIR, "alpha.yaml"), "alpha");

    expect(result.projectName).toBe("Test Project");
    expect(result.environmentName).toBe("alpha");
  });

  test("resolves template params in source image", () => {
    const result = loadProjectConfig(join(ENVS_DIR, "alpha.yaml"), "alpha");
    const web = result.state.services.web;

    expect(web.source).toEqual({ image: "ghcr.io/org/web:alpha" });
  });

  test("resolves template params in variables", () => {
    const result = loadProjectConfig(join(ENVS_DIR, "alpha.yaml"), "alpha");
    const web = result.state.services.web;

    expect(web.variables.APP_ENV).toBe("alpha");
  });

  test("passes through Railway ${{}} references", () => {
    const result = loadProjectConfig(join(ENVS_DIR, "alpha.yaml"), "alpha");
    const web = result.state.services.web;

    expect(web.variables.DB_URL).toBe("${{Postgres.DATABASE_URL}}");
  });

  test("merges environment variables into template", () => {
    const result = loadProjectConfig(join(ENVS_DIR, "alpha.yaml"), "alpha");
    const web = result.state.services.web;

    // EXTRA was added by env file
    expect(web.variables.EXTRA).toBe("added");
  });

  test("handles null variable overrides (deletions)", () => {
    const result = loadProjectConfig(join(ENVS_DIR, "alpha.yaml"), "alpha");
    const web = result.state.services.web;

    // REPLICAS was set to null in env file, should be absent from resolved vars
    expect("REPLICAS" in web.variables).toBe(false);
    // Should appear in deletedVars
    expect(result.deletedVars.web).toContain("REPLICAS");
  });

  test("resolves domain from template params into domains array", () => {
    const result = loadProjectConfig(join(ENVS_DIR, "alpha.yaml"), "alpha");
    const web = result.state.services.web;

    expect(web.domains).toEqual([{ domain: "alpha.example.com" }]);
  });

  test("handles inline services without templates", () => {
    const result = loadProjectConfig(join(ENVS_DIR, "alpha.yaml"), "alpha");
    const redis = result.state.services.redis;

    expect(redis.source).toEqual({ image: "bitnami/redis:7.4" });
    expect(redis.variables.ALLOW_EMPTY_PASSWORD).toBe("yes");
    expect(redis.volume).toEqual({ mount: "/data", name: "redis-data" });
  });

  test("resolves shared variables", () => {
    const result = loadProjectConfig(join(ENVS_DIR, "alpha.yaml"), "alpha");

    expect(result.state.sharedVariables).toEqual({
      APP_ENVIRONMENT: "alpha",
    });
  });

  test("sets projectId and environmentId to empty (resolved later)", () => {
    const result = loadProjectConfig(join(ENVS_DIR, "alpha.yaml"), "alpha");

    expect(result.state.projectId).toBe("");
    expect(result.state.environmentId).toBe("");
  });

  test("loads multiple domains", () => {
    const result = loadProjectConfig(join(ENVS_DIR, "multi-domain.yaml"), "alpha");
    const web = result.state.services.web;

    expect(web.domains).toEqual([{ domain: "app.example.com" }, { domain: "www.example.com" }]);
  });

  test("loads new service settings from template and inline", () => {
    const result = loadProjectConfig(join(ENVS_DIR, "settings.yaml"), "alpha");
    const worker = result.state.services.worker;

    expect(worker.startCommand).toBe("npm run worker");
    expect(worker.buildCommand).toBe("npm run build");
    expect(worker.rootDirectory).toBe("/packages/worker");
    expect(worker.sleepApplication).toBe(true);
    expect(worker.preDeployCommand).toEqual(["npm run migrate"]);
  });

  test("loads bucket config into state", () => {
    const result = loadProjectConfig(join(ENVS_DIR, "buckets.yaml"), "alpha");

    expect(result.projectName).toBe("Test Project");
    expect(result.state.buckets).toEqual({
      "terraform-state": { id: "", name: "tachyon-terraform" },
      media: { id: "", name: "media-uploads" },
    });
  });

  test("throws on missing config file", () => {
    expect(() => loadProjectConfig(join(ENVS_DIR, "nonexistent.yaml"), "alpha")).toThrow(
      "Config file not found",
    );
  });

  test("throws on missing template file", () => {
    writeFileSync(
      join(ENVS_DIR, "bad-template.yaml"),
      `
project: Test
environments:
  - alpha
services:
  web:
    template: ../services/nonexistent.yaml
`,
    );

    expect(() => loadProjectConfig(join(ENVS_DIR, "bad-template.yaml"), "alpha")).toThrow(
      "Template not found",
    );
  });

  test("throws on malformed YAML", () => {
    writeFileSync(join(ENVS_DIR, "bad.yaml"), "{{{{not yaml");

    expect(() => loadProjectConfig(join(ENVS_DIR, "bad.yaml"), "alpha")).toThrow();
  });

  test("throws on missing required field", () => {
    writeFileSync(
      join(ENVS_DIR, "no-project.yaml"),
      `
environments:
  - alpha
services:
  web:
    source:
      image: nginx:latest
`,
    );

    expect(() => loadProjectConfig(join(ENVS_DIR, "no-project.yaml"), "alpha")).toThrow();
  });

  test("throws on invalid restart_policy", () => {
    writeFileSync(
      join(ENVS_DIR, "bad-restart.yaml"),
      `
project: Test
environments:
  - alpha
services:
  web:
    source:
      image: nginx:latest
    restart_policy: INVALID
`,
    );

    expect(() => loadProjectConfig(join(ENVS_DIR, "bad-restart.yaml"), "alpha")).toThrow();
  });

  test("throws on invalid YAML in template file", () => {
    expect(() => loadProjectConfig(join(ENVS_DIR, "bad-template-yaml.yaml"), "alpha")).toThrow(
      "Invalid YAML in template",
    );
  });

  test("loads region with num_replicas", () => {
    const result = loadProjectConfig(join(ENVS_DIR, "region.yaml"), "alpha");
    const web = result.state.services.web;

    expect(web.region).toEqual({
      region: "us-west-2",
      numReplicas: 3,
    });
  });

  test("loads healthcheck with timeout", () => {
    const result = loadProjectConfig(join(ENVS_DIR, "healthcheck.yaml"), "alpha");
    const web = result.state.services.web;

    expect(web.healthcheck).toEqual({
      path: "/health",
      timeout: 60,
    });
  });

  test("throws on invalid service template with unknown field", () => {
    expect(() => loadProjectConfig(join(ENVS_DIR, "invalid-template-field.yaml"), "alpha")).toThrow(
      "Invalid service template",
    );
  });

  test("throws on invalid cron schedule", () => {
    writeFileSync(
      join(ENVS_DIR, "bad-cron.yaml"),
      `
project: Test
environments:
  - alpha
services:
  web:
    source:
      image: nginx:latest
    cron_schedule: "not a cron"
`,
    );

    expect(() => loadProjectConfig(join(ENVS_DIR, "bad-cron.yaml"), "alpha")).toThrow();
  });

  test("accepts valid cron schedule", () => {
    writeFileSync(
      join(ENVS_DIR, "good-cron.yaml"),
      `
project: Test
environments:
  - alpha
services:
  worker:
    source:
      image: nginx:latest
    cron_schedule: "*/5 * * * *"
`,
    );

    const result = loadProjectConfig(join(ENVS_DIR, "good-cron.yaml"), "alpha");
    expect(result.state.services.worker.cronSchedule).toBe("*/5 * * * *");
  });

  test("loads builder, watch_patterns, draining_seconds, overlap_seconds, ipv6_egress", () => {
    const result = loadProjectConfig(join(ENVS_DIR, "new-settings.yaml"), "alpha");
    const web = result.state.services.web;

    expect(web.builder).toBe("NIXPACKS");
    expect(web.watchPatterns).toEqual(["src/**", "package.json"]);
    expect(web.drainingSeconds).toBe(30);
    expect(web.overlapSeconds).toBe(10);
    expect(web.ipv6EgressEnabled).toBe(true);
  });

  test("loads branch from config", () => {
    const result = loadProjectConfig(join(ENVS_DIR, "branch.yaml"), "alpha");
    const web = result.state.services.web;

    expect(web.branch).toBe("develop");
  });

  test("loads railway_domain: true as railwayDomain: {}", () => {
    const result = loadProjectConfig(join(ENVS_DIR, "railway-domain-bool.yaml"), "alpha");
    const web = result.state.services.web;

    expect(web.railwayDomain).toEqual({});
  });

  test("loads railway_domain object with target_port as railwayDomain with targetPort", () => {
    const result = loadProjectConfig(join(ENVS_DIR, "railway-domain-obj.yaml"), "alpha");
    const web = result.state.services.web;

    expect(web.railwayDomain).toEqual({ targetPort: 8080 });
  });

  test("loads tcp_proxies (single port) into tcpProxies array", () => {
    const result = loadProjectConfig(join(ENVS_DIR, "tcp-proxy-single.yaml"), "alpha");
    const db = result.state.services.db;

    expect(db.tcpProxies).toEqual([5432]);
  });

  test("loads tcp_proxies (plural) into tcpProxies array", () => {
    const result = loadProjectConfig(join(ENVS_DIR, "tcp-proxies-multi.yaml"), "alpha");
    const db = result.state.services.db;

    expect(db.tcpProxies).toEqual([5432, 6379]);
  });

  test("loads limits with memory_gb and vcpus", () => {
    const result = loadProjectConfig(join(ENVS_DIR, "limits.yaml"), "alpha");
    const web = result.state.services.web;

    expect(web.limits).toEqual({ memoryGB: 8, vCPUs: 4 });
  });

  test("loads domain objects with target_port into domains array with targetPort", () => {
    const result = loadProjectConfig(join(ENVS_DIR, "domain-objects.yaml"), "alpha");
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
environments:
  - alpha
services:
  web:
    source:
      image: nginx:latest
    variables:
      SECRET: "\${UNDEFINED_SECRET}"
`,
    );

    // Strict mode throws
    expect(() => loadProjectConfig(join(ENVS_DIR, "env-vars.yaml"), "alpha")).toThrow(
      "UNDEFINED_SECRET",
    );

    // Lenient mode succeeds
    const result = loadProjectConfig(join(ENVS_DIR, "env-vars.yaml"), "alpha", { lenient: true });
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
environments:
  - alpha
services:
  my-api:
    template: ../services/self-ref.yaml
`,
    );

    const result = loadProjectConfig(join(ENVS_DIR, "self-ref.yaml"), "alpha");
    const svc = result.state.services["my-api"];
    expect(svc.variables.NAME).toBe("my-api");
    expect(svc.domains[0].domain).toBe("my-api.example.com");
  });

  test("overriding service_name as a param throws", () => {
    writeFileSync(
      join(ENVS_DIR, "override-service-name.yaml"),
      `
project: Test
environments:
  - alpha
services:
  web:
    template: ../services/self-ref.yaml
    params:
      service_name: custom
`,
    );

    expect(() => loadProjectConfig(join(ENVS_DIR, "override-service-name.yaml"), "alpha")).toThrow(
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
environments:
  - alpha
services:
  web:
    template: ../services/bad-param.yaml
`,
    );

    expect(() => loadProjectConfig(join(ENVS_DIR, "bad-template-param.yaml"), "alpha")).toThrow(
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
environments:
  - alpha
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

    const result = loadProjectConfig(join(ENVS_DIR, "param-validated.yaml"), "alpha");
    const svc = result.state.services.worker;
    expect(svc.cronSchedule).toBe("*/5 * * * *");
    expect(svc.restartPolicy).toBe("ON_FAILURE");
    expect(svc.builder).toBe("NIXPACKS");
    expect(svc.volume?.mount).toBe("/data");
  });

  test("throws on invalid builder after param expansion", () => {
    writeFileSync(
      join(ENVS_DIR, "bad-builder-param.yaml"),
      `
project: Test
environments:
  - alpha
services:
  web:
    template: ../services/param-validated.yaml
    params:
      schedule: "*/5 * * * *"
      policy: ON_FAILURE
      build: INVALID_BUILDER
      mount: /data
`,
    );

    expect(() => loadProjectConfig(join(ENVS_DIR, "bad-builder-param.yaml"), "alpha")).toThrow(
      "builder",
    );
  });

  test("throws on invalid volume mount after param expansion", () => {
    writeFileSync(
      join(ENVS_DIR, "bad-mount-param.yaml"),
      `
project: Test
environments:
  - alpha
services:
  web:
    template: ../services/param-validated.yaml
    params:
      schedule: "*/5 * * * *"
      policy: ON_FAILURE
      build: NIXPACKS
      mount: relative/path
`,
    );

    expect(() => loadProjectConfig(join(ENVS_DIR, "bad-mount-param.yaml"), "alpha")).toThrow(
      "volume.mount",
    );
  });

  test("throws on invalid cron_schedule after param expansion", () => {
    writeFileSync(
      join(ENVS_DIR, "bad-cron-param.yaml"),
      `
project: Test
environments:
  - alpha
services:
  web:
    template: ../services/param-validated.yaml
    params:
      schedule: "not-a-cron"
      policy: ON_FAILURE
      build: NIXPACKS
      mount: /data
`,
    );

    expect(() => loadProjectConfig(join(ENVS_DIR, "bad-cron-param.yaml"), "alpha")).toThrow(
      "cron_schedule",
    );
  });

  test("throws on invalid restart_policy after param expansion", () => {
    writeFileSync(
      join(ENVS_DIR, "bad-policy-param.yaml"),
      `
project: Test
environments:
  - alpha
services:
  web:
    template: ../services/param-validated.yaml
    params:
      schedule: "*/5 * * * *"
      policy: SOMETIMES
      build: NIXPACKS
      mount: /data
`,
    );

    expect(() => loadProjectConfig(join(ENVS_DIR, "bad-policy-param.yaml"), "alpha")).toThrow(
      "restart_policy",
    );
  });
});

describe("project config features", () => {
  test("shared variable defaults + env overrides", () => {
    writeFileSync(
      join(ENVS_DIR, "shared-vars.yaml"),
      `
project: Test
environments: [alpha, production]
shared_variables:
  DEFAULT_VAR: "shared"
  alpha:
    ALPHA_VAR: "a"
  production:
    PROD_VAR: "p"
services:
  web:
    source:
      image: nginx:latest
`,
    );

    const alpha = loadProjectConfig(join(ENVS_DIR, "shared-vars.yaml"), "alpha");
    expect(alpha.state.sharedVariables.DEFAULT_VAR).toBe("shared");
    expect(alpha.state.sharedVariables.ALPHA_VAR).toBe("a");
    expect("PROD_VAR" in alpha.state.sharedVariables).toBe(false);

    const prod = loadProjectConfig(join(ENVS_DIR, "shared-vars.yaml"), "production");
    expect(prod.state.sharedVariables.DEFAULT_VAR).toBe("shared");
    expect(prod.state.sharedVariables.PROD_VAR).toBe("p");
    expect("ALPHA_VAR" in prod.state.sharedVariables).toBe(false);
  });

  test("service defaults + env overrides merge (params)", () => {
    writeFileSync(
      join(ENVS_DIR, "svc-params-merge.yaml"),
      `
project: Test
environments: [alpha, production]
services:
  web:
    template: ../services/web.yaml
    params:
      replicas: "1"
    environments:
      alpha:
        params:
          environment: alpha
      production:
        params:
          environment: prod
          replicas: "5"
`,
    );

    const alpha = loadProjectConfig(join(ENVS_DIR, "svc-params-merge.yaml"), "alpha");
    const alphaWeb = alpha.state.services.web;
    // replicas comes from default ("1"), environment from alpha override
    expect(alphaWeb.variables.REPLICAS).toBe("1");
    expect(alphaWeb.variables.APP_ENV).toBe("alpha");

    const prod = loadProjectConfig(join(ENVS_DIR, "svc-params-merge.yaml"), "production");
    const prodWeb = prod.state.services.web;
    // replicas overridden to "5", environment from production override
    expect(prodWeb.variables.REPLICAS).toBe("5");
    expect(prodWeb.variables.APP_ENV).toBe("prod");
  });

  test("service scoping (environments block controls presence)", () => {
    writeFileSync(
      join(ENVS_DIR, "svc-scoping.yaml"),
      `
project: Test
environments: [alpha, production]
services:
  web:
    source:
      image: nginx:latest
  debug:
    source:
      image: debug:latest
    environments:
      alpha: {}
`,
    );

    const alpha = loadProjectConfig(join(ENVS_DIR, "svc-scoping.yaml"), "alpha");
    expect("web" in alpha.state.services).toBe(true);
    expect("debug" in alpha.state.services).toBe(true);

    const prod = loadProjectConfig(join(ENVS_DIR, "svc-scoping.yaml"), "production");
    expect("web" in prod.state.services).toBe(true);
    expect("debug" in prod.state.services).toBe(false);
  });

  test("service without environments block exists in all envs", () => {
    writeFileSync(
      join(ENVS_DIR, "svc-all-envs.yaml"),
      `
project: Test
environments: [alpha, production]
services:
  web:
    source:
      image: nginx:latest
  debug:
    source:
      image: debug:latest
    environments:
      alpha: {}
`,
    );

    const alpha = loadProjectConfig(join(ENVS_DIR, "svc-all-envs.yaml"), "alpha");
    expect("web" in alpha.state.services).toBe(true);

    const prod = loadProjectConfig(join(ENVS_DIR, "svc-all-envs.yaml"), "production");
    expect("web" in prod.state.services).toBe(true);
  });

  test("env override replaces domains entirely", () => {
    writeFileSync(
      join(ENVS_DIR, "svc-domain-override.yaml"),
      `
project: Test
environments: [alpha, production]
services:
  web:
    source:
      image: nginx:latest
    domains:
      - default.example.com
    environments:
      alpha:
        domains:
          - alpha.example.com
      production: {}
`,
    );

    const alpha = loadProjectConfig(join(ENVS_DIR, "svc-domain-override.yaml"), "alpha");
    expect(alpha.state.services.web.domains).toEqual([{ domain: "alpha.example.com" }]);

    const prod = loadProjectConfig(join(ENVS_DIR, "svc-domain-override.yaml"), "production");
    expect(prod.state.services.web.domains).toEqual([{ domain: "default.example.com" }]);
  });

  test("env override replaces source entirely", () => {
    writeFileSync(
      join(ENVS_DIR, "svc-source-override.yaml"),
      `
project: Test
environments: [alpha, production]
services:
  web:
    source:
      image: nginx:latest
    environments:
      alpha:
        source:
          image: nginx:alpha
      production: {}
`,
    );

    const alpha = loadProjectConfig(join(ENVS_DIR, "svc-source-override.yaml"), "alpha");
    expect(alpha.state.services.web.source).toEqual({ image: "nginx:alpha" });

    const prod = loadProjectConfig(join(ENVS_DIR, "svc-source-override.yaml"), "production");
    expect(prod.state.services.web.source).toEqual({ image: "nginx:latest" });
  });

  test("variables shallow merge", () => {
    writeFileSync(
      join(ENVS_DIR, "svc-vars-merge.yaml"),
      `
project: Test
environments: [alpha, production]
services:
  web:
    source:
      image: nginx:latest
    variables:
      SHARED: "yes"
      ENV_SPECIFIC: "default"
    environments:
      alpha:
        variables:
          ENV_SPECIFIC: "alpha"
          EXTRA: "added"
      production: {}
`,
    );

    const alpha = loadProjectConfig(join(ENVS_DIR, "svc-vars-merge.yaml"), "alpha");
    expect(alpha.state.services.web.variables.SHARED).toBe("yes");
    expect(alpha.state.services.web.variables.ENV_SPECIFIC).toBe("alpha");
    expect(alpha.state.services.web.variables.EXTRA).toBe("added");

    const prod = loadProjectConfig(join(ENVS_DIR, "svc-vars-merge.yaml"), "production");
    expect(prod.state.services.web.variables.SHARED).toBe("yes");
    expect(prod.state.services.web.variables.ENV_SPECIFIC).toBe("default");
    expect("EXTRA" in prod.state.services.web.variables).toBe(false);
  });

  test("throws on undeclared environment", () => {
    writeFileSync(
      join(ENVS_DIR, "declared-envs.yaml"),
      `
project: Test
environments: [alpha, production]
services:
  web:
    source:
      image: nginx:latest
`,
    );

    expect(() => loadProjectConfig(join(ENVS_DIR, "declared-envs.yaml"), "staging")).toThrow(
      "staging",
    );
  });

  test("shared variable key matching env name with non-object value throws", () => {
    writeFileSync(
      join(ENVS_DIR, "shared-var-collision.yaml"),
      `
project: Test
environments: [alpha]
shared_variables:
  alpha: "literal-string"
services:
  web:
    source:
      image: nginx:latest
`,
    );

    expect(() => loadProjectConfig(join(ENVS_DIR, "shared-var-collision.yaml"), "alpha")).toThrow(
      "matches a declared environment name",
    );
  });

  test("shared variable with object value on non-env key throws", () => {
    writeFileSync(
      join(ENVS_DIR, "shared-var-object.yaml"),
      `
project: Test
environments: [alpha]
shared_variables:
  MY_CONFIG:
    key: value
services:
  web:
    source:
      image: nginx:latest
`,
    );

    expect(() => loadProjectConfig(join(ENVS_DIR, "shared-var-object.yaml"), "alpha")).toThrow(
      "does not match any declared environment",
    );
  });

  test("warns on unrecognized environment key in service environments block", () => {
    writeFileSync(
      join(ENVS_DIR, "bad-env-key.yaml"),
      `
project: Test
environments: [alpha]
services:
  web:
    source:
      image: nginx:latest
    environments:
      alha: {}
`,
    );

    const warnings: string[] = [];
    logger.mockTypes((type) =>
      type === "warn"
        ? (...args: unknown[]) => warnings.push(args.map(String).join(" "))
        : () => {},
    );
    loadProjectConfig(join(ENVS_DIR, "bad-env-key.yaml"), "alpha");
    logger.restoreAll();

    expect(warnings.some((w) => w.includes("alha") && w.includes("not in the declared"))).toBe(
      true,
    );
  });

  describe("mergeServiceEntry", () => {
    test("no override returns service defaults unchanged", () => {
      const defaults = {
        source: { image: "nginx:latest" },
        variables: { FOO: "bar" },
        domains: ["example.com" as const],
      };

      const result = mergeServiceEntry(defaults);
      expect(result.source).toEqual({ image: "nginx:latest" });
      expect(result.variables).toEqual({ FOO: "bar" });
      expect(result.domains).toEqual(["example.com"]);
    });

    test("params shallow merge", () => {
      const defaults = {
        source: { image: "nginx:latest" },
        params: { a: "1", b: "2" },
      };

      const result = mergeServiceEntry(defaults, { params: { b: "override", c: "3" } });
      expect(result.params).toEqual({ a: "1", b: "override", c: "3" });
    });

    test("variables shallow merge", () => {
      const defaults = {
        source: { image: "nginx:latest" },
        variables: { SHARED: "yes", OVERRIDE: "default" },
      };

      const result = mergeServiceEntry(defaults, {
        variables: { OVERRIDE: "new", EXTRA: "added" },
      });
      expect(result.variables).toEqual({ SHARED: "yes", OVERRIDE: "new", EXTRA: "added" });
    });

    test("domains replaced by override", () => {
      const defaults = {
        source: { image: "nginx:latest" },
        domains: ["default.example.com" as const],
      };

      const result = mergeServiceEntry(defaults, { domains: ["override.example.com"] });
      expect(result.domains).toEqual(["override.example.com"]);
    });

    test("scalar fields replaced by override", () => {
      const defaults = {
        source: { image: "nginx:latest" },
        start_command: "npm start",
        builder: "NIXPACKS" as const,
      };

      const result = mergeServiceEntry(defaults, {
        start_command: "bun run start",
        builder: "HEROKU",
      });
      expect(result.start_command).toBe("bun run start");
      expect(result.builder).toBe("HEROKU");
      // source unchanged
      expect(result.source).toEqual({ image: "nginx:latest" });
    });

    test("template replaced by override clears default params", () => {
      const defaults = {
        template: "../services/web.yaml",
        params: { tag: "latest" },
      };

      const result = mergeServiceEntry(defaults, {
        template: "../services/web-prod.yaml",
      });
      expect(result.template).toBe("../services/web-prod.yaml");
      // Default params are cleared when template changes — they belong to the old template
      expect(result.params).toBeUndefined();
    });

    test("template replaced by override uses override params exclusively", () => {
      const defaults = {
        template: "../services/web.yaml",
        params: { tag: "latest", old_param: "value" },
      };

      const result = mergeServiceEntry(defaults, {
        template: "../services/web-prod.yaml",
        params: { new_param: "prod" },
      });
      expect(result.template).toBe("../services/web-prod.yaml");
      expect(result.params).toEqual({ new_param: "prod" });
    });
  });

  test("per-environment template override loads different template", () => {
    writeFileSync(
      join(SERVICES_DIR, "alt-web.yaml"),
      `
source:
  image: nginx:stable
variables:
  ALT: "true"
`,
    );
    writeFileSync(
      join(ENVS_DIR, "template-override.yaml"),
      `
project: Test
environments: [alpha, production]
services:
  web:
    template: ../services/web.yaml
    params:
      environment: alpha
    environments:
      alpha: {}
      production:
        template: ../services/alt-web.yaml
`,
    );

    const alpha = loadProjectConfig(join(ENVS_DIR, "template-override.yaml"), "alpha");
    expect(alpha.state.services.web.source).toEqual({ image: "ghcr.io/org/web:alpha" });

    const prod = loadProjectConfig(join(ENVS_DIR, "template-override.yaml"), "production");
    expect(prod.state.services.web.source).toEqual({ image: "nginx:stable" });
    expect(prod.state.services.web.variables.ALT).toBe("true");
  });
});
