/**
 * Tool output as text, cut to `limit` while it is written, so a large output
 * is never serialized whole. Plain JSON data reads as `JSON.stringify` would
 * write it (a circular reference is written as `null`). Used for the bounded
 * error excerpt of a failed tool, whose output can be very large.
 */
export function boundedText(value: unknown, limit: number): string {
  if (typeof value === 'string') return value.slice(0, limit);
  if (value == null) return '';
  let out = '';
  const open = new Set<object>();
  /** Appends `part`; false once the budget is spent. */
  const write = (part: string): boolean => {
    out += part;
    return out.length < limit;
  };
  const serialize = (item: unknown): boolean => {
    if (typeof item === 'string') {
      return write(JSON.stringify(item.slice(0, limit)));
    }
    if (typeof item === 'number') {
      return write(Number.isFinite(item) ? String(item) : 'null');
    }
    if (typeof item === 'boolean' || typeof item === 'bigint') {
      return write(String(item));
    }
    if (item === null || typeof item !== 'object' || open.has(item)) {
      return write('null');
    }
    const toJSON = (item as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === 'function') return serialize(toJSON.call(item));
    open.add(item);
    const more = Array.isArray(item)
      ? serializeArray(item)
      : serializeObject(item as Record<string, unknown>);
    open.delete(item);
    return more;
  };
  const serializeArray = (items: readonly unknown[]): boolean => {
    if (!write('[')) return false;
    for (let index = 0; index < items.length; index += 1) {
      if (index > 0 && !write(',')) return false;
      if (!serialize(items[index])) return false;
    }
    return write(']');
  };
  const serializeObject = (record: Record<string, unknown>): boolean => {
    if (!write('{')) return false;
    let first = true;
    for (const key in record) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
      const entry = record[key];
      if (
        entry === undefined ||
        typeof entry === 'function' ||
        typeof entry === 'symbol'
      ) {
        continue;
      }
      if (!first && !write(',')) return false;
      first = false;
      if (!write(`${JSON.stringify(key)}:`) || !serialize(entry)) return false;
    }
    return write('}');
  };
  serialize(value);
  return out.slice(0, limit);
}
