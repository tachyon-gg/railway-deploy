import { logger } from "../logger.js";
import type { ParamDef } from "../types/config.js";

/**
 * Validate parameter values against definitions and apply defaults.
 * Returns the resolved parameter map.
 */
export function resolveParams(
  defs: Record<string, ParamDef>,
  values: Record<string, string>,
): Record<string, string> {
  const resolved: Record<string, string> = {};

  for (const [name, def] of Object.entries(defs)) {
    if (name in values) {
      resolved[name] = values[name];
    } else if (def.default !== undefined) {
      resolved[name] = def.default;
    } else if (def.required) {
      throw new Error(`Missing required parameter: ${name}`);
    }
  }

  // Warn about extra params not in the template
  for (const name of Object.keys(values)) {
    if (!(name in defs)) {
      logger.warn(`Unknown parameter "${name}" (not in template)`);
    }
  }

  return resolved;
}

/**
 * Expand %{param} placeholders in a string using resolved param values.
 */
export function expandParams(input: string, params: Record<string, string>): string {
  return input.replace(/%\{(\w+)\}/g, (_match, name: string) => {
    if (!(name in params)) {
      throw new Error(`Unresolved parameter: %{${name}}`);
    }
    return params[name];
  });
}

/**
 * Recursively expand %{param} placeholders in an object/array/string.
 */
export function expandParamsDeep<T>(value: T, params: Record<string, string>): T {
  if (typeof value === "string") {
    return expandParams(value, params) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => expandParamsDeep(item, params)) as T;
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = expandParamsDeep(v, params);
    }
    return result as T;
  }
  return value;
}
