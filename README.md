# zod-to-protobuf

Convert Zod 4 schemas to Protocol Buffers (proto3) definitions.

[![npm version](https://img.shields.io/npm/v/zod-to-protobuf)](https://www.npmjs.com/package/zod-to-protobuf)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Features

- Primitives map to proto3 scalars: `z.number().int()` → `int32`, `z.number()` → `double`, `z.bigint()` → `int64`, `z.date()` → `string`
- Collections: array/set → `repeated`, map/record → `map<K, V>`, tuple → nested message
- Nested objects generate messages automatically
- `z.union()` and `z.discriminatedUnion()` → `oneof`
- Enums get a zero `UNSPECIFIED` value and prefixed names per proto3 style; override the name with `.meta({ id: 'Name' })` (also resolves enum/message name collisions)
- `.optional()` / `.nullable()` → `optional`; `ZodPipe`, `ZodDefault`, `ZodCatch` are unwrapped
- Nested arrays wrap in messages instead of emitting invalid `repeated repeated`
- Options: `packageName`, `rootMessageName`, `typePrefix`, and `useGoogleTimestamp` to emit `google.protobuf.Timestamp` for dates

## Installation

```bash
npm install zod-to-protobuf
```

Requires Zod 4 as a peer dependency.

## Usage

```typescript
import { z } from 'zod'
import { zodToProtobuf } from 'zod-to-protobuf'

const schema = z.object({
	name: z.string(),
	age: z.number()
})

console.log(zodToProtobuf(schema))
```

```protobuf
syntax = "proto3";
package default;

message Message {
    string name = 1;
    double age = 2;
}
```

A richer example with enums, nesting, unions, and the Timestamp option:

```typescript
const schema = z.object({
	id: z.number().int(),
	isActive: z.boolean(),
	roles: z.array(z.enum(['ADMIN', 'USER', 'GUEST'])),
	address: z.object({ street: z.string(), city: z.string() }),
	value: z.union([z.string(), z.number().int()]),
	createdAt: z.date()
})

console.log(
	zodToProtobuf(schema, { rootMessageName: 'User', useGoogleTimestamp: true })
)
```

```protobuf
syntax = "proto3";
package default;

import "google/protobuf/timestamp.proto";

enum Role {
    ROLE_UNSPECIFIED = 0;
    ROLE_ADMIN = 1;
    ROLE_USER = 2;
    ROLE_GUEST = 3;
}

message Address {
    string street = 1;
    string city = 2;
}

message User {
    int32 id = 1;
    bool isActive = 2;
    repeated Role roles = 3;
    Address address = 4;
    oneof value {
        string value_string = 5;
        int32 value_int32 = 6;
    }
    google.protobuf.Timestamp createdAt = 7;
}
```

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

```bash
git clone https://github.com/brandhaug/zod-to-protobuf.git
cd zod-to-protobuf
bun install
```

| Command            | Description                                       |
| ------------------ | ------------------------------------------------- |
| `npm test`         | Run tests (`bun test`)                            |
| `npm run build`    | Compile TypeScript to `dist/`                     |
| `npm run lint`     | Type-aware oxlint (strict config incl. anti-slop) |
| `npm run format`   | Format with oxfmt                                 |
| `npm run validate` | Lint + tests (CI)                                 |

Formatting is enforced by a git pre-commit hook (installed on `bun install`), not in CI. Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) and PR titles are gated on it.

## License

MIT
