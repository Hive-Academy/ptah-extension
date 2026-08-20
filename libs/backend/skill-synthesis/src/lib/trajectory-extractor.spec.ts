/**
 * TrajectoryExtractor unit tests.
 *
 * The extractor is a pure transform over JSONL messages; we mock
 * `JsonlReaderService` so we can synthesize traces deterministically and
 * assert hash stability + eligibility rules.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TrajectoryExtractor } from './trajectory-extractor';

const makeLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
});

interface FakeReader {
  findSessionsDirectory: jest.Mock;
  readJsonlMessages: jest.Mock;
}

const makeReader = (): FakeReader => ({
  findSessionsDirectory: jest.fn().mockResolvedValue('/fake/sessions'),
  readJsonlMessages: jest.fn(),
});

const userTurn = (text: string) => ({
  type: 'user',
  message: { role: 'user', content: text },
});
const assistantTurn = (text: string) => ({
  type: 'assistant',
  message: { role: 'assistant', content: text },
});
const assistantToolUse = (name: string, input: unknown) => ({
  type: 'assistant',
  message: {
    role: 'assistant',
    content: [{ type: 'tool_use', name, input }],
  },
});
const userToolResult = (content: string) => ({
  type: 'user',
  message: {
    role: 'user',
    content: [{ type: 'tool_result', content }],
  },
});

describe('TrajectoryExtractor', () => {
  let reader: FakeReader;
  let extractor: TrajectoryExtractor;

  beforeEach(() => {
    reader = makeReader();
    extractor = new TrajectoryExtractor(makeLogger() as never, reader as never);
  });

  it('returns null for sessions with fewer than 2 role turns', async () => {
    reader.readJsonlMessages.mockResolvedValue([userTurn('hi')]);
    const out = await extractor.extract('s1', '/ws');
    expect(out).toBeNull();
  });

  it('extracts a 2+ turn session even with no success marker', async () => {
    reader.readJsonlMessages.mockResolvedValue([
      userTurn('please refactor'),
      assistantTurn('working on it'),
      userTurn('continue'),
      assistantTurn('still working'),
    ]);
    const out = await extractor.extract('s1', '/ws');
    expect(out).not.toBeNull();
    expect(out?.hasSuccessMarker).toBe(false);
  });

  it('counts tool_use/tool_result so a tool-bearing session reaches 2+ turns with tool-aware canonical text', async () => {
    reader.readJsonlMessages.mockResolvedValue([
      userTurn('add a feature'),
      assistantToolUse('Edit', { file_path: '/ws/src/a.ts' }),
      userToolResult('file updated'),
      assistantToolUse('Bash', { command: 'npm test' }),
      userToolResult('all tests pass'),
    ]);
    const out = await extractor.extract('s1', '/ws');
    expect(out).not.toBeNull();
    if (!out) return;
    expect(out.turnCount).toBeGreaterThanOrEqual(2);
    expect(out.editCount).toBe(1);
    expect(out.toolUseCount).toBe(2);
    expect(out.bashTestPassed).toBe(true);
    expect(out.canonicalText).toContain('[tool:Edit]');
    expect(out.canonicalText).toContain('[tool:Bash npm test]');
    expect(out.canonicalText.length).toBeGreaterThan(0);
    expect(out.charLength).toBe(out.canonicalText.length);
  });

  it('extracts and hashes a 5+ turn session ending with a success marker', async () => {
    reader.readJsonlMessages.mockResolvedValue([
      userTurn('refactor the controller'),
      assistantTurn('reading file'),
      userTurn('continue'),
      assistantTurn('extracting service'),
      userTurn('wire DI'),
      assistantTurn('Task complete! All tests pass.'),
    ]);
    const out = await extractor.extract('s1', '/ws');
    expect(out).not.toBeNull();
    if (!out) return;
    expect(out.turnCount).toBe(6);
    expect(out.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(out.slug).toMatch(/^[a-z0-9-]+$/);
  });

  it('produces stable hashes across runs given the same trajectory', async () => {
    const trace = [
      userTurn('do thing'),
      assistantTurn('working'),
      userTurn('keep going'),
      assistantTurn('still going'),
      userTurn('final'),
      assistantTurn('successfully completed the task'),
    ];
    reader.readJsonlMessages.mockResolvedValue(trace);
    const a = await extractor.extract('s1', '/ws');
    const b = await extractor.extract('s2', '/ws');
    expect(a?.hash).toBe(b?.hash);
  });

  it.each([
    'All 42 tests passing.',
    'Implementation complete.',
    'implementation is complete',
    'Build succeeded.',
    'typecheck green',
    'lint passing',
    'All checks passed',
  ])('flags "%s" as a success marker signal', async (marker) => {
    reader.readJsonlMessages.mockResolvedValue([
      userTurn('do the work'),
      assistantTurn('starting'),
      userTurn('continue'),
      assistantTurn('still going'),
      userTurn('finish'),
      assistantTurn(marker),
    ]);
    const out = await extractor.extract('s1', '/ws');
    expect(out).not.toBeNull();
    expect(out?.hasSuccessMarker).toBe(true);
  });

  it('does not flag bare "fixed" or "successfully" as a success marker', async () => {
    reader.readJsonlMessages.mockResolvedValue([
      userTurn('do the work'),
      assistantTurn('starting'),
      userTurn('continue'),
      assistantTurn('still going'),
      userTurn('finish'),
      assistantTurn('I successfully read the file and fixed a typo earlier'),
    ]);
    const out = await extractor.extract('s1', '/ws');
    expect(out).not.toBeNull();
    expect(out?.hasSuccessMarker).toBe(false);
  });

  it('reads the explicit transcriptPath instead of resolving by session id', async () => {
    reader.readJsonlMessages.mockResolvedValue([
      userTurn('subagent task'),
      assistantTurn('working'),
      userTurn('continue'),
      assistantTurn('more work'),
      userTurn('finish'),
      assistantTurn('Task complete'),
    ]);
    const explicitPath =
      '/home/u/.claude/projects/proj/parent/subagents/agent-abc123.jsonl';
    const out = await extractor.extract(
      'agent-abc123',
      '/ws',
      undefined,
      explicitPath,
    );
    expect(out).not.toBeNull();
    expect(reader.findSessionsDirectory).not.toHaveBeenCalled();
    expect(reader.readJsonlMessages).toHaveBeenCalledWith(explicitPath);
  });

  /**
   * B2.4.1 fallout — `SkillEnhancerService`'s 5-turn requirement is now REAL,
   * and this is the only thing pinning it.
   *
   * `minTurns` used to be `void`-ed: the gate was a hard floor of 2 whatever the
   * caller asked for. B2.4.1 made the parameter do what its name says, which
   * NARROWED one caller — `skill-enhancer.service.ts:733` passes
   * `TRAJECTORY_MIN_TURNS`, so enhancement candidates with 2–4 role turns are
   * rejected where they previously passed.
   *
   * That narrowing is intended: it restores the constant's plainly stated
   * intent. But intended and accidental look identical in a diff, and the
   * enhancer's own spec cannot tell them apart — it stubs `trajectories.extract`
   * with a jest mock, so the real gate never runs there. Without this block the
   * next person to widen `extract`'s default silently re-widens the enhancer
   * with it and nothing goes red.
   *
   * The threshold is READ OUT OF the enhancer rather than re-typed here, so the
   * guard defends the caller's actual number instead of a copy that can drift
   * away from it.
   */
  describe("the enhancer's minTurns is honoured (defends skill-enhancer.service.ts:733)", () => {
    const ENHANCER_SOURCE = fs.readFileSync(
      path.join(__dirname, 'skill-enhancer.service.ts'),
      'utf8',
    );
    const ENHANCER_MIN_TURNS = Number(
      /const TRAJECTORY_MIN_TURNS = (\d+);/.exec(ENHANCER_SOURCE)?.[1],
    );

    const fourTurns = [
      userTurn('the build is broken'),
      assistantTurn('looking'),
      userTurn('any luck'),
      assistantTurn('still looking'),
    ];
    const fiveTurns = [...fourTurns, userTurn('and now?')];

    it('still declares a threshold and still passes it to the extractor', () => {
      // If either half goes, the two behavioural cases below would be
      // defending a call that no longer happens.
      expect(ENHANCER_MIN_TURNS).toBe(5);
      expect(ENHANCER_SOURCE).toMatch(
        /this\.trajectories\.extract\([\s\S]{0,120}TRAJECTORY_MIN_TURNS/,
      );
    });

    it(`rejects a 4-turn session at the enhancer's threshold`, async () => {
      reader.readJsonlMessages.mockResolvedValue(fourTurns);
      expect(
        await extractor.extract('s1', '/ws', ENHANCER_MIN_TURNS),
      ).toBeNull();
    });

    it(`accepts a ${5}-turn session at the enhancer's threshold`, async () => {
      // The paired positive: "returns null" alone is also satisfied by an
      // extractor that returns null for everything.
      reader.readJsonlMessages.mockResolvedValue(fiveTurns);
      const out = await extractor.extract('s1', '/ws', ENHANCER_MIN_TURNS);
      expect(out).not.toBeNull();
      expect(out?.turnCount).toBe(5);
    });

    it('still extracts that same 4-turn session for callers that do NOT ask', async () => {
      // The narrowing is scoped to callers who set a threshold. If the default
      // ever climbs back to 5 this fails, which is the re-narrowing that would
      // otherwise be invisible.
      reader.readJsonlMessages.mockResolvedValue(fourTurns);
      expect(await extractor.extract('s1', '/ws')).not.toBeNull();
    });
  });

  it('normalizes workspace-specific paths so hashes are workspace-independent', async () => {
    const trace = (root: string) => [
      userTurn(`open ${root}/src/file.ts`),
      assistantTurn('reading'),
      userTurn('continue'),
      assistantTurn('still'),
      userTurn('done?'),
      assistantTurn('Task complete'),
    ];
    reader.readJsonlMessages.mockResolvedValueOnce(trace('/home/alice/proj'));
    const a = await extractor.extract('sA', '/home/alice/proj');
    reader.readJsonlMessages.mockResolvedValueOnce(trace('/home/bob/work'));
    const b = await extractor.extract('sB', '/home/bob/work');
    expect(a?.hash).toBe(b?.hash);
  });
});
