/** How a CLI child's stderr line should be treated. */
export type CliStderrSeverity = 'error' | 'info';

const STDERR_ERROR_REGEX =
  /\b(error|fail(ed)?|exception|denied|unauthorized|refused|timeout|abort|crash|panic|fatal)\b/i;

/** Classify one already-trimmed, ANSI-stripped stderr line. */
export function classifyCliStderr(line: string): CliStderrSeverity {
  if (!line || !line.trim()) {
    return 'info';
  }
  return STDERR_ERROR_REGEX.test(line) ? 'error' : 'info';
}
