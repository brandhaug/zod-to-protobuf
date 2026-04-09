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

| Command                | Description                       |
| ---------------------- | --------------------------------- |
| `npm run build`        | Compile TypeScript to `dist/`     |
| `npm run lint`         | Run oxlint with type-aware checks |
| `npm run format`       | Format with oxfmt (write mode)    |
| `npm run format:check` | Check formatting without writing  |
| `npm test`             | Run Vitest in watch mode          |
| `npm run validate`     | Lint + format check + tests (CI)  |

## Testing

- **Framework:** Vitest
- **Run all tests:** `npm test`
- **Run once (no watch):** `npx vitest run`
- **Run a specific test:** `npx vitest run -t "test name"`
- **Test file:** `test/index.test.ts`
- Tests compare generated protobuf output strings against expected values. Always verify the full protobuf output matches expectations.

## PR Guidelines

- Target branch: `master`
- All checks must pass: lint, format, tests, build
- Run `npm run validate` before submitting
