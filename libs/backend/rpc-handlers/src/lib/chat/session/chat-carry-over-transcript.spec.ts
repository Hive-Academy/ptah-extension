import {
  CARRY_OVER_INSTRUCTION,
  CARRY_OVER_READ_TAIL_BYTES,
  CARRY_OVER_READ_TIMEOUT_MS,
  CARRY_OVER_TEXT_BUDGET_CHARS,
  redactKnownSecrets,
  renderCarryOverPrompt,
  type CarryOverTranscript,
} from './chat-carry-over-transcript';

type Turn = CarryOverTranscript['turns'][number];

const user = (text: string): Turn => ({ role: 'user', text, compactionSummary: false });
const assistant = (text: string): Turn => ({
  role: 'assistant',
  text,
  compactionSummary: false,
});
const summary = (text: string): Turn => ({
  role: 'user',
  text,
  compactionSummary: true,
});

function transcriptOf(
  turns: Turn[],
  windowCoversWholeHistory = true,
  startsAtCompactionSummary = false,
): CarryOverTranscript {
  return { turns, windowCoversWholeHistory, startsAtCompactionSummary };
}

const OPEN = '\n\n<previous-conversation>\n';
const CLOSE = '\n</previous-conversation>';

/** The rendered transcript between the wrapper tags. */
function body(prompt: string): string {
  expect(prompt.startsWith(CARRY_OVER_INSTRUCTION + OPEN)).toBe(true);
  expect(prompt.endsWith(CLOSE)).toBe(true);
  return prompt.slice(CARRY_OVER_INSTRUCTION.length + OPEN.length, -CLOSE.length);
}

function render(transcript: CarryOverTranscript, budget?: number) {
  const result = renderCarryOverPrompt(transcript, budget);
  if (result === null) throw new Error('Expected a rendered prompt');
  return { ...result, body: body(result.prompt) };
}

describe('chat carry-over transcript constants', () => {
  it('pins the read bound, the text budget, the timeout and a non-slash instruction', () => {
    expect(CARRY_OVER_READ_TAIL_BYTES).toBe(2 * 1024 * 1024);
    expect(CARRY_OVER_TEXT_BUDGET_CHARS).toBe(48_000);
    expect(CARRY_OVER_READ_TIMEOUT_MS).toBe(20_000);
    expect(CARRY_OVER_INSTRUCTION.trimStart().startsWith('/')).toBe(false);
    expect(CARRY_OVER_INSTRUCTION).toMatch(/summary only/i);
  });
});

