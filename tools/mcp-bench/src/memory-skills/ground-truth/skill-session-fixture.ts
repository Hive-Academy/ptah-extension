import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import { SessionJsonlWriter } from './session-jsonl-writer';

const EVENT_KINDS = [
  'analyze-run',
  'idle-trigger',
  'manual-run',
  'ineligible',
] as const;
const SCRIPT_OPERATIONS = [
  'session-end',
  'idle-timeout',
  'manual-analyze',
  'unreadable-line',
  'unsupported-tool-use',
] as const;

export const skillSessionScriptSchema = z
  .array(z.enum(SCRIPT_OPERATIONS))
  .min(1);
export const expectedActivityEventSchema = z.strictObject({
  kind: z.enum(EVENT_KINDS),
  note: z.string().min(1).optional(),
});
export const skillSessionFixtureSchema = z.strictObject({
  id: z.string().regex(/^skill-session-\d{2}$/),
  routine: z.string().min(1).nullable(),
  degraded: z.boolean(),
  script: skillSessionScriptSchema,
  expectedEvents: z.array(expectedActivityEventSchema),
  jsonl: z.string().min(1),
});

export type SkillSessionFixture = z.infer<typeof skillSessionFixtureSchema>;

const routineIds = [
  'dependency-upgrade',
  'incident-triage',
  'release-checklist',
  'test-failure-diagnosis',
] as const;

/** Derives the ground-truth feed sequence without observing pipeline output. */
export function expectedEventsFromScript(
  script: z.infer<typeof skillSessionScriptSchema>,
): z.infer<typeof expectedActivityEventSchema>[] {
  const events: z.infer<typeof expectedActivityEventSchema>[] = [];
  for (const operation of script) {
    switch (operation) {
      case 'session-end':
        events.push({ kind: 'analyze-run' });
        break;
      case 'idle-timeout':
        events.push({ kind: 'idle-trigger' }, { kind: 'analyze-run' });
        break;
      case 'manual-analyze':
        events.push({ kind: 'manual-run' }, { kind: 'analyze-run' });
        break;
      case 'unreadable-line':
        events.push({
          kind: 'ineligible',
          note: 'Unreadable input is expected to be rejected before candidate authoring.',
        });
        break;
      case 'unsupported-tool-use':
        events.push({
          kind: 'ineligible',
          note: 'Unsupported tool use is expected to be rejected before candidate authoring.',
        });
        break;
    }
  }
  return events;
}

/** Builds the synthetic committed gt-skill-sessions@v1 corpus in memory. */
export function buildSkillSessionFixtures(): readonly SkillSessionFixture[] {
  const cases: {
    routine: string | null;
    degraded: boolean;
    script: z.infer<typeof skillSessionScriptSchema>;
    topic: string;
  }[] = [];
  for (const routine of routineIds) {
    for (let occurrence = 1; occurrence <= 3; occurrence += 1) {
      cases.push({
        routine,
        degraded: false,
        script: ['session-end', 'idle-timeout'],
        topic: `${routine} repetition ${occurrence}`,
      });
    }
  }
  for (let index = 1; index <= 10; index += 1) {
    cases.push({
      routine: null,
      degraded: false,
      script:
        index <= 4
          ? ['session-end']
          : index <= 7
            ? ['manual-analyze']
            : ['session-end', 'idle-timeout'],
      topic:
        index <= 4
          ? `question and answer ${index}`
          : index <= 7
            ? `aborted exploration ${index}`
            : `single edit ${index}`,
    });
  }
  for (let index = 1; index <= 8; index += 1) {
    cases.push({
      routine: null,
      degraded: true,
      script: [index <= 4 ? 'unreadable-line' : 'unsupported-tool-use'],
      topic:
        index <= 4 ? `corrupt line ${index}` : `unsupported operation ${index}`,
    });
  }
  return cases.map((entry, index) => buildFixture(index + 1, entry));
}

export async function writeSkillSessionFixture(
  directory: string,
): Promise<void> {
  const sessions = buildSkillSessionFixtures();
  await mkdir(directory, { recursive: true });
  await Promise.all(
    sessions.map((session) =>
      writeFile(join(directory, `${session.id}.jsonl`), session.jsonl, 'utf8'),
    ),
  );
  const index = {
    fixture: 'gt-skill-sessions@v1',
    schemaVersion: 1,
    sessions: sessions.map(({ jsonl: _jsonl, ...session }) => session),
  };
  await writeFile(
    join(directory, 'index.json'),
    `${JSON.stringify(index, null, 2)}\n`,
    'utf8',
  );
}

function buildFixture(
  index: number,
  entry: {
    routine: string | null;
    degraded: boolean;
    script: z.infer<typeof skillSessionScriptSchema>;
    topic: string;
  },
): SkillSessionFixture {
  const id = `skill-session-${String(index).padStart(2, '0')}`;
  const writer = new SessionJsonlWriter<'synthetic'>(
    id,
    `2026-01-${String(index).padStart(2, '0')}T09:00:00.000Z`,
    1,
    4_000,
    8,
  );
  writer.turn('user', `Synthetic benchmark request: ${entry.topic}.`);
  writer.turn(
    'assistant',
    'I will keep this synthetic session focused on the requested work.',
  );
  writer.turn(
    'user',
    entry.routine === null
      ? 'This is an isolated task and should not establish a reusable routine.'
      : `Repeat the ${entry.routine} routine using the same ordered checks.`,
  );
  writer.turn(
    'assistant',
    entry.degraded
      ? 'The synthetic input is intentionally degraded for benchmark coverage.'
      : 'The routine steps were completed in this synthetic transcript.',
  );
  const script = skillSessionScriptSchema.parse(entry.script);
  return skillSessionFixtureSchema.parse({
    id,
    routine: entry.routine,
    degraded: entry.degraded,
    script,
    expectedEvents: expectedEventsFromScript(script),
    jsonl: writer.build('standard', []).jsonl,
  });
}
