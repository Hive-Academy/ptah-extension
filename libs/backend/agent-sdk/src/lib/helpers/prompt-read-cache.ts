/** Short-lived prompt lookup cache; a pending lookup is shared by concurrent sessions. */
export class PromptReadCache {
  private readonly values = new Map<string, { value: string; expiresAt: number }>();
  private readonly pending = new Map<string, Promise<string>>();

  constructor(private readonly ttlMs = 2_000) {}

  run(key: string, read: () => Promise<string>): Promise<string> {
    const cached = this.values.get(key);
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
    const existing = this.pending.get(key);
    if (existing) return existing;
    const result = Promise.resolve().then(read);
    this.pending.set(key, result);
    void result.then(
      (value) => {
        this.pending.delete(key);
        this.values.set(key, { value, expiresAt: Date.now() + this.ttlMs });
        if (this.values.size > 128) this.values.delete(this.values.keys().next().value ?? key);
      },
      () => { this.pending.delete(key); },
    );
    return result;
  }

  invalidate(): void { this.values.clear(); }
}
