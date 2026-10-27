import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [path]
      : [];
  });
}

/**
 * Module specifiers of the runtime import/export-from declarations in
 * `source`. `import type` / `export type` emit no import, so they are skipped.
 */
export function specifiersOf(source: string): string[] {
  return [
    ...source.matchAll(
      /^\s*(import|export)\s+(type\s+)?[^;]*?\s+from\s+['"]([^'"]+)['"]/gm,
    ),
  ]
    .filter((match) => match[2] === undefined)
    .map((match) => match[3]);
}

/** `source` without HTML, block and line comments. */
export function withoutComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}
