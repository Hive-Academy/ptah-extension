const OWNER_CAP = 4000;

/** Tracks message and nested tool ownership without retaining event payloads. */
export class SubagentExecutionOwnership {
  private readonly messageOwner = new Map<string, string>();
  private readonly toolOwner = new Map<string, string>();
  private readonly ownersByEntry = new Map<
    string,
    Map<string, 'message' | 'tool'>
  >();
  private readonly evictedMessages = new Map<string, string>();

  message(id: string): string | undefined {
    return this.messageOwner.get(id);
  }

  tool(id: string): string | undefined {
    return this.toolOwner.get(id);
  }

  wasEvicted(id: string): boolean {
    return this.evictedMessages.has(id);
  }

  own(key: string, id: string, kind: 'message' | 'tool'): void {
    const owners =
      this.ownersByEntry.get(key) ?? new Map<string, 'message' | 'tool'>();
    this.ownersByEntry.set(key, owners);
    const composite = `${kind}:${id}`;
    owners.delete(composite);
    owners.set(composite, kind);
    (kind === 'message' ? this.messageOwner : this.toolOwner).set(id, key);
    if (kind === 'message') this.evictedMessages.delete(id);
    if (owners.size <= OWNER_CAP) return;

    const oldest = owners.keys().next().value;
    if (!oldest) return;
    const oldKind = owners.get(oldest);
    owners.delete(oldest);
    const oldId = oldest.slice(oldest.indexOf(':') + 1);
    (oldKind === 'message' ? this.messageOwner : this.toolOwner).delete(oldId);
    if (oldKind === 'message') this.evictedMessages.set(oldId, key);
  }

  drop(key: string): void {
    for (const [composite, kind] of this.ownersByEntry.get(key) ?? []) {
      const id = composite.slice(composite.indexOf(':') + 1);
      (kind === 'message' ? this.messageOwner : this.toolOwner).delete(id);
    }
    this.ownersByEntry.delete(key);
    for (const [id, owner] of this.evictedMessages) {
      if (owner === key) this.evictedMessages.delete(id);
    }
  }
}
