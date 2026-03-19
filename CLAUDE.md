# CLAUDE.md

## Project Overview

`railway-deploy` is a declarative Railway infrastructure management CLI. It reads a project-level YAML config describing the desired state of a Railway project across one or more environments, diffs against live Railway state, and applies changes atomically using Railway's native EnvironmentConfig patch system.

## Architecture

The codebase follows a clear pipeline: **load config → fetch config → build desired → diff → stage + commit**.

- `src/config/` — Config loading, YAML parsing, template resolution, variable substitution, service merge
- `src/railway/` — Railway API client, GraphQL queries/mutations, retry logic
- `src/reconcile/` — Config builder (`config.ts`), diff engine (`diff.ts`), apply engine (`apply.ts`), format (`format.ts`)
- `src/types/` — Shared types: `State` (unified), `EnvironmentConfig` (Railway native), `ConfigDiff` (diff output), `ProjectConfig` (raw YAML)
- `src/generated/` — Auto-generated GraphQL types (from `bun run codegen`)

### Key patterns

- **EnvironmentConfig patches**: Changes are applied via `environmentStageChanges` + `environmentPatchCommitStaged` — two API calls instead of 20+ individual mutations. Railway handles diffing and provisioning internally.
- **Project-level config**: One YAML file per project. Services define defaults, with per-environment overrides under `environments.<name>`. The `-e` flag selects the target environment.
- **Service merge**: `mergeServiceEntry()` combines service defaults with per-environment overrides. Params/variables shallow-merge; domains/source/volume replace entirely.
- **Service scoping**: Services with an `environments` block only exist in listed environments. No block = all environments.
- **Shared variable defaults**: Top-level string keys are defaults; environment-named keys are override blocks.
- **Config builder**: `buildEnvironmentConfig()` converts our `State` (from YAML) into Railway's `EnvironmentConfig` JSON format (service IDs as keys, variables as `{ value }` objects, etc.).
- **Diff/apply separation**: `computeConfigDiff()` is pure (no API calls). `applyConfigDiff()` executes: create services → create volumes → stage → commit → delete services.
- **Variable filtering**: `RAILWAY_*` variables are auto-injected by Railway and excluded from diffs.
- **Template params**: `%{param}` syntax is expanded at config load time. `${ENV_VAR}` is resolved from local env. `${{service.VAR}}` is passed through for Railway runtime.
- **No reconciliation loop**: The patch system is atomic — no need to re-fetch and re-diff after apply.
- **YAML field names**: `serverless` maps to `sleepApplication`, `metal` maps to `buildEnvironment: "V3"`, `wait_for_ci` maps to `source.checkSuites`, `private_hostname` maps to `networking.privateNetworkEndpoint`, `restart_policy` nests as `{ type, max_retries }` mapping to `restartPolicyType`/`restartPolicyMaxRetries`.

## Commands

```bash
bun run test             # Unit tests (222 tests)
bun run test:integration # Integration tests (requires .env.test with RAILWAY_TOKEN)
bun run typecheck        # TypeScript strict mode
bun run lint             # Biome check
bun run lint:fix         # Biome auto-fix
bun run codegen          # Regenerate GraphQL types from schema
```

## Important Notes

- Never hardcode Railway business logic — let Railway enforce it via its API
- If config loading encounters an error, abort entirely — don't skip and continue
- The `src/generated/` directory is auto-generated; don't edit manually
- Integration tests require a real Railway token and test project
- The EnvironmentConfig uses service IDs (UUIDs) as keys — name→ID mapping is done via `fetchServiceMap()`
- Services must be created via `serviceCreate` before they can be included in a patch
- Volumes must be created via `volumeCreate` to get their ID before referencing in `volumeMounts`
