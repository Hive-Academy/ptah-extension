import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Resolves the Kimi Code CLI home (`~/.kimi-code`) once.
 *
 * Deliberately NOT `@injectable()`, same as `CodexHomeResolver`: both
 * parameters are test seams, not dependencies. In production they are absent
 * and the resolver reads `homedir()`. The Kimi Code CLI honours no home
 * override environment variable that this code relies on, so none is read.
 */
export class KimiCodeHomeResolver {
  readonly path: string;

  constructor(override?: string, homeDirectory?: () => string) {
    const home = homeDirectory ?? homedir;
    this.path = resolve(override || join(home(), '.kimi-code'));
  }

  /** `<home>/credentials` — one JSON token file per CLI login. */
  get credentialsDir(): string {
    return join(this.path, 'credentials');
  }

  /** `<home>/config.toml` — names the active OAuth credential and host. */
  get configFile(): string {
    return join(this.path, 'config.toml');
  }

  /** `<home>/device_id` — sent as `X-Msh-Device-Id` on refresh. */
  get deviceIdFile(): string {
    return join(this.path, 'device_id');
  }

  /** `<home>/region` — `global` or `mainland-cn`. */
  get regionFile(): string {
    return join(this.path, 'region');
  }

  /** `<home>/bin` — where the CLI installer puts the `kimi` executable. */
  get binDir(): string {
    return join(this.path, 'bin');
  }
}
