/**
 * The shared schemas (schemas.ts) are written for Gemini, which rejects
 * `additionalProperties`. OpenAI and Claude can guarantee schema-valid tool
 * arguments and structured output in strict mode, but each wants the schema
 * in its own strict dialect. These turn one into the other on the way out.
 */

type Schema = Record<string, unknown>

function mapObjects(schema: unknown, visit: (node: Schema) => Schema): unknown {
  if (Array.isArray(schema)) return schema.map((item) => mapObjects(item, visit))
  if (schema === null || typeof schema !== 'object') return schema
  const out: Schema = {}
  for (const [key, value] of Object.entries(schema)) out[key] = mapObjects(value, visit)
  return out.type === 'object' ? visit(out) : out
}

/** Claude's strict dialect, used for the concept map's structured output:
 *  every object closed, optional properties left optional. */
export function closeObjects(schema: Schema): Schema {
  return mapObjects(schema, (node) => ({ ...node, additionalProperties: false })) as Schema
}

/** OpenAI's strict dialect: every object closed and every property required.
 *  A property that was optional becomes nullable instead, so the model can
 *  still leave it out by sending null, which the parsers read as absent. */
export function requireAll(schema: Schema): Schema {
  return mapObjects(schema, (node) => {
    const properties = (node.properties ?? {}) as Record<string, Schema>
    const required = new Set((node.required as string[] | undefined) ?? [])
    const strictProperties: Record<string, Schema> = {}
    for (const [name, property] of Object.entries(properties)) {
      strictProperties[name] = required.has(name) ? property : nullable(property)
    }
    return {
      ...node,
      properties: strictProperties,
      required: Object.keys(properties),
      additionalProperties: false,
    }
  }) as Schema
}

function nullable(property: Schema): Schema {
  const out: Schema = { ...property }
  if (typeof property.type === 'string') out.type = [property.type, 'null']
  if (Array.isArray(property.enum)) out.enum = [...(property.enum as unknown[]), null]
  return out
}
