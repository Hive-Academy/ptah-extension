/** Keep unresolved sessions from matching agents with unresolved owners. */
export function ownedBySession<T>(
  items: readonly T[],
  sessionId: string | null,
  owner: (item: T) => string | undefined | null,
): T[] {
  return sessionId ? items.filter((item) => owner(item) === sessionId) : [];
}
