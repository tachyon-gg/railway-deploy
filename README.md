# railway-deploy

[![CI](https://github.com/tachyon-gg/railway-deploy/actions/workflows/ci.yml/badge.svg)](https://github.com/tachyon-gg/railway-deploy/actions/workflows/ci.yml)
[![Integration Tests](https://github.com/tachyon-gg/railway-deploy/actions/workflows/integration.yml/badge.svg)](https://github.com/tachyon-gg/railway-deploy/actions/workflows/integration.yml)
[![codecov](https://codecov.io/gh/tachyon-gg/railway-deploy/graph/badge.svg)](https://codecov.io/gh/tachyon-gg/railway-deploy)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1)](https://bun.sh/)
[![Biome](https://img.shields.io/badge/linter-Biome-60a5fa)](https://biomejs.dev/)

Declarative infrastructure management for [Railway](https://railway.com). Define your Railway project's services, variables, domains, volumes, and buckets in YAML, and `railway-deploy` will diff against the live state and apply changes -- like Terraform, but purpose-built for Railway.

## Quick start

```bash
# Install
npx @tachyon-gg/railway-deploy --help

# Validate a config file
npx @tachyon-gg/railway-deploy --validate environments/production.yaml

# Dry-run (show what would change)
npx @tachyon-gg/railway-deploy environments/production.yaml

# Apply changes
npx @tachyon-gg/railway-deploy --apply environments/production.yaml
```

## CLI flags

| Flag | Description |
|------|-------------|
| `--apply` | Execute changes (default: dry-run) |
| `-y, --yes` | Skip confirmation for destructive ops |
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

Environment configs are YAML files describing the desired state of a Railway environment. Add schema support to your editor:

```yaml
# yaml-language-server: $schema=./schemas/environment.schema.json
```

### Top-level fields

```yaml
project: My Project          # Railway project name (must match exactly)
environment: production      # Railway environment name

shared_variables:            # Variables shared across all services
  APP_ENV: production
  DATABASE_URL: ${{Postgres.DATABASE_URL}}

services:                    # Map of service name -> config
  web: { ... }
  worker: { ... }

buckets:                     # S3-compatible buckets
  media:
    name: media-uploads
```

### Service configuration

Each service can be defined inline or via a template:

```yaml
services:
  # Inline service (Docker image)
  redis:
    source:
      image: redis:7
    variables:
      ALLOW_EMPTY_PASSWORD: "yes"

  # Inline service (GitHub repo)
  api:
    source:
      repo: myorg/my-api
    branch: main

  # Template-based service
  web:
    template: ../services/web.yaml
    params:
      tag: v1.2.3
    variables:
      EXTRA_VAR: override-value
```

### Full service options

Every option below can be used on both inline services and service templates.

#### Source

```yaml
source:
  image: nginx:latest              # Docker image (Docker Hub, GHCR, etc.)
  # OR
  repo: myorg/my-repo              # GitHub repository

branch: main                       # Branch to deploy from (GitHub repos)
check_suites: true                 # Wait for GitHub Actions to pass before deploying

registry_credentials:              # For private container registries
  username: ${REGISTRY_USER}
  password: ${REGISTRY_PASS}
```

#### Build

```yaml
builder: NIXPACKS                  # RAILPACK (default), DOCKERFILE, NIXPACKS, HEROKU, PAKETO
build_command: npm run build       # Custom build command
dockerfile_path: Dockerfile.prod   # Path to Dockerfile (when builder is DOCKERFILE)
root_directory: /packages/api      # Root directory (monorepo support)
watch_patterns:                    # File patterns that trigger deploys
  - /packages/api/src/**
  - /packages/shared/**
railway_config_file: railway.toml  # Path to railway.json/toml for config-as-code
```

#### Deploy

```yaml
start_command: npm start           # Custom start command
pre_deploy_command:                # Run before deployment (e.g., migrations)
  - npm run migrate
  - npm run seed
cron_schedule: "*/5 * * * *"       # Cron schedule (for scheduled jobs)
healthcheck:                       # HTTP healthcheck
  path: /health
  timeout: 300                     # Timeout in seconds (default: 300)
restart_policy: ON_FAILURE         # ALWAYS, NEVER, or ON_FAILURE
restart_policy_max_retries: 10     # Max retries (only with ON_FAILURE)
sleep_application: true            # Enable serverless sleeping
draining_seconds: 30               # Graceful shutdown timeout (seconds between SIGTERM and SIGKILL)
overlap_seconds: 10                # Blue-green deploy overlap duration
```

#### Networking

```yaml
# Custom domains
domains:
  - app.example.com                # Simple domain
  - domain: api.example.com        # Domain with target port
    target_port: 8080

# Railway-provided domain
railway_domain: true               # Generate a .up.railway.app domain
railway_domain:                    # ...with a specific target port
  target_port: 3000

# TCP proxies (for non-HTTP services like databases)
tcp_proxies: [5432, 6379]          # One or more ports

# Outbound networking
ipv6_egress: true                  # Enable IPv6 outbound traffic
static_outbound_ips: true          # Assign permanent outbound IP addresses
```

#### Scaling

```yaml
region:                            # Deployment region
  region: us-east-1
  num_replicas: 3                  # Horizontal replicas (default: 1)

limits:                            # Resource limits per replica
  memory_gb: 8
  vcpus: 4
```

#### Storage

```yaml
volume:                            # Persistent volume
  mount: /data                     # Mount path (must be absolute)
  name: my-data
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
| `null` | N/A | Marks a variable for deletion |

### Service templates

Templates extract reusable service definitions with parameterized values:

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
  DATABASE_URL: ${{Postgres.DATABASE_URL}}

domains:
  - "%{tag}.example.com"

healthcheck:
  path: /health
  timeout: 300

region:
  region: us-east-1
  num_replicas: 1
```

Referenced from an environment config:

```yaml
services:
  web:
    template: ../services/web.yaml
    params:
      tag: v2.0.0
      replicas: "3"
    variables:
      EXTRA: added-by-env      # Merged with template variables
      APP_VERSION: null         # Deletes the template-defined variable
    domains:
      - production.example.com  # Overrides template domain
```

Template override precedence: environment config values override template values for `source`, `domains`, and `variables`.

### Complete example

```yaml
# yaml-language-server: $schema=./schemas/environment.schema.json
project: My SaaS App
environment: production

shared_variables:
  APP_ENV: production
  SENTRY_DSN: ${SENTRY_DSN}

services:
  web:
    source:
      repo: myorg/web-app
    branch: main
    check_suites: true
    builder: NIXPACKS
    build_command: npm run build
    start_command: npm start
    root_directory: /packages/web
    pre_deploy_command: npm run migrate
    healthcheck:
      path: /health
      timeout: 60
    restart_policy: ON_FAILURE
    restart_policy_max_retries: 5
    domains:
      - app.example.com
      - domain: api.example.com
        target_port: 8080
    railway_domain: true
    region:
      region: us-east-1
      num_replicas: 2
    limits:
      memory_gb: 4
      vcpus: 2
    variables:
      PORT: "3000"
      DATABASE_URL: ${{Postgres.DATABASE_URL}}

  postgres:
    source:
      image: postgres:16
    volume:
      mount: /var/lib/postgresql/data
      name: pg-data
    tcp_proxies: [5432]
    variables:
      POSTGRES_DB: myapp

  redis:
    source:
      image: redis:7-alpine
    volume:
      mount: /data
      name: redis-data
    tcp_proxies: [6379]

  worker:
    template: ../services/worker.yaml
    params:
      queue: default
    sleep_application: false

buckets:
  uploads:
    name: user-uploads
```

## JSON schemas

Editor support (autocompletion, validation) is available via JSON schemas:

- `schemas/environment.schema.json` -- environment config files
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
