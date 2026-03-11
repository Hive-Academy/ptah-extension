/**
 * Exhaustiveness checking helper for discriminated unions.
 *
 * Use in default case of switch statements to get compile-time errors
 * when new union members are added.
 *
 * Example:
 * ```typescript
 * type Animal = { type: 'dog' } | { type: 'cat' };
 *
 * function handle(animal: Animal) {
 *   switch (animal.type) {
 *     case 'dog':
 *       return 'woof';
 *     case 'cat':
 *       return 'meow';
 *     default:
 *       // TypeScript error if a new animal type is added but not handled
 *       return assertNever(animal);
 *   }
 * }
 * ```
 *
 * @param value - The value that should never occur (type 'never')
 * @param message - Optional custom error message
 * @throws Error with the unexpected value serialized
 */
export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${JSON.stringify(value)}`);
}
