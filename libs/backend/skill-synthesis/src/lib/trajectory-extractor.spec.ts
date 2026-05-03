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

describe('TrajectoryExtractor', () => {
  let reader: FakeReader;
  let extractor: TrajectoryExtractor;

  beforeEach(() => {
    reader = makeReader();
    extractor = new TrajectoryExtractor(makeLogger() as never, reader as never);
  });

  it('returns null for sessions with fewer than 5 turns', async () => {
    reader.readJsonlMessages.mockResolvedValue([
      userTurn('hi'),
      assistantTurn('hello'),
    ]);
    const out = await extractor.extract('s1', '/ws');
    expect(out).toBeNull();
  });

  it('returns null when no success marker is present', async () => {
    reader.readJsonlMessages.mockResolvedValue([
      userTurn('please refactor'),
      assistantTurn('working on it'),
      userTurn('continue'),
      assistantTurn('still working'),
      userTurn('any progress?'),
      assistantTurn('almost there'),
    ]);
    const out = await extractor.extract('s1', '/ws');
    expect(out).toBeNull();
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
