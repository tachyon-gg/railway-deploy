# CLAUDE.md

## Project Overview

`railway-deploy` is a declarative Railway infrastructure management CLI. It reads a project-level YAML config describing the desired state of a Railway project across one or more environments, diffs against live Railway state, and applies changes atomically using Railway's native EnvironmentConfig patch system.

## Architecture

The codebase follows a clear pipeline: **load config → fetch config → build desired → diff → stage + commit**.

- `src/config/` — Config loading (`loader.ts`), YAML parsing, Zod schema (`schema.ts`), template params (`params.ts`), variable resolution (`variables.ts`), service merge
- `src/railway/` — Railway API client, GraphQL queries/mutations, retry logic
- `src/reconcile/` — Config builder (`config.ts`), diff engine (`diff.ts`), apply engine (`apply.ts`), format (`format.ts`)
- `src/types/` — `State` (internal flat model), `EnvironmentConfig` (Railway native), `ConfigDiff` (diff output)
- `src/generated/` — Auto-generated GraphQL types (from `bun run codegen`)

### Key patterns

- **EnvironmentConfig patches**: Changes are applied via `environmentStageChanges` + `environmentPatchCommitStaged`. Railway handles provisioning internally.
- **Discriminated union schemas**: Source (repo vs image) and build (railpack/nixpacks/dockerfile) use Zod discriminated unions with `.strict()`. Invalid field combinations are rejected at parse time.
- **Enum enforcement**: `builder` and `restart_policy` use lowercase Zod enums (`railpack`, `on_failure`). The loader maps to Railway's uppercase format. `${ENV_VAR}` and `%{param}` cannot be used in enum fields — the schema rejects them.
- **Nested config**: Source-specific fields (`branch`, `wait_for_ci`, `registry_credentials`, `auto_updates`) are nested under `source`. Build fields (`builder`, `command`, `dockerfile_path`, `watch_patterns`, `metal`) are nested under `build`. The internal `ServiceState` stays flat — nesting is a YAML ergonomic concern only.
- **Types from Zod**: All YAML config types are derived from Zod schemas via `z.infer<>` in `src/config/schema.ts`. There is no separate types file for config shapes.
- **Service merge**: `mergeServiceEntry()` combines service defaults with per-environment overrides. Params/variables shallow-merge; domains/source/volume/build replace entirely.
- **Template params**: `%{param}` syntax is expanded at config load time (after schema validation, so enums reject placeholders). `${ENV_VAR}` is resolved from local env. `${{service.VAR}}` is passed through for Railway runtime.
- **Config builder**: `buildEnvironmentConfig()` converts `State` → Railway's `EnvironmentConfig` JSON (service IDs as keys, variables as `{ value }` objects).
- **Diff/apply separation**: `computeConfigDiff()` is pure (no API calls). `applyConfigDiff()` executes the pipeline.
- **Apply pipeline**: create services → create volumes → delete TCP proxies (pre-stage) → null-inject removed collections → stage → commit → egress gateways → railway domains → custom domains → private hostnames → volume deletion → delete services.
- **Features requiring mutations (not patches)**: Custom domains, railway domains, TCP proxy deletion, static outbound IPs, private hostnames, volume deletion, bucket creation.
- **TCP proxies**: Single port per service. Creation via patch. Deletion/port-change via `tcpProxyDelete` mutation pre-stage (so the patch can create the new port).
- **Regions**: `regions` field accepts string (`us-west1`) or map (`{ us-west1: 2, us-east4: 1 }`). Multi-region supported. Railway auto-assigns a default region on service creation — null-injected in apply step.
- **No reconciliation loop**: The patch system is atomic — no need to re-fetch and re-diff after apply.

### YAML field mapping

| YAML (nested) | Internal State (flat) | Railway EnvironmentConfig |
|---|---|---|
| `source.branch` | `branch` | `source.branch` |
| `source.wait_for_ci` | `waitForCi` | `source.checkSuites` |
| `source.auto_updates` | `autoUpdates` | `source.autoUpdates` |
| `build.builder` | `builder` | `build.builder` |
| `build.command` | `buildCommand` | `build.buildCommand` |
| `build.dockerfile_path` | `dockerfilePath` | `build.dockerfilePath` |
| `build.watch_patterns` | `watchPatterns` | `build.watchPatterns` |
| `build.metal` | `metal` | `build.buildEnvironment: "V3"` |
| `restart_policy` | `restartPolicy` | `deploy.restartPolicyType` |
| `serverless` | `serverless` | `deploy.sleepApplication` |
| `private_hostname` | `privateHostname` | mutation (not patch) |
| `regions` | `regions` (Record) | `deploy.multiRegionConfig` |
| `railway_domain` | `railwayDomain` | mutation (not patch) |
| `tcp_proxy` | `tcpProxy` | `networking.tcpProxies` + mutation |

## Commands

```bash
bun run test             # Unit tests (224 tests)
bun run test:integration # Integration tests (27 files, 152 cases — requires .env.test)
bun run typecheck        # TypeScript strict mode
bun run lint             # Biome check
bun run lint:fix         # Biome auto-fix
bun run codegen          # Regenerate GraphQL types from schema
```

## Important Notes

- Never hardcode Railway business logic — let Railway enforce it via its API
- If config loading encounters an error, abort entirely — don't skip and continue
- The `src/generated/` directory is auto-generated; don't edit manually
- Integration tests require a real Railway token and test project — each test file creates/destroys its own environment
- The EnvironmentConfig uses service IDs (UUIDs) as keys — name→ID mapping is done via `fetchServiceMap()`
- Services must be created via `serviceCreate` before they can be included in a patch
- Volumes must be created via `volumeCreate` to get their ID before referencing in `volumeMounts`
- All Zod object schemas use `.strict()` to reject unknown keys
- Enum fields (builder, restart_policy) must be lowercase in YAML — the loader maps to Railway's uppercase
- Integration tests follow create → converge → update → converge → remove → converge pattern
