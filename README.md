# zod-to-protobuf

Convert Zod 4 schemas to Protocol Buffers (proto3) definitions.

[![npm version](https://img.shields.io/npm/v/zod-to-protobuf)](https://www.npmjs.com/package/zod-to-protobuf)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Features

- Primitives: `string`, `number`, `boolean`, `date`, `bigint`, `literal`
- Integers: `z.number().int()` maps to `int32` (otherwise `double`)
- Collections: `array`, `set`, `map`, `record`, `tuple`
- Nested objects with automatic message generation
- Unions: `z.union()` and `z.discriminatedUnion()` map to `oneof`
- Enums with `UNSPECIFIED` zero value and prefixed names per proto3 style guide
- Custom enum naming via `.meta({ id: 'Name' })`
- Optional and nullable fields
- Wrappers: `ZodPipe`, `ZodDefault`, `ZodCatch` (unwrapped automatically)
- Nested arrays wrapped in messages (valid proto3, no `repeated repeated`)
- Configurable package name, root message name, and type prefix
- Optional `google.protobuf.Timestamp` for date fields

## Installation

```bash
npm install zod-to-protobuf
```

**Requirements:** Node.js >= 20, Zod 4

## Usage

### Basic

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

### Nested objects, enums, and arrays

```typescript
const schema = z.object({
	id: z.number().int(),
	name: z.string(),
	isActive: z.boolean(),
	roles: z.array(z.enum(['ADMIN', 'USER', 'GUEST'])),
	address: z.object({
		street: z.string(),
		city: z.string(),
		postalCode: z.string()
	})
})

console.log(zodToProtobuf(schema, { rootMessageName: 'User' }))
```

```protobuf
syntax = "proto3";
package default;

enum Role {
    ROLE_UNSPECIFIED = 0;
    ROLE_ADMIN = 1;
    ROLE_USER = 2;
    ROLE_GUEST = 3;
}

message Address {
    string street = 1;
    string city = 2;
    string postalCode = 3;
}

message User {
    int32 id = 1;
    string name = 2;
    bool isActive = 3;
    repeated Role roles = 4;
    Address address = 5;
}
```

### Optional and nullable fields

```typescript
const schema = z.object({
	name: z.string(),
	nickname: z.string().optional(),
	bio: z.string().nullable()
})
```

```protobuf
message Message {
    string name = 1;
    optional string nickname = 2;
    optional string bio = 3;
}
```

### Unions (oneof)

```typescript
const schema = z.object({
	value: z.union([z.string(), z.number().int()])
})
```

```protobuf
message Message {
    oneof value {
        string value_string = 1;
        int32 value_int32 = 2;
    }
}
```

### Maps and records

```typescript
const schema = z.object({
	metadata: z.map(z.string(), z.number().int()),
	settings: z.record(z.string(), z.string())
})
```

```protobuf
message Message {
    map<string, int32> metadata = 1;
    map<string, string> settings = 2;
}
```

### Google Timestamp

```typescript
const schema = z.object({
	createdAt: z.date(),
	updatedAt: z.date()
})

console.log(zodToProtobuf(schema, { useGoogleTimestamp: true }))
```

```protobuf
syntax = "proto3";
package default;

import "google/protobuf/timestamp.proto";

message Message {
    google.protobuf.Timestamp createdAt = 1;
    google.protobuf.Timestamp updatedAt = 2;
}
```

## Type Mapping

| Zod Type                              | Protobuf Type               |
| ------------------------------------- | --------------------------- |
| `z.string()`                          | `string`                    |
| `z.number()`                          | `double`                    |
| `z.number().int()`                    | `int32`                     |
| `z.boolean()`                         | `bool`                      |
| `z.bigint()`                          | `int64`                     |
| `z.date()`                            | `string`                    |
| `z.date()` + `useGoogleTimestamp`     | `google.protobuf.Timestamp` |
| `z.literal("...")`                    | `string`                    |
| `z.literal(123)`                      | `int32` or `double`         |
| `z.literal(true)`                     | `bool`                      |
| `z.array()`                           | `repeated`                  |
| `z.set()`                             | `repeated`                  |
| `z.map()`                             | `map<K, V>`                 |
| `z.record()`                          | `map<K, V>`                 |
| `z.object()`                          | `message`                   |
| `z.enum()`                            | `enum` (with `UNSPECIFIED`) |
| `z.tuple()`                           | `message`                   |
| `z.union()`                           | `oneof`                     |
| `z.discriminatedUnion()`              | `oneof`                     |
| `.optional()`                         | `optional`                  |
| `.nullable()`                         | `optional`                  |
| `.default()` / `.catch()` / `.pipe()` | unwrapped                   |

## Options

| Option               | Description                                    | Default   |
| -------------------- | ---------------------------------------------- | --------- |
| `packageName`        | Name of the protobuf package                   | `default` |
| `rootMessageName`    | Name of the root message                       | `Message` |
| `typePrefix`         | Prefix for generated types                     | `""`      |
| `useGoogleTimestamp` | Use `google.protobuf.Timestamp` for `z.date()` | `false`   |

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

### Development

```bash
git clone https://github.com/brandhaug/zod-to-protobuf.git
cd zod-to-protobuf
npm install
npm test
```

## License

MIT
