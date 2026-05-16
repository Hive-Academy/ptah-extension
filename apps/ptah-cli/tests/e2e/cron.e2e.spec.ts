/**
 * Cron Scheduler e2e.
 *
 * Surface under test: `cron:create`, `cron:runNow`, `cron:runs`, `cron:list`,
 * `cron:delete` RPC methods backed by `@ptah-extension/cron-scheduler`.
 *
 * Why skipped:
 *   The RPC methods are registered on the in-process `cli-message-transport`
 *   (via `CliRpcMethodRegistrationService`) but are NOT reachable on the
 *   `ptah interact` stdio inbound channel — that channel only registers
 *   `task.submit / task.cancel / session.shutdown / session.history`
 *   (verified `apps/ptah-cli/src/cli/commands/interact.ts`).
 *
 *   One-shot subcommand dispatching would work, but the `ptah cron` subcommand
 *   group has not yet been added to `apps/ptah-cli/src/cli/router.ts` as of
 *   the Thoth hub work. Once that CLI surface exists these tests can be
 *   activated without any API calls — cron operations are pure SQLite + croner
 *   and don't require an upstream provider.
 *
 * When unblocked, the test flow is:
 *   1. tmp = await createTmpHome()
 *   2. spawnOneshot(['cron', 'create', '--expr', '* * * * *',
 *        '--name', 'e2e-test', '--prompt', 'ping', '--json'])
 *      → assert result.job.id exists, result.job.enabled === true.
 *   3. spawnOneshot(['cron', 'run-now', '--id', jobId, '--json'])
 *      → assert result.run.status === 'running' or 'done'.
 *   4. spawnOneshot(['cron', 'runs', '--id', jobId, '--json'])
 *      → assert result.runs.length ≥ 1.
 *   5. spawnOneshot(['cron', 'delete', '--id', jobId, '--json'])
 *      → assert result.ok === true.
 *   6. spawnOneshot(['cron', 'runs', '--id', jobId, '--json'])
 *      → assert result.runs.length === 0 (cascade delete confirmed).
 *   7. tmp.cleanup()
 *
 * Prerequisite: `ptah cron create|list|get|delete|toggle|run-now|runs|next-fire`
 * CLI subcommands added to `apps/ptah-cli/src/cli/router.ts` (not yet present
 * as of the Thoth hub work).
 */

describe.skip('cron scheduler e2e (TASK_2026_HERMES Track 3 — requires ptah cron CLI subcommands)', () => {
  it('cron:create returns a job DTO with a valid ULID id and enabled=true', () => {
    /* Stub — see file header. */
  });

  it('cron:runNow fires the job immediately and returns a run row', () => {
    /* Stub — see file header. */
  });

  it('cron:runs returns ≥1 row after runNow', () => {
    /* Stub — see file header. */
  });

  it('cron:delete removes the job and cascade-deletes its run rows', () => {
    /* Stub — see file header. */
  });

  it('cron:toggle disables a job so it no longer appears in cron:list enabledOnly', () => {
    /* Stub — see file header. */
  });

  it('cron:nextFire returns a future epoch ms for a valid cron expression', () => {
    /* Stub — see file header. */
  });
});
