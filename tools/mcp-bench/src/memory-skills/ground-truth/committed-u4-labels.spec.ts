/**
 * Frozen U4 rows committed under fixtures/memory-skills.
 * Trigger lines are the suite parser's `triggerLabelSchema` (method
 * model-panel when every row names one panel). Session lines are
 * `realSessionLabelSchema` only: opaque id, copy hash, line numbers.
 */

import 'reflect-metadata';
jest.mock('vscode', () => ({}), { virtual: true });

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { realSessionLabelSchema } from './label-schemas';
import {
  TRIGGER_EVAL_PANEL,
  triggerLabelSchema,
} from '../suites/skills/trigger-human-eval';

const FIXTURES = join(__dirname, '../../../fixtures/memory-skills');

function jsonl(name: string): unknown[] {
  return readFileSync(join(FIXTURES, name), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

describe('committed U4 labels', () => {
  it('parses skill-triggers.v1.jsonl as one model-panel', () => {
    const rows = jsonl('skill-triggers.v1.jsonl').map((row) =>
      triggerLabelSchema.parse(row),
    );
    expect(rows).toHaveLength(23);
    expect(new Set(rows.map((row) => row.skillId)).size).toBe(23);
    expect(rows.every((row) => row.panel === TRIGGER_EVAL_PANEL)).toBe(true);
  });

  it('parses real-sessions.v1.jsonl as opaque session labels', () => {
    const rows = jsonl('real-sessions.v1.jsonl').map((row) =>
      realSessionLabelSchema.parse(row),
    );
    expect(rows).toHaveLength(20);
    expect(new Set(rows.map((row) => row.opaqueId)).size).toBe(20);
    expect(
      rows.every(
        (row) =>
          Object.keys(row).sort().join(',') === 'lineRefs,opaqueId,sha256',
      ),
    ).toBe(true);
  });
});
