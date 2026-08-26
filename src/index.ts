import * as inflection from 'inflection'
import {
	ZodArray,
	ZodBigInt,
	ZodBoolean,
	ZodCatch,
	ZodDate,
	ZodDefault,
	ZodDiscriminatedUnion,
	ZodEnum,
	ZodLiteral,
	ZodMap,
	ZodNullable,
	ZodNumber,
	ZodObject,
	ZodOptional,
	ZodPipe,
	ZodRecord,
	ZodSet,
	ZodString,
	ZodTuple,
	ZodUnion,
	type ZodTypeAny
} from 'zod'
// SAFETY note on the umbrella type below: $ZodType is zod v4's structural
// schema interface, so every runtime `instanceof ZodXxx` narrowing is
// assignable to it without assertions -- unlike the nominal ZodTypeAny class.
import { type $ZodType } from 'zod/v4/core'

type ZodToProtobufOptions = {
	packageName?: string
	rootMessageName?: string
	typePrefix?: string
	useGoogleTimestamp?: boolean
}

class UnsupportedTypeException extends Error {
	constructor(type: string) {
		super(`Unsupported type: ${type}`)
		this.name = 'UnsupportedTypeException'
	}
}

type ProtobufField = {
	types: string[]
	name: string
	oneofMembers?: ProtobufField[]
}

/** Shared state threaded through the whole conversion traversal. */
type Context = {
	messages: Map<string, string[]>
	enums: Map<string, string[]>
	typePrefix: string
	useGoogleTimestamp: boolean
	hasTimestamp: boolean
}

/**
 * Converts a Zod number to its corresponding Protobuf type name.
 * @param value The ZodNumber instance.
 * @returns The Protobuf type name.
 */
function getNumberTypeName(value: ZodNumber): string {
	return value.isInt ? 'int32' : 'double'
}

/**
 * Converts a string to PascalCase.
 * @param value The string.
 * @returns The PascalCase string.
 */
function toPascalCase(value: string): string {
	return value
		.split('.')
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join('')
}

/**
 * Converts a PascalCase or camelCase string to SCREAMING_SNAKE_CASE.
 * @param value The string.
 * @returns The SCREAMING_SNAKE_CASE string.
 */
function toScreamingSnakeCase(value: string): string {
	return value
		.replaceAll(/([a-z0-9])([A-Z])/g, '$1_$2')
		.replaceAll(/([A-Z])([A-Z][a-z])/g, '$1_$2')
		.toUpperCase()
}

function renderFieldType(field: ProtobufField): string {
	return field.types.join(' ')
}

/**
 * Formats an array of ProtobufFields into formatted string lines with
 * sequential field numbering, handling oneof blocks.
 * @param fields The ProtobufField array.
 * @returns An array of formatted field strings.
 */
function formatFields(fields: ProtobufField[]): string[] {
	const lines: string[] = []
	let fieldNum = 1
	for (const field of fields) {
		if (field.oneofMembers) {
			lines.push(`oneof ${field.name} {`)
			for (const member of field.oneofMembers) {
				lines.push(
					`    ${renderFieldType(member)} ${member.name} = ${fieldNum};`
				)
				fieldNum++
			}
			lines.push('}')
		} else {
			lines.push(`${renderFieldType(field)} ${field.name} = ${fieldNum};`)
			fieldNum++
		}
	}
	return lines
}

/**
 * Returns a type suffix for naming oneof members based on the Zod type.
 * @param value The Zod schema value.
 * @returns A short string suffix.
 */
function getOneofTypeSuffix(value: $ZodType): string {
	if (value instanceof ZodString) return 'string'
	if (value instanceof ZodNumber) return getNumberTypeName(value)
	if (value instanceof ZodBoolean) return 'bool'
	if (value instanceof ZodBigInt) return 'int64'
	if (value instanceof ZodDate) return 'date'
	if (value instanceof ZodObject) return 'message'
	if (value instanceof ZodArray || value instanceof ZodSet) return 'list'
	if (value instanceof ZodEnum) return 'enum'
	if (value instanceof ZodLiteral) return 'literal'
	return 'value'
}

/**
 * Maps a ZodLiteral to its Protobuf scalar type by inspecting the JS runtime
 * type of the literal's held values.
 * @param value The ZodLiteral instance.
 * @returns The Protobuf scalar type name.
 */
function getLiteralTypeName(value: ZodLiteral): string {
	/* oxlint-disable anti-slop/no-runtime-typeof --
	 * Discriminating a ZodLiteral by the JavaScript primitive type of its
	 * held values IS this library's domain logic, not smuggled slop. proto3's
	 * int32/double/string/bool split follows the runtime primitive type, and
	 * zod exposes no static marker distinguishing z.literal("x") from
	 * z.literal(1). This function is the I/O boundary; there is nothing
	 * earlier to parse against.
	 */
	const first = value.values.values().next().value
	if (typeof first === 'string') return 'string'
	if (typeof first === 'number') {
		return Number.isInteger(first) ? 'int32' : 'double'
	}
	if (typeof first === 'boolean') return 'bool'
	throw new UnsupportedTypeException(`ZodLiteral(${typeof first})`)
	/* oxlint-enable anti-slop/no-runtime-typeof */
}

