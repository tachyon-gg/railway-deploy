# railway-deploy

[![CI](https://github.com/tachyon-gg/railway-deploy/actions/workflows/ci.yml/badge.svg)](https://github.com/tachyon-gg/railway-deploy/actions/workflows/ci.yml)
[![Integration Tests](https://github.com/tachyon-gg/railway-deploy/actions/workflows/integration.yml/badge.svg)](https://github.com/tachyon-gg/railway-deploy/actions/workflows/integration.yml)
[![codecov](https://codecov.io/gh/tachyon-gg/railway-deploy/graph/badge.svg)](https://codecov.io/gh/tachyon-gg/railway-deploy)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1)](https://bun.sh/)
[![Biome](https://img.shields.io/badge/linter-Biome-60a5fa)](https://biomejs.dev/)

Declarative infrastructure management for [Railway](https://railway.com). Define your Railway project's services, variables, domains, volumes, and buckets in YAML, and `railway-deploy` will diff against the live state and apply changes atomically -- like Terraform, but purpose-built for Railway.

## Quick start

```bash
# Install
npx @tachyon-gg/railway-deploy --help

# Validate a config file
npx @tachyon-gg/railway-deploy --validate project.yaml

# Dry-run (show what would change)
npx @tachyon-gg/railway-deploy project.yaml -e production

# Apply changes
npx @tachyon-gg/railway-deploy --apply -e production project.yaml
```

## CLI flags

| Flag | Description |
|------|-------------|
| `-e, --environment <name>` | Target environment (required except for `--validate`) |
| `--apply` | Execute changes (default: dry-run) |
| `--stage` | Stage changes in Railway without committing (preview in dashboard) |
| `-y, --yes` | Skip confirmation for destructive ops |
| `--allow-data-loss` | Allow operations that can cause data loss (e.g., volume deletion) |
| `--env-file <path>` | Load `.env` file for `${VAR}` resolution |
| `-v, --verbose` | Show detailed diffs (old -> new values) |
| `--no-color` | Disable ANSI color output |
| `--validate` | Validate config without connecting to Railway |

## Environment variables

| Variable | Description |
|----------|-------------|
| `RAILWAY_TOKEN` | Railway API token (required for all API operations) |

---

## Config reference

Project configs are YAML files describing the desired state of a Railway project across one or more environments. Add schema support to your editor:

```yaml
# yaml-language-server: $schema=./schemas/project.schema.json
```

### Top-level structure

```yaml
project: My Project              # Railway project name (must match exactly)
environments:                    # Environments to manage
  - staging
  - production

shared_variables: { ... }        # Variables shared across all services
services: { ... }                # Service definitions
volumes: { ... }                 # Persistent volume definitions
buckets: { ... }                 # S3-compatible bucket definitions
```

### Shared variables

Shared variables are available to all services in an environment. Use the string shorthand for values that are the same everywhere, or the object form for per-environment overrides:

```yaml
shared_variables:
  # String shorthand — same value in all environments
  ADMIN_PORT: "8081"
  PUBLIC_PORT: "8080"

  # Object form — default value with per-environment overrides
  JWT_SECRET:
    value: ${JWT_SECRET_DEFAULT}
    environments:
      staging:
        value: ${JWT_SECRET_STAGING}
      production:
        value: ${JWT_SECRET_PROD}
```

Supports `${ENV_VAR}` syntax (resolved from your local environment or `--env-file`) and `${{shared.OTHER_VAR}}` self-references.

> **Note:** Shared variables cannot contain `${{service.VAR}}` cross-service references. Railway resolves shared variables without a service context.

### Volumes

Volumes are declared at the top level with optional per-environment overrides. Services reference them by name.

```yaml
volumes:
  pg-data:
    size_mb: 50000
    region: us-east4
    environments:
      production:
        size_mb: 100000

  redis-data: {}                 # Minimal declaration — Railway defaults

services:
  postgres:
    source:
      image: postgres:17
    volume:                      # Reference a declared volume
      name: pg-data
      mount: /var/lib/postgresql/data
```

Every volume referenced by a service must be declared in the `volumes` block.

### Buckets

S3-compatible Railway buckets. The key is the bucket name.

```yaml
buckets:
  media-uploads:
    region: iad
    environments:
      eu-production:
        region: fra

  logs: {}                       # Minimal — uses default region
```

### Services

Each service defines defaults that apply to all environments. Per-environment overrides go under `environments.<name>`:

```yaml
services:
  web:
    source:
      repo: myorg/web-app
    start_command: npm start
    variables:
      PORT: "3000"
    environments:
      staging:
        branch: develop
      production:
        branch: main
        wait_for_ci: true

  # Service without environments block — exists in all environments
  redis:
    source:
      image: redis:7

  # Service scoped to specific environments
  debug-tools:
    source:
      image: debug:latest
    environments:
      staging: {}                # Only in staging
```

#### Service scope rules

- Service **has** `environments` block -> only exists in environments listed there
- Service **has no** `environments` block -> exists in ALL declared environments

#### Merge rules

When a service has per-environment overrides:

| Field type | Merge behavior |
|------------|---------------|
| `params`, `variables` | Shallow merge (override keys replace defaults) |
| `domains`, `source`, `volume`, `region`, `healthcheck` | Override replaces entirely |
| Scalar fields (`start_command`, `builder`, etc.) | Override replaces |

---

### Service fields reference

Every field below can be used on service defaults, per-environment overrides, and templates.

#### Source

```yaml
source:
  image: nginx:latest            # Docker image (Docker Hub, GHCR, etc.)
  # OR
  repo: myorg/my-repo            # GitHub repository

branch: main                     # Branch to deploy from (GitHub repos)
wait_for_ci: true                # Wait for GitHub Actions to pass before deploying

registry_credentials:            # For private container registries
  username: ${REGISTRY_USER}
  password: ${REGISTRY_PASS}

auto_updates:                    # Auto-update schedule for image-based services
  type: patch
  schedule:
    - day: 0                     # Sunday
      start_hour: 0
      end_hour: 24
    - day: 1                     # Monday
      start_hour: 0
      end_hour: 24
```

#### Build

```yaml
builder: NIXPACKS               # RAILPACK (default), NIXPACKS, HEROKU, PAKETO, DOCKERFILE
build_command: npm run build     # Custom build command
dockerfile_path: Dockerfile.prod # Path to Dockerfile
root_directory: /packages/api    # Root directory (monorepo support)
watch_patterns:                  # File patterns that trigger deploys
  - /packages/api/src/**
  - /packages/shared/**
railway_config_file: railway.toml # Path to railway.json/toml
metal: true                      # Enable Metal build environment (faster builds)
```

#### Deploy

```yaml
start_command: npm start         # Custom start command

pre_deploy_command:              # Run before deployment (e.g., migrations)
  - npm run migrate
  - npm run seed

cron_schedule: "*/5 * * * *"     # Cron schedule (5-field format)
                                 # Note: cron forces restart_policy to NEVER
                                 # and disables serverless

healthcheck:                     # HTTP healthcheck
  path: /health
  timeout: 300                   # Timeout in seconds (default: 300)

# Restart policy — string shorthand or object with max_retries
restart_policy: ALWAYS           # ALWAYS, NEVER, or ON_FAILURE

restart_policy:                  # Object form for ON_FAILURE with retries
  type: ON_FAILURE
  max_retries: 5

serverless: true                 # Enable serverless sleeping (scale to zero when idle)
draining_seconds: 30             # Graceful shutdown timeout (SIGTERM to SIGKILL)
overlap_seconds: 10              # Blue-green deploy overlap duration
```

#### Networking

```yaml
# Custom domains
domains:
  - app.example.com              # Simple domain
  - domain: api.example.com      # Domain with target port
    target_port: 8080

# Railway-provided domain (*.up.railway.app)
railway_domain: true             # Generate a railway domain
railway_domain:                  # ...with a specific target port
  target_port: 3000

# TCP proxies (for non-HTTP services like databases)
tcp_proxies: [5432, 6379]

# Private networking
private_hostname: postgres       # Internal DNS hostname for service-to-service communication

# Outbound networking
ipv6_egress: true                # Enable IPv6 outbound traffic
static_outbound_ips: true        # Assign permanent outbound IP addresses
```

#### Scaling

```yaml
region:                          # Deployment region
  region: us-east4
  num_replicas: 3                # Horizontal replicas (default: 1)

limits:                          # Resource limits per replica
  memory_gb: 8
  vcpus: 4
```

#### Storage

```yaml
volume:                          # Reference a top-level volume
  name: pg-data                  # Must match a key in the volumes block
  mount: /var/lib/postgresql/data # Absolute mount path
```

#### Variables

```yaml
variables:
  PORT: "3000"
  DATABASE_URL: ${{Postgres.DATABASE_URL}}    # Railway runtime reference
  API_KEY: ${LOCAL_API_KEY}                    # Resolved from local env at config time
  OLD_VAR: null                                # Marks for deletion
```

### Variable syntax

| Syntax | Resolved | Description |
|--------|----------|-------------|
| `${ENV_VAR}` | At config load time | Reads from local environment (or `--env-file`) |
| `${{service.VAR}}` | At Railway runtime | Railway reference variable (cross-service) |
| `%{param}` | At config load time | Template parameter substitution |
| `%{service_name}` | At config load time | Built-in: the service's config key |
| `null` | N/A | Marks a variable for deletion |

`%{param}` is expanded first, so it can be used inside `${{}}` Railway references:

```yaml
variables:
  DATABASE_URL: ${{%{service_name}.DATABASE_URL}}
  REDIS_URL: ${{%{cache_service}.REDIS_URL}}
```

### Service templates

Templates extract reusable service definitions with parameterized values. The built-in `%{service_name}` param resolves to the service's key in the config.

```yaml
# services/web.yaml
params:
  tag:
    required: true
  replicas:
    default: "1"

source:
  image: ghcr.io/org/app:%{tag}

variables:
  APP_VERSION: "%{tag}"
  SERVICE_NAME: "%{service_name}"
  DATABASE_URL: ${{Postgres.DATABASE_URL}}

domains:
  - "%{service_name}.example.com"

healthcheck:
  path: /health
  timeout: 300

region:
  region: us-east4
  num_replicas: 1
```

Referenced from a project config:

```yaml
services:
  web:
    template: services/web.yaml
    params:
      replicas: "1"
    environments:
      staging:
        params:
          tag: alpha
      production:
        params:
          tag: v2.0.0
          replicas: "3"
        variables:
          EXTRA: added-by-env
          APP_VERSION: null           # Deletes the template-defined variable
        domains:
          - production.example.com    # Overrides template domains
```

### Complete example

```yaml
# yaml-language-server: $schema=./schemas/project.schema.json
project: My SaaS App
environments:
  - staging
  - production

shared_variables:
  APP_PORT: "3000"
  SENTRY_DSN:
    value: ${SENTRY_DSN_DEFAULT}
    environments:
      production:
        value: ${SENTRY_DSN_PROD}

volumes:
  pg-data:
    size_mb: 50000
    environments:
      production:
        size_mb: 200000
  redis-data: {}

buckets:
  uploads:
    region: iad

services:
  web:
    source:
      repo: myorg/web-app
    builder: NIXPACKS
    metal: true
    build_command: npm run build
    start_command: npm start
    root_directory: /packages/web
    pre_deploy_command: npm run migrate
    healthcheck:
      path: /health
      timeout: 60
    restart_policy:
      type: ON_FAILURE
      max_retries: 5
    serverless: true
    railway_domain: true
    variables:
      PORT: "3000"
      DATABASE_URL: ${{Postgres.DATABASE_URL}}
    environments:
      staging:
        branch: develop
        domains:
          - staging.example.com
      production:
        branch: main
        wait_for_ci: true
        domains:
          - app.example.com
          - domain: api.example.com
            target_port: 8080
        region:
          region: us-east4
          num_replicas: 2
        limits:
          memory_gb: 4
          vcpus: 2

  postgres:
    source:
      image: postgres:17
    private_hostname: postgres
    volume:
      name: pg-data
      mount: /var/lib/postgresql/data
    tcp_proxies: [5432]
    variables:
      POSTGRES_DB: myapp

  redis:
    source:
      image: redis:7-alpine
    private_hostname: redis
    volume:
      name: redis-data
      mount: /data
    tcp_proxies: [6379]

  worker:
    template: services/worker.yaml
    params:
      queue: default
    serverless: false

  cron:
    source:
      repo: myorg/web-app
    root_directory: /packages/cron
    cron_schedule: "0 0 * * *"
    start_command: node scripts/cleanup.js
```

## Known limitations

- **Service groups** are read-only. Railway's public API does not expose group creation -- groups can only be managed via the Railway dashboard. Existing groups are respected when reading config.
- **Custom domains** may require DNS verification to take effect.
- **Registry credentials** are always sent when configured but cannot be verified -- Railway does not return them in config responses.
- **Static outbound IPs** are managed via a separate API call (not atomic with the config patch). If the patch succeeds but the egress call fails, IPs may not be configured.

## JSON schemas

Editor support (autocompletion, validation) is available via JSON schemas:

- `schemas/project.schema.json` -- project config files
- `schemas/service-template.schema.json` -- service template files

## Development

```bash
bun install              # Install dependencies
bun run test             # Run unit tests
bun run test:integration # Run integration tests (requires RAILWAY_TOKEN)
bun run typecheck        # Type check
bun run lint             # Lint (Biome)
bun run lint:fix         # Auto-fix lint issues
bun run codegen          # Regenerate GraphQL types
bun run build            # Build for distribution
```
