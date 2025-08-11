import * as inflection from 'inflection'
import {
	ZodArray,
	ZodBigInt,
	ZodBoolean,
	ZodDate,
	ZodEnum,
	ZodMap,
	ZodNullable,
	ZodNumber,
	ZodObject,
	ZodOptional,
	ZodSet,
	ZodString,
	ZodTuple,
	ZodType,
	type ZodTypeAny
} from 'zod'

interface ZodToProtobufOptions {
	packageName?: string
	rootMessageName?: string
	typePrefix?: string
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
 * Traverses an array schema and generates Protobuf fields.
 * @param key The key for the array.
 * @param value The ZodArray instance.
 * @param messages The map of message definitions.
 * @param enums The map of enum definitions.
 * @param typePrefix The prefix for type names.
 * @returns An array of Protobuf field definitions.
 */
const traverseArray = ({
	key,
	value,
	messages,
	enums,
	typePrefix
}: {
	key: string
	value: ZodArray<ZodTypeAny> | ZodSet<ZodTypeAny>
	messages: Map<string, string[]>
	enums: Map<string, string[]>
	typePrefix: string | null
}): ProtobufField[] => {
	const nestedValue =
		value instanceof ZodArray
			? value.element
			: value instanceof ZodSet
				? (value._def as { valueType: ZodTypeAny }).valueType
				: // @ts-expect-error
					(value._def as { element?: ZodTypeAny }).element

	const singularKey = inflection.singularize(key)
	const elementFields = traverseKey({
		key: singularKey,
		value: nestedValue,
		messages,
		enums,
		isOptional: false, // Ensure elements inside arrays are not optional
		isInArray: true,
		typePrefix
	})
	return elementFields.map((field) => ({
		...field,
		types: ['repeated', ...field.types],
		name: field.name.replace(singularKey, key)
	}))
}

/**
 * Traverses a map schema and generates Protobuf fields.
 * @param key The key for the map.
 * @param value The ZodMap instance.
 * @param messages The map of message definitions.
 * @param enums The map of enum definitions.
 * @param typePrefix The prefix for type names.
 * @returns An array of Protobuf field definitions.
 */
const traverseMap = ({
	key,
	value,
	messages,
	enums,
	typePrefix
}: {
	key: string
	value: ZodMap<ZodTypeAny, ZodTypeAny>
	messages: Map<string, string[]>
	enums: Map<string, string[]>
	typePrefix: string | null
}): ProtobufField[] => {
	const keyType = traverseKey({
		key: `${key}Key`,
		value: value._def.keyType,
		messages,
		enums,
		isOptional: false,
		isInArray: true,
		typePrefix
	})
	const valueType = traverseKey({
		key: `${key}Value`,
		value: value._def.valueType,
		messages,
		enums,
		isOptional: false,
		isInArray: true,
		typePrefix
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
 * @returns An array of Protobuf field definitions.
 */
const traverseKey = ({
	key,
	value,
	messages,
	enums,
	isOptional,
	isInArray,
	typePrefix
}: {
	key: string
	value: unknown
	messages: Map<string, string[]>
	enums: Map<string, string[]>
	isOptional: boolean
	isInArray: boolean
	typePrefix: string | null
}): ProtobufField[] => {
	if (value instanceof ZodOptional || value instanceof ZodNullable) {
		return traverseKey({
			key,
			value: value.unwrap(),
			messages,
			enums,
			isOptional: true,
			isInArray,
			typePrefix
		})
	}

	if (value instanceof ZodArray || value instanceof ZodSet) {
		return traverseArray({
			key,
			value: value as ZodArray<ZodTypeAny> | ZodSet<ZodTypeAny>,
			messages,
			enums,
			typePrefix
		})
	}

	if (value instanceof ZodMap) {
		return traverseMap({
			key,
			value: value as ZodMap<ZodTypeAny, ZodTypeAny>,
			messages,
			enums,
			typePrefix
		})
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
			typePrefix
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
		const enumFields = value.options
			.map(
				(option: string | number, index: number) =>
					`    ${String(option)} = ${index};`
			)
			.join('\n')
		let enumName = toPascalCase({ value: key })
		if (typePrefix) {
			enumName = `${typePrefix}${enumName}`
		}
		enums.set(enumName, [`enum ${enumName} {\n${enumFields}\n}`])
		return [
			{
				types: [optional, enumName],
				name: key
			}
		]
	}

	if (value instanceof ZodDate) {
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
			value._def.items as ZodTypeAny[]
		).flatMap((item: ZodTypeAny, index: number) => {
			return traverseKey({
				key: `${key}_${index}`,
				value: item,
				messages,
				enums,
				isOptional: false,
				isInArray,
				typePrefix
			})
		})

		const tupleMessageName = toPascalCase({ value: key })
		messages.set(
			tupleMessageName,
			tupleFields.map(
				(field, index) =>
					`  ${field.types.join(' ')} ${field.name} = ${index + 1};`
			)
		)
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

const protobufFieldToType = ({ field }: { field: ProtobufField }) => {
	return field.types.filter(Boolean).join(' ')
}

/**
 * Traverses a schema and generates Protobuf fields.
 * @param schema The Zod schema.
 * @param messages The map of message definitions.
 * @param enums The map of enum definitions.
 * @param typePrefix The prefix for type names.
 * @returns An array of Protobuf field definitions.
 */
const traverseSchema = ({
	schema,
	messages,
	enums,
	typePrefix
}: {
	schema: ZodTypeAny
	messages: Map<string, string[]>
	enums: Map<string, string[]>
	typePrefix: string | null
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
			typePrefix
		})
	})

	return fields.map(
		(field, index) =>
			`${protobufFieldToType({ field })} ${field.name} = ${index + 1};`
	)
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
		typePrefix = ''
	} = options

	const messages = new Map<string, string[]>()
	const enums = new Map<string, string[]>()

	const fields = traverseSchema({ schema, messages, enums, typePrefix })
	messages.set(`${typePrefix}${rootMessageName}`, fields)

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

	const protoDefinition = `
syntax = "proto3";
package ${packageName};

${content}
`

	return protoDefinition.trim()
}

export { zodToProtobuf, type ZodToProtobufOptions, UnsupportedTypeException }
