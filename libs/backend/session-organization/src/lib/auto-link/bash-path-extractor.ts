/** Paths named by shell commands that can move or create a worktree. */
export function extractBashPaths(command: string): string[] {
  const segments: string[][] = [[]];
  const operators: string[] = [];
  let word = '';
  let quote: "'" | '"' | null = null;
  let active = false;
  const pushWord = () => {
    if (active) segments[segments.length - 1]?.push(word);
    word = '';
    active = false;
  };
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (char === '\\' && quote !== "'" && /[\s'"\\;&|]/.test(command[i + 1] ?? '')) {
      word += command[++i];
      active = true;
    } else if (char === quote) {
      quote = null;
    } else if (quote !== null) {
      word += char;
      active = true;
    } else if (char === "'" || char === '"') {
      quote = char;
      active = true;
    } else if (/\s/.test(char) && char !== '\n') {
      pushWord();
    } else if (char === '\n' || char === ';' || char === '|' || char === '&') {
      if ((char === '|' || char === '&') && command[i + 1] !== char && char === '&') return [];
      const operator = (char === '|' || char === '&') && command[i + 1] === char ? `${char}${char}` : char;
      if (operator.length === 2) i++;
      pushWord();
      operators.push(operator);
      segments.push([]);
    } else {
      word += char;
      active = true;
    }
  }
  if (quote !== null) return [];
  pushWord();
  const paths: string[] = [];
  let cwd = '';
  const resolve = (value: string) => {
    if (/^(?:[A-Za-z]:[\\/]|[\\/])/.test(value)) return value;
    return cwd ? `${cwd}/${value}` : value;
  };
  for (const [index, args] of segments.entries()) {
    // Only a successful && chain can carry a prior cd into the next command.
    if (index > 0 && operators[index - 1] !== '&&') cwd = '';
    if (args[0] === 'cd' && args.length === 2 && args[1]) {
      cwd = resolve(args[1]);
      paths.push(cwd);
    } else if (args[0] === 'git' && args[1] === '-C' && args[2]) {
      paths.push(resolve(args[2]));
    } else if (args[0] === 'git' && args[1] === 'worktree' && args[2] === 'add') {
      let index = 3;
      while (args[index]?.startsWith('-')) {
        const option = args[index] ?? '';
        if (/^(?:-b|-B|--reason|--orphan)$/.test(option)) index += 2;
        else if (/^(?:-b|-B|--reason|--orphan)=/.test(option) || /^(?:--detach|-d|-f|--force|--lock|--no-checkout|--checkout|--quiet|-q|--track|--no-track|--guess-remote|--no-guess-remote)$/.test(option)) index++;
        else { index = args.length; break; }
      }
      if (args[index]) paths.push(resolve(args[index]));
    }
  }
  return paths;
}
