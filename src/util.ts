import equal from "fast-deep-equal";

/**
 * Deep equality comparison for objects, arrays, and primitives.
 * Order-independent for object keys.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  return equal(a, b);
}
