/**
 * CliIntegrityWorkerFactory — CLI host implementation of
 * `IIntegrityWorkerProcessFactory`. Spawns the bundled `integrity-worker.mjs`
 * in a `node:worker_threads` Worker (the headless CLI runs on plain Node and
 * has no Electron `utilityProcess`).
 *
 * Mirrors `ElectronIntegrityWorkerFactory` on the worker_threads transport.
 * The worker entry auto-detects the runtime and, absent `process.parentPort`,
 * falls back to `node:worker_threads` — so the SAME `integrity-worker.mjs`
 * drives both hosts.
 *
 * Two deliberate differences from `CliEmbedderWorkerFactory`:
 *
 * 1. No `init` message. The integrity worker is single-shot and takes its only
 *    input — the database path — on the `check` request that
 *    `SqliteIntegrityService` posts immediately after `spawn()`.
 * 2. No respawn or idle-teardown client behind it. One spawn, one reply, then
 *    the service kills it.
 */
import type {
  IIntegrityWorkerProcess,
  IIntegrityWorkerProcessFactory,
} from '@ptah-extension/persistence-sqlite';
import { CliWorkerThreadProcess } from './cli-worker-thread-process';

export class CliIntegrityWorkerFactory implements IIntegrityWorkerProcessFactory {
  constructor(private readonly workerPath: string) {}

  spawn(): IIntegrityWorkerProcess {
    return CliWorkerThreadProcess.fork(this.workerPath);
  }
}
