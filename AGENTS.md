# AGENTS.md

## Project Overview

**zod-to-protobuf** converts Zod 4 schemas to Protocol Buffer (proto3) definitions. Single-package TypeScript library published to npm.

- **Source:** `src/index.ts` (single file, ~750 lines)
- **Tests:** `test/index.test.ts` (~1000 lines, 50+ test cases)
- **Build output:** `dist/`
- **Module system:** ESM with CommonJS module resolution (node16)

## Setup

```sh
npm install
```

No lockfile is generated (`.npmrc` has `package-lock=false`). Dependencies are pinned to exact versions (`save-exact=true`).

**Node.js >= 20 required.**

## Development Commands

| Command            | Description                       |
| ------------------ | --------------------------------- |
| `npm run build`    | Compile TypeScript to `dist/`     |
| `npm run lint`     | Run oxlint with type-aware checks |
| `npm run format`   | Format with oxfmt (write mode)    |
| `npm test`         | Run Vitest in watch mode          |
| `npm run validate` | Lint + tests (CI)                 |

## Testing

- **Framework:** Vitest
- **Run all tests:** `npm test`
- **Run once (no watch):** `npx vitest run`
- **Run a specific test:** `npx vitest run -t "test name"`
- **Test file:** `test/index.test.ts`
- Tests compare generated protobuf output strings against expected values. Always verify the full protobuf output matches expectations.

## PR Guidelines

- Target branch: `master`
- All CI checks must pass: lint, tests, build
- Formatting is enforced locally by the git pre-commit hook (`.githooks/pre-commit`), not in CI; it runs `oxfmt --write` plus `oxlint --fix` on commit
- Run `npm run validate` before submitting

## Commit & Release Conventions

- **All commits and PR titles must follow [Conventional Commits](https://www.conventionalcommits.org/)**: `type(scope): subject`, where `type` is one of `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `revert`. Use `!` or a `BREAKING CHANGE:` footer for breaking changes.
- This convention is enforced by the **PR Gate** workflow (`.github/workflows/pr-gate.yml`), which fails any PR whose title does not conform.
- Releases are automated by [release-please](https://github.com/googleapis/release-please-action): merging Conventional Commits to `master` opens a release PR titled `chore(master): release ...`; merging it tags and publishes the release.
- `CLAUDE.md` is a symlink to this file so Claude Code reads the same conventions.
