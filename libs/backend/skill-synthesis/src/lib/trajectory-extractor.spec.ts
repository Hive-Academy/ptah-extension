/**
 * TrajectoryExtractor unit tests.
 *
 * The extractor is a pure transform over JSONL messages; we mock
 * `JsonlReaderService` so we can synthesize traces deterministically and
 * assert hash stability + eligibility rules.
 */
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
