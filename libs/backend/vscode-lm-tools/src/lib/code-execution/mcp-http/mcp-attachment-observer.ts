import type {
  IMcpAttachmentProbe,
  McpAttachment,
} from '@ptah-extension/cli-agent-runtime';

const RETENTION_MS = 60 * 60 * 1000;

class McpAttachmentObserver implements IMcpAttachmentProbe {
  private readonly entries = new Map<string, McpAttachment>();
  private readonly listeners = new Map<
    string,
    Set<(entry?: McpAttachment) => void>
  >();

  private key(agentId: string, port: number): string {
    return `${port}:${agentId}`;
  }

  get(agentId: string, port: number): McpAttachment | undefined {
    const key = this.key(agentId, port);
    const entry = this.entries.get(key);
    if (entry && Date.now() - entry.time > RETENTION_MS) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  record(entry: McpAttachment): void {
    const key = this.key(entry.agentId, entry.port);
    if (this.get(entry.agentId, entry.port)) return;
    for (const [storedKey, stored] of this.entries) {
      if (entry.time - stored.time > RETENTION_MS)
        this.entries.delete(storedKey);
    }
    if (this.entries.size >= 512)
      this.entries.delete(this.entries.keys().next().value ?? '');
    this.entries.set(key, entry);
    for (const listener of this.listeners.get(key) ?? []) listener(entry);
  }

  waitFor(
    agentId: string,
    port: number,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<McpAttachment | undefined> {
    const existing = this.get(agentId, port);
    if (existing) return Promise.resolve(existing);
    if (signal?.aborted) return Promise.resolve(undefined);
    const key = this.key(agentId, port);
    return new Promise((resolve) => {
      const listeners =
        this.listeners.get(key) ?? new Set<(entry?: McpAttachment) => void>();
      const finish = (entry?: McpAttachment): void => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        listeners.delete(onEntry);
        if (listeners.size === 0) this.listeners.delete(key);
        resolve(entry);
      };
      const onEntry = (entry?: McpAttachment): void => finish(entry);
      const onAbort = (): void => finish();
      listeners.add(onEntry);
      this.listeners.set(key, listeners);
      const timer = setTimeout(() => finish(), timeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  clear(): void {
    this.entries.clear();
    for (const listeners of this.listeners.values()) {
      for (const listener of [...listeners]) listener();
    }
  }
  clearPort(port: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.port === port) this.entries.delete(key);
    }
    for (const [key, listeners] of this.listeners) {
      if (key.startsWith(`${port}:`)) {
        for (const listener of [...listeners]) listener();
      }
    }
  }
}

export const mcpAttachmentObserver = new McpAttachmentObserver();
