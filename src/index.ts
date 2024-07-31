import * as inflection from "inflection"
import {
	ZodArray,
	ZodBoolean,
	ZodDate,
	ZodEnum,
	ZodNullable,
	ZodNumber,
	ZodObject,
	ZodOptional,
	ZodString,
	ZodType,
	type ZodTypeAny,
} from "zod"

interface ZodToProtobufOptions {
	packageName?: string
	messageName?: string
}

class UnsupportedTypeException extends Error {
	constructor(type: string) {
		super(`Unsupported type: ${type}`)
		this.name = "UnsupportedTypeException"
	}
}

/**
 * Converts a Zod number to its corresponding Protobuf type name.
 * @param value The ZodNumber instance.
 * @returns The Protobuf type name.
 */
const getNumberTypeName = ({ value }: { value: ZodNumber }): string => {
	return value.isInt ? "int32" : "double"
}

/**
 * Converts a dot-separated string to PascalCase.
 * @param key The dot-separated string.
 * @returns The PascalCase string.
 */
const fromDotToPascalCase = ({ key }: { key: string }): string => {
	return key
		.split(".")
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join("")
}

/**
 * Traverses an array schema and generates Protobuf fields.
 * @param key The key for the array.
 * @param value The ZodArray instance.
 * @param fieldNumber The current field number.
 * @param messages The map of message definitions.
 * @param enums The map of enum definitions.
 * @returns An array of Protobuf field definitions.
 */
const traverseArray = ({
	key,
	value,
	fieldNumber,
	messages,
	enums,
}: {
	key: string
	value: ZodArray<ZodTypeAny>
	fieldNumber: { current: number }
	messages: Map<string, string[]>
	enums: Map<string, string[]>
}): string[] => {
	const singularKey = inflection.singularize(key)
	const elementFields = traverseKey({
		key: singularKey,
		value: value._def.type,
		fieldNumber,
		messages,
		enums,
		isOptional: false, // Ensure elements inside arrays are not optional
		isInArray: true,
	})
	return elementFields.map(
		(field) => `repeated ${field.replace(singularKey, key)}`,
	)
}

/**
 * Traverses a key and its schema value to generate Protobuf fields.
 * @param key The key.
 * @param value The schema value.
 * @param fieldNumber The current field number.
 * @param messages The map of message definitions.
 * @param enums The map of enum definitions.
 * @param isOptional Whether the field is optional.
 * @param isInArray Whether the field is inside an array.
 * @returns An array of Protobuf field definitions.
 */
const traverseKey = ({
	key,
	value,
	fieldNumber,
	messages,
	enums,
	isOptional,
	isInArray,
}: {
	key: string
	value: unknown
	fieldNumber: { current: number }
	messages: Map<string, string[]>
	enums: Map<string, string[]>
	isOptional: boolean
	isInArray: boolean
}): string[] => {
	if (value instanceof ZodOptional || value instanceof ZodNullable) {
		return traverseKey({
			key,
			value: value.unwrap(),
			fieldNumber,
			messages,
			enums,
			isOptional: true,
			isInArray,
		})
	}

	if (value instanceof ZodArray) {
		return traverseArray({ key, value, fieldNumber, messages, enums })
	}

	const optionalKeyword = isOptional && !isInArray ? "optional " : ""

	if (value instanceof ZodObject) {
		const messageName = fromDotToPascalCase({ key })
		const nestedMessageFields = traverseSchema({
			schema: value,
			messages,
			enums,
		})
		messages.set(messageName, nestedMessageFields)
		return [
			`${optionalKeyword}${messageName} ${key} = ${fieldNumber.current++};`,
		]
	}

	if (value instanceof ZodString) {
		return [`${optionalKeyword}string ${key} = ${fieldNumber.current++};`]
	}

	if (value instanceof ZodNumber) {
		const typeName = getNumberTypeName({ value })
		return [`${optionalKeyword}${typeName} ${key} = ${fieldNumber.current++};`]
	}

	if (value instanceof ZodBoolean) {
		return [`${optionalKeyword}bool ${key} = ${fieldNumber.current++};`]
	}

	if (value instanceof ZodEnum) {
		const enumFields = value.options
			.map((option: string, index: number) => `    ${option} = ${index};`)
			.join("\n")
		const enumName = fromDotToPascalCase({ key })
		enums.set(enumName, [`enum ${enumName} {\n${enumFields}\n}`])
		return [`${optionalKeyword}${enumName} ${key} = ${fieldNumber.current++};`]
	}

	if (value instanceof ZodDate) {
		return [`${optionalKeyword}string ${key} = ${fieldNumber.current++};`]
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
 * @returns An array of Protobuf field definitions.
 */
const traverseSchema = ({
	schema,
	messages,
	enums,
}: {
	schema: ZodTypeAny
	messages: Map<string, string[]>
	enums: Map<string, string[]>
}): string[] => {
	if (!(schema instanceof ZodObject)) {
		throw new UnsupportedTypeException(schema.constructor.name)
	}

	const fieldNumber = { current: 1 }
	const fields = Object.entries(schema.shape).flatMap(([key, value]) =>
		traverseKey({
			key,
			value,
			fieldNumber,
			messages,
			enums,
			isOptional: false,
			isInArray: false,
		}),
	)
	return fields
}

/**
 * Converts a Zod schema to a Protobuf definition.
 * @param schema The Zod schema.
 * @param options The conversion options.
 * @returns The Protobuf definition.
 */
const zodToProtobuf = (
	schema: ZodTypeAny,
	options: ZodToProtobufOptions = {},
): string => {
	const { packageName = "default", messageName = "Message" } = options

	const messages = new Map<string, string[]>()
	const enums = new Map<string, string[]>()

	const fields = traverseSchema({ schema, messages, enums })
	messages.set(messageName, fields)

	const enumsString = Array.from(enums.values()).map((enumDef) =>
		enumDef.join("\n"),
	)

	const messagesString = Array.from(messages.entries()).map(
		([name, fields]) =>
			`message ${name} {\n${fields.map((field) => `    ${field}`).join("\n")}\n}`,
	)

	const content = [enumsString, messagesString]
		.filter((strings) => !!strings.length)
		.map((strings) => strings.join("\n\n"))
		.join("\n\n")

	const protoDefinition = `
syntax = "proto3";
package ${packageName};

${content}
`

	return protoDefinition.trim()
}

export { zodToProtobuf, type ZodToProtobufOptions, UnsupportedTypeException }
