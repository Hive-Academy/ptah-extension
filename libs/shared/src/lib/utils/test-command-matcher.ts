interface CommandToken {
  readonly value: string;
  readonly quoted: boolean;
}

type SegmentSeparator = '&&' | '||' | '|' | ';' | '\n';

interface CommandSegment {
  readonly value: string;
  readonly followingSeparator?: SegmentSeparator;
}

function splitSegments(command: string): readonly CommandSegment[] {
  const segments: CommandSegment[] = [];
  let segment = '';
  let quote: 'single' | 'double' | null = null;

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (quote === 'single') {
      if (character === "'") quote = null;
      segment += character;
      continue;
    }
    if (quote === 'double') {
      if (character === '"') quote = null;
      segment += character;
      continue;
    }
    if (character === "'") {
      quote = 'single';
      segment += character;
      continue;
    }
    if (character === '"') {
      quote = 'double';
      segment += character;
      continue;
    }
    const isDoubleSeparator =
      (character === '&' && command[index + 1] === '&') ||
      (character === '|' && command[index + 1] === '|');
    if (
      isDoubleSeparator ||
      character === ';' ||
      character === '|' ||
      character === '\n'
    ) {
      const followingSeparator: SegmentSeparator = isDoubleSeparator
        ? (`${character}${character}` as '&&' | '||')
        : (character as '|' | ';' | '\n');
      segments.push({ value: segment, followingSeparator });
      segment = '';
      if (isDoubleSeparator) index += 1;
      continue;
    }
    segment += character;
  }
  segments.push({ value: segment });
  return segments;
}

function tokenize(segment: string): readonly CommandToken[] {
  const tokens: CommandToken[] = [];
  let value = '';
  let quoted = false;
  let quote: 'single' | 'double' | null = null;

  const pushToken = (): void => {
    if (value.length > 0 || quoted) {
      tokens.push({ value, quoted });
      value = '';
      quoted = false;
    }
  };

  for (let index = 0; index < segment.length; index += 1) {
    const character = segment[index];
    if (quote === 'single') {
      quoted = true;
      if (character === "'") quote = null;
      else value += character;
      continue;
    }
    if (quote === 'double') {
      quoted = true;
      if (character === '"') quote = null;
      else value += character;
      continue;
    }
    if (character === "'") {
      quoted = true;
      quote = 'single';
      continue;
    }
    if (character === '"') {
      quoted = true;
      quote = 'double';
      continue;
    }
    if (/\s/.test(character)) {
      pushToken();
      continue;
    }
    value += character;
  }
  pushToken();
  return tokens;
}

function isPlain(token: CommandToken | undefined, value: string): boolean {
  return token?.quoted === false && token.value === value;
}

function isTestScript(token: CommandToken | undefined): boolean {
  return (
    token?.quoted === false &&
    (token.value === 'test' || token.value.startsWith('test:'))
  );
}

function isInfoOnly(
  tokens: readonly CommandToken[],
  argumentStart: number,
): boolean {
  const arguments_ = tokens.slice(argumentStart);
  return (
    arguments_.length > 0 &&
    arguments_.every(
      (token) =>
        token.quoted === false &&
        (token.value === '--version' ||
          token.value === '-v' ||
          token.value === '--help' ||
          token.value === '-h'),
    )
  );
}

function matchesNxTargets(tokens: readonly CommandToken[]): boolean {
  for (let index = 2; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.quoted) continue;
    let targets: string | undefined;
    if (
      token.value === '-t' ||
      token.value === '--target' ||
      token.value === '--targets'
    ) {
      const next = tokens[index + 1];
      if (next?.quoted === false) targets = next.value;
    } else if (
      token.value.startsWith('--target=') ||
      token.value.startsWith('--targets=')
    ) {
      targets = token.value.slice(token.value.indexOf('=') + 1);
    }
    if (targets?.split(',').includes('test')) return true;
  }
  return false;
}

