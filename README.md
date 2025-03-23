# zod-to-protobuf
 
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