/**
 * Wraps already-generated fields as repeated members under an outer key,
 * used when flattening nested array/set element types.
 * @param field The generated element field.
 * @param key The outer (plural) key.
 * @returns The repeated field definition.
 */
function toRepeatedField(field: ProtobufField, key: string): ProtobufField {
	const repeatedField: ProtobufField = {
		types: ['repeated', ...field.types],
		name: key
	}
	if (field.oneofMembers) {
		repeatedField.oneofMembers = field.oneofMembers
	}
	return repeatedField
}

/**
 * Asserts a traversal produced exactly one plain field and returns it, so
 * map/record sides can safely be rendered as a scalar map<...> entry.
 */
function soleField(fields: ProtobufField[], label: string): ProtobufField {
	const [only] = fields
	if (only === undefined || fields.length !== 1) {
		throw new UnsupportedTypeException(label)
	}
	return only
}

/**
 * Builds a `map<K, V>` field shared by the ZodMap and ZodRecord branches,
 * validating that neither side flattens into more than one field.
 */
function toMapField(
	context: Context,
	key: string,
	keyType: $ZodType,
	valueType: $ZodType,
	labelPrefix: 'map' | 'record'
): ProtobufField {
	const keyField = soleField(
		traverseKey(`${key}Key`, keyType, false, true, context),
		`${key} ${labelPrefix} key`
	)
	const valueField = soleField(
		traverseKey(`${key}Value`, valueType, false, true, context),
		`${key} ${labelPrefix} value`
	)

	return {
		types: [
			`map<${renderFieldType(keyField)}, ${renderFieldType(valueField)}>`
		],
		name: key
	}
}

/**
 * Traverses an array or set schema and generates Protobuf fields. Wraps
 * nested arrays in messages to avoid invalid `repeated repeated`.
 * @param key The key for the array.
 * @param value The ZodArray or ZodSet instance.
 * @param context Shared traversal state.
 * @returns An array of Protobuf field definitions.
 */
function traverseArray(
	key: string,
	value: ZodArray | ZodSet,
	context: Context
): ProtobufField[] {
	const nestedValue =
		value instanceof ZodArray ? value.element : value.def.valueType

	// Nested array/set: wrap inner array in a message to avoid invalid `repeated repeated`
	let unwrapped: unknown = nestedValue
	while (unwrapped instanceof ZodOptional || unwrapped instanceof ZodNullable) {
		unwrapped = unwrapped.unwrap()
	}
	if (unwrapped instanceof ZodArray || unwrapped instanceof ZodSet) {
		const singularKey = inflection.singularize(key)
		let wrapperName = `${context.typePrefix}${toPascalCase(singularKey)}List`
		// Avoid name collision with existing messages/enums
		const baseName = wrapperName
		let suffix = 2
		while (
			context.messages.has(wrapperName) ||
			context.enums.has(wrapperName)
		) {
			wrapperName = `${baseName}${suffix}`
			suffix++
		}

		const innerFields = traverseArray(singularKey, unwrapped, context)
		context.messages.set(wrapperName, formatFields(innerFields))

		return [{ types: ['repeated', wrapperName], name: key }]
	}

	const singularKey = inflection.singularize(key)
	const elementFields = traverseKey(
		singularKey,
		nestedValue,
		false,
		true,
		context
	)
	return elementFields.map((field) => toRepeatedField(field, key))
}

/**
 * Traverses a key and its schema value to generate Protobuf fields.
 * @param key The key.
 * @param value The schema value.
 * @param isOptional Whether an enclosing optional/nullable made the field optional.
 * @param isInArray Whether the field is inside an array.
 * @param context Shared traversal state.
 * @returns An array of Protobuf field definitions.
 */
