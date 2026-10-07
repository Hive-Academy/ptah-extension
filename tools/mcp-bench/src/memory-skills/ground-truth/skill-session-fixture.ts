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
  'drain-eligible-candidate',
  'prefilter-rejected',
] as const;

export const skillSessionScriptSchema = z
  .array(z.enum(SCRIPT_OPERATIONS))
  .min(1);
export const expectedActivityEventSchema = z.strictObject({
  kind: z.enum(EVENT_KINDS),
  reason: z.enum(['prefilterTooThin', 'prefilterRejected']).optional(),
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
        break;
      case 'idle-timeout':
        events.push({ kind: 'idle-trigger' });
        break;
      case 'manual-analyze':
        events.push({ kind: 'manual-run' });
        break;
      case 'drain-eligible-candidate':
        events.push({ kind: 'analyze-run' });
        break;
      case 'prefilter-rejected':
        events.push({ kind: 'ineligible', reason: 'prefilterRejected' });
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
    shape:
      | 'routine'
      | 'question'
      | 'aborted'
      | 'single-edit'
      | 'unreadable'
      | 'unsupported';
  }[] = [];
  for (const routine of routineIds) {
    for (let occurrence = 1; occurrence <= 3; occurrence += 1) {
      cases.push({
        routine,
        degraded: false,
        script: ['session-end', 'drain-eligible-candidate'],
        topic: `${routine} repetition ${occurrence}`,
        shape: 'routine',
      });
    }
  }
  for (let index = 1; index <= 10; index += 1) {
    cases.push({
      routine: null,
      degraded: false,
      script:
        index === 3
          ? ['idle-timeout', 'prefilter-rejected']
          : index === 4 || (index >= 5 && index <= 7)
            ? ['manual-analyze', 'prefilter-rejected']
            : index <= 7
              ? ['session-end', 'prefilter-rejected']
              : // One Edit passes the default prefilter
                // (`eligibility/session-work-evidence.ts:15-23`), so the
                // bench-caused drain drafts it and the product pushes
                // `analyze-run` on registration (`skill-synthesis.service.ts`
                // `analyzeSession`). Archaeology pushes no feed event.
                ['session-end', 'drain-eligible-candidate'],
      topic:
        index <= 4
          ? `question and answer ${index}`
          : index <= 7
            ? `aborted exploration ${index}`
            : `single edit ${index}`,
      shape: index <= 4 ? 'question' : index <= 7 ? 'aborted' : 'single-edit',
    });
  }
  for (let index = 1; index <= 8; index += 1) {
    cases.push({
      routine: null,
      degraded: true,
      script: ['session-end', 'prefilter-rejected'],
      topic:
        index <= 4 ? `corrupt line ${index}` : `unsupported operation ${index}`,
      shape: index <= 4 ? 'unreadable' : 'unsupported',
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
    shape:
      | 'routine'
      | 'question'
      | 'aborted'
      | 'single-edit'
      | 'unreadable'
      | 'unsupported';
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
  writeFixtureTurns(writer, entry, id);
  const script = skillSessionScriptSchema.parse(entry.script);
  return skillSessionFixtureSchema.parse({
    id,
    routine: entry.routine,
    degraded: entry.degraded,
    script,
    expectedEvents: expectedEventsFromScript(script),
    jsonl: withDegradation(writer.build('standard', []).jsonl, entry.shape),
  });
}

function writeFixtureTurns(
  writer: SessionJsonlWriter<'synthetic'>,
  entry: { routine: string | null; topic: string; shape: string },
  id: string,
): void {
  writer.turn('user', `Synthetic benchmark request: ${entry.topic}.`);
  if (entry.shape === 'question') {
    writer.turn('assistant', 'Synthetic answer: this is a Q&A-only exchange.');
    return;
  }
  if (entry.shape === 'aborted') {
    writer.turn(
      'assistant',
      'I will inspect the synthetic task before making changes.',
    );
    writer.turn(
      'user',
      'Stop here; the synthetic task was intentionally aborted.',
    );
    return;
  }
  if (entry.shape === 'single-edit') {
    writer.contentTurn(
      'assistant',
      [
        {
          type: 'tool_use',
          id: `${id}-edit`,
          name: 'Edit',
          input: {
            file_path: 'src/synthetic.ts',
            old_string: 'old',
            new_string: 'new',
          },
        },
      ],
      '[tool:Edit]',
    );
    writer.contentTurn(
      'user',
      [
        {
          type: 'tool_result',
          tool_use_id: `${id}-edit`,
          content: 'updated one synthetic line',
        },
      ],
      '[tool_result: updated one synthetic line]',
    );
    return;
  }
  if (entry.shape === 'unsupported') {
    writer.contentTurn(
      'assistant',
      [
        {
          type: 'tool_use',
          id: `${id}-unsupported`,
          name: 'UnsupportedSyntheticTool',
          input: { payload: 'synthetic only' },
        },
      ],
      '[tool:UnsupportedSyntheticTool]',
    );
    writer.contentTurn(
      'user',
      [
        {
          type: 'tool_result',
          tool_use_id: `${id}-unsupported`,
          content: 'unsupported tool result',
        },
      ],
      '[tool_result: unsupported tool result]',
    );
    return;
  }
  if (entry.shape === 'unreadable') {
    writer.turn(
      'assistant',
      'This synthetic session contains a deliberately unreadable JSONL record.',
    );
    return;
  }
  writer.turn(
    'assistant',
    `Repeat the ${entry.routine} routine using the same ordered checks.`,
  );
  writer.contentTurn(
    'assistant',
    [
      {
        type: 'tool_use',
        id: `${id}-read`,
        name: 'Read',
        input: { file_path: 'src/synthetic.ts' },
      },
    ],
    '[tool:Read]',
  );
  writer.contentTurn(
    'user',
    [
      {
        type: 'tool_result',
        tool_use_id: `${id}-read`,
        content: 'export const synthetic = true;',
      },
    ],
    '[tool_result: source read]',
  );
  writer.contentTurn(
    'assistant',
    [
      {
        type: 'tool_use',
        id: `${id}-edit`,
        name: 'Edit',
        input: {
          file_path: 'src/synthetic.ts',
          old_string: 'true',
          new_string: 'false',
        },
      },
    ],
    '[tool:Edit]',
  );
  writer.contentTurn(
    'user',
    [
      {
        type: 'tool_result',
        tool_use_id: `${id}-edit`,
        content: 'synthetic edit applied',
      },
    ],
    '[tool_result: edit applied]',
  );
  writer.contentTurn(
    'assistant',
    [
      {
        type: 'tool_use',
        id: `${id}-test`,
        name: 'Bash',
        input: { command: 'npx jest synthetic --runInBand' },
      },
    ],
    '[tool:Bash npx jest synthetic --runInBand]',
  );
  writer.contentTurn(
    'user',
    [
      {
        type: 'tool_result',
        tool_use_id: `${id}-test`,
        content: 'Tests: 1 passed, 1 total',
      },
    ],
    '[tool_result: tests passed]',
  );
}

function withDegradation(jsonl: string, shape: string): string {
  if (shape !== 'unreadable') return jsonl;
  const lines = jsonl.trimEnd().split('\n');
  lines.splice(1, 0, '{"type":"assistant","message":');
  return `${lines.join('\n')}\n`;
}
