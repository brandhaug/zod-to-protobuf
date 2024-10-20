# zod-to-protobuf

[![NPM Version](https://img.shields.io/npm/v/zod-to-protobuf.svg)](https://npmjs.org/package/zod-to-protobuf)
[![NPM Downloads](https://img.shields.io/npm/dw/zod-to-protobuf.svg)](https://npmjs.org/package/zod-to-protobuf)

## Summary 
Convert Zod schemas to Protocol Buffers definitions.

## Installation


```bash
npm install zod-to-protobuf
```

## Usage

```typescript
import { z } from 'zod'
import { zodToProtobuf } from 'zod-to-protobuf'

const schema = z.object({
    name: z.string(),
    age: z.number()
})

const proto = zodToProtobuf(schema)
console.log(proto)
```

#### Expected Output
```protobuf
syntax = "proto3";
package default;

message Message {
    string name = 1;
    double age = 2;
}
```

## Options

| Option            | Description                                | Default          |
|-------------------|--------------------------------------------|------------------|
| `packageName`     | Name of the protobuf package               | `default`        |
| `rootMessageName` | Name of the protobuf message               | `Message`        |
| `typePrefix`      | Prefix for each type                       | (empty string)   |

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.
