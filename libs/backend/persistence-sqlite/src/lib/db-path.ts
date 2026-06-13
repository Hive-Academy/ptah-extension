import * as os from 'node:os';
import * as path from 'node:path';

export function resolvePtahDbPath(opts?: { isDev?: boolean }): string {
  const isDev = opts?.isDev ?? process.env['NODE_ENV'] === 'development';
  const dbFileName = isDev ? 'ptah-dev.sqlite' : 'ptah.sqlite';
  return path.join(os.homedir(), '.ptah', 'state', dbFileName);
}
