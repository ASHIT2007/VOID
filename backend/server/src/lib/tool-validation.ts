type Schema = { type?: string | string[]; properties?: Record<string, Schema>; required?: string[]; items?: Schema;
  enum?: unknown[]; additionalProperties?: boolean; minimum?: number; maximum?: number; minLength?: number; maxLength?: number; minItems?: number; maxItems?: number; anyOf?: Schema[]; oneOf?: Schema[] };
const unsafe = new Set(['__proto__', 'constructor', 'prototype']);
const keyShape = (key: string) => key.replace(/[_-]/g, '').toLowerCase();

/** Repair only schema-declared fields, then validate before invoking a handler. */
export function validateToolArguments(input: Record<string, unknown>, schema?: unknown): { args?: Record<string, unknown>; error?: string } {
  const visit = (value: unknown, rule: Schema, path: string, depth: number): unknown => {
    if (depth > 32) throw new Error(`${path} is nested too deeply`);
    if (rule.anyOf || rule.oneOf) {
      for (const variant of rule.anyOf || rule.oneOf || []) { try { return visit(value, variant, path, depth + 1); } catch {} }
      throw new Error(`${path} does not match an allowed shape`);
    }
    const types = Array.isArray(rule.type) ? rule.type : [rule.type];
    if (!types.includes('string')) {
      if (typeof value === 'string' && types.includes('boolean') && /^(?:true|false)$/i.test(value.trim())) value = value.trim().toLowerCase() === 'true';
      if (typeof value === 'string' && (types.includes('number') || types.includes('integer')) && /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) value = Number(value);
      if (typeof value === 'string' && (types.includes('object') || types.includes('array'))) { try { value = JSON.parse(value); } catch {} }
    }
    const matches = (type: string | undefined) => {
      if (!type) return true;
      if (type === 'null') return value === null;
      if (type === 'array') return Array.isArray(value);
      if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
      if (type === 'integer') return Number.isInteger(value);
      return typeof value === type && (type !== 'number' || Number.isFinite(value));
    };
    if (!types.some(matches)) throw new Error(`${path} must be ${types.join(' or ')}`);
    if (rule.enum && !rule.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) throw new Error(`${path} must use an allowed value`);
    if (typeof value === 'number' && (rule.minimum !== undefined && value < rule.minimum || rule.maximum !== undefined && value > rule.maximum)) throw new Error(`${path} is outside its allowed range`);
    if (typeof value === 'string' && (rule.minLength !== undefined && value.length < rule.minLength || rule.maxLength !== undefined && value.length > rule.maxLength)) throw new Error(`${path} has an invalid length`);
    if (Array.isArray(value)) {
      if (rule.minItems !== undefined && value.length < rule.minItems || rule.maxItems !== undefined && value.length > rule.maxItems) throw new Error(`${path} has an invalid item count`);
      return value.map((item, index) => visit(item, rule.items || {}, `${path}[${index}]`, depth + 1));
    }
    if (value && typeof value === 'object') {
      const output: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        if (unsafe.has(key)) throw new Error(`${path} contains an unsafe key`);
        const mapped = Object.hasOwn(rule.properties || {}, key) ? key : Object.keys(rule.properties || {}).find(candidate => keyShape(candidate) === keyShape(key)) || key;
        if (Object.hasOwn(output, mapped)) throw new Error(`${path}.${mapped} was supplied twice`);
        if (rule.additionalProperties === false && !Object.hasOwn(rule.properties || {}, mapped)) throw new Error(`${path}.${mapped} is not an allowed argument`);
        output[mapped] = visit(item, rule.properties?.[mapped] || {}, `${path}.${mapped}`, depth + 1);
      }
      for (const key of rule.required || []) if (!Object.hasOwn(output, key)) throw new Error(`${path}.${key} is required`);
      return output;
    }
    return value;
  };
  try { return { args: visit(input, (schema || { type: 'object' }) as Schema, 'arguments', 0) as Record<string, unknown> }; }
  catch (error) { return { error: error instanceof Error ? error.message : 'Invalid tool arguments' }; }
}
