import * as path from 'path';

export function resolveInitialWorkspaceArg(
  argv: readonly string[],
  isDirectory: (candidate: string) => boolean,
): string | undefined {
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('-') || arg === argv[0] || arg === argv[1]) {
      continue;
    }
    const candidate = path.resolve(arg);
    if (isDirectory(candidate)) {
      return candidate;
    }
  }
  return undefined;
}
