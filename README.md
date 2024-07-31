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

## Options
- **packageName**: Name of the protobuf package (default: default)
- **messageName**: Name of the protobuf message (default: Message)

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.
