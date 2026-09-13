import { homedir } from 'node:os';
import { resolve } from 'node:path';

/**
 * Resolves Codex identity once so auth I/O and App Server cannot diverge.
 *
 * Deliberately NOT `@injectable()`: the three parameters are test seams, not
 * dependencies. Nothing registers them, so in production all three are absent
 * and the resolver reads `process.env` and `homedir` — which is exactly what
 * `new CodexHomeResolver()` does. `register-providers.ts` therefore builds it
 * through a factory rather than `useClass`, and the specs construct it
 * directly. Injecting them as optional tokens meant three tokens that no
 * `register*` site could ever satisfy.
 */
export class CodexHomeResolver {
  readonly path: string;

  constructor(
    override?: string,
    environment?: Readonly<Record<string, string | undefined>>,
    homeDirectory?: () => string,
  ) {
    const env = environment ?? process.env;
    const home = homeDirectory ?? homedir;
    this.path = resolve(override || env['CODEX_HOME'] || resolve(home(), '.codex'));
  }
}
