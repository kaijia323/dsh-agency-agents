/**
 * Loader hook used only by the test suite.
 *
 * `src/tools.js` and `src/index.js` import `@deepseek-ai/dsh-tools`, which a
 * checkout of this repository does not have installed (it is a peer dependency
 * of the mounted deployment). The hook resolves that specifier — and the other
 * harness specifiers a host would provide — to an in-memory stub.
 *
 * The stub is small but **not permissive**: it mirrors the author-facing schema
 * rules the real compiler enforces, because the interesting defects in a tool
 * declaration are exactly the ones a permissive stub swallows. One of them
 * shipped once: a `type: 'object'` parameter without `additionalProperties`
 * compiled fine here and took the whole profile down at startup with
 *
 *   unsupported JSON schema: parameters.output_schema.additionalProperties
 *   must be explicitly true or false
 *
 * The rule, confirmed against `@deepseek-ai/dsh-tools`: every `type: 'object'`
 * node — including one nested in an array's `items` or another object's
 * `properties` — must state `additionalProperties` as an explicit boolean.
 *
 * @module dsh-agency-agents/test/stub-harness
 */

import { register } from 'node:module'

/** Identities the harness owns; a stub instance is returned per specifier. */
const STUBBED = new Set([
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-subagent',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/cordis',
])

const SOURCE = `
/** Thrown for a declaration the real compiler would reject. */
export class JsonSchemaError extends Error {
  constructor(message) {
    super(message)
    this.name = 'JsonSchemaError'
    this.code = 'UNSUPPORTED_SCHEMA'
  }
}

/** Walk one declared node, enforcing the object-openness rule. */
function checkNode(input, path, violations) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    violations.push(path + ' must be a schema object')
    return
  }
  if (Array.isArray(input.oneOf)) {
    input.oneOf.forEach((branch, index) => checkNode(branch, path + '.oneOf[' + index + ']', violations))
    return
  }
  if (input.type === 'object') {
    // The rule that broke the profile: openness must be stated, never implied.
    if (typeof input.additionalProperties !== 'boolean') {
      violations.push(path + '.additionalProperties must be explicitly true or false')
    }
    if (input.properties !== undefined) {
      if (input.properties === null || typeof input.properties !== 'object') {
        violations.push(path + '.properties must be an object')
      } else {
        for (const key of Object.keys(input.properties)) {
          checkNode(input.properties[key], path + '.properties.' + key, violations)
        }
      }
    }
  }
  if (input.type === 'array' && input.items !== undefined) {
    checkNode(input.items, path + '.items', violations)
  }
}

/** Mirror the real compiler's projection of one author parameter map. */
export function parameterSchemaSpecToJsonSchema(spec) {
  const properties = {}
  const required = []
  for (const key of Object.keys(spec)) {
    const declared = spec[key]
    if (declared === null || typeof declared !== 'object') {
      throw new JsonSchemaError('parameters.' + key + ' must be an object')
    }
    const node = {}
    for (const field of Object.keys(declared)) {
      if (field === 'required' || field === 'description') continue
      node[field] = declared[field]
    }
    if (declared.required === true) required.push(key)
    properties[key] = node
  }
  return { type: 'object', properties, ...(required.length === 0 ? {} : { required }) }
}

/** Enforce the subset the real compiler enforces, reported the same way. */
export function assertSupportedJsonSchema(schema) {
  const violations = []
  if (schema !== null && typeof schema === 'object' && schema.type === 'object' && schema.properties !== undefined) {
    for (const key of Object.keys(schema.properties)) {
      checkNode(schema.properties[key], 'parameters.' + key, violations)
    }
  } else {
    checkNode(schema, 'schema', violations)
  }
  if (violations.length > 0) {
    throw new JsonSchemaError('unsupported JSON schema: ' + violations.join('; '))
  }
}

/**
 * Compile the parameters, then echo the definition — the same order the real
 * helper uses before it wraps \\\`execute\\\`.
 */
export function defineTool(options) {
  const schema = parameterSchemaSpecToJsonSchema(options.parameters)
  assertSupportedJsonSchema(schema)
  return options
}
`

/** Register the hook once per process. */
export function installHarnessStub() {
  register(
    `data:text/javascript,${encodeURIComponent(`
      const STUBBED = ${JSON.stringify([...STUBBED])}
      const SOURCE = ${JSON.stringify(SOURCE)}
      export async function resolve(specifier, context, nextResolve) {
        if (STUBBED.includes(specifier)) {
          return { url: 'stub:' + specifier, shortCircuit: true, format: 'module' }
        }
        return nextResolve(specifier, context)
      }
      export async function load(url, context, nextLoad) {
        if (url.startsWith('stub:')) {
          return { format: 'module', source: SOURCE, shortCircuit: true }
        }
        return nextLoad(url, context)
      }
    `)}`,
    import.meta.url,
  )
}
