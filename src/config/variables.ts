/**
 * Variable resolution for ${ENV_VAR} syntax.
 * ${{service.VAR}} (Railway references) are passed through as-is.
 */

import { parse as parseDotenv } from "dotenv";
import { readFileSync } from "fs";

/**
 * Resolve ${ENV_VAR} placeholders from the local shell environment.
 * Leaves ${{...}} (Railway references) untouched.
 */
export function resolveEnvVars(
  variables: Record<string, string | null>,
  env: Record<string, string | undefined> = process.env,
  lenient = false,
): Record<string, string> {
  const resolved: Record<string, string> = {};

  for (const [key, value] of Object.entries(variables)) {
    // null means "delete this variable" — skip it in resolved output
    if (value === null) continue;

    resolved[key] = resolveEnvVarString(value, env, lenient);
  }

  return resolved;
}

/**
 * Resolve ${ENV_VAR} in a single string value.
 * ${{...}} is left untouched (Railway resolves these at runtime).
 */
export function resolveEnvVarString(
  input: string,
  env: Record<string, string | undefined> = process.env,
  lenient = false,
): string {
  // Match ${VAR} but NOT ${{VAR}} — use negative lookahead for second brace
  return input.replace(/\$\{(?!\{)([^}]+)\}/g, (match, name: string) => {
    const value = env[name];
    if (value === undefined) {
      if (lenient) return match; // Leave unresolved in validate mode
      throw new Error(`Environment variable "${name}" is not set (referenced as \${${name}})`);
    }
    return value;
  });
}

/**
 * Extract variable names that would be deleted (set to null in YAML).
 */
export function getDeletedVariables(variables: Record<string, string | null>): string[] {
  return Object.entries(variables)
    .filter(([, v]) => v === null)
    .map(([k]) => k);
}

/**
 * Parse a .env file into a key-value record using dotenv.
 */
export function loadEnvFile(path: string): Record<string, string> {
  const content = readFileSync(path, "utf-8");
  return parseDotenv(Buffer.from(content)) as Record<string, string>;
}
