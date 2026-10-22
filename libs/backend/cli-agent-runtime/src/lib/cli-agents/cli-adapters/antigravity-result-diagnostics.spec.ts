import { formatAgyDiagnostics } from './antigravity-result-diagnostics';

describe('formatAgyDiagnostics', () => {
  it('truncates each value so step and stderr evidence survive a long result', () => {
    const formatted = formatAgyDiagnostics(
      {
        processExitCode: 7,
        resultEvent: { response: `Bearer result-secret ${'R'.repeat(9000)}` },
      },
      [{ marker: 'step-evidence', output: 'O'.repeat(9000) }],
      [`stderr-evidence ${'S'.repeat(9000)}`],
    );

    expect(formatted.length).toBeLessThanOrEqual(8 * 1024);
    expect(formatted.indexOf('"agyErrors"')).toBeLessThan(formatted.indexOf('"errorSteps"'));
    expect(formatted.indexOf('"errorSteps"')).toBeLessThan(formatted.indexOf('"event"'));
    expect(formatted).toContain('stderr-evidence');
    expect(formatted).toContain('step-evidence');
    expect(formatted).toContain('"processExitCode":7');
    expect(formatted).toContain('[REDACTED]');
    expect(formatted).not.toContain('result-secret');
    expect(formatted).not.toContain('R'.repeat(1025));
    expect(formatted).not.toContain('S'.repeat(1025));
    expect(formatted).not.toContain('O'.repeat(1025));
  });
});
