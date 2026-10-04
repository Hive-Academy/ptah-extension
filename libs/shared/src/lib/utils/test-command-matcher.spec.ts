import { TEST_COMMAND_FIXTURES } from './test-command.fixtures';
import { classifyTestCommand } from './test-command-matcher';

describe('classifyTestCommand', () => {
  it.each(TEST_COMMAND_FIXTURES)('$rule: $command', ({ command, matches }) => {
    expect(classifyTestCommand(command)).toBe(matches);
  });

  it('recognizes newline and pipe-delimited test segments', () => {
    expect(classifyTestCommand('echo setup\nnpm test | tail -20')).toBe(true);
  });

  it('does not throw for malformed runtime input', () => {
    expect(classifyTestCommand(undefined as unknown as string)).toBe(false);
  });
});
