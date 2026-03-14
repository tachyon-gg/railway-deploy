# Contributing

## Branch naming

Follow the convention: `<username>/<issue#>` (e.g., `csangani/14`).

## Development workflow

1. Create a GitHub issue for the work
2. Create a branch from `main`
3. Make changes and ensure checks pass:
   ```bash
   bun run typecheck
   bun run lint
   bun run test
   ```
4. Open a PR to `main`

## Tests

- Unit tests must pass for all PRs
- Integration tests (`bun run test:integration`) are required for API-related changes
- Add tests for new functionality

## Code style

Code style is enforced by [Biome](https://biomejs.dev/). Run `bun run lint:fix` to auto-fix issues.