function matchExecutable(tokens: readonly CommandToken[]): boolean {
  if (isPlain(tokens[0], 'nx')) {
    if (isPlain(tokens[1], 'test')) return !isInfoOnly(tokens, 2);
    if (isPlain(tokens[1], 'run') && tokens[2]?.quoted === false) {
      return (
        tokens[2].value
          .split(':')
          .slice(1)
          .some((target) => target === 'test' || target.startsWith('test:')) &&
        !isInfoOnly(tokens, 3)
      );
    }
    if (isPlain(tokens[1], 'run-many') || isPlain(tokens[1], 'affected'))
      return matchesNxTargets(tokens);
  }
  if (isPlain(tokens[0], 'jest') || isPlain(tokens[0], 'vitest'))
    return !isInfoOnly(tokens, 1);
  if (isPlain(tokens[0], 'pytest') || isPlain(tokens[0], 'py.test'))
    return !isInfoOnly(tokens, 1);
  if (
    (isPlain(tokens[0], 'python') || isPlain(tokens[0], 'python3')) &&
    isPlain(tokens[1], '-m') &&
    isPlain(tokens[2], 'pytest')
  )
    return !isInfoOnly(tokens, 3);
  if (
    isPlain(tokens[0], 'go') ||
    isPlain(tokens[0], 'cargo') ||
    isPlain(tokens[0], 'dotnet')
  )
    return isPlain(tokens[1], 'test') && !isInfoOnly(tokens, 2);
  return false;
}

function matchesSegment(segment: string): boolean {
  let tokens = tokenize(segment);
  if (
    tokens.length === 0 ||
    isPlain(tokens[0], 'cd') ||
    isPlain(tokens[0], 'pushd') ||
    isPlain(tokens[0], 'popd')
  )
    return false;
  while (
    tokens[0]?.quoted === false &&
    /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0].value)
  )
    tokens = tokens.slice(1);
  if (isPlain(tokens[0], 'time')) tokens = tokens.slice(1);
  if (
    (isPlain(tokens[0], 'pnpm') &&
      (isPlain(tokens[1], 'exec') || isPlain(tokens[1], 'dlx'))) ||
    (isPlain(tokens[0], 'npm') && isPlain(tokens[1], 'exec')) ||
    (isPlain(tokens[0], 'yarn') && isPlain(tokens[1], 'dlx'))
  )
    tokens = tokens.slice(2);
  else if (isPlain(tokens[0], 'npx') || isPlain(tokens[0], 'bunx'))
    tokens = tokens.slice(1);

  if (
    (isPlain(tokens[0], 'npm') &&
      (isPlain(tokens[1], 'test') ||
        isPlain(tokens[1], 't') ||
        (isPlain(tokens[1], 'run') && isTestScript(tokens[2])))) ||
    ((isPlain(tokens[0], 'pnpm') || isPlain(tokens[0], 'yarn')) &&
      (isPlain(tokens[1], 'test') ||
        (isPlain(tokens[1], 'run') && isTestScript(tokens[2])))) ||
    (isPlain(tokens[0], 'bun') && isPlain(tokens[1], 'test'))
  )
    return true;
  if (matchExecutable(tokens)) return true;
  if (
    isPlain(tokens[0], 'pnpm') ||
    isPlain(tokens[0], 'yarn') ||
    isPlain(tokens[0], 'bun')
  )
    return matchExecutable(tokens.slice(1));
  return false;
}

/** Returns whether a shell command contains at least one test-running segment. */
export function classifyTestCommand(command: string): boolean {
  try {
    if (typeof command !== 'string') return false;
    return splitSegments(command).some((segment) =>
      matchesSegment(segment.value),
    );
  } catch {
    return false;
  }
}

/** Returns whether a test command's shell status is masked by a pipe or `||` tail. */
export function hasMaskedTestCommandOutcome(command: string): boolean {
  try {
    if (typeof command !== 'string') return false;
    return splitSegments(command).some(
      (segment) =>
        matchesSegment(segment.value) &&
        (segment.followingSeparator === '|' ||
          segment.followingSeparator === '||'),
    );
  } catch {
    return false;
  }
}
