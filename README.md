# railway-deploy

[![CI](https://github.com/tachyon-gg/railway-deploy/actions/workflows/ci.yml/badge.svg)](https://github.com/tachyon-gg/railway-deploy/actions/workflows/ci.yml)
[![Integration Tests](https://github.com/tachyon-gg/railway-deploy/actions/workflows/integration.yml/badge.svg)](https://github.com/tachyon-gg/railway-deploy/actions/workflows/integration.yml)
[![codecov](https://codecov.io/gh/tachyon-gg/railway-deploy/graph/badge.svg)](https://codecov.io/gh/tachyon-gg/railway-deploy)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1)](https://bun.sh/)
[![Biome](https://img.shields.io/badge/linter-Biome-60a5fa)](https://biomejs.dev/)

Declarative infrastructure management for [Railway](https://railway.com). Define your Railway project's services, variables, domains, volumes, and buckets in YAML, and `railway-deploy` will diff against the live state and apply changes — like Terraform, but purpose-built for Railway.

## Quick start

```bash
# Install dependencies
bun install

# Validate a config file
bun run start -- --validate environments/production.yaml

# Dry-run (show what would change)
bun run start -- environments/production.yaml

# Apply changes
bun run start -- --apply environments/production.yaml
```

## Config format

Environment configs are YAML files that describe the desired state of a Railway environment:

```yaml
project: My Project
environment: production

shared_variables:
  APP_ENV: production

services:
  web:
    template: ../services/web.yaml
    params:
      tag: v1.2.3
    variables:
      EXTRA_VAR: value
    domains:
      - app.example.com

  redis:
    source:
      image: redis:7
    variables:
      ALLOW_EMPTY_PASSWORD: "yes"
    volume:
      mount: /data
      name: redis-data

buckets:
  media:
    name: media-uploads
```

### Service templates

Templates extract reusable service definitions with parameterized values (`%{param}`):

```yaml
# services/web.yaml
params:
  tag:
    required: true

source:
  image: ghcr.io/org/app:%{tag}

variables:
  APP_ENV: "%{tag}"
  DATABASE_URL: ${{Postgres.DATABASE_URL}}

domain: "%{tag}.example.com"
healthcheck:
  path: /health
  timeout: 300
```

### Variable syntax

- `${ENV_VAR}` — resolved from local environment at config load time
- `${{service.VAR}}` — Railway reference variable, resolved at runtime
- `null` — marks a variable for deletion

## CLI flags

| Flag | Description |
|------|-------------|
| `--apply` | Execute changes (default: dry-run) |
| `-y, --yes` | Skip confirmation for destructive ops |
| `--env-file <path>` | Load `.env` file for `${VAR}` resolution |
| `-v, --verbose` | Show detailed diffs (old → new values) |
| `--no-color` | Disable ANSI color output |
| `--validate` | Validate config without connecting to Railway |

## Environment variables

| Variable | Description |
|----------|-------------|
| `RAILWAY_TOKEN` | Railway API token (required for API operations) |

## JSON schemas

Editor support (autocompletion, validation) is available via JSON schemas:

- `schemas/environment.schema.json` — environment config files
- `schemas/service-template.schema.json` — service template files

Add to your YAML files:

```yaml
# yaml-language-server: $schema=./schemas/environment.schema.json
```

## Development

```bash
bun install              # Install dependencies
bun run test             # Run unit tests
bun run test:integration # Run integration tests (requires RAILWAY_TOKEN)
bun run typecheck        # Type check
bun run lint             # Lint (Biome)
bun run lint:fix         # Auto-fix lint issues
bun run codegen          # Regenerate GraphQL types
```
