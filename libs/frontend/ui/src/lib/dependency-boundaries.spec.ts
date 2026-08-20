/**
 * Dependency-boundary pins for `@ptah-extension/ui` (P1-9 part b).
 *
 * WHAT THIS IS FOR. `ProviderModelPickerComponent` takes its model catalogue
 * from an injected `PROVIDER_MODELS_LOADER` rather than calling RPC directly.
 * That indirection only pays for itself while the boundary it protects still
 * holds: this lib is `type:ui`, and the Nx module-boundary rule confines
 * `type:ui` to `['type:ui', 'type:util']`. `@ptah-extension/core` — the owner
 * of `VSCodeService` and of every RPC round-trip — is `type:core`, so the
 * picker cannot reach a transport without either breaking the rule or
 * quietly weakening it.
 *
 * WHY A SPEC WHEN LINT ALREADY ENFORCES IT. The lint rule catches the import.
 * It does NOT catch the two edits that would make the import legal:
 * retagging this project away from `type:ui`, or relaxing the `type:ui`
 * constraint list. Both are one-line changes in files nobody reads during a
 * component review, and both would land green. So this spec pins three
 * things: the absence of the import (fast, direct, duplicates lint on
 * purpose), the tags on both ends of the edge, and the constraint list
 * itself.
 *
 * This is the first `dependency-boundaries.spec.ts` in the repo. If a second
 * lib needs one, copy the shape rather than generalising prematurely — the
 * value here is that the assertions name concrete, reviewable facts.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const LIB_ROOT = resolve(__dirname, '..', '..');
const WORKSPACE_ROOT = resolve(LIB_ROOT, '..', '..', '..');

/**
 * The only `@ptah-extension/*` specifiers this lib may carry.
 *
 * `@ptah-extension/shared` is `type:util` and is where the provider registry
 * and the RPC wire types live. `@ptah-extension/ui` is this project's own
 * path alias — several of the deprecated CDK components import their siblings
 * through it, which is a self-edge, not a boundary crossing.
 */
const ALLOWED_INTERNAL_IMPORTS = [
  '@ptah-extension/shared',
  '@ptah-extension/ui',
];

/** Tag pair the whole design rests on. */
const THIS_LIB_TAG = 'type:ui';
const FORBIDDEN_LIB = '@ptah-extension/core';
const FORBIDDEN_LIB_TAG = 'type:core';
const ALLOWED_TAGS_FOR_TYPE_UI = ['type:ui', 'type:util'];

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full));
      continue;
    }
    if (/\.(ts|html)$/.test(entry)) out.push(full);
  }
  return out;
}

function readTags(projectJsonPath: string): string[] {
  const raw = readFileSync(projectJsonPath, 'utf8');
  const parsed = JSON.parse(raw) as { tags?: string[] };
  return parsed.tags ?? [];
}

describe('@ptah-extension/ui dependency boundaries', () => {
  const sourceFiles = collectSourceFiles(join(LIB_ROOT, 'src'));

  it('finds source files to check (guards against a silently empty sweep)', () => {
    expect(sourceFiles.length).toBeGreaterThan(10);
  });

  it(`never imports ${FORBIDDEN_LIB}`, () => {
    // Import/export SPECIFIERS only. The picker's own doc comments name the
    // forbidden lib to explain why it is forbidden; prose is not an edge.
    const specifier = new RegExp(
      `(?:from|import|require\\()\\s*['"]${FORBIDDEN_LIB}(?:/[a-z0-9-]+)?['"]`,
    );
    const offenders = sourceFiles.filter((file) =>
      specifier.test(readFileSync(file, 'utf8')),
    );

    expect(
      offenders.map((f) => relative(WORKSPACE_ROOT, f).split(sep).join('/')),
    ).toEqual([]);
  });

  it('imports no workspace lib other than the shared type layer', () => {
    const pattern = /@ptah-extension\/[a-z0-9-]+/g;
    const offenders: string[] = [];

    for (const file of sourceFiles) {
      const contents = readFileSync(file, 'utf8');
      for (const match of contents.match(pattern) ?? []) {
        // The picker's own docs quote the forbidden id; comments are prose,
        // not edges, so only real import/export specifiers count.
        const isSpecifier = new RegExp(
          `(?:from|import|require\\()\\s*['"]${match}(?:/[a-z0-9-]+)?['"]`,
        ).test(contents);
        if (!isSpecifier) continue;
        if (ALLOWED_INTERNAL_IMPORTS.includes(match)) continue;
        offenders.push(
          `${relative(WORKSPACE_ROOT, file).split(sep).join('/')} → ${match}`,
        );
      }
    }

    expect(offenders).toEqual([]);
  });

  it('is still tagged type:ui, so the boundary rule still applies to it', () => {
    expect(readTags(join(LIB_ROOT, 'project.json'))).toContain(THIS_LIB_TAG);
  });

  it('still faces a type:core library on the other side of the edge', () => {
    const coreTags = readTags(
      join(WORKSPACE_ROOT, 'libs', 'frontend', 'core', 'project.json'),
    );
    expect(coreTags).toContain(FORBIDDEN_LIB_TAG);
  });

  it('keeps the shared type layer reachable (type:util)', () => {
    const sharedTags = readTags(
      join(WORKSPACE_ROOT, 'libs', 'shared', 'project.json'),
    );
    expect(sharedTags).toContain('type:util');
  });

  it('keeps the Nx constraint for type:ui narrowed to ui + util', () => {
    const config = readFileSync(
      join(WORKSPACE_ROOT, 'eslint.config.mjs'),
      'utf8',
    ).replace(/\s+/g, ' ');

    const match = config.match(
      /sourceTag: '(?:type:ui)', onlyDependOnLibsWithTags: \[([^\]]*)\]/,
    );

    expect(match).not.toBeNull();

    const tags = (match?.[1] ?? '')
      .split(',')
      .map((t) => t.trim().replace(/^'|'$/g, ''))
      .filter((t) => t.length > 0);

    expect(tags).toEqual(ALLOWED_TAGS_FOR_TYPE_UI);
    expect(tags).not.toContain(FORBIDDEN_LIB_TAG);
  });
});
