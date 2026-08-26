# AGENTS.md

## Project Overview

**zod-to-protobuf** converts Zod 4 schemas to Protocol Buffer (proto3) definitions. Single-package TypeScript library published to npm.

- **Source:** `src/index.ts` (single file) · **Tests:** `test/index.test.ts` · **Build output:** `dist/`

## Setup

```sh
bun install
```

**Bun >= 1.4 required** (`engines`, CI pins 1.4.0). Dependency versions are pinned via the `catalog` block in `package.json`; dep bumps flow through the catalog-update automation.

## Development Commands

| Command            | Description                       |
| ------------------ | --------------------------------- |
| `npm run build`    | Compile TypeScript to `dist/`     |
| `npm run lint`     | Run oxlint with type-aware checks |
| `npm run format`   | Format with oxfmt (write mode)    |
| `npm test`         | Run Bun tests                     |
| `npm run validate` | Lint + tests                      |

## Testing

Tests run with **Bun's built-in runner** (`bun test`); filter with `bun test -t "test name"`.

Tests compare generated protobuf output strings against expected values. Always verify the full protobuf output matches expectations.

## Code Standards

- Strict oxlint with anti-slop rules (ultracite plugin): `src/` must stay lint-clean. Prefer real refactors over suppressions.
- Formatting is enforced only by the git pre-commit hook (`.githooks/pre-commit`: `oxfmt --write` + `oxlint --fix`), never in CI.

## PR Guidelines

- Target branch: `master`. CI runs lint + tests + build; run `npm run validate` before submitting.

## Commit & Release Conventions

- Commits and PR titles must follow [Conventional Commits](https://www.conventionalcommits.org/) (`type(scope): subject`, breaking via `!` or `BREAKING CHANGE:` footer), enforced by the PR Gate workflow (`.github/workflows/pr-gate.yml`).
- Releases via [release-please](https://github.com/googleapis/release-please-action): merging Conventional Commits to `master` opens a release PR titled `chore(master): release ...`; merging it tags and publishes.
- `CLAUDE.md` is a symlink to this file.
