import {
  MASKED_TEST_COMMAND_FIXTURES,
  TEST_COMMAND_FIXTURES,
} from './test-command.fixtures';
import {
  classifyTestCommand,
  hasMaskedTestCommandOutcome,
} from './test-command-matcher';

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

  it.each(MASKED_TEST_COMMAND_FIXTURES)(
    'detects masked outcome for $rule: $command',
    ({ command, masked }) => {
      expect(hasMaskedTestCommandOutcome(command)).toBe(masked);
    },
  );
});
