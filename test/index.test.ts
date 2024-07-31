import {describe, expect, it} from "vitest"
import {z} from "zod"
import {zodToProtobuf} from "../src"

describe("zodToProtobuf", () => {
  it("should convert a simple Zod object to protobuf", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().int(),
    })

    const expectedProto = `
syntax = "proto3";
package default;

message Message {
    string name = 1;
    int32 age = 2;
}`

    const proto = zodToProtobuf(schema)
    expect(proto).toBe(expectedProto.trim())
  })

  it("should handle booleans", () => {
    const schema = z.object({
      isActive: z.boolean(),
    })

    const expectedProto = `
syntax = "proto3";
package default;

message Message {
    bool isActive = 1;
}`

    const proto = zodToProtobuf(schema)
    expect(proto).toBe(expectedProto.trim())
  })

  it("should handle arrays", () => {
    const schema = z.object({
      tags: z.array(z.string()),
    })

    const expectedProto = `
syntax = "proto3";
package default;

message Message {
    repeated string tags = 1;
}`

    const proto = zodToProtobuf(schema)
    expect(proto).toBe(expectedProto.trim())
  })

  it("should handle nested Zod objects", () => {
    const schema = z.object({
      user: z.object({
        name: z.string(),
        age: z.number().int(),
      }),
    })

    const expectedProto = `
syntax = "proto3";
package default;

message User {
    string name = 1;
    int32 age = 2;
}

message Message {
    User user = 1;
}`

    const proto = zodToProtobuf(schema)
    expect(proto).toBe(expectedProto.trim())
  })

  it("should handle nested arrays", () => {
    const schema = z.object({
      matrix: z.array(z.array(z.number().int())),
    })

    const expectedProto = `
syntax = "proto3";
package default;

message Message {
    repeated repeated int32 matrix = 1;
}`

    const proto = zodToProtobuf(schema)
    expect(proto).toBe(expectedProto.trim())
  })

  it("should handle enums", () => {
    const schema = z.object({
      status: z.enum(["ACTIVE", "INACTIVE"]),
    })

    const expectedProto = `
syntax = "proto3";
package default;

enum Status {
    ACTIVE = 0;
    INACTIVE = 1;
}

message Message {
    Status status = 1;
}`

    const proto = zodToProtobuf(schema)
    expect(proto).toBe(expectedProto.trim())
  })

  it("should handle optional fields", () => {
    const schema = z.object({
      name: z.string().optional(),
      age: z.number().int().nullable(),
      city: z.string().nullish(),
      address: z
        .object({
          street: z.string().optional(),
        })
        .nullable(),
      tags: z.array(z.string()).nullable(),
      stickers: z.array(z.string().nullish()),
    })

    const expectedProto = `
syntax = "proto3";
package default;

message Address {
    optional string street = 1;
}

message Message {
    optional string name = 1;
    optional int32 age = 2;
    optional string city = 3;
    optional Address address = 4;
    repeated string tags = 5;
    repeated string stickers = 6;
}`

    const proto = zodToProtobuf(schema)
    expect(proto).toBe(expectedProto.trim())
  })

  it("should handle nullable fields", () => {
    const schema = z.object({
      name: z.string().nullable(),
      age: z.number().int().nullish(),
    })

    const expectedProto = `
syntax = "proto3";
package default;

message Message {
    optional string name = 1;
    optional int32 age = 2;
}`

    const proto = zodToProtobuf(schema)
    expect(proto).toBe(expectedProto.trim())
  })

  it("should handle dates", () => {
    const schema = z.object({
      birthdate: z.date(),
      appointment: z.date(),
    })

    const expectedProto = `
syntax = "proto3";
package default;

message Message {
    string birthdate = 1;
    string appointment = 2;
}`

    const proto = zodToProtobuf(schema)
    expect(proto).toBe(expectedProto.trim())
  })

  it("should handle double types", () => {
    const schema = z.object({
      measurement: z.number(),
    })

    const expectedProto = `
syntax = "proto3";
package default;

message Message {
    double measurement = 1;
}`

    const proto = zodToProtobuf(schema)
    expect(proto).toBe(expectedProto.trim())
  })

  it("should handle int types", () => {
    const schema = z.object({
      counter: z.number().int(),
    })

    const expectedProto = `
syntax = "proto3";
package default;

message Message {
    int32 counter = 1;
}`

    const proto = zodToProtobuf(schema)
    expect(proto).toBe(expectedProto.trim())
  })

  it("should handle nested objects with arrays and enums", () => {
    const schema = z.object({
      user: z.object({
        name: z.string(),
        tags: z.array(
          z.object({
            label: z.string(),
            value: z.number(),
          }),
        ),
        status: z.enum(["ACTIVE", "INACTIVE"]),
      }),
    })

    const expectedProto = `
syntax = "proto3";
package default;

enum Status {
    ACTIVE = 0;
    INACTIVE = 1;
}

message Tag {
    string label = 1;
    double value = 2;
}

message User {
    string name = 1;
    repeated Tag tags = 2;
    Status status = 3;
}

message Message {
    User user = 1;
}`

    const proto = zodToProtobuf(schema)
    expect(proto).toBe(expectedProto.trim())
  })

  it("should throw exception on unsupported ZodAny type", () => {
    const schema = z.object({
      counter: z.any(),
    })

    expect(() => zodToProtobuf(schema)).toThrowError(
      "Unsupported type: ZodAny",
    )
  })

  it("should throw exception on unsupported Object type", () => {
    // @ts-expect-error
    expect(() => zodToProtobuf({test: 1})).toThrowError(
      "Unsupported type: Object",
    )
  })

  it("should throw exception on unsupported Number type", () => {
    // @ts-expect-error
    expect(() => zodToProtobuf(1)).toThrowError(
      "Unsupported type: Number",
    )
  })

  it("should handle custom message name and package name", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().int(),
      address: z.object({
        street: z.string()
      })
    })

    const expectedProto = `
syntax = "proto3";
package mypackage;

message Address {
    string street = 1;
}

message MyMessage {
    string name = 1;
    int32 age = 2;
    Address address = 3;
}`

    const proto = zodToProtobuf(schema, {packageName: "mypackage", messageName: "MyMessage"})
    expect(proto).toBe(expectedProto.trim())
  })

  it("should handle complex nested objects and arrays", () => {
    const schema = z.object({
      user: z.object({
        name: z.string(),
        tags: z.array(
          z.object({
            label: z.string(),
            value: z.number().int(),
          }),
        ),
      }),
    })

    const expectedProto = `
syntax = "proto3";
package default;

message Tag {
    string label = 1;
    int32 value = 2;
}

message User {
    string name = 1;
    repeated Tag tags = 2;
}

message Message {
    User user = 1;
}`

    const proto = zodToProtobuf(schema)
    expect(proto).toBe(expectedProto.trim())
  })
})
