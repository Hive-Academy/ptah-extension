/**
 * `TemplatePartialResolver` — the rejection cases are the point.
 *
 * Expanding a well-formed marker pair is the easy half. The half that matters
 * is refusing everything else, because the failure this class replaces was
 * SILENT: markers nothing resolved leaked into every generated agent for as
 * long as they existed, and a malformed id (`ANT I_PATTERNS`) was invisible to
 * the `\w+` validator that was supposed to catch it.
 */
import 'reflect-metadata';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

jest.mock('@ptah-extension/vscode-core', () => ({
  Logger: jest.fn(),
  TOKENS: { LOGGER: Symbol.for('Logger'), SENTRY_SERVICE: Symbol.for('S') },
}));

import { renderTaskSpecAgentBlock } from '@ptah-extension/shared';
import {
  TemplatePartialResolver,
  partialFileName,
} from './template-partial-resolver';

const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as never;

describe('TemplatePartialResolver', () => {
  let dir: string;
  let resolver: TemplatePartialResolver;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ptah-partials-'));
    writeFileSync(
      join(dir, partialFileName('REPLACEMENT_POLICY')),
      '## Replace, do not accumulate\n\n- Replace in place.\n',
      'utf8',
    );
    writeFileSync(
      join(dir, partialFileName('CLARIFICATION_PROTOCOL')),
      'STOP before {{CLARIFY_ARTIFACT}}.\n',
      'utf8',
    );
    resolver = new TemplatePartialResolver(logger);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const resolve = (body: string, vars: Record<string, string> = {}) =>
    resolver.resolve('some-agent', body, dir, vars);

  it('passes content with no markers through untouched', async () => {
    const body = '# Agent\n\nJust prose.\n';
    const result = await resolve(body);
    expect(result.value!.content).toBe(body);
    expect(result.value!.blocks).toEqual([]);
  });

  it('replaces whatever sits between the markers, and keeps the markers', async () => {
    // Stale content between the pair is the NORMAL case during the rewrite —
    // the resolver must not care what was there.
    const result = await resolve(
      [
        'intro',
        '<!-- STATIC:REPLACEMENT_POLICY -->',
        'stale text that drifted years ago',
        '<!-- /STATIC:REPLACEMENT_POLICY -->',
        'outro',
      ].join('\n'),
    );
    const content = result.value!.content;
    expect(content).toContain('- Replace in place.');
    expect(content).not.toContain('stale text that drifted');
    // Markers survive; `buildAgentFileContent` strips them on emit.
    expect(content).toContain('<!-- STATIC:REPLACEMENT_POLICY -->');
    expect(content).toContain('<!-- /STATIC:REPLACEMENT_POLICY -->');
    expect(content.startsWith('intro')).toBe(true);
    expect(content.trimEnd().endsWith('outro')).toBe(true);
  });

  it('expands an EMPTY pair, which is the shape templates are authored with', async () => {
    const result = await resolve(
      '<!-- STATIC:REPLACEMENT_POLICY -->\n<!-- /STATIC:REPLACEMENT_POLICY -->\n',
    );
    expect(result.value!.content).toContain('- Replace in place.');
  });

  it('renders TASK_SPEC_CONTRACT from the contract module, with no file present', async () => {
    const result = await resolve(
      '<!-- STATIC:TASK_SPEC_CONTRACT -->\n<!-- /STATIC:TASK_SPEC_CONTRACT -->\n',
    );
    expect(result.value!.blocks[0].content).toBe(
      renderTaskSpecAgentBlock().trim(),
    );
  });

  it('fills declared slots', async () => {
    const result = await resolve(
      '<!-- STATIC:CLARIFICATION_PROTOCOL -->\n<!-- /STATIC:CLARIFICATION_PROTOCOL -->\n',
      { CLARIFY_ARTIFACT: 'writing production code' },
    );
    expect(result.value!.content).toContain(
      'STOP before writing production code.',
    );
  });

  it('refuses a slot the template did not declare', async () => {
    const result = await resolve(
      '<!-- STATIC:CLARIFICATION_PROTOCOL -->\n<!-- /STATIC:CLARIFICATION_PROTOCOL -->\n',
    );
    expect(result.isErr()).toBe(true);
    expect(result.error!.message).toContain('CLARIFY_ARTIFACT');
  });

  /**
   * Substitution is one `replace` pass, and `replace` never re-examines the
   * text it inserted. A `variables` value carrying its own `{{...}}` therefore
   * sailed through with `missing` empty — the literal placeholder reaching the
   * agent by the one route the check did not cover, which is the exact failure
   * the undeclared-slot rule exists to prevent.
   */
  it('refuses a slot value that itself contains a placeholder', async () => {
    const result = await resolve(
      '<!-- STATIC:CLARIFICATION_PROTOCOL -->\n<!-- /STATIC:CLARIFICATION_PROTOCOL -->\n',
      { CLARIFY_ARTIFACT: 'writing {{CLARIFY_TRIGGER}} code' },
    );

    expect(result.isErr()).toBe(true);
    expect(result.error!.message).toContain('unresolved placeholder');
    expect(result.error!.message).toContain('CLARIFY_TRIGGER');
  });

  it('does not second-pass a nested placeholder that HAS a value', async () => {
    // Declaring the inner name must not make it expand either: templating
    // inside a variable value is not a feature, it is an unbounded one.
    const result = await resolve(
      '<!-- STATIC:CLARIFICATION_PROTOCOL -->\n<!-- /STATIC:CLARIFICATION_PROTOCOL -->\n',
      {
        CLARIFY_ARTIFACT: 'writing {{CLARIFY_TRIGGER}} code',
        CLARIFY_TRIGGER: 'production',
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result.error!.message).toContain('CLARIFY_TRIGGER');
  });

  it('refuses a malformed id instead of ignoring the line', async () => {
    // The real defect: a space in the id made the marker invisible to `\w+`.
    const result = await resolve(
      '<!-- STATIC:REPLACEMENT_POLICY -->\n<!-- /STATIC:ANT I_PATTERNS -->\n',
    );
    expect(result.isErr()).toBe(true);
    expect(result.error!.message).toContain('/^[A-Z_]+$/');
  });

  it('refuses an unregistered id', async () => {
    const result = await resolve(
      '<!-- STATIC:MAIN_CONTENT -->\n<!-- /STATIC:MAIN_CONTENT -->\n',
    );
    expect(result.isErr()).toBe(true);
    expect(result.error!.message).toContain('Unknown STATIC block id');
  });

  it('refuses an unclosed block', async () => {
    const result = await resolve('<!-- STATIC:REPLACEMENT_POLICY -->\nbody\n');
    expect(result.isErr()).toBe(true);
    expect(result.error!.message).toContain('never closed');
  });

  it('refuses a mismatched close', async () => {
    const result = await resolve(
      '<!-- STATIC:REPLACEMENT_POLICY -->\n<!-- /STATIC:CLI_DELEGATION -->\n',
    );
    expect(result.isErr()).toBe(true);
    expect(result.error!.message).toContain('closed by');
  });

  it('refuses nesting', async () => {
    const result = await resolve(
      [
        '<!-- STATIC:REPLACEMENT_POLICY -->',
        '<!-- STATIC:CLI_DELEGATION -->',
        '<!-- /STATIC:CLI_DELEGATION -->',
        '<!-- /STATIC:REPLACEMENT_POLICY -->',
      ].join('\n'),
    );
    expect(result.isErr()).toBe(true);
    expect(result.error!.message).toContain('may not nest');
  });

  it('reports a missing partial file by path', async () => {
    const result = await resolve(
      '<!-- STATIC:CLI_DELEGATION -->\n<!-- /STATIC:CLI_DELEGATION -->\n',
    );
    expect(result.isErr()).toBe(true);
    expect(result.error!.message).toContain('cli-delegation.md');
    expect(result.error!.message).toContain('file not found');
  });

  it('expands several blocks in one body', async () => {
    const result = await resolve(
      [
        '<!-- STATIC:REPLACEMENT_POLICY -->',
        '<!-- /STATIC:REPLACEMENT_POLICY -->',
        'middle',
        '<!-- STATIC:TASK_SPEC_CONTRACT -->',
        '<!-- /STATIC:TASK_SPEC_CONTRACT -->',
      ].join('\n'),
    );
    expect(result.value!.blocks.map((b) => b.id)).toEqual([
      'REPLACEMENT_POLICY',
      'TASK_SPEC_CONTRACT',
    ]);
    expect(result.value!.content).toContain('middle');
  });

  /**
   * The resolver owns STATIC and nothing else.
   *
   * `LLM` sections are filled a stage later, by `ContentGenerationService`, from
   * analysis the resolver has never seen. Two properties have to hold or the two
   * mechanisms collide: an `LLM` marker must survive resolution untouched, and
   * the slot scan — which fails a load on any residual `{{…}}` — must never look
   * at LLM fallback text, because that text is authored template body and not a
   * shared partial at all.
   */
  describe('LLM markers belong to a later stage', () => {
    it('passes an LLM pair through byte-for-byte', async () => {
      const body = [
        '# Agent',
        '',
        '<!-- LLM:FRAMEWORK_CONVENTIONS -->',
        '## Framework conventions',
        '',
        '- Follow what the framework already establishes.',
        '<!-- /LLM:FRAMEWORK_CONVENTIONS -->',
        '',
      ].join('\n');

      const result = await resolve(body);

      expect(result.isOk()).toBe(true);
      expect(result.value!.content).toBe(body);
      expect(result.value!.blocks).toEqual([]);
    });

    it('does not treat an LLM id as an unregistered STATIC id', async () => {
      // A `STATIC:FRAMEWORK_CONVENTIONS` would fail the load — the id is not in
      // SHARED_BLOCK_IDS. The `LLM:` prefix must not reach that check at all.
      const result = await resolve(
        '<!-- LLM:FRAMEWORK_CONVENTIONS -->\nx\n<!-- /LLM:FRAMEWORK_CONVENTIONS -->\n',
      );
      expect(result.isErr()).toBe(false);
    });

    it('resolves a STATIC block sitting beside an LLM pair', async () => {
      const result = await resolve(
        [
          '<!-- LLM:REVIEW_FOCUS -->',
          '## Review focus',
          '<!-- /LLM:REVIEW_FOCUS -->',
          '',
          '<!-- STATIC:REPLACEMENT_POLICY -->',
          '<!-- /STATIC:REPLACEMENT_POLICY -->',
        ].join('\n'),
      );

      expect(result.value!.blocks.map((b) => b.id)).toEqual([
        'REPLACEMENT_POLICY',
      ]);
      expect(result.value!.content).toContain('<!-- LLM:REVIEW_FOCUS -->');
      expect(result.value!.content).toContain('- Replace in place.');
    });

    it('does not run the residual-slot scan over LLM fallback text', async () => {
      // The scan is scoped to an expanded partial's body. A `{{…}}` anywhere in
      // the surrounding template — including inside an LLM pair — is somebody
      // else's problem, and failing the load on it would make the two
      // mechanisms unable to share a file.
      const result = await resolve(
        [
          '<!-- LLM:EXISTING_PATTERNS -->',
          '## Existing patterns',
          '',
          '- A literal {{NOT_A_SLOT}} in authored fallback text.',
          '<!-- /LLM:EXISTING_PATTERNS -->',
          '<!-- STATIC:CLARIFICATION_PROTOCOL -->',
          '<!-- /STATIC:CLARIFICATION_PROTOCOL -->',
        ].join('\n'),
        { CLARIFY_ARTIFACT: 'writing code' },
      );

      expect(result.isErr() ? result.error!.message : 'ok').toBe('ok');
      expect(result.value!.content).toContain('{{NOT_A_SLOT}}');
      expect(result.value!.content).toContain('STOP before writing code.');
    });
  });

  it('reads each partial once and forgets it on clearCache', async () => {
    const body =
      '<!-- STATIC:REPLACEMENT_POLICY -->\n<!-- /STATIC:REPLACEMENT_POLICY -->\n';
    await resolve(body);
    // Deleting the file must not break a cached read...
    rmSync(join(dir, partialFileName('REPLACEMENT_POLICY')));
    expect((await resolve(body)).isOk()).toBe(true);
    // ...and clearing the cache must go back to disk.
    resolver.clearCache();
    expect((await resolve(body)).isErr()).toBe(true);
  });
});
