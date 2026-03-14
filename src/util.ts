/**
 * Deep equality comparison for objects, arrays, and primitives.
 * Order-independent for object keys. Uses Bun's built-in implementation.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  return Bun.deepEquals(a, b);
}
