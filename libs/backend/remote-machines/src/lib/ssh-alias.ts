import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { MACHINE_SSH_ALIAS_PATTERN } from '@ptah-extension/shared';

export function validateSshAlias(alias: string): string {
  if (!MACHINE_SSH_ALIAS_PATTERN.test(alias))
    throw new Error(
      'Invalid SSH alias. Use 1–64 letters, digits, dots, underscores or hyphens, starting with a letter or digit.',
    );
  return alias;
}

export async function listSshAliases(
  read: (path: string, encoding: 'utf8') => Promise<string> = readFile,
  home: string = homedir(),
): Promise<string[]> {
  let config: string;
  try {
    config = await read(join(home, '.ssh', 'config'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const aliases = new Set<string>();
  for (const line of config.split(/\r?\n/)) {
    const match = /^\s*Host\s+(.+?)\s*(?:#.*)?$/i.exec(line);
    if (!match) continue;
    for (const alias of match[1].split(/\s+/)) {
      if (MACHINE_SSH_ALIAS_PATTERN.test(alias)) aliases.add(alias);
    }
  }
  return [...aliases];
}
