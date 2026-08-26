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
	types: Array<string | null>
	name: string
	oneofMembers?: ProtobufField[]
}

/**
 * Converts a Zod number to its corresponding Protobuf type name.
 * @param value The ZodNumber instance.
 * @returns The Protobuf type name.
 */
function getNumberTypeName({ value }: { value: ZodNumber }): string {
	return value.isInt ? 'int32' : 'double'
}

/**
 * Converts a string to PascalCase.
 * @param value The string.
 * @returns The PascalCase string.
 */
function toPascalCase({ value }: { value: string }): string {
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
function toScreamingSnakeCase({ value }: { value: string }): string {
	return value
		.replaceAll(/([a-z0-9])([A-Z])/g, '$1_$2')
		.replaceAll(/([A-Z])([A-Z][a-z])/g, '$1_$2')
		.toUpperCase()
}

function protobufFieldToType({ field }: { field: ProtobufField }) {
	return field.types.filter(Boolean).join(' ')
}

/**
 * Formats an array of ProtobufFields into formatted string lines with
 * sequential field numbering, handling oneof blocks.
 * @param fields The ProtobufField array.
 * @returns An array of formatted field strings.
 */
function formatFields({ fields }: { fields: ProtobufField[] }): string[] {
	const lines: string[] = []
	let fieldNum = 1
	for (const field of fields) {
		if (field.oneofMembers) {
			lines.push(`oneof ${field.name} {`)
			for (const member of field.oneofMembers) {
				lines.push(
					`    ${protobufFieldToType({ field: member })} ${member.name} = ${fieldNum};`
				)
				fieldNum++
			}
			lines.push('}')
		} else {
			lines.push(
				`${protobufFieldToType({ field })} ${field.name} = ${fieldNum};`
			)
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
function getOneofTypeSuffix({ value }: { value: unknown }): string {
	if (value instanceof ZodString) return 'string'
	if (value instanceof ZodNumber) return value.isInt ? 'int32' : 'double'
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
function getLiteralTypeName({ value }: { value: ZodLiteral }): string {
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
 * Traverses an array schema and generates Protobuf fields.
 * Wraps nested arrays in messages to avoid invalid `repeated repeated`.
 * @param key The key for the array.
 * @param value The ZodArray or ZodSet instance.
 * @param messages The map of message definitions.
 * @param enums The map of enum definitions.
 * @param typePrefix The prefix for type names.
 * @param useGoogleTimestamp Whether to use google.protobuf.Timestamp for dates.
 * @param hasTimestamp Mutable ref tracking if Timestamp import is needed.
 * @returns An array of Protobuf field definitions.
 */
function traverseArray({
	key,
	value,
	messages,
	enums,
	typePrefix,
	useGoogleTimestamp,
	hasTimestamp
}: {
	key: string
	value: ZodArray | ZodSet
	messages: Map<string, string[]>
	enums: Map<string, string[]>
	typePrefix: string | null
	useGoogleTimestamp: boolean
	hasTimestamp: { value: boolean }
}): ProtobufField[] {
	const nestedValue =
		value instanceof ZodArray ? value.element : value.def.valueType

	// Unwrap optional/nullable to check the underlying type
	let unwrapped: unknown = nestedValue
	while (unwrapped instanceof ZodOptional || unwrapped instanceof ZodNullable) {
		unwrapped = unwrapped.unwrap()
	}

	// Nested array/set: wrap inner array in a message to avoid invalid `repeated repeated`
	if (unwrapped instanceof ZodArray || unwrapped instanceof ZodSet) {
		const singularKey = inflection.singularize(key)
		let wrapperName = `${toPascalCase({ value: singularKey })}List`
		if (typePrefix) {
			wrapperName = `${typePrefix}${wrapperName}`
		}
		// Avoid name collision with existing messages/enums
		const baseName = wrapperName
		let suffix = 2
		while (messages.has(wrapperName) || enums.has(wrapperName)) {
			wrapperName = `${baseName}${suffix}`
			suffix++
		}

		const innerFields = traverseArray({
			key: singularKey,
			value: unwrapped,
			messages,
			enums,
			typePrefix,
			useGoogleTimestamp,
			hasTimestamp
		})

		messages.set(wrapperName, formatFields({ fields: innerFields }))

		return [
			{
				types: ['repeated', wrapperName],
				name: key
			}
		]
	}

	const singularKey = inflection.singularize(key)
	const elementFields = traverseKey({
		key: singularKey,
		value: nestedValue,
		messages,
		enums,
		isOptional: false,
		isInArray: true,
		typePrefix,
		useGoogleTimestamp,
		hasTimestamp
	})
	return elementFields.map((field) => toRepeatedField(field, key))
}

/**
 * Traverses a map schema and generates Protobuf fields.
 * @param key The key for the map.
 * @param value The ZodMap instance.
 * @param messages The map of message definitions.
 * @param enums The map of enum definitions.
 * @param typePrefix The prefix for type names.
 * @param useGoogleTimestamp Whether to use google.protobuf.Timestamp for dates.
 * @param hasTimestamp Mutable ref tracking if Timestamp import is needed.
 * @returns An array of Protobuf field definitions.
 */
function traverseMap({
	key,
	value,
	messages,
	enums,
	typePrefix,
	useGoogleTimestamp,
	hasTimestamp
}: {
	key: string
	value: ZodMap
	messages: Map<string, string[]>
	enums: Map<string, string[]>
	typePrefix: string | null
	useGoogleTimestamp: boolean
	hasTimestamp: { value: boolean }
}): ProtobufField[] {
	const keyType = traverseKey({
		key: `${key}Key`,
		value: value.def.keyType,
		messages,
		enums,
		isOptional: false,
		isInArray: true,
		typePrefix,
		useGoogleTimestamp,
		hasTimestamp
	})
	const valueType = traverseKey({
		key: `${key}Value`,
		value: value.def.valueType,
		messages,
		enums,
		isOptional: false,
		isInArray: true,
		typePrefix,
		useGoogleTimestamp,
		hasTimestamp
	})

	if (!keyType[0] || keyType.length !== 1) {
		throw new UnsupportedTypeException(`${key} map key`)
	}

	if (!valueType[0] || valueType.length !== 1) {
		throw new UnsupportedTypeException(`${key} map value`)
	}

	const mapType = `map<${protobufFieldToType({ field: keyType[0] })}, ${protobufFieldToType({ field: valueType[0] })}>`
	return [
		{
			types: [mapType],
			name: key
		}
	]
}

/**
 * Traverses a key and its schema value to generate Protobuf fields.
 * @param key The key.
 * @param value The schema value.
 * @param messages The map of message definitions.
 * @param enums The map of enum definitions.
 * @param isOptional Whether the field is optional.
 * @param isInArray Whether the field is inside an array.
 * @param typePrefix The prefix for type names.
 * @param useGoogleTimestamp Whether to use google.protobuf.Timestamp for dates.
 * @param hasTimestamp Mutable ref tracking if Timestamp import is needed.
 * @returns An array of Protobuf field definitions.
 */
function traverseKey({
	key,
	value,
	messages,
	enums,
	isOptional,
	isInArray,
	typePrefix,
	useGoogleTimestamp,
	hasTimestamp
}: {
	key: string
	value: $ZodType
	messages: Map<string, string[]>
	enums: Map<string, string[]>
	isOptional: boolean
	isInArray: boolean
	typePrefix: string | null
	useGoogleTimestamp: boolean
	hasTimestamp: { value: boolean }
}): ProtobufField[] {
	if (value instanceof ZodOptional || value instanceof ZodNullable) {
		return traverseKey({
			key,
			value: value.unwrap(),
			messages,
			enums,
			isOptional: true,
			isInArray,
			typePrefix,
			useGoogleTimestamp,
			hasTimestamp
		})
	}

	if (value instanceof ZodPipe) {
		return traverseKey({
			key,
			value: value.in,
			messages,
			enums,
			isOptional,
			isInArray,
			typePrefix,
			useGoogleTimestamp,
			hasTimestamp
		})
	}

	if (value instanceof ZodDefault || value instanceof ZodCatch) {
		return traverseKey({
			key,
			value: value.unwrap(),
			messages,
			enums,
			isOptional,
			isInArray,
			typePrefix,
			useGoogleTimestamp,
			hasTimestamp
		})
	}

	if (value instanceof ZodArray || value instanceof ZodSet) {
		return traverseArray({
			key,
			value,
			messages,
			enums,
			typePrefix,
			useGoogleTimestamp,
			hasTimestamp
		})
	}

	if (value instanceof ZodMap) {
		return traverseMap({
			key,
			value,
			messages,
			enums,
			typePrefix,
			useGoogleTimestamp,
			hasTimestamp
		})
	}

	if (value instanceof ZodRecord) {
		const keyField = traverseKey({
			key: `${key}Key`,
			value: value.keyType,
			messages,
			enums,
			isOptional: false,
			isInArray: true,
			typePrefix,
			useGoogleTimestamp,
			hasTimestamp
		})
		const valueField = traverseKey({
			key: `${key}Value`,
			value: value.valueType,
			messages,
			enums,
			isOptional: false,
			isInArray: true,
			typePrefix,
			useGoogleTimestamp,
			hasTimestamp
		})

		if (!keyField[0] || keyField.length !== 1) {
			throw new UnsupportedTypeException(`${key} record key`)
		}
		if (!valueField[0] || valueField.length !== 1) {
			throw new UnsupportedTypeException(`${key} record value`)
		}

		const mapType = `map<${protobufFieldToType({ field: keyField[0] })}, ${protobufFieldToType({ field: valueField[0] })}>`
		return [
			{
				types: [mapType],
				name: key
			}
		]
	}

	if (value instanceof ZodUnion || value instanceof ZodDiscriminatedUnion) {
		const options = value.options
		const members: ProtobufField[] = []
		const usedSuffixes = new Set<string>()

		for (const option of options) {
			let suffix = getOneofTypeSuffix({ value: option })
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
			const memberFields = traverseKey({
				key: memberKey,
				value: option,
				messages,
				enums,
				isOptional: false,
				isInArray: true,
				typePrefix,
				useGoogleTimestamp,
				hasTimestamp
			})
			members.push(...memberFields)
		}

		return [
			{
				types: [],
				name: key,
				oneofMembers: members
			}
		]
	}

	const optional = isOptional && !isInArray ? 'optional' : null

	if (value instanceof ZodObject) {
		let messageName = toPascalCase({ value: key })
		if (typePrefix) {
			messageName = `${typePrefix}${messageName}`
		}
		const nestedMessageFields = traverseSchema({
			schema: value,
			messages,
			enums,
			typePrefix,
			useGoogleTimestamp,
			hasTimestamp
		})
		messages.set(messageName, nestedMessageFields)
		return [
			{
				types: [optional, messageName],
				name: key
			}
		]
	}

	if (value instanceof ZodString) {
		return [
			{
				types: [optional, 'string'],
				name: key
			}
		]
	}

	if (value instanceof ZodNumber) {
		const typeName = getNumberTypeName({ value })
		return [
			{
				types: [optional, typeName],
				name: key
			}
		]
	}

	if (value instanceof ZodBoolean) {
		return [
			{
				types: [optional, 'bool'],
				name: key
			}
		]
	}

	if (value instanceof ZodEnum) {
		let enumName = toPascalCase({ value: value.meta()?.id ?? key })
		if (typePrefix) {
			enumName = `${typePrefix}${enumName}`
		}
		const prefix = toScreamingSnakeCase({ value: enumName })
		const unspecified = `    ${prefix}_UNSPECIFIED = 0;`
		const enumFields = value.options
			.map(
				(option, index) =>
					`    ${prefix}_${String(option).toUpperCase()} = ${index + 1};`
			)
			.join('\n')
		enums.set(enumName, [
			`enum ${enumName} {\n${unspecified}\n${enumFields}\n}`
		])
		return [
			{
				types: [optional, enumName],
				name: key
			}
		]
	}

	if (value instanceof ZodLiteral) {
		return [
			{
				types: [optional, getLiteralTypeName({ value })],
				name: key
			}
		]
	}

	if (value instanceof ZodDate) {
		if (useGoogleTimestamp) {
			hasTimestamp.value = true
			return [
				{
					types: [optional, 'google.protobuf.Timestamp'],
					name: key
				}
			]
		}
		return [
			{
				types: [optional, 'string'],
				name: key
			}
		]
	}

	if (value instanceof ZodBigInt) {
		return [
			{
				types: [optional, 'int64'],
				name: key
			}
		]
	}

	if (value instanceof ZodTuple) {
		const tupleFields: ProtobufField[] = value.def.items.flatMap(
			(item, index) => {
				return traverseKey({
					key: `${key}_${index}`,
					value: item,
					messages,
					enums,
					isOptional: false,
					isInArray,
					typePrefix,
					useGoogleTimestamp,
					hasTimestamp
				})
			}
		)

		let tupleMessageName = toPascalCase({ value: key })
		if (typePrefix) {
			tupleMessageName = `${typePrefix}${tupleMessageName}`
		}
		messages.set(tupleMessageName, formatFields({ fields: tupleFields }))
		return [
			{
				types: [optional, tupleMessageName],
				name: key
			}
		]
	}

	throw new UnsupportedTypeException(value.constructor.name)
}

/**
 * Traverses a schema and generates Protobuf fields.
 * @param schema The Zod schema.
 * @param messages The map of message definitions.
 * @param enums The map of enum definitions.
 * @param typePrefix The prefix for type names.
 * @param useGoogleTimestamp Whether to use google.protobuf.Timestamp for dates.
 * @param hasTimestamp Mutable ref tracking if Timestamp import is needed.
 * @returns An array of formatted Protobuf field strings.
 */
function traverseSchema({
	schema,
	messages,
	enums,
	typePrefix,
	useGoogleTimestamp,
	hasTimestamp
}: {
	schema: $ZodType
	messages: Map<string, string[]>
	enums: Map<string, string[]>
	typePrefix: string | null
	useGoogleTimestamp: boolean
	hasTimestamp: { value: boolean }
}): string[] {
	if (!(schema instanceof ZodObject)) {
		throw new UnsupportedTypeException(schema.constructor.name)
	}

	const fields = Object.entries(schema.shape).flatMap(([key, value]) => {
		return traverseKey({
			key,
			value,
			messages,
			enums,
			isOptional: false,
			isInArray: false,
			typePrefix,
			useGoogleTimestamp,
			hasTimestamp
		})
	})

	return formatFields({ fields })
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

	const messages = new Map<string, string[]>()
	const enums = new Map<string, string[]>()
	const hasTimestamp = { value: false }

	const rootFields = traverseSchema({
		schema,
		messages,
		enums,
		typePrefix,
		useGoogleTimestamp,
		hasTimestamp
	})
	messages.set(`${typePrefix}${rootMessageName}`, rootFields)

	// Validate no enum/message name collisions
	for (const enumName of enums.keys()) {
		if (messages.has(enumName)) {
			throw new Error(
				`Name collision: "${enumName}" is used for both an enum and a message. Use .meta({ id: '...' }) on the enum to give it a unique name.`
			)
		}
	}

	const enumsString = [...enums.values()].map((enumDef) => enumDef.join('\n'))

	const messagesString = [...messages.entries()].map(
		([name, fieldLines]) =>
			`message ${name} {\n${fieldLines.map((field) => `    ${field}`).join('\n')}\n}`
	)

	const content = [enumsString, messagesString]
		.filter((strings) => !!strings.length)
		.map((strings) => strings.join('\n\n'))
		.join('\n\n')

	const imports = hasTimestamp.value
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
