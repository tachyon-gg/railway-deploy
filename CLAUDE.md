# CLAUDE.md

## Project Overview

`railway-deploy` is a declarative Railway infrastructure management CLI. It reads a project-level YAML config describing the desired state of a Railway project across one or more environments, diffs against live Railway state, and applies changes.

## Architecture

The codebase follows a clear pipeline: **load config → fetch state → diff → apply**.

- `src/config/` — Config loading, YAML parsing, template resolution, variable substitution, service merge
- `src/railway/` — Railway API client, GraphQL queries/mutations, retry logic
- `src/reconcile/` — Diff engine (`diff.ts`) and change executor (`apply.ts`)
- `src/types/` — Shared types: `State` (unified), `Change`/`Changeset` (diff output), `ProjectConfig` (raw YAML)
- `src/generated/` — Auto-generated GraphQL types (from `bun run codegen`)

### Key patterns

- **Project-level config**: One YAML file per project. Services define defaults, with per-environment overrides under `environments.<name>`. The `-e` flag selects the target environment.
- **Service merge**: `mergeServiceEntry()` combines service defaults with per-environment overrides. Params/variables shallow-merge; domains/source/volume replace entirely.
- **Service scoping**: Services with an `environments` block only exist in listed environments. No block = all environments.
- **Shared variable defaults**: Top-level string keys are defaults; environment-named keys are override blocks.
- **Change type union**: All mutations are expressed as a discriminated union (`Change` type in `src/types/changeset.ts`). Both `applyChange` and `changeLabel` use exhaustive switches.
- **Diff/apply separation**: `computeChangeset()` is pure (no API calls). `applyChangeset()` executes the plan. `printChangeset()` formats for display.
- **Variable filtering**: `RAILWAY_*` variables are auto-injected by Railway and excluded from diffs.
- **Template params**: `%{param}` syntax is expanded at config load time. `${ENV_VAR}` is resolved from local env. `${{service.VAR}}` is passed through for Railway runtime.

## Commands

```bash
bun run test             # Unit tests (255 tests)
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
