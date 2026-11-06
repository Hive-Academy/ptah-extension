import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';

export interface WorkerPaths {
  directory: string;
  workspaces: string;
  tokens: string;
  adminKey: string;
  endpoint: string;
  events: string;
}

export function workerPaths(home: string = homedir()): WorkerPaths {
  const directory = join(home, '.ptah', 'worker');
  return {
    directory,
    workspaces: join(directory, 'workspaces.json'),
    tokens: join(directory, 'tokens.json'),
    adminKey: join(directory, 'admin.key'),
    endpoint: join(directory, 'endpoint.json'),
    events: join(directory, 'events'),
  };
}

export async function ensureWorkerDirectory(paths: WorkerPaths): Promise<void> {
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
}
