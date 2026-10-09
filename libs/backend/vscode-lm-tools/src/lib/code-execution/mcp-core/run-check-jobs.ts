/** In-memory, HTTP-only lifecycle for `ptah_run_check` jobs. */
import { randomUUID } from 'node:crypto';
import { runningCheckPids, type RunCheckOutcome } from './run-check.tool';
import type { RunCheckArgs } from './wait-tools-args.schema';

export const RUN_CHECK_RESULT_TTL_MS = 15 * 60 * 1000;
export const MAX_FINISHED_RUN_CHECK_JOBS = 16;

export interface RunCheckJob {
  readonly id: string;
  readonly ownerKey: string;
  readonly args: RunCheckArgs;
  readonly root: string;
  readonly startedAt: number;
  readonly controller: AbortController;
  readonly done: Promise<RunCheckOutcome>;
  outcome?: RunCheckOutcome;
  finishedAt?: number;
  logPath?: string;
}

export type RunCheckStart =
  | { readonly job: RunCheckJob; readonly attached: boolean }
  | { readonly busy: RunCheckJob | undefined; readonly external: boolean };

export interface RunCheckJobRegistry {
  start(
    args: RunCheckArgs,
    root: string,
    ownerKey: string,
    run: (
      signal: AbortSignal,
      onLogOpened: (path: string | undefined) => void,
    ) => Promise<RunCheckOutcome>,
  ): RunCheckStart;
  get(id: string, ownerKey: string): RunCheckJob | undefined;
  waitFor(
    job: RunCheckJob,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<RunCheckOutcome | undefined>;
  cancel(job: RunCheckJob): void;
}

export function createRunCheckJobRegistry(
  now: () => number = Date.now,
): RunCheckJobRegistry {
  let running: RunCheckJob | undefined;
  const finished = new Map<string, RunCheckJob>();

  const sweep = () => {
    const cutoff = now() - RUN_CHECK_RESULT_TTL_MS;
    for (const [id, job] of finished) {
      if ((job.finishedAt ?? 0) < cutoff) finished.delete(id);
    }
    while (finished.size > MAX_FINISHED_RUN_CHECK_JOBS) {
      const oldest = finished.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      finished.delete(oldest);
    }
  };

  return {
    start(args, root, ownerKey, run) {
      sweep();
      if (running !== undefined) {
        if (running.ownerKey === ownerKey && sameCheck(running.args, args)) {
          return { job: running, attached: true };
        }
        return {
          busy: running.ownerKey === ownerKey ? running : undefined,
          external: running.ownerKey !== ownerKey,
        };
      }
      if (runningCheckPids().length > 0)
        return { busy: undefined, external: true };
      const controller = new AbortController();
      const job = {} as RunCheckJob;
      const done = Promise.resolve()
        .then(() =>
          run(controller.signal, (logPath) => {
            job.logPath = logPath;
          }),
        )
        .catch((error: unknown): RunCheckOutcome => ({
          isError: true,
          text: `ptah_run_check: job failed: ${error instanceof Error ? error.message : String(error)}`,
          structured: {
            cwd: root,
            project: args.project,
            targets: args.targets,
            verdict: 'not_run',
            exitCode: null,
          },
        }))
        .then((outcome) => {
          job.outcome = outcome;
          job.finishedAt = now();
          if (!job.logPath) job.logPath = outcome.logPath;
          if (running === job) running = undefined;
          finished.set(job.id, job);
          sweep();
          return outcome;
        });
      Object.assign(job, {
        id: randomUUID(),
        ownerKey,
        args,
        root,
        startedAt: now(),
        controller,
        done,
      });
      running = job;
      return { job, attached: false };
    },
    get(id, ownerKey) {
      sweep();
      const job = running?.id === id ? running : finished.get(id);
      return job?.ownerKey === ownerKey ? job : undefined;
    },
    async waitFor(job, timeoutMs, signal) {
      sweep();
      if (job.outcome !== undefined) return job.outcome;
      if (signal?.aborted) return undefined;
      return await new Promise<RunCheckOutcome | undefined>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const settle = (outcome: RunCheckOutcome | undefined) => {
          if (timer !== undefined) clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          resolve(outcome);
        };
        const onAbort = () => settle(undefined);
        timer = setTimeout(() => settle(undefined), Math.max(0, timeoutMs));
        signal?.addEventListener('abort', onAbort, { once: true });
        void job.done.then((outcome) => settle(outcome));
      });
    },
    cancel(job) {
      job.controller.abort();
    },
  };
}

function sameCheck(left: RunCheckArgs, right: RunCheckArgs): boolean {
  return (
    left.project === right.project &&
    left.targets.length === right.targets.length &&
    left.targets.every((target, index) => target === right.targets[index])
  );
}

/** Process-wide registry, parallel to the existing live-check process map. */
export const runCheckJobs = createRunCheckJobRegistry();