describe('renderCarryOverPrompt', () => {
  it('returns null for an empty or text-free transcript', () => {
    expect(renderCarryOverPrompt(transcriptOf([]))).toBeNull();
    expect(renderCarryOverPrompt(transcriptOf([user('   '), assistant('\n')]))).toBeNull();
  });

  it('keeps every turn in order with role labels and no omission line when it fits (AC 3.1)', () => {
    const result = render(
      transcriptOf([user('First question'), assistant('First answer'), user('Second question')]),
    );
    expect(result.body).toBe(
      'User:\nFirst question\n\nAssistant:\nFirst answer\n\nUser:\nSecond question',
    );
    expect(result.keptTurns).toBe(3);
    expect(result.omittedTurns).toBe(0);
    expect(result.body).not.toContain('Earlier conversation omitted');
  });

  it('drops the oldest turns first with an exact count when the window covers the history (AC 3.2)', () => {
    const turns = [user('a'.repeat(100)), assistant('b'.repeat(100)), user('c'.repeat(100))];
    const result = render(transcriptOf(turns), 260);
    expect(result.body).toBe(
      `Earlier conversation omitted (1 turn).\n\nAssistant:\n${'b'.repeat(100)}\n\nUser:\n${'c'.repeat(100)}`,
    );
    expect(result.keptTurns).toBe(2);
    expect(result.omittedTurns).toBe(1);
    expect(result.body.length).toBeLessThanOrEqual(260);

    const two = render(transcriptOf(turns), 150);
    expect(two.body).toBe(`Earlier conversation omitted (2 turns).\n\nUser:\n${'c'.repeat(100)}`);
    expect(two.omittedTurns).toBe(2);
  });

  it('counts dropped turns when the window starts at a compaction summary (AC 3.2, 3.8)', () => {
    const turns = [summary('s'.repeat(200)), user('next'), assistant('reply')];
    const fits = render(transcriptOf(turns, false, true));
    expect(fits.body.startsWith('Summary of the earlier conversation:\n' + 's'.repeat(200))).toBe(
      true,
    );
    expect(fits.body).not.toContain('Earlier conversation omitted');
    expect(fits.body).toContain('User:\nnext\n\nAssistant:\nreply');

    const dropped = render(transcriptOf(turns, false, true), 120);
    expect(dropped.body).toBe(
      'Earlier conversation omitted (1 turn).\n\nUser:\nnext\n\nAssistant:\nreply',
    );
  });

  it('uses the no-count line when the window holds neither the whole history nor a summary (AC 3.2, 3.8)', () => {
    // A summary just outside the window, or text turns before it: the window
    // starts mid-conversation, and so does a native-shaped transcript.
    const result = render(transcriptOf([user('in window'), assistant('reply')], false, false));
    expect(result.body).toBe(
      'Earlier conversation omitted.\n\nUser:\nin window\n\nAssistant:\nreply',
    );
    expect(result.omittedTurns).toBe(0);

    const dropped = render(
      transcriptOf([user('x'.repeat(100)), assistant('y'.repeat(100))], false, false),
      150,
    );
    expect(dropped.body).toBe(`Earlier conversation omitted.\n\nAssistant:\n${'y'.repeat(100)}`);
    expect(dropped.omittedTurns).toBe(1);
  });

  it('keeps the end of a single oversize newest turn behind the marker (AC 3.3)', () => {
    const text = 'start-' + 'm'.repeat(500) + '-the-end';
    const result = render(transcriptOf([user('older'), assistant(text)]), 200);
    expect(result.body.length).toBeLessThanOrEqual(200);
    expect(result.body.startsWith('Earlier conversation omitted (1 turn).\n\nAssistant:\n')).toBe(
      true,
    );
    expect(result.body).toContain('[start of this message omitted] ');
    expect(result.body.endsWith('-the-end')).toBe(true);
    expect(result.body).not.toContain('start-');
    expect(result.keptTurns).toBe(1);
    expect(result.omittedTurns).toBe(1);
  });

  it('never exceeds the budget for inputs ten times the budget or more (AC 3.4)', () => {
    let seed = 42;
    const next = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed;
    };
    for (let round = 0; round < 40; round++) {
      const budget = 200 + (next() % 5_000);
      const turns: Turn[] = [];
      let size = 0;
      while (size < budget * 10) {
        const length = 1 + (next() % (budget * 2));
        const text = 'w'.repeat(length) + (next() % 3 === 0 ? ' Bearer abc.def' : '');
        turns.push(next() % 2 === 0 ? user(text) : assistant(text));
        size += length;
      }
      const result = render(
        transcriptOf(turns, next() % 2 === 0, next() % 2 === 0),
        budget,
      );
      expect(result.body.length).toBeLessThanOrEqual(budget);
      expect(result.keptTurns + result.omittedTurns).toBe(turns.length);
    }
  });

  it('stays within the default budget for an input ten times its size (AC 3.4)', () => {
    const turns = Array.from({ length: 100 }, (_, i) =>
      i % 2 === 0 ? user('u'.repeat(4_800)) : assistant('a'.repeat(4_800)),
    );
    const result = render(transcriptOf(turns));
    expect(result.body.length).toBeLessThanOrEqual(CARRY_OVER_TEXT_BUDGET_CHARS);
    expect(result.omittedTurns).toBeGreaterThan(0);
    expect(result.body.startsWith(`Earlier conversation omitted (${result.omittedTurns} turns).`)).toBe(
      true,
    );
  });

  it('stays within a budget smaller than its fixed text', () => {
    const result = render(transcriptOf([user('hello there')], false, false), 10);
    expect(result.body.length).toBeLessThanOrEqual(10);
  });

  describe('secret redaction (AC 8.2, 8.3)', () => {
    const secrets: ReadonlyArray<readonly [string, string]> = [
      ['Authorization header', 'Authorization: Basic dXNlcjpzZWNyZXRwYXNz'],
      ['bearer token', 'Bearer abcDEF123456.ghiJKL-789'],
      ['sk- key', 'sk-ant-api03-AbCdEf0123456789xyz'],
      ['AWS key', 'AKIAIOSFODNN7EXAMPLE'],
      ['GitHub token', 'ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'],
      ['GitHub PAT', 'github_pat_11ABCDEFG0123456789_abcdefghijklmnop'],
      ['Slack token', 'xoxb-123456789012-abcdefABCDEF'],
      ['Google key', 'AIzaSyA1234567890abcdefghijklmnopqrstuv'],
      [
        'JWT',
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      ],
      [
        'PEM private key',
        '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEAuniquepemvalue\n-----END RSA PRIVATE KEY-----',
      ],
      ['api_key assignment', 'api_key = "quoted-config-value-42"'],
      ['password assignment', 'password: hunter2xyz'],
      ['access_token assignment', 'access_token=plainvalue987'],
      ['secret assignment', "client_secret='single-quoted-777'"],
    ];
    const secretValue = (raw: string): string => {
      const assignment = /[:=]\s*["']?([^"'\s]+)/.exec(raw);
      if (raw.includes('PRIVATE KEY')) return 'MIIEpAIBAAKCAQEAuniquepemvalue';
      if (raw.startsWith('Authorization')) return 'dXNlcjpzZWNyZXRwYXNz';
      if (raw.startsWith('Bearer')) return 'abcDEF123456.ghiJKL-789';
      if (/^(api_key|password|access_token|client_secret)/.test(raw) && assignment)
        return assignment[1];
      return raw;
    };

    it.each(secrets)('removes a %s from prose and from a summary', (_name, raw) => {
      const value = secretValue(raw);
      expect(redactKnownSecrets(`please use ${raw} for the call`)).not.toContain(value);
      const result = renderCarryOverPrompt(
        transcriptOf(
          [summary(`Earlier we configured ${raw} in the env.`), user(`My key: ${raw} ok?`)],
          false,
          true,
        ),
      );
      expect(result).not.toBeNull();
      expect(result?.prompt).not.toContain(value);
      expect(result?.prompt).toContain('[REDACTED]');
    });

    it('leaves ordinary prose, hashes and paths alone', () => {
      const prose =
        'Commit 3f9a1c2e7b4d5a6f8e9d0c1b2a3f4e5d6c7b8a9f touched /usr/local/lib/node_modules/x.';
      expect(redactKnownSecrets(prose)).toBe(prose);
      expect(redactKnownSecrets('The token budget is fine.')).toBe('The token budget is fine.');
    });

    it('redacts before measuring, so truncation cannot expose a secret tail', () => {
      const secret = 'sk-' + 'Z'.repeat(400);
      const result = render(transcriptOf([user(`${'p'.repeat(50)} ${secret}`)]), 120);
      expect(result.body).not.toContain('ZZZZ');
      expect(result.body.length).toBeLessThanOrEqual(120);
    });
  });
});
