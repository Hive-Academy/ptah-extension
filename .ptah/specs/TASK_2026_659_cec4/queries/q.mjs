// Scratch query helper for TASK_2026_659 evaluation. Queries COPIES of the DBs only. Not committed.
// Usage: node q.mjs <db> <file.sql> <out.txt> [maxLen]
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
const [, , dbPath, sqlFile, outFile, maxLenArg] = process.argv;
const maxLen = Number(maxLenArg ?? 400);
const sql = readFileSync(sqlFile, 'utf8');
const db = new DatabaseSync(dbPath);
const out = [];
const trunc = (v) => (typeof v === 'string' && v.length > maxLen ? v.slice(0, maxLen) + '…' : v);
for (const stmt of sql.split(/;\s*\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('--'))) {
  out.push('>> ' + stmt.replace(/\s+/g, ' '));
  try {
    const rows = db.prepare(stmt).all();
    for (const r of rows.slice(0, 300)) out.push(JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, trunc(v)]))));
    if (rows.length > 300) out.push(`... ${rows.length} rows`);
  } catch (e) {
    out.push('ERR ' + e.message);
  }
}
writeFileSync(outFile, out.join('\n') + '\n');
console.log('wrote ' + outFile);
