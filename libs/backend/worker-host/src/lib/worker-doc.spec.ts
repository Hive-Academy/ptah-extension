import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { WorkerCapabilityRow } from '@ptah-extension/worker-runtime';

const start = '<!-- capability-table:start -->';
const end = '<!-- capability-table:end -->';

function renderTable(rows: readonly WorkerCapabilityRow[]): string {
  return [
    '| Capability | Status | Reason or phase | Remote methods |',
    '| --- | --- | --- | --- |',
    ...rows.map(
      (row) =>
        `| ${row.capability} | ${row.status} | ${row.reason ?? row.phase ?? '—'} | ${row.methods.length ? row.methods.join(', ') : '—'} |`,
    ),
  ].join('\n');
}

function normalizeTable(table: string): string {
  return table
    .split('\n')
    .map(
      (line) =>
        `| ${line
          .split('|')
          .slice(1, -1)
          .map((cell) => {
            const value = cell.trim();
            return /^-+$/.test(value) ? '---' : value;
          })
          .join(' | ')} |`,
    )
    .join('\n');
}

describe('worker operator guide', () => {
  // Warm the runtime barrel (it loads the engine graph) outside the case
  // timeout; platform-core loads first.
  beforeAll(async () => {
    await import('@ptah-extension/platform-core');
    await import('@ptah-extension/worker-runtime');
  }, 180_000);

  it('keeps the capability table equal to the runtime data', async () => {
    await import('@ptah-extension/platform-core');
    const { WORKER_CAPABILITIES } =
      await import('@ptah-extension/worker-runtime');
    const guide = await readFile(
      join(__dirname, '../../docs/worker.md'),
      'utf8',
    );
    expect(guide.split(start)).toHaveLength(2);
    expect(guide.split(end)).toHaveLength(2);
    const table = guide.split(start)[1]?.split(end)[0]?.trim();
    expect(table && normalizeTable(table)).toBe(
      renderTable(WORKER_CAPABILITIES),
    );
    // The runtime barrel loads the engine graph; under a shared verify lock it can exceed 5 s.
  }, 60_000);
});
