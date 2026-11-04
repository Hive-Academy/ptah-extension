import { stat } from 'node:fs/promises';
import {
  PROTOCOL_VERSION,
  type ReadinessCheck,
  type ReadinessReport,
} from '@ptah-extension/worker-protocol';
import type { RegisteredWorkspace } from './workspace-registry';

export interface ReadinessPorts {
  platform: () => string;
  nodeVersion: () => string;
  sqliteMemory: () => Promise<void>;
  ptahVersion: () => string;
  listener: () => { host: string; port: number };
  workspaces: () => readonly RegisteredWorkspace[];
  /** Host adapts ClaudeCliDetector. */
  claudeCli: () => Promise<{ available: boolean; detail: string }>;
  /** Host adapts resolveEffectiveAuthRoute. */
  authRoute: () => Promise<{ ready: boolean; detail: string }>;
  driverLock: () => Promise<{ available: boolean; stranded: boolean }>;
  desktopVersionWarning?: () => string | undefined;
  exists?: (path: string) => Promise<boolean>;
}

export async function checkWorkerReadiness(
  ports: ReadinessPorts,
): Promise<ReadinessReport> {
  const checks: ReadinessCheck[] = [];
  const add = (
    id: string,
    label: string,
    status: ReadinessCheck['status'],
    detail: string,
    fix?: string,
  ): void => {
    checks.push({ id, label, status, detail, ...(fix ? { fix } : {}) });
  };
  const os = ports.platform();
  add(
    'os',
    'Operating system',
    os === 'linux' ? 'pass' : 'fail',
    os,
    'Use a Linux worker machine.',
  );
  const node = ports.nodeVersion();
  const major = Number(node.replace(/^v/, '').split('.')[0]);
  let sqlite = true;
  try {
    await ports.sqliteMemory();
  } catch {
    sqlite = false;
  }
  const runtimeReady = major >= 22 && sqlite;
  add(
    'runtime',
    'Node version and SQLite',
    runtimeReady ? 'pass' : 'fail',
    `Bundled Node ${node}; better-sqlite3 ${sqlite ? 'opens an in-memory database' : 'could not open an in-memory database'}.`,
    runtimeReady
      ? undefined
      : 'Update the Ptah desktop package to get Node 22+ or rebuild better-sqlite3 for the bundled runtime.',
  );
  const version = ports.ptahVersion();
  add(
    'version',
    'Ptah package and protocol versions',
    version && PROTOCOL_VERSION === 1 ? 'pass' : 'fail',
    `Ptah package ${version || 'unknown'}; protocol ${PROTOCOL_VERSION}.`,
  );
  const listener = ports.listener();
  const loopback =
    (listener.host === '127.0.0.1' || listener.host === '::1') &&
    Number.isInteger(listener.port) &&
    listener.port >= 0 &&
    listener.port <= 65535;
  add(
    'listener',
    'Listener address',
    loopback ? 'pass' : 'fail',
    `${listener.host}:${listener.port}`,
    'Bind to a loopback literal.',
  );
  const exists =
    ports.exists ??
    (async (path: string) => {
      try {
        return (await stat(path)).isDirectory();
      } catch {
        // degradation-audit: reported - a path that cannot be stat'ed counts as
        // missing, and the workspaces readiness check reports it as a failure.
        return false;
      }
    });
  const workspaces = ports.workspaces();
  const registered = (
    await Promise.all(workspaces.map((workspace) => exists(workspace.path)))
  ).filter(Boolean).length;
  add(
    'workspaces',
    'Registered workspaces',
    registered > 0 ? 'pass' : 'fail',
    `${registered} existing registered workspace(s).`,
    'Register an existing workspace.',
  );
  let cli: { available: boolean; detail: string };
  let route: { ready: boolean; detail: string };
  try {
    cli = await ports.claudeCli();
  } catch {
    cli = { available: false, detail: 'Claude CLI detection failed.' };
  }
  try {
    route = await ports.authRoute();
  } catch {
    route = { ready: false, detail: 'Provider authentication check failed.' };
  }
  const provider = {
    ready: cli.available && route.ready,
    detail: `${cli.detail} ${route.detail}`.trim(),
  };
  add(
    'provider',
    'Provider ready',
    provider.ready ? 'pass' : 'fail',
    provider.detail,
    provider.ready
      ? undefined
      : 'Sign in with a provider CLI on the worker machine. Desktop API keys are not shared.',
  );
  let lock: { available: boolean; stranded: boolean };
  try {
    lock = await ports.driverLock();
  } catch {
    lock = { available: false, stranded: false };
  }
  add(
    'driver-lock',
    'Driver lock',
    lock.available && !lock.stranded ? 'pass' : 'fail',
    `Driver lock ${lock.available ? 'available' : 'unavailable'}; ${lock.stranded ? 'a lock is stranded' : 'no stranded lock'}; applies to Claude and native Codex sessions; this worker drives Claude sessions only.`,
    lock.available && !lock.stranded
      ? undefined
      : 'Repair the driver lock before starting the worker.',
  );
  const warning = ports.desktopVersionWarning?.();
  if (warning) add('desktop-version', 'Desktop app version', 'warn', warning);
  return { ready: checks.every((check) => check.status !== 'fail'), checks };
}
