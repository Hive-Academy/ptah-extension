import { classifyCliStderr } from './cli-stderr-severity';

describe('classifyCliStderr', () => {
  it('classifies benign CLI notices as info', () => {
    expect(
      classifyCliStderr(
        '[claude-code:unrecognized_model] {"model":"glm-5.2:cloud"}',
      ),
    ).toBe('info');

    expect(
      classifyCliStderr(
        'claude.ai connectors are disabled because ANTHROPIC_API_KEY is set',
      ),
    ).toBe('info');
  });

  it('classifies error lines as error', () => {
    expect(classifyCliStderr('Error: ENOENT')).toBe('error');
    expect(classifyCliStderr('fatal: unable to access repository')).toBe(
      'error',
    );
    expect(classifyCliStderr('panic: runtime error: index out of range')).toBe(
      'error',
    );
    expect(classifyCliStderr('Operation timed out: connection timeout')).toBe(
      'error',
    );
    expect(classifyCliStderr('Permission denied')).toBe('error');
    expect(classifyCliStderr('Connection refused by peer')).toBe('error');
    expect(classifyCliStderr('Unhandled exception in thread')).toBe('error');
    expect(classifyCliStderr('HTTP 401 unauthorized')).toBe('error');
    expect(classifyCliStderr('process crash detected')).toBe('error');
    expect(classifyCliStderr('task failed')).toBe('error');
    expect(classifyCliStderr('build fail')).toBe('error');
    expect(classifyCliStderr('abort signal received')).toBe('error');
  });

  it('respects word boundaries', () => {
    // 'terminated' contains 'abort' neither as word nor substring, but ensure words like 'terminated' are info
    expect(classifyCliStderr('process terminated')).toBe('info');
    // Words containing fragments should not match if not on word boundaries
    expect(classifyCliStderr('abortive attempt')).toBe('info');
    expect(classifyCliStderr('disinformative content')).toBe('info');
    expect(classifyCliStderr('refusedness is not a word')).toBe('info');
  });

  it('treats empty or whitespace lines as info', () => {
    expect(classifyCliStderr('')).toBe('info');
    expect(classifyCliStderr('   ')).toBe('info');
    expect(classifyCliStderr('\t\n')).toBe('info');
  });

  it('is case-insensitive', () => {
    expect(classifyCliStderr('FATAL ERROR')).toBe('error');
    expect(classifyCliStderr('TIMEOUT OCCURRED')).toBe('error');
    expect(classifyCliStderr('DENIED')).toBe('error');
  });
});
