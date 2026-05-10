/**
 * Sets a signal only when the new value differs from the current one.
 * Returns true if the value was updated, false if it was a no-op.
 *
 * @param sig   - The writable signal to update
 * @param next  - The candidate new value
 * @param equal - Optional comparator (defaults to Object.is)
 */
export function setIfChanged<T>(
  sig: import('@angular/core').WritableSignal<T>,
  next: T,
  equal: (a: T, b: T) => boolean = Object.is,
): boolean {
  if (equal(sig(), next)) return false;
  sig.set(next);
  return true;
}
