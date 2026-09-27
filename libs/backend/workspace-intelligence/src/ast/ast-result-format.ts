/**
 * Compact, lossless text for an AST analysis result (TASK_2026_559 Batch 20.2p).
 *
 * `JSON.stringify` of an analysis result repeats every field name on every
 * function, class, import and export record; on a function-heavy file that
 * made the answer only ~30% smaller in tokens than reading the file, short of
 * the "40-60% fewer tokens" the MCP prompt promises. This format keeps the
 * result valid JSON with the same top-level keys in the same order (so parse
 * status and coverage stay first), and writes each list of records as a table:
 *
 *   "functions":[["name","parameters","startLine","endLine"],["load",["id"],3,9]]
 *
 * - The first row names the columns: the union of the record fields, in the
 *   order they first appear. Every following row is one record.
 * - A `null` cell, or a row shorter than the header, means the record does not
 *   have that field (the same thing `JSON.stringify` expresses by omitting an
 *   `undefined` field).
 * - A list that cannot be tabulated without ambiguity — a record that is not a
 *   plain object, or has a real `null` value — is written unchanged as an
 *   array of objects. An empty list stays `[]`.
 *
 * Nothing else changes: nested values (parameter lists, imported symbols,
 * coverage) are written exactly as `JSON.stringify` writes them.
 */

type JsonRecord = Record<string, unknown>;

/** Serialise `result` with each list of records written as a table. */
export function formatAstAnalysisResult(result: object): string {
  const out: JsonRecord = {};
  for (const [key, value] of Object.entries(result)) {
    out[key] = Array.isArray(value) ? (tabulate(value) ?? value) : value;
  }
  return JSON.stringify(out);
}

/** Header row plus one row per record, or `undefined` when not tabulable. */
function tabulate(list: readonly unknown[]): unknown[][] | undefined {
  if (list.length === 0 || !list.every(isTabulableRecord)) {
    return undefined;
  }
  const columns: string[] = [];
  for (const record of list) {
    for (const [field, value] of Object.entries(record)) {
      if (value !== undefined && !columns.includes(field)) {
        columns.push(field);
      }
    }
  }
  const rows = list.map((record) => {
    const row = columns.map((field) => record[field] ?? null);
    while (row.length > 0 && row[row.length - 1] === null) {
      row.pop();
    }
    return row;
  });
  return [columns, ...rows];
}

/** A plain object none of whose fields holds a real `null`. */
function isTabulableRecord(value: unknown): value is JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return false;
  }
  return Object.values(value).every((field) => field !== null);
}
