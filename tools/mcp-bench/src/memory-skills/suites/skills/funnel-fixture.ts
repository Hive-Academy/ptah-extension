/**
 * `gt-skill-sessions@v1` as the funnel suites read it from the isolated home:
 * the committed `index.json` (labels, scripts, expected events) and the 30
 * session JSONL files. The expected events are the fixture's; they are checked
 * here against `expectedEventsFromScript` so a hand-edited index cannot drift
 * from its own scripts, and they are never derived from pipeline output.
 *
 * Imports only Node, zod and the ground-truth module, so the parent may load it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import {
  expectedEventsFromScript,
  skillSessionFixtureSchema,
} from '../../ground-truth/skill-session-fixture';
import { resolveHomeFile } from '../memory/memory-suite-support';
import type { FunnelSessionFile } from './funnel-port';

export const FUNNEL_FIXTURE_ID = 'gt-skill-sessions@v1';
/** Home-relative default: the plan seeds the committed fixture dir as `memory-skills`. */
export const DEFAULT_FUNNEL_SESSIONS_DIR = 'memory-skills/skill-sessions.v1';

const indexEntrySchema = skillSessionFixtureSchema.omit({ jsonl: true });
const indexSchema = z.strictObject({
  fixture: z.literal(FUNNEL_FIXTURE_ID),
  schemaVersion: z.literal(1),
  sessions: z.array(indexEntrySchema).min(1),
});

export type FunnelFixtureSession = z.infer<typeof indexEntrySchema>;

export interface FunnelFixture {
  readonly sessions: readonly FunnelFixtureSession[];
  readonly files: readonly FunnelSessionFile[];
}

/** Read and validate the fixture under `home/<dir>`. Throws naming the defect. */
export function loadFunnelFixture(home: string, dir: string): FunnelFixture {
  const root = resolveHomeFile(home, dir);
  const index = indexSchema.parse(
    JSON.parse(readFileSync(join(root, 'index.json'), 'utf8')) as unknown,
  );
  const ids = new Set<string>();
  for (const session of index.sessions) {
    if (ids.has(session.id)) {
      throw new Error(`${FUNNEL_FIXTURE_ID} repeats session ${session.id}`);
    }
    ids.add(session.id);
    const derived = expectedEventsFromScript(session.script);
    if (JSON.stringify(derived) !== JSON.stringify(session.expectedEvents)) {
      throw new Error(
        `${FUNNEL_FIXTURE_ID} ${session.id}: expectedEvents disagree with its script`,
      );
    }
  }
  const files = index.sessions.map((session) => ({
    id: session.id,
    jsonl: readFileSync(join(root, `${session.id}.jsonl`), 'utf8'),
  }));
  return { sessions: index.sessions, files };
}
