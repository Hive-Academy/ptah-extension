import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { inject, injectable } from 'tsyringe';
import { AUTH_PROVIDERS_TOKENS } from '../../di/tokens';

/** Resolves Codex identity once so auth I/O and App Server cannot diverge. */
@injectable()
export class CodexHomeResolver {
  readonly path: string;

  constructor(
    @inject(AUTH_PROVIDERS_TOKENS.CODEX_HOME_OVERRIDE, { isOptional: true })
    override?: string,
    @inject(AUTH_PROVIDERS_TOKENS.CODEX_ENV_OVERRIDE, { isOptional: true })
    environment?: Readonly<Record<string, string | undefined>>,
    @inject(AUTH_PROVIDERS_TOKENS.CODEX_HOMEDIR_OVERRIDE, { isOptional: true })
    homeDirectory?: () => string,
  ) {
    const env = environment ?? process.env;
    const home = homeDirectory ?? homedir;
    this.path = resolve(override || env['CODEX_HOME'] || resolve(home(), '.codex'));
  }
}
