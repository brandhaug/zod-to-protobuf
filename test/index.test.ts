// fallow-ignore-file unused-file
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import {
	UnsupportedTypeException,
	type ZodToProtobufOptions,
	zodToProtobuf
} from '../src'

/**
 * Builds a complete proto3 document the way zodToProtobuf assembles one, so
 * individual tests only spell out the part they actually assert on.
 */
function protoDoc(
	expectedBody: string,
	options?: ZodToProtobufOptions
): string {
	const imports =
		options?.useGoogleTimestamp === true
			? '\nimport "google/protobuf/timestamp.proto";\n'
			: ''

	return `
syntax = "proto3";
package ${options?.packageName ?? 'default'};
${imports}
${expectedBody.trim()}
`.trim()
}

function expectProto(
	schema: Parameters<typeof zodToProtobuf>[0],
	expectedBody: string,
	options?: ZodToProtobufOptions
): void {
	expect(zodToProtobuf(schema, options)).toBe(protoDoc(expectedBody, options))
}

describe('zodToProtobuf', () => {
	it('should convert a simple Zod object to protobuf', () => {
		const schema = z.object({
			name: z.string(),
			age: z.number().int()
		})

		const expectedBody = `
message Message {
    string name = 1;
    int32 age = 2;
}`

		expectProto(schema, expectedBody)
	})

	it('should handle booleans', () => {
		const schema = z.object({
			isActive: z.boolean()
		})

		const expectedBody = `
message Message {
    bool isActive = 1;
}`

		expectProto(schema, expectedBody)
	})

	it('should handle arrays', () => {
		const schema = z.object({
			tags: z.array(z.string())
		})

		const expectedBody = `
message Message {
    repeated string tags = 1;
}`

		expectProto(schema, expectedBody)
	})

	it('should handle nested Zod objects', () => {
		const schema = z.object({
			user: z.object({
				name: z.string(),
				age: z.number().int()
			})
		})

		const expectedBody = `
message User {
    string name = 1;
    int32 age = 2;
}

message Message {
    User user = 1;
}`

		expectProto(schema, expectedBody)
	})

	it('should handle nested arrays by wrapping in a message', () => {
		const schema = z.object({
			matrix: z.array(z.array(z.number().int()))
		})

		const expectedBody = `
message MatrixList {
    repeated int32 matrix = 1;
}

message Message {
    repeated MatrixList matrix = 1;
}`

		expectProto(schema, expectedBody)
	})

	it('should handle enums with UNSPECIFIED and prefixed values', () => {
		const schema = z.object({
			status: z.enum(['ACTIVE', 'INACTIVE'])
		})

		const expectedBody = `
enum Status {
    STATUS_UNSPECIFIED = 0;
    STATUS_ACTIVE = 1;
    STATUS_INACTIVE = 2;
}

message Message {
    Status status = 1;
}`

		expectProto(schema, expectedBody)
	})

	it('should handle optional fields', () => {
		const schema = z.object({
			name: z.string().optional(),
			age: z.number().int().nullable(),
			city: z.string().nullish(),
			address: z
				.object({
					street: z.string().optional()
				})
				.nullable(),
			tags: z.array(z.string()).nullable(),
			stickers: z.array(z.string().nullish())
		})

		const expectedBody = `
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

		expectProto(schema, expectedBody)
	})

	it('should handle nullable fields', () => {
		const schema = z.object({
			name: z.string().nullable(),
			age: z.number().int().nullish()
		})

		const expectedBody = `
message Message {
    optional string name = 1;
    optional int32 age = 2;
}`

		expectProto(schema, expectedBody)
	})

	it('should handle dates', () => {
		const schema = z.object({
			birthdate: z.date(),
			appointment: z.date()
		})

		const expectedBody = `
message Message {
    string birthdate = 1;
    string appointment = 2;
}`

		expectProto(schema, expectedBody)
	})

	it('should handle double types', () => {
		const schema = z.object({
			measurement: z.number()
		})

		const expectedBody = `
message Message {
    double measurement = 1;
}`

		expectProto(schema, expectedBody)
	})

	it('should handle int types', () => {
		const schema = z.object({
			counter: z.number().int()
		})

		const expectedBody = `
message Message {
    int32 counter = 1;
}`

		expectProto(schema, expectedBody)
	})

	it('should handle nested objects with arrays and enums', () => {
		const schema = z.object({
			user: z.object({
				name: z.string(),
				tags: z.array(
					z.object({
						label: z.string(),
						value: z.number()
					})
				),
				status: z.enum(['ACTIVE', 'INACTIVE'])
			})
		})

		const expectedBody = `
enum Status {
    STATUS_UNSPECIFIED = 0;
    STATUS_ACTIVE = 1;
    STATUS_INACTIVE = 2;
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

		expectProto(schema, expectedBody)
	})

	it('should throw exception on unsupported ZodAny type', () => {
		const schema = z.object({
			counter: z.any()
		})

		expect(() => zodToProtobuf(schema)).toThrowError('Unsupported type: ZodAny')
	})

	it('should throw exception on unsupported Object type', () => {
		// @ts-expect-error -- exercising the runtime guard with a non-schema value
		expect(() => zodToProtobuf({ test: 1 })).toThrowError(
			'Unsupported type: Object'
		)
	})

	it('should throw exception on unsupported Number type', () => {
		// @ts-expect-error -- exercising the runtime guard with a non-schema value
		expect(() => zodToProtobuf(1)).toThrowError('Unsupported type: Number')
	})

	it('should handle custom message name and package name', () => {
		const schema = z.object({
			name: z.string(),
			age: z.number().int(),
			address: z.object({
				street: z.string()
			})
		})

		const options = {
			packageName: 'mypackage',
			rootMessageName: 'MyMessage'
		} satisfies ZodToProtobufOptions

		const expectedBody = `
message Address {
    string street = 1;
}

message MyMessage {
    string name = 1;
    int32 age = 2;
    Address address = 3;
}`

		expectProto(schema, expectedBody, options)
	})

	it('should handle complex nested objects and arrays', () => {
		const schema = z.object({
			user: z.object({
				name: z.string(),
				tags: z.array(
					z.object({
						label: z.string(),
						value: z.number().int()
					})
				)
			})
		})

		const expectedBody = `
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

		expectProto(schema, expectedBody)
	})

	it('should generate Protobuf schema with type name prefix, including nested objects', () => {
		const schema = z.object({
			id: z.number().int(),
			name: z.string(),
			isActive: z.boolean(),
			createdAt: z.date(),
			roles: z.array(z.enum(['ADMIN', 'USER', 'GUEST'])),
			address: z.object({
				street: z.string(),
				city: z.string(),
				postalCode: z.string()
			})
		})

		const options = {
			packageName: 'example',
			rootMessageName: 'ExampleMessage',
			typePrefix: 'Prefix_'
		} satisfies ZodToProtobufOptions

		const expectedBody = `
enum Prefix_Role {
    PREFIX_ROLE_UNSPECIFIED = 0;
    PREFIX_ROLE_ADMIN = 1;
    PREFIX_ROLE_USER = 2;
    PREFIX_ROLE_GUEST = 3;
}

message Prefix_Address {
    string street = 1;
    string city = 2;
    string postalCode = 3;
}

message Prefix_ExampleMessage {
    int32 id = 1;
    string name = 2;
    bool isActive = 3;
    string createdAt = 4;
    repeated Prefix_Role roles = 5;
    Prefix_Address address = 6;
}`

		expectProto(schema, expectedBody, options)
	})

	it('should handle sets', () => {
		const schema = z.object({
			uniqueTags: z.set(z.string())
		})

		const expectedBody = `
message Message {
    repeated string uniqueTags = 1;
}`

		expectProto(schema, expectedBody)
	})

	it('should handle tuples', () => {
		const schema = z.object({
			coordinates: z.tuple([z.number(), z.number()])
		})

		const expectedBody = `
message Coordinates {
    double coordinates_0 = 1;
    double coordinates_1 = 2;
}

message Message {
    Coordinates coordinates = 1;
}`

		expectProto(schema, expectedBody)
	})

	it('should handle tuples with 3 elements', () => {
		const schema = z.object({
			coordinates: z.tuple([
				z.number(),
				z.string(),
				z.object({ a: z.string() })
			])
		})

		const expectedBody = `
message Coordinates_2 {
    string a = 1;
}

message Coordinates {
    double coordinates_0 = 1;
    string coordinates_1 = 2;
    Coordinates_2 coordinates_2 = 3;
}

message Message {
    Coordinates coordinates = 1;
}`

		expectProto(schema, expectedBody)
	})

	it('should handle map with string key and value', () => {
		const schema = z.object({
			metadata: z.map(z.string(), z.string())
		})

		const expectedBody = `
message Message {
    map<string, string> metadata = 1;
}`

		expectProto(schema, expectedBody)
	})

	it('should handle map with number key', () => {
		const schema = z.object({
			metadata: z.map(z.number().int(), z.string())
		})

		const expectedBody = `
message Message {
    map<int32, string> metadata = 1;
}`

		expectProto(schema, expectedBody)
	})

	it('should handle big integers', () => {
		const schema = z.object({
			largeNumber: z.bigint()
		})

		const expectedBody = `
message Message {
    int64 largeNumber = 1;
}`

		expectProto(schema, expectedBody)
	})

	it('should handle map with object value', () => {
		const schema = z.object({
			metadata: z.map(
				z.string(),
				z.object({
					value: z.string(),
					timestamp: z.date()
				})
			)
		})

		const expectedBody = `
message MetadataValue {
    string value = 1;
    string timestamp = 2;
}

message Message {
    map<string, MetadataValue> metadata = 1;
}`

		expectProto(schema, expectedBody)
	})

	it('should handle 2D set with object by wrapping in message', () => {
		const schema = z.object({
			matrix: z.set(
				z.set(
					z.object({
						value: z.string(),
						count: z.number().int()
					})
				)
			)
		})

		const expectedBody = `
message Matrix {
    string value = 1;
    int32 count = 2;
}

message MatrixList {
    repeated Matrix matrix = 1;
}

message Message {
    repeated MatrixList matrix = 1;
}`

		expectProto(schema, expectedBody)
	})

	it('should handle object arrays', () => {
		const schema = z.object({
			users: z.array(
				z.object({
					id: z.number().int(),
					name: z.string(),
					isActive: z.boolean()
				})
			)
		})

		const expectedBody = `
message User {
    int32 id = 1;
    string name = 2;
    bool isActive = 3;
}

message Message {
    repeated User users = 1;
}`

		expectProto(schema, expectedBody)
	})

	it('should handle multiple enums with different meta ids', () => {
		const colorScheme = z.enum(['red', 'blue']).meta({ id: 'colorType' })
		const sizeScheme = z.enum(['small', 'big']).meta({ id: 'sizeType' })
		const schema = z.object({
			color: z.object({
				value: colorScheme
			}),
			size: z.object({
				value: sizeScheme
			})
		})

		const expectedBody = `
enum ColorType {
    COLOR_TYPE_UNSPECIFIED = 0;
    COLOR_TYPE_RED = 1;
    COLOR_TYPE_BLUE = 2;
}

enum SizeType {
    SIZE_TYPE_UNSPECIFIED = 0;
    SIZE_TYPE_SMALL = 1;
    SIZE_TYPE_BIG = 2;
}

message Color {
    ColorType value = 1;
}

message Size {
    SizeType value = 1;
}

message Message {
    Color color = 1;
    Size size = 2;
}`

		expectProto(schema, expectedBody)
	})

	it('should throw on enum/message name collision', () => {
		const colorScheme = z.enum(['red', 'blue']).meta({ id: 'color' })
		const schema = z.object({
			color: z.object({
				value: colorScheme
			})
		})

		expect(() => zodToProtobuf(schema)).toThrowError(
			'Name collision: "Color" is used for both an enum and a message'
		)
	})

	it('should handle transform', () => {
		const schema = z.object({
			name: z.string().transform((val) => val.toUpperCase())
		})

		const expectedBody = `
message Message {
    string name = 1;
}`

		expectProto(schema, expectedBody)
	})

	it('should handle chained transforms', () => {
		const schema = z.object({
			name: z
				.string()
				.transform((val) => val.trim())
				.transform((val) => val.toUpperCase())
		})

		const expectedBody = `
message Message {
    string name = 1;
}`

		expectProto(schema, expectedBody)
	})

	it('should handle explicit pipe', () => {
		const schema = z.object({
			name: z.string().pipe(z.number())
		})

		const expectedBody = `
message Message {
    string name = 1;
}`

		expectProto(schema, expectedBody)
	})

	it('should handle default', () => {
		const schema = z.object({
			name: z.string().default('hello')
		})

		const expectedBody = `
message Message {
    string name = 1;
}`

		expectProto(schema, expectedBody)
	})

	it('should handle optional with default', () => {
		const schema = z.object({
			name: z.string().optional().default('hello')
		})

		const expectedBody = `
message Message {
    optional string name = 1;
}`

		expectProto(schema, expectedBody)
	})

	it('should handle catch', () => {
		const schema = z.object({
			name: z.string().catch('fallback')
		})

		const expectedBody = `
message Message {
    string name = 1;
}`

		expectProto(schema, expectedBody)
	})

	// --- New feature tests ---

	it('should handle z.union as oneof', () => {
		const schema = z.object({
			value: z.union([z.string(), z.number().int()])
		})

		const expectedBody = `
message Message {
    oneof value {
        string value_string = 1;
        int32 value_int32 = 2;
    }
}`

		expectProto(schema, expectedBody)
	})

	it('should handle z.union with objects as oneof', () => {
		const schema = z.object({
			result: z.union([
				z.object({ data: z.string() }),
				z.object({ error: z.string() })
			])
		})

		const expectedBody = `
message Result_message {
    string data = 1;
}

message Result_message2 {
    string error = 1;
}

message Message {
    oneof result {
        Result_message result_message = 1;
        Result_message2 result_message2 = 2;
    }
}`

		expectProto(schema, expectedBody)
	})

	it('should handle z.discriminatedUnion as oneof', () => {
		const schema = z.object({
			shape: z.discriminatedUnion('type', [
				z.object({ type: z.literal('circle'), radius: z.number() }),
				z.object({ type: z.literal('square'), side: z.number() })
			])
		})

		const expectedBody = `
message Shape_message {
    string type = 1;
    double radius = 2;
}

message Shape_message2 {
    string type = 1;
    double side = 2;
}

message Message {
    oneof shape {
        Shape_message shape_message = 1;
        Shape_message2 shape_message2 = 2;
    }
}`

		expectProto(schema, expectedBody)
	})

	it('should handle z.record with string keys', () => {
		const schema = z.object({
			metadata: z.record(z.string(), z.number().int())
		})

		const expectedBody = `
message Message {
    map<string, int32> metadata = 1;
}`

		expectProto(schema, expectedBody)
	})

	it('should handle z.record with object values', () => {
		const schema = z.object({
			users: z.record(
				z.string(),
				z.object({
					name: z.string(),
					age: z.number().int()
				})
			)
		})

		const expectedBody = `
message UsersValue {
    string name = 1;
    int32 age = 2;
}

message Message {
    map<string, UsersValue> users = 1;
}`

		expectProto(schema, expectedBody)
	})

	it('should handle z.literal string', () => {
		const schema = z.object({
			type: z.literal('hello')
		})

		const expectedBody = `
message Message {
    string type = 1;
}`

		expectProto(schema, expectedBody)
	})

	it('should handle z.literal number', () => {
		const schema = z.object({
			code: z.literal(42)
		})

		const expectedBody = `
message Message {
    int32 code = 1;
}`

		expectProto(schema, expectedBody)
	})

	it('should handle z.literal boolean', () => {
		const schema = z.object({
			flag: z.literal(true)
		})

		const expectedBody = `
message Message {
    bool flag = 1;
}`

		expectProto(schema, expectedBody)
	})

	it('should handle z.date with useGoogleTimestamp option', () => {
		const schema = z.object({
			createdAt: z.date(),
			updatedAt: z.date()
		})

		const expectedBody = `
message Message {
    google.protobuf.Timestamp createdAt = 1;
    google.protobuf.Timestamp updatedAt = 2;
}`

		expectProto(schema, expectedBody, { useGoogleTimestamp: true })
	})

	it('should not include timestamp import when useGoogleTimestamp is false', () => {
		const schema = z.object({
			createdAt: z.date()
		})

		const proto = zodToProtobuf(schema)
		expect(proto).not.toContain('import')
		expect(proto).toContain('string createdAt')
	})

	it('should throw on arrays of unions instead of silently dropping repeated', () => {
		const schema = z.object({
			values: z.array(z.union([z.string(), z.number().int()])),
			tags: z.set(z.union([z.string(), z.number()]))
		})

		// proto3 has no repeated oneof; emitting a plain oneof would silently
		// change the shape of the data being described.
		expect(() => zodToProtobuf(schema)).toThrowError(UnsupportedTypeException)
	})

	it('should detect nested arrays hidden behind wrappers', () => {
		const schema = z.object({
			piped: z.array(z.array(z.string()).pipe(z.array(z.string()))),
			defaulted: z.array(z.array(z.string()).default([]))
		})

		const expectedBody = `
message PipedList {
    repeated string piped = 1;
}

message DefaultedList {
    repeated string defaulted = 1;
}

message Message {
    repeated PipedList piped = 1;
    repeated DefaultedList defaulted = 2;
}`

		expectProto(schema, expectedBody)
	})
})
