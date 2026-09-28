/**
 * What `go.mod` and `go.work` files say about Go module paths (TASK_2026_559
 * implementation-plan-languages.md, "Dependency graphs", Go row). Text
 * extraction only, after the `golang.org/x/mod/modfile` grammar: one
 * directive per line or a parenthesised block of them, `//` comments,
 * interpreted (`"…"`) and raw (backtick) strings. The Go toolchain is never
 * run.
 *
 * Read: `module`, `require`, `replace` (go.mod); `use`, `replace`
 * (go.work). A file with a malformed line, or a go.mod without its
 * `module`, is `undefined`: the caller's `manifest-unparseable` gap.
 */

/** A `replace` directive: `from [version] => to [version]`. */
export interface GoReplace {
  /** The replaced module path. */
  readonly from: string;
  /**
   * The replaced version when the directive names one: the replacement then
   * applies only to that version of the module.
   */
  readonly fromVersion?: string;
  /**
   * The replacement directory as written, when it is a file path (Go: it
   * starts with `./`, `../` or is absolute, and has no version); `undefined`
   * for a replacement by another module version.
   */
  readonly localDir?: string;
  /** The replacement module and version, for a non-directory replacement. */
  readonly to?: string;
}

/** A `require` directive. */
export interface GoRequire {
  readonly path: string;
  readonly version: string;
}

export interface GoModFacts {
  readonly module: string;
  readonly requires: readonly GoRequire[];
  readonly replaces: readonly GoReplace[];
}

export interface GoWorkFacts {
  /** Module directories as written (`./svc`, `.`). */
  readonly uses: readonly string[];
  readonly replaces: readonly GoReplace[];
}

/** The facts of a go.mod, or `undefined` when it cannot be read. */
export function readGoMod(text: string): GoModFacts | undefined {
  const directives = directivesOf(text);
  if (directives === undefined) return undefined;
  let module: string | undefined;
  const requires: GoRequire[] = [];
  const replaces: GoReplace[] = [];
  for (const { verb, args } of directives) {
    if (verb === 'module') {
      if (args.length !== 1 || module !== undefined) return undefined;
      module = args[0];
    } else if (verb === 'require') {
      if (args.length !== 2) return undefined;
      requires.push({ path: args[0], version: args[1] });
    } else if (verb === 'replace') {
      const replace = replaceOf(args);
      if (replace === undefined) return undefined;
      replaces.push(replace);
    }
  }
  return module === undefined || module === ''
    ? undefined
    : { module, requires, replaces };
}

/** The facts of a go.work, or `undefined` when it cannot be read. */
export function readGoWork(text: string): GoWorkFacts | undefined {
  const directives = directivesOf(text);
  if (directives === undefined) return undefined;
  const uses: string[] = [];
  const replaces: GoReplace[] = [];
  for (const { verb, args } of directives) {
    if (verb === 'use') {
      if (args.length !== 1) return undefined;
      uses.push(args[0]);
    } else if (verb === 'replace') {
      const replace = replaceOf(args);
      if (replace === undefined) return undefined;
      replaces.push(replace);
    }
  }
  return { uses, replaces };
}

/** `from [v] => to [v]`. */
function replaceOf(args: readonly string[]): GoReplace | undefined {
  const arrow = args.indexOf('=>');
  if (arrow !== 1 && arrow !== 2) return undefined;
  const target = args.slice(arrow + 1);
  if (target.length !== 1 && target.length !== 2) return undefined;
  const to = target[0];
  const isPath =
    target.length === 1 &&
    (to.startsWith('./') ||
      to.startsWith('../') ||
      to === '.' ||
      to === '..' ||
      to.startsWith('/') ||
      /^[A-Za-z]:[\\/]/.test(to) ||
      to.startsWith('.\\') ||
      to.startsWith('..\\'));
  return {
    from: args[0],
    ...(arrow === 2 ? { fromVersion: args[1] } : {}),
    ...(isPath ? { localDir: to } : { to: target.join(' ') }),
  };
}

interface Directive {
  readonly verb: string;
  readonly args: readonly string[];
}

/** Every directive, a block's lines each under the block's verb; `undefined` on a lexical error. */
function directivesOf(text: string): Directive[] | undefined {
  const directives: Directive[] = [];
  let blockVerb: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const tokens = tokensOf(line);
    if (tokens === undefined) return undefined;
    if (tokens.length === 0) continue;
    if (blockVerb !== undefined) {
      if (tokens.length === 1 && tokens[0] === ')') {
        blockVerb = undefined;
      } else {
        directives.push({ verb: blockVerb, args: tokens });
      }
      continue;
    }
    const [verb, ...args] = tokens;
    if (args.length === 1 && args[0] === '(') {
      blockVerb = verb;
    } else {
      directives.push({ verb, args });
    }
  }
  return blockVerb === undefined ? directives : undefined;
}

/** A line's tokens: words, `(`, `)`, `=>`, strings unquoted; comments dropped. */
function tokensOf(line: string): string[] | undefined {
  const tokens: string[] = [];
  let i = 0;
  while (i < line.length) {
    const char = line[i];
    if (char === ' ' || char === '\t' || char === '\r') {
      i++;
    } else if (line.startsWith('//', i)) {
      break;
    } else if (char === '(' || char === ')') {
      tokens.push(char);
      i++;
    } else if (char === '`') {
      const close = line.indexOf('`', i + 1);
      if (close === -1) return undefined;
      tokens.push(line.slice(i + 1, close));
      i = close + 1;
    } else if (char === '"') {
      const value = interpretedString(line, i);
      if (value === undefined) return undefined;
      tokens.push(value.text);
      i = value.end;
    } else {
      let end = i;
      while (
        end < line.length &&
        !/[\s()"`]/.test(line[end]) &&
        !line.startsWith('//', end)
      ) {
        end++;
      }
      tokens.push(line.slice(i, end));
      i = end;
    }
  }
  return tokens;
}

/** A `"…"` string starting at `start`, through JSON's escape rules (as modfile does). */
function interpretedString(
  line: string,
  start: number,
): { text: string; end: number } | undefined {
  let i = start + 1;
  while (i < line.length && line[i] !== '"') i += line[i] === '\\' ? 2 : 1;
  if (i >= line.length) return undefined;
  let text: unknown;
  try {
    text = JSON.parse(line.slice(start, i + 1));
  } catch {
    // An escape JSON does not take: a malformed line.
    text = undefined;
  }
  return typeof text === 'string' ? { text, end: i + 1 } : undefined;
}
