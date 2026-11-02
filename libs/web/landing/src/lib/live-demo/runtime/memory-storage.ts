class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(String(key)) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(String(key)); }
  setItem(key: string, value: string): void { this.values.set(String(key), String(value)); }
}

export function installMemoryStorage(target: Window = window): void {
  Object.defineProperty(target, 'localStorage', { configurable: true, value: new MemoryStorage() });
  Object.defineProperty(target, 'sessionStorage', { configurable: true, value: new MemoryStorage() });
}
