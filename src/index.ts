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
	ZodType,
	ZodUnion,
	type ZodTypeAny
} from 'zod'

interface ZodToProtobufOptions {
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

interface ProtobufField {
	types: Array<string | null>
	name: string
	oneofMembers?: ProtobufField[]
}

/**
 * Converts a Zod number to its corresponding Protobuf type name.
 * @param value The ZodNumber instance.
 * @returns The Protobuf type name.
 */
const getNumberTypeName = ({ value }: { value: ZodNumber }): string => {
	return value.isInt ? 'int32' : 'double'
}

/**
 * Converts a string to PascalCase.
 * @param value The string.
 * @returns The PascalCase string.
 */
const toPascalCase = ({ value }: { value: string }): string => {
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
const toScreamingSnakeCase = ({ value }: { value: string }): string => {
	return value
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
		.toUpperCase()
}

const protobufFieldToType = ({ field }: { field: ProtobufField }) => {
	return field.types.filter(Boolean).join(' ')
}

/**
 * Formats an array of ProtobufFields into formatted string lines with
 * sequential field numbering, handling oneof blocks.
 * @param fields The ProtobufField array.
 * @returns An array of formatted field strings.
 */
const formatFields = ({ fields }: { fields: ProtobufField[] }): string[] => {
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
const getOneofTypeSuffix = ({ value }: { value: unknown }): string => {
	if (value instanceof ZodString) return 'string'
	if (value instanceof ZodNumber) {
		return (value as ZodNumber).isInt ? 'int32' : 'double'
	}
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
const traverseArray = ({
	key,
	value,
	messages,
	enums,
	typePrefix,
	useGoogleTimestamp,
	hasTimestamp
}: {
	key: string
	value: ZodArray<ZodTypeAny> | ZodSet<ZodTypeAny>
	messages: Map<string, string[]>
	enums: Map<string, string[]>
	typePrefix: string | null
	useGoogleTimestamp: boolean
	hasTimestamp: { value: boolean }
}): ProtobufField[] => {
	const nestedValue =
		value instanceof ZodArray
			? value.element
			: (value as ZodSet<ZodTypeAny>).def.valueType

	// Unwrap optional/nullable to check the underlying type
	let unwrapped: unknown = nestedValue
	while (unwrapped instanceof ZodOptional || unwrapped instanceof ZodNullable) {
		unwrapped = (unwrapped as ZodOptional<ZodTypeAny>).unwrap()
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
			value: unwrapped as ZodArray<ZodTypeAny> | ZodSet<ZodTypeAny>,
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
	return elementFields.map((field) => ({
		...field,
		types: ['repeated', ...field.types],
		name: key
	}))
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
const traverseMap = ({
	key,
	value,
	messages,
	enums,
	typePrefix,
	useGoogleTimestamp,
	hasTimestamp
}: {
	key: string
	value: ZodMap<ZodTypeAny, ZodTypeAny>
	messages: Map<string, string[]>
	enums: Map<string, string[]>
	typePrefix: string | null
	useGoogleTimestamp: boolean
	hasTimestamp: { value: boolean }
}): ProtobufField[] => {
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
const traverseKey = ({
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
	value: unknown
	messages: Map<string, string[]>
	enums: Map<string, string[]>
	isOptional: boolean
	isInArray: boolean
	typePrefix: string | null
	useGoogleTimestamp: boolean
	hasTimestamp: { value: boolean }
}): ProtobufField[] => {
	if (value instanceof ZodOptional || value instanceof ZodNullable) {
		return traverseKey({
			key,
			value: (value as ZodOptional<ZodTypeAny>).unwrap(),
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
			value: (value as ZodPipe<ZodTypeAny, ZodTypeAny>).in,
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
			value: (value as ZodDefault<ZodTypeAny> | ZodCatch<ZodTypeAny>).unwrap(),
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
			value: value as ZodArray<ZodTypeAny> | ZodSet<ZodTypeAny>,
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
			value: value as ZodMap<ZodTypeAny, ZodTypeAny>,
			messages,
			enums,
			typePrefix,
			useGoogleTimestamp,
			hasTimestamp
		})
	}

	if (value instanceof ZodRecord) {
		const recordValue = value as ZodRecord
		const keyType = traverseKey({
			key: `${key}Key`,
			value: recordValue.keyType,
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
			value: recordValue.valueType,
			messages,
			enums,
			isOptional: false,
			isInArray: true,
			typePrefix,
			useGoogleTimestamp,
			hasTimestamp
		})

		if (!keyType[0] || keyType.length !== 1) {
			throw new UnsupportedTypeException(`${key} record key`)
		}
		if (!valueType[0] || valueType.length !== 1) {
			throw new UnsupportedTypeException(`${key} record value`)
		}

		const mapType = `map<${protobufFieldToType({ field: keyType[0] })}, ${protobufFieldToType({ field: valueType[0] })}>`
		return [
			{
				types: [mapType],
				name: key
			}
		]
	}

	if (value instanceof ZodUnion || value instanceof ZodDiscriminatedUnion) {
		const options = (value as ZodUnion<[ZodTypeAny, ...ZodTypeAny[]]>)
			.options as ZodTypeAny[]
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
		const enumFields = (value.options as Array<string | number>)
			.map(
				(option: string | number, index: number) =>
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
		const literalValues = (value as ZodLiteral).values
		const first = literalValues.values().next().value
		if (typeof first === 'string') {
			return [{ types: [optional, 'string'], name: key }]
		}
		if (typeof first === 'number') {
			return [
				{
					types: [optional, Number.isInteger(first) ? 'int32' : 'double'],
					name: key
				}
			]
		}
		if (typeof first === 'boolean') {
			return [{ types: [optional, 'bool'], name: key }]
		}
		throw new UnsupportedTypeException(`ZodLiteral(${typeof first})`)
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
		const tupleFields: ProtobufField[] = (
			(value as ZodTuple<[ZodTypeAny, ...ZodTypeAny[]]>).def
				.items as ZodTypeAny[]
		).flatMap((item: ZodTypeAny, index: number) => {
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
		})

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

	if (value instanceof ZodType) {
		throw new UnsupportedTypeException(value.constructor.name)
	}

	throw new UnsupportedTypeException(typeof value)
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
const traverseSchema = ({
	schema,
	messages,
	enums,
	typePrefix,
	useGoogleTimestamp,
	hasTimestamp
}: {
	schema: ZodTypeAny
	messages: Map<string, string[]>
	enums: Map<string, string[]>
	typePrefix: string | null
	useGoogleTimestamp: boolean
	hasTimestamp: { value: boolean }
}): string[] => {
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
const zodToProtobuf = (
	schema: ZodTypeAny,
	options: ZodToProtobufOptions = {}
): string => {
	const {
		packageName = 'default',
		rootMessageName = 'Message',
		typePrefix = '',
		useGoogleTimestamp = false
	} = options

	const messages = new Map<string, string[]>()
	const enums = new Map<string, string[]>()
	const hasTimestamp = { value: false }

	const fields = traverseSchema({
		schema,
		messages,
		enums,
		typePrefix,
		useGoogleTimestamp,
		hasTimestamp
	})
	messages.set(`${typePrefix}${rootMessageName}`, fields)

	// Validate no enum/message name collisions
	for (const enumName of enums.keys()) {
		if (messages.has(enumName)) {
			throw new Error(
				`Name collision: "${enumName}" is used for both an enum and a message. Use .meta({ id: '...' }) on the enum to give it a unique name.`
			)
		}
	}

	const enumsString = Array.from(enums.values()).map((enumDef) =>
		enumDef.join('\n')
	)

	const messagesString = Array.from(messages.entries()).map(
		([name, fields]) =>
			`message ${name} {\n${fields.map((field) => `    ${field}`).join('\n')}\n}`
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