function traverseKey(
	key: string,
	value: $ZodType,
	isOptional: boolean,
	isInArray: boolean,
	context: Context
): ProtobufField[] {
	// Peels off wrappers that do not change the wire representation.
	if (value instanceof ZodOptional || value instanceof ZodNullable) {
		return traverseKey(key, value.unwrap(), true, isInArray, context)
	}
	if (
		value instanceof ZodPipe ||
		value instanceof ZodDefault ||
		value instanceof ZodCatch
	) {
		const inner = value instanceof ZodPipe ? value.in : value.unwrap()
		return traverseKey(key, inner, isOptional, isInArray, context)
	}

	if (value instanceof ZodArray || value instanceof ZodSet) {
		return traverseArray(key, value, context)
	}

	if (value instanceof ZodMap) {
		return [
			toMapField(context, key, value.def.keyType, value.def.valueType, 'map')
		]
	}

	if (value instanceof ZodRecord) {
		return [toMapField(context, key, value.keyType, value.valueType, 'record')]
	}

	if (value instanceof ZodUnion || value instanceof ZodDiscriminatedUnion) {
		const members: ProtobufField[] = []
		const usedSuffixes = new Set<string>()

		for (const option of value.options) {
			let suffix = getOneofTypeSuffix(option)
			// Deduplicate suffixes
			if (usedSuffixes.has(suffix)) {
				let counter = 2
				while (usedSuffixes.has(`${suffix}${counter}`)) {
					counter++
				}
				suffix = `${suffix}${counter}`
			}
			usedSuffixes.add(suffix)

			const memberKey = `${key}_${suffix}`
			const memberFields = traverseKey(memberKey, option, false, true, context)
			members.push(...memberFields)
		}

		return [{ types: [], name: key, oneofMembers: members }]
	}

	const optional = isOptional && !isInArray ? ['optional'] : []

	if (value instanceof ZodObject) {
		const messageName = `${context.typePrefix}${toPascalCase(key)}`
		context.messages.set(messageName, traverseSchema(value, context))
		return [{ types: [...optional, messageName], name: key }]
	}

	if (value instanceof ZodString) {
		return [{ types: [...optional, 'string'], name: key }]
	}

	if (value instanceof ZodNumber) {
		return [{ types: [...optional, getNumberTypeName(value)], name: key }]
	}

	if (value instanceof ZodBoolean) {
		return [{ types: [...optional, 'bool'], name: key }]
	}

	if (value instanceof ZodEnum) {
		const baseName = toPascalCase(value.meta()?.id ?? key)
		const enumName = `${context.typePrefix}${baseName}`
		const prefix = toScreamingSnakeCase(enumName)
		const unspecified = `    ${prefix}_UNSPECIFIED = 0;`
		const enumMembers = value.options
			.map(
				(option, index) =>
					`    ${prefix}_${String(option).toUpperCase()} = ${index + 1};`
			)
			.join('\n')
		context.enums.set(enumName, [
			`enum ${enumName} {\n${unspecified}\n${enumMembers}\n}`
		])
		return [{ types: [...optional, enumName], name: key }]
	}

	if (value instanceof ZodLiteral) {
		return [{ types: [...optional, getLiteralTypeName(value)], name: key }]
	}

	if (value instanceof ZodDate) {
		if (context.useGoogleTimestamp) {
			context.hasTimestamp = true
			return [{ types: [...optional, 'google.protobuf.Timestamp'], name: key }]
		}
		return [{ types: [...optional, 'string'], name: key }]
	}

	if (value instanceof ZodBigInt) {
		return [{ types: [...optional, 'int64'], name: key }]
	}

	if (value instanceof ZodTuple) {
		const tupleFields: ProtobufField[] = value.def.items.flatMap(
			(item, index) =>
				traverseKey(`${key}_${index}`, item, false, isInArray, context)
		)

		const tupleMessageName = `${context.typePrefix}${toPascalCase(key)}`
		context.messages.set(tupleMessageName, formatFields(tupleFields))
		return [{ types: [...optional, tupleMessageName], name: key }]
	}

	throw new UnsupportedTypeException(value.constructor.name)
}

/**
 * Traverses a schema and generates Protobuf fields.
 * @param schema The Zod schema.
 * @param context Shared traversal state.
 * @returns An array of formatted Protobuf field strings.
 */
function traverseSchema(schema: $ZodType, context: Context): string[] {
	if (!(schema instanceof ZodObject)) {
		throw new UnsupportedTypeException(schema.constructor.name)
	}

	const fields = Object.entries(schema.shape).flatMap(([key, value]) =>
		traverseKey(key, value, false, false, context)
	)

	return formatFields(fields)
}

/**
 * Converts a Zod schema to a Protobuf definition.
 * @param schema The Zod schema.
 * @param options The conversion options.
 * @returns The Protobuf definition.
 */
function zodToProtobuf(
	schema: ZodTypeAny,
	options: ZodToProtobufOptions = {}
): string {
	const {
		packageName = 'default',
		rootMessageName = 'Message',
		typePrefix = '',
		useGoogleTimestamp = false
	} = options

	const context: Context = {
		messages: new Map<string, string[]>(),
		enums: new Map<string, string[]>(),
		typePrefix,
		useGoogleTimestamp,
		hasTimestamp: false
	}

	context.messages.set(
		typePrefix + rootMessageName,
		traverseSchema(schema, context)
	)

	// Validate no enum/message name collisions
	for (const enumName of context.enums.keys()) {
		if (context.messages.has(enumName)) {
			throw new Error(
				`Name collision: "${enumName}" is used for both an enum and a message. Use .meta({ id: '...' }) on the enum to give it a unique name.`
			)
		}
	}

	const enumsString = [...context.enums.values()].map((enumDef) =>
		enumDef.join('\n')
	)

	const messagesString = [...context.messages.entries()].map(
		([name, fieldLines]) =>
			`message ${name} {\n${fieldLines.map((field) => `    ${field}`).join('\n')}\n}`
	)

	const content = [enumsString, messagesString]
		.filter((strings) => !!strings.length)
		.map((strings) => strings.join('\n\n'))
		.join('\n\n')

	const imports = context.hasTimestamp
		? '\nimport "google/protobuf/timestamp.proto";\n'
		: ''

	const protoDefinition = `
syntax = "proto3";
package ${packageName};
${imports}
${content}
`

	return protoDefinition.trim()
}

export { zodToProtobuf, type ZodToProtobufOptions, UnsupportedTypeException }
