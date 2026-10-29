import path from 'node:path';

/** A deliberately small shell grammar. No expansion or filesystem lookup occurs here. */
type Platform = string;
const powerShellCommands = new Set([
  'get-content',
  'get-childitem',
  'select-string',
  'test-path',
]);
const portableCommands = new Set(['rg', 'ls', 'cat']);
const forbidden = /[^\x20-\x7e]|[;&<>`$@{}()#%^!]/;

export interface ReadOnlyCommandOptions {
  readonly systemRoot?: string;
}

function unwrap(command: string, platform: Platform, options: ReadOnlyCommandOptions): string | undefined {
  if (platform !== 'win32') return command;
  const trimmed = command.trim();
  const invocation = /^("[^"]+"|'[^']+'|[^\s"']+)(?: +([\s\S]*))?$/.exec(trimmed);
  if (!invocation) return /(?:powershell|pwsh)(?:\.exe)?/i.test(trimmed) ? undefined : command;
  const executable = invocation[1].replace(/^(["'])(.*)\1$/, '$2');
  const bare = /^(?:powershell|pwsh)(?:\.exe)?$/i.test(executable);
  const shellPath = /(?:^|[\\/])(?:powershell|pwsh)(?:\.exe)?$/i.test(executable);
  if (!bare && !shellPath) return command;
  const systemRoot = options.systemRoot;
  const trustedPath = systemRoot && /^[a-z]:[\\/]/i.test(systemRoot) &&
    path.win32.isAbsolute(systemRoot) &&
    path.win32.normalize(executable).toLowerCase() ===
      path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe').toLowerCase();
  if (!bare && !trustedPath) return undefined;
  const match = /^(?:-NoProfile(?: +-NoLogo)? +)?-(?:Command|c) +(["'])([\s\S]*)\1$/i.exec(invocation[2] ?? '');
  if (!match) return undefined;
  const body = match[2];
  // Nested shell quoting is ambiguous in this string form. Ask the user.
  if (!body || body.includes(match[1])) return undefined;
  return body;
}

interface Token { readonly value: string; readonly quoted: boolean }

function tokenize(command: string, platform: Platform): Token[] | undefined {
  if (!command.trim() || forbidden.test(command) ||
      (platform !== 'win32' && command.includes('\\'))) return undefined;
  const tokens: Token[] = [];
  let index = 0;
  while (index < command.length) {
    if (/\s/.test(command[index])) { index++; continue; }
    if (command[index] === '|') {
      tokens.push({ value: '|', quoted: false }); index++; continue;
    }
    let token = '';
    let quoted = false;
    while (index < command.length && !/[\s|]/.test(command[index])) {
      const char = command[index];
      if (char === '"' || char === "'") {
        if (quoted || token) return undefined;
        quoted = true;
        const quote = char;
        index++;
        const start = index;
        while (index < command.length && command[index] !== quote) index++;
        if (index === command.length || index === start) return undefined;
        token += command.slice(start, index);
        index++;
        if (index < command.length && !/[\s|]/.test(command[index])) return undefined;
      } else {
        token += char;
        index++;
      }
    }
    if (!token || token.includes('"') || token.includes("'")) return undefined;
    if (platform !== 'win32' && !quoted && /[*?[\]]/.test(token)) return undefined;
    tokens.push({ value: token, quoted });
  }
  return tokens;
}

export function pathWithin(candidate: string, cwd: string, platform: Platform): boolean {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  if (!paths.isAbsolute(candidate) || !paths.isAbsolute(cwd)) return false;
  const relative = paths.relative(cwd, candidate);
  return relative !== '..' && !relative.startsWith(platform === 'win32' ? '..\\' : '../') &&
    !paths.isAbsolute(relative);
}

function insideCwd(candidate: string, cwd: string, threadCwd: string, platform: Platform): boolean {
  if (!candidate || candidate.startsWith('~') || candidate.includes('*') ||
      candidate.includes('?') || candidate.includes('[') || candidate.includes(']') ||
      (platform === 'win32' && candidate.includes(','))) return false;
  if (platform === 'win32') {
    if (candidate.split(/[\\/]/).some((segment) =>
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment) ||
      (segment !== '.' && segment !== '..' && /[. ]$/.test(segment)))) return false;
    if (candidate.startsWith('\\') || candidate.startsWith('//') ||
        (candidate.includes(':') && !/^[a-z]:[\\/][^:]*$/i.test(candidate)) ||
        /^[a-z]:[^\\/]/i.test(candidate) || /^[a-z]:$/i.test(candidate)) return false;
    const resolved = path.win32.resolve(cwd, candidate);
    return pathWithin(resolved, threadCwd, platform);
  }
  if (candidate.includes('\\') || candidate.startsWith('//')) return false;
  const resolved = path.posix.resolve(cwd, candidate);
  return pathWithin(resolved, threadCwd, platform);
}

function validStage(stage: string[], cwd: string, threadCwd: string, platform: Platform): string[] | undefined {
  const [rawName, ...args] = stage;
  if (!rawName) return undefined;
  const name = platform === 'win32' ? rawName.toLowerCase() : rawName;
  if (!portableCommands.has(name) &&
      !(platform === 'win32' && powerShellCommands.has(name))) return undefined;
  const paths: string[] = [];
  if (name === 'rg') {
    let files = false;
    let index = 0;
    while (index < args.length && args[index].startsWith('-')) {
      const option = args[index++];
      if (option === '--files') files = true;
      else if (!['-n', '--line-number', '-i', '--ignore-case', '-l', '--files-with-matches'].includes(option)) return undefined;
    }
    if (files) paths.push(...args.slice(index));
    else {
      if (!args[index] || args[index].startsWith('-') || /[*?[\]]/.test(args[index])) return undefined;
      paths.push(...args.slice(index + 1));
    }
  } else if (name === 'select-string') {
    // PowerShell's explicit -Pattern / -Path form avoids positional ambiguity.
    if (args.length !== 4 || args[0].toLowerCase() !== '-pattern' ||
        args[2].toLowerCase() !== '-path' || !args[1]) return undefined;
    paths.push(args[3]);
  } else if (powerShellCommands.has(name)) {
    const values = args[0]?.toLowerCase() === '-literalpath' ? args.slice(1) : args;
    if (values.length > 1 || (name !== 'get-childitem' && values.length !== 1)) return undefined;
    paths.push(...values);
  } else {
    if (name === 'cat' && args.length === 0) return undefined;
    paths.push(...args);
  }
  return paths.every((value) => value !== '-' && !value.startsWith('-') &&
    insideCwd(value, cwd, threadCwd, platform)) ? paths : undefined;
}

export interface ReadOnlyCommand {
  readonly names: readonly string[];
  readonly paths: readonly string[];
}

/** Lexical classification only. The caller must check real paths before acceptance. */
export function classifyReadOnlyCommand(
  command: unknown,
  cwd: unknown,
  threadCwd: unknown,
  platform: Platform,
  options: ReadOnlyCommandOptions = {},
): ReadOnlyCommand | undefined {
  if (typeof command !== 'string' || typeof cwd !== 'string' || typeof threadCwd !== 'string' ||
      !['win32', 'linux', 'darwin', 'freebsd'].includes(platform) ||
      !cwd || !threadCwd ||
      (platform === 'win32' && [cwd, threadCwd].some((value) => value.startsWith('\\\\') || value.startsWith('//'))) ||
      !pathWithin(cwd, threadCwd, platform)) return undefined;
  const body = unwrap(command, platform, options);
  const tokens = body === undefined ? undefined : tokenize(body, platform);
  if (!tokens || tokens[0]?.value === '|' || tokens.at(-1)?.value === '|') return undefined;
  const stages: string[][] = [[]];
  for (const token of tokens) {
    if (token.value === '|' && !token.quoted) {
      if (!stages.at(-1)?.length) return undefined;
      stages.push([]);
    } else stages[stages.length - 1].push(token.value);
  }
  const paths: string[] = [];
  for (const stage of stages) {
    const stagePaths = validStage(stage, cwd, threadCwd, platform);
    if (!stagePaths) return undefined;
    paths.push(...stagePaths);
  }
  return { names: stages.map((stage) => stage[0]), paths };
}

/** Returns only command names so callers can log an approval without arguments. */
export function readOnlyCommandNames(command: unknown, cwd: unknown, threadCwd: unknown, platform: Platform, options: ReadOnlyCommandOptions = {}): readonly string[] | undefined {
  return classifyReadOnlyCommand(command, cwd, threadCwd, platform, options)?.names;
}

export function isReadOnlyCommand(
  command: unknown,
  cwd: unknown,
  threadCwd: unknown,
  platform: Platform,
  options: ReadOnlyCommandOptions = {},
): boolean {
  return readOnlyCommandNames(command, cwd, threadCwd, platform, options) !== undefined;
}
