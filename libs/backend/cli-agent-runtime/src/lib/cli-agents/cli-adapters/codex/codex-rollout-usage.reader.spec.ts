import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  lastRequestInputTokensIn,
  readCodexRolloutUsage,
} from './codex-rollout-usage.reader';

const THREAD_ID = '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b';
const FIXTURE = readFileSync(
  join(__dirname, '__fixtures__', 'rollout-tail.jsonl'),
  'utf8',
);

describe('readCodexRolloutUsage', () => {
  let sessionsDir: string;

  beforeEach(() => {
    sessionsDir = mkdtempSync(join(tmpdir(), 'codex-rollout-usage-'));
  });

  afterEach(() => {
    rmSync(sessionsDir, { recursive: true, force: true });
  });

  function writeRollout(
    datePath: readonly string[],
    stamp: string,
    content: string,
    threadId = THREAD_ID,
  ): string {
    const dir = join(sessionsDir, ...datePath);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `rollout-${stamp}-${threadId}.jsonl`);
    writeFileSync(file, content);
    return file;
  }

  it('reads last_token_usage.input_tokens of the last token_count, not the running total', async () => {
    const file = writeRollout(
      ['2026', '10', '03'],
      '2026-10-03T13-26-45',
      FIXTURE,
    );

    const usage = await readCodexRolloutUsage(THREAD_ID, { sessionsDir });

    // The last token_count with info carries last 48,973 / total 114,523; a
    // later rate-limit-only token_count (info: null) is skipped.
    expect(usage).toEqual({
      file,
      lastRequestInputTokens: 48_973,
      modifiedAtMs: expect.any(Number),
    });
  });

  it('finds the thread in an older date directory when newer ones do not hold it', async () => {
    writeRollout(
      ['2026', '10', '04'],
      '2026-10-04T09-00-00',
      FIXTURE,
      'ffffffff-0000-0000-0000-000000000000',
    );
    const file = writeRollout(
      ['2025', '12', '31'],
      '2025-12-31T23-59-59',
      FIXTURE,
    );

    const usage = await readCodexRolloutUsage(THREAD_ID, { sessionsDir });

    expect(usage?.file).toBe(file);
  });

  it('reads past a tail window that holds no token_count', async () => {
    // A final record larger than the first 64 KiB window.
    const bigOutput = JSON.stringify({
      type: 'response_item',
      payload: { type: 'function_call_output', output: 'x'.repeat(200_000) },
    });
    writeRollout(
      ['2026', '10', '03'],
      '2026-10-03T13-26-45',
      `${FIXTURE}${bigOutput}\n`,
    );

    const usage = await readCodexRolloutUsage(THREAD_ID, { sessionsDir });

    expect(usage?.lastRequestInputTokens).toBe(48_973);
  });

  it('returns null when no rollout names the thread', async () => {
    writeRollout(
      ['2026', '10', '03'],
      '2026-10-03T13-26-45',
      FIXTURE,
      'ffffffff-0000-0000-0000-000000000000',
    );

    await expect(
      readCodexRolloutUsage(THREAD_ID, { sessionsDir }),
    ).resolves.toBeNull();
  });

  it('returns null when the sessions directory does not exist', async () => {
    await expect(
      readCodexRolloutUsage(THREAD_ID, {
        sessionsDir: join(sessionsDir, 'absent'),
      }),
    ).resolves.toBeNull();
  });

  it('returns null when the rollout has no per-request figure', async () => {
    writeRollout(
      ['2026', '10', '03'],
      '2026-10-03T13-26-45',
      '{"type":"session_meta","payload":{}}\n',
    );

    await expect(
      readCodexRolloutUsage(THREAD_ID, { sessionsDir }),
    ).resolves.toBeNull();
  });

  it('refuses a thread id that cannot name a rollout file', async () => {
    await expect(
      readCodexRolloutUsage('../../etc/passwd', { sessionsDir }),
    ).resolves.toBeNull();
  });
});

describe('lastRequestInputTokensIn', () => {
  it('skips a torn final line and reads the record before it', () => {
    const lines = FIXTURE.split('\n');
    lines.push(
      '{"type":"event_msg","payload":{"type":"token_count","info":{"last_tok',
    );

    expect(lastRequestInputTokensIn(lines)).toBe(48_973);
  });
});
