import 'reflect-metadata';
import {
  WAIT_SUMMARY_MAX_CHARS,
  RunCheckWaitArgsSchema,
} from './wait-tools-args.schema';
import { buildRunCheckWaitTool } from './run-check-wait.tool';
import { formatRunCheckRunning } from './run-check.tool';

describe('ptah_run_check_wait', () => {
  it('uses a strict, bounded schema and cancellation-aware annotations', () => {
    expect(
      RunCheckWaitArgsSchema.parse({
        jobId: 'df4f4faa-4fb3-4eef-b8ef-63c63d4b45a6',
      }),
    ).toMatchObject({
      timeoutSec: 45,
    });
    expect(RunCheckWaitArgsSchema.safeParse({ jobId: 'bad' }).success).toBe(
      false,
    );
    expect(
      RunCheckWaitArgsSchema.safeParse({
        jobId: 'df4f4faa-4fb3-4eef-b8ef-63c63d4b45a6',
        extra: true,
      }).success,
    ).toBe(false);
    expect(buildRunCheckWaitTool()).toMatchObject({
      name: 'ptah_run_check_wait',
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
      inputSchema: {
        properties: {
          timeoutSec: { description: 'Seconds to wait (default 45).' },
        },
      },
    });
  });

  it('keeps running replies within the shared wait budget', () => {
    expect(
      formatRunCheckRunning({
        jobId: 'df4f4faa-4fb3-4eef-b8ef-63c63d4b45a6',
        project: 'a'.repeat(120),
        targets: ['test', 'lint', 'typecheck', 'build'],
        elapsedMs: 45_000,
        cwd: 'c:/ws',
        logPath: `c:/ws/.ptah/tmp/checks/${'x'.repeat(500)}`,
      }).length,
    ).toBeLessThanOrEqual(WAIT_SUMMARY_MAX_CHARS);
  });
});
