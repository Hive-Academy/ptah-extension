/**
 * Rules for {@link GeneratedSectionValidator}.
 *
 * Every rule here is paired: the sentence that must be rejected AND the
 * near-identical sentence that must survive. A validator with only negative
 * cases passes by rejecting everything, and the cost of that is invisible —
 * the wizard silently ships the generic fallback for all six sections and the
 * agents come out stack-agnostic, which is the state this whole task exists to
 * end.
 */
import 'reflect-metadata';
import { minimatch } from 'minimatch';
import type { IFileSystemProvider } from '@ptah-extension/platform-core';

jest.mock('@ptah-extension/vscode-core', () => ({
  Logger: jest.fn(),
  TOKENS: { LOGGER: Symbol.for('Logger') },
}));

import {
  GeneratedSectionValidator,
  type AnalysisPathIndex,
} from './generated-section-validator';

const HEADING = '## Framework conventions';
const FALLBACK = `${HEADING}\n\n- Follow whatever the framework already establishes.`;

function makeValidator(exists?: jest.Mock): GeneratedSectionValidator {
  return new GeneratedSectionValidator(exists ? ({ exists } as never) : null);
}

/** No paths and no file-system port: the path rules stand down entirely. */
const NO_PATHS: AnalysisPathIndex = {
  paths: new Set<string>(),
  rootPath: '/workspace/app',
};

async function verdict(
  validator: GeneratedSectionValidator,
  generated: string,
  index: AnalysisPathIndex = NO_PATHS,
): Promise<{ accepted: boolean; violations: readonly string[] }> {
  return validator.validate(
    { sectionId: 'FRAMEWORK_CONVENTIONS', generated, fallback: FALLBACK },
    index,
  );
}

/** Verified against this worktree; the fake never invents repository files. */
const REPOSITORY_FILES = [
  'libs/backend/platform-core/src/interfaces/output-channel.interface.ts',
  'libs/backend/gateway-chat-bridge/src/lib/di/tokens.ts',
  'libs/backend/workspace-intelligence/src/di/register.ts',
  'libs/backend/platform-core/src/interfaces/file-system-provider.interface.ts',
  'libs/backend/platform-core/src/interfaces/process-spawner.interface.ts',
  'apps/ptah-extension-vscode/src/di/phase-4-app.ts',
  'apps/ptah-cli/src/di/expected-resolvable.ts',
  'libs/backend/cli-engine/src/lib/rpc/expected-absent.ts',
  'apps/ptah-cli/src/di/container.smoke.spec.ts',
  'libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts',
  'libs/backend/vscode-core/src/messaging/rpc-handler.ts',
  'libs/backend/persistence-sqlite/src/lib/sqlite-connection.service.ts',
  'libs/frontend/core/src/lib/tokens/session-data.token.ts',
  'libs/frontend/core/src/lib/tokens/file-link-opener.token.ts',
  'libs/frontend/chat-state/src/lib/conversation-registry.service.ts',
  '.github/workflows/publish-electron.yml',
  '.github/workflows/publish-cli.yml',
  '.github/workflows/deploy-server.yml',
  '.github/workflows/deploy-landing.yml',
  '.github/workflows/deploy-docs.yml',
  'libs/web/auth/src/test-setup.ts',
  'libs/web/auth/tsconfig.spec.json',
  'libs/web/auth/tsconfig.lib.json',
  'libs/frontend/markdown/src/lib/provide-markdown-rendering.ts',
  'libs/frontend/markdown/src/lib/markdown-block.component.ts',
  'libs/backend/cron-scheduler/src/lib/run.store.ts',
  '.ptah/specs/TASK_2026_259/task.md',
  'apps/ptah-license-server-e2e/src/support/global-setup.ts',
  'libs/frontend/webview-e2e-harness/src/lib/postmessage-bridge.ts',
  'apps/ptah-landing-page/src/app/base-content-muted.spec.ts',
  'libs/backend/agent-generation/src/index.ts',
  'apps/ptah-extension-webview/src/index.html',
  'apps/ptah-electron/src/di/phase-4-handlers.ts',
  'libs/backend/persistence-sqlite/src/lib/migrations/0001_init.ts',
  'libs/frontend/workspace-indexing/src/lib/workspace-indexing.component.html',
];
function repositoryPort(): IFileSystemProvider {
  return {
    readFile: jest.fn(),
    readFileBytes: jest.fn(),
    writeFile: jest.fn(),
    writeFileBytes: jest.fn(),
    readDirectory: jest.fn(),
    stat: jest.fn(),
    delete: jest.fn(),
    createDirectory: jest.fn(),
    createDirectoryExclusive: jest.fn(),
    copy: jest.fn(),
    createFileWatcher: jest.fn(),
    exists: jest.fn(async (absolute: string) => {
      const relative = absolute
        .replace('/workspace/app/', '')
        .replace(/\/$/, '');
      return REPOSITORY_FILES.some(
        (path) => path === relative || path.startsWith(relative + '/'),
      );
    }),
    findFiles: jest.fn(
      async (
        pattern: string,
        _exclude?: string[],
        maxResults = 1,
        cwd = '/workspace/app',
      ) => {
        return REPOSITORY_FILES.filter((path) =>
          minimatch(path, pattern, { dot: true }),
        )
          .slice(0, maxResults)
          .map((path) => cwd + '/' + path);
      },
    ),
  };
}

describe('GeneratedSectionValidator', () => {
  let validator: GeneratedSectionValidator;

  beforeEach(() => {
    validator = makeValidator();
  });

  describe('accepts conventions', () => {
    it.each([
      [
        'a plain rule',
        `${HEADING}\n- Declare every provider in the module that owns it.`,
      ],
      [
        'a measurement, which stays true',
        `${HEADING}\n- Indent with 2 spaces and keep a file under 700 lines.`,
      ],
      [
        'a filename that merely looks version-shaped',
        `${HEADING}\n- Wire contracts live in \`rpc.types.ts\`.`,
      ],
      [
        'a numbered word that is not a census',
        `${HEADING}\n- Prefer two or three collaborators over six fragments.`,
      ],
      [
        'a slash that is prose, not a path',
        `${HEADING}\n- Use the and/or form sparingly in rule text.`,
      ],
      [
        'an ES year that has no word boundary',
        `${HEADING}\n- Target ES2022 output.`,
      ],
    ])('%s', async (_label, text) => {
      const result = await verdict(validator, text);
      expect(result.violations).toEqual([]);
      expect(result.accepted).toBe(true);
    });
  });

  describe('rejects facts that go stale', () => {
    it.each([
      ['a semver version', `${HEADING}\n- Built on Angular 21.3.`, 'version'],
      ['a v-prefixed version', `${HEADING}\n- Requires v4.1.0.`, 'version'],
      [
        'a lib census',
        `${HEADING}\n- The 29 backend libs share one port.`,
        'counts',
      ],
      [
        'an uppercase census',
        `${HEADING}\n- Exposes 22 PLATFORM_TOKENS.`,
        'counts',
      ],
      [
        'a qualified census',
        `${HEADING}\n- There are 13 Nx projects.`,
        'counts',
      ],
      ['a percentage', `${HEADING}\n- Coverage is 72%.`, 'percentage'],
      [
        'a spelled percentage',
        `${HEADING}\n- About 40 percent is typed.`,
        'percentage',
      ],
      ['an ISO date', `${HEADING}\n- Measured 2026-08-25.`, 'date'],
      ['a bare year', `${HEADING}\n- Migrated in 2026.`, 'date'],
      ['a month and year', `${HEADING}\n- Current as of Aug 2026.`, 'date'],
    ])('%s', async (_label, text, kind) => {
      const result = await verdict(validator, text);
      expect(result.accepted).toBe(false);
      expect(result.violations.join(' ')).toContain(kind);
    });

    it('names every rule broken, not just the first', async () => {
      const result = await verdict(
        validator,
        `${HEADING}\n- Angular 21.3 covers 72% of the 15 libs, as of 2026-01-01.`,
      );
      expect(result.violations.length).toBeGreaterThan(2);
    });

    it('returns a violation for empty text rather than accepting it', async () => {
      const result = await verdict(validator, '   \n  ');
      expect(result.accepted).toBe(false);
      expect(result.violations[0]).toContain('empty');
    });
  });

  describe('heading preservation', () => {
    it('rejects a renamed heading', async () => {
      const result = await verdict(
        validator,
        '## Angular conventions\n- Components are standalone.',
      );
      expect(result.accepted).toBe(false);
      expect(result.violations[0]).toContain('renamed');
    });

    it('rejects a dropped heading', async () => {
      const result = await verdict(validator, '- Components are standalone.');
      expect(result.accepted).toBe(false);
      expect(result.violations[0]).toContain('dropped');
    });

    it('ignores case and inner whitespace', async () => {
      const result = await verdict(
        validator,
        '##   framework   Conventions\n- Providers are module-scoped.',
      );
      expect(result.violations).toEqual([]);
    });

    it('imposes nothing when the fallback has no heading of its own', async () => {
      const result = await validator.validate(
        {
          sectionId: 'X',
          generated: 'Some prose with no heading.',
          fallback: 'Plain fallback prose.',
        },
        NO_PATHS,
      );
      expect(result.violations).toEqual([]);
    });
  });

  describe('path citations', () => {
    const index: AnalysisPathIndex = {
      paths: new Set([
        'src/main.ts',
        'src',
        'libs/core/src/index.ts',
        'libs/core/src',
        'libs/core',
        'libs',
        'package.json',
      ]),
      rootPath: '/workspace/app',
    };

    it('accepts a path the analysis surfaced', async () => {
      const result = await verdict(
        validator,
        `${HEADING}\n- Bootstrap in \`src/main.ts\`.`,
        index,
      );
      expect(result.violations).toEqual([]);
    });

    it('accepts an absolute form of the same path', async () => {
      const result = await verdict(
        validator,
        `${HEADING}\n- Bootstrap in \`/workspace/app/src/main.ts\`.`,
        index,
      );
      expect(result.violations).toEqual([]);
    });

    it('accepts a Windows-separated form of the same path', async () => {
      const result = await verdict(
        validator,
        `${HEADING}\n- Bootstrap in \`src\\main.ts\`.`,
        index,
      );
      expect(result.violations).toEqual([]);
    });

    it('accepts a glob whose fixed prefix is known', async () => {
      const result = await verdict(
        validator,
        `${HEADING}\n- Everything under \`libs/core/**/*.ts\` is public API.`,
        index,
      );
      expect(result.violations).toEqual([]);
    });

    it('accepts an ancestor directory of a known file', async () => {
      const result = await verdict(
        validator,
        `${HEADING}\n- Shared code lives in \`libs/core\`.`,
        index,
      );
      expect(result.violations).toEqual([]);
    });

    it('rejects an invented path', async () => {
      const result = await verdict(
        validator,
        `${HEADING}\n- Providers register in \`src/di/container.ts\`.`,
        index,
      );
      expect(result.accepted).toBe(false);
      expect(result.violations[0]).toContain('src/di/container.ts');
    });

    it('rejects a section that cites nothing at all', async () => {
      const result = await verdict(
        validator,
        `${HEADING}\n- Keep services small and focused.`,
        index,
      );
      expect(result.accepted).toBe(false);
      expect(result.violations[0]).toContain('cites no path');
    });

    it('ignores a URL, which is not a repository path', async () => {
      const result = await verdict(
        validator,
        `${HEADING}\n- See https://example.com/docs/guide.html and \`src/main.ts\`.`,
        index,
      );
      expect(result.violations).toEqual([]);
    });

    it('skips path checking entirely when neither a path set nor a port exists', async () => {
      // Otherwise every section fails on a capability the host does not have.
      const result = await verdict(
        validator,
        `${HEADING}\n- Providers register in \`src/di/container.ts\`.`,
      );
      expect(result.violations).toEqual([]);
    });

    describe('disk fallback when the analysis carried no paths', () => {
      it('accepts a path that exists on disk', async () => {
        const exists = jest.fn().mockResolvedValue(true);
        const result = await verdict(
          makeValidator(exists),
          `${HEADING}\n- Bootstrap in \`src/main.ts\`.`,
        );
        expect(result.violations).toEqual([]);
        expect(exists).toHaveBeenCalledWith('/workspace/app/src/main.ts');
      });

      it('rejects a path that does not', async () => {
        const result = await verdict(
          makeValidator(jest.fn().mockResolvedValue(false)),
          `${HEADING}\n- Bootstrap in \`src/nope.ts\`.`,
        );
        expect(result.accepted).toBe(false);
        expect(result.violations[0]).toContain('src/nope.ts');
      });

      it('treats a throwing port as a miss rather than crashing the wizard', async () => {
        const result = await verdict(
          makeValidator(jest.fn().mockRejectedValue(new Error('EACCES'))),
          `${HEADING}\n- Bootstrap in \`src/main.ts\`.`,
        );
        expect(result.accepted).toBe(false);
      });
    });

    /**
     * The prompt lets the model OPEN a file to confirm a convention, so the two
     * checks are per path, not one instead of the other. When the disk probe
     * only ran on an empty index, a file the model really read and the analysis
     * happened not to list was scored as an invention and the generic fallback
     * shipped — the exact outcome this section exists to prevent.
     */
    describe('a non-empty index does not disable the disk check', () => {
      it('accepts a listed path without probing disk at all', async () => {
        const exists = jest.fn().mockResolvedValue(false);
        const result = await verdict(
          makeValidator(exists),
          `${HEADING}\n- Bootstrap in \`src/main.ts\`.`,
          index,
        );
        expect(result.violations).toEqual([]);
        expect(exists).not.toHaveBeenCalled();
      });

      it('accepts an unlisted path the model actually opened', async () => {
        const exists = jest.fn().mockResolvedValue(true);
        const result = await verdict(
          makeValidator(exists),
          `${HEADING}\n- Providers register in \`src/di/container.ts\`.`,
          index,
        );
        expect(result.violations).toEqual([]);
        expect(exists).toHaveBeenCalledWith(
          '/workspace/app/src/di/container.ts',
        );
      });

      it('rejects an unlisted path that is not on disk either', async () => {
        const result = await verdict(
          makeValidator(jest.fn().mockResolvedValue(false)),
          `${HEADING}\n- Providers register in \`src/di/container.ts\`.`,
          index,
        );
        expect(result.accepted).toBe(false);
        expect(result.violations[0]).toContain('src/di/container.ts');
      });

      it('rejects an unlisted path when there is no port to ask', async () => {
        const result = await verdict(
          makeValidator(),
          `${HEADING}\n- Providers register in \`src/di/container.ts\`.`,
          index,
        );
        expect(result.accepted).toBe(false);
        expect(result.violations[0]).toContain('src/di/container.ts');
      });
    });

    describe('the disk probe never leaves the workspace root', () => {
      it.each([
        ['a parent-directory escape', '../../.ssh/id_rsa'],
        ['an absolute path outside the root', '/etc/ssl/openssl.cnf'],
      ])('rejects %s without asking the port', async (_label, cited) => {
        // A permissive port would otherwise turn model-authored text into a
        // probe of the user's home directory.
        const exists = jest.fn().mockResolvedValue(true);
        const result = await verdict(
          makeValidator(exists),
          `${HEADING}\n- Secrets live in \`${cited}\`.`,
          index,
        );
        expect(result.accepted).toBe(false);
        expect(result.violations[0]).toContain(cited);
        expect(exists).not.toHaveBeenCalled();
      });

      it('resolves an interior .. that stays inside the root', async () => {
        const exists = jest.fn().mockResolvedValue(true);
        const result = await verdict(
          makeValidator(exists),
          `${HEADING}\n- Bootstrap in \`libs/other/../core/boot.ts\`.`,
          index,
        );
        expect(result.violations).toEqual([]);
        expect(exists).toHaveBeenCalledWith('/workspace/app/libs/core/boot.ts');
      });
    });

    /**
     * A code span is where the prompt TELLS the model to cite, so two segments
     * are enough there. Bare prose needs harder evidence, or `and/or` becomes a
     * fabricated path and every section carrying the phrase is discarded.
     */
    it('reads a two-segment code span as a citation but the same shape in prose as words', async () => {
      const rejected = await verdict(
        validator,
        `${HEADING}\n- Shared code lives in \`libs/other\`.`,
        index,
      );
      expect(rejected.violations[0]).toContain('libs/other');

      const accepted = await verdict(
        validator,
        `${HEADING}\n- Use the and/or form when citing \`src/main.ts\`.`,
        index,
      );
      expect(accepted.violations).toEqual([]);
    });

    it('masks cited paths before the numeric rules run', async () => {
      // `01-project-profile.md` is a census AND a version to a naive matcher.
      const result = await verdict(
        validator,
        `${HEADING}\n- Phase notes live in \`docs/01-project-profile.md\`.`,
        {
          paths: new Set(['docs/01-project-profile.md', 'docs']),
          rootPath: '/workspace/app',
        },
      );
      expect(result.violations).toEqual([]);
    });
  });

  describe('real wizard regressions', () => {
    async function logVerdict(tokens: string, sources: string[] = []) {
      const subject = new GeneratedSectionValidator(repositoryPort());
      const index = subject.buildPathIndex(NO_PATHS.rootPath, sources);
      const body = tokens
        .split(', ')
        .map((token) => `Follow \`${token}\``)
        .join('\n');
      return verdict(subject, HEADING + '\n' + body, index);
    }
    async function accepts(
      tokens: string,
      sources: string[] = [],
    ): Promise<void> {
      expect(await logVerdict(tokens, sources)).toEqual({
        accepted: true,
        violations: [],
      });
    }
    it('accepts software-architect / EXISTING_PATTERNS', async () => {
      // output-channel.interface.ts, apps/ptah-extension-vscode/src/di/phase-*.ts, apps/ptah-electron/src/di/phase-*.ts, expected-absent.ts
      await accepts(
        'output-channel.interface.ts, apps/ptah-extension-vscode/src/di/phase-*.ts, apps/ptah-electron/src/di/phase-*.ts, expected-absent.ts',
      );
    });
    it('accepts backend-developer / FRAMEWORK_CONVENTIONS', async () => {
      // tokens.ts, register.ts, file-system-provider.interface.ts, process-spawner.interface.ts, phase-4-app.ts, expected-resolvable.ts, expected-absent.ts, container.smoke.spec.ts, chat-rpc.handlers.ts, rpc-handler.ts, process.env, e.g
      await accepts(
        'tokens.ts, register.ts, file-system-provider.interface.ts, process-spawner.interface.ts, phase-4-app.ts, expected-resolvable.ts, expected-absent.ts, container.smoke.spec.ts, chat-rpc.handlers.ts, rpc-handler.ts, process.env, e.g',
      );
    });
    it('accepts backend-developer / ARCHITECTURE_PATTERNS', async () => {
      // @nx/enforce-module-boundaries, src/index.ts, src/lib/sqlite-connection.service.ts, src/lib/migrations/
      await accepts(
        '@nx/enforce-module-boundaries, src/index.ts, src/lib/sqlite-connection.service.ts, src/lib/migrations/',
      );
    });
    it('accepts frontend-developer / FRAMEWORK_CONVENTIONS', async () => {
      // *.component.html, session-data.token.ts, file-link-opener.token.ts, @ptah-extension/shared, text-base-content/60, *.spec.ts, tsconfig.spec.json, tsconfig.lib.json, ChangeDetectionStrategy.OnPush, e.g
      await accepts(
        '*.component.html, session-data.token.ts, file-link-opener.token.ts, @ptah-extension/shared, text-base-content/60, *.spec.ts, tsconfig.spec.json, tsconfig.lib.json, ChangeDetectionStrategy.OnPush, e.g',
      );
    });
    it('accepts frontend-developer / ARCHITECTURE_PATTERNS', async () => {
      // @nx/enforce-module-boundaries, @ptah-extension/shared, conversation-registry.service.ts, src/index.ts, src/lib/
      await accepts(
        '@nx/enforce-module-boundaries, @ptah-extension/shared, conversation-registry.service.ts, src/index.ts, src/lib/',
      );
    });
    it('accepts devops-engineer / BUILD_AND_DEPLOY_SURFACE', async () => {
      // release/*, publish-electron.yml, publish-cli.yml, deploy-server.yml, deploy-landing.yml, deploy-docs.yml
      await accepts(
        'release/*, publish-electron.yml, publish-cli.yml, deploy-server.yml, deploy-landing.yml, deploy-docs.yml',
        ['release/*'],
      );
    });
    it('rejects devops-engineer / BUILD_AND_DEPLOY_SURFACE without release index evidence', async () => {
      expect(
        await logVerdict(
          'release/*, publish-electron.yml, publish-cli.yml, deploy-server.yml, deploy-landing.yml, deploy-docs.yml',
        ),
      ).toEqual({
        accepted: false,
        violations: [
          'cites path(s) that neither the analysis surfaced nor the workspace contains: release/*',
        ],
      });
    });
    it('accepts senior-tester / TEST_INFRASTRUCTURE', async () => {
      // *.spec.ts, tsconfig.spec.json, src/**/*.spec.ts, src/**/*.test.ts, test-setup.ts, @ptah-extension/shared/testing
      await accepts(
        '*.spec.ts, tsconfig.spec.json, src/**/*.spec.ts, src/**/*.test.ts, test-setup.ts, @ptah-extension/shared/testing',
        // No .test.ts files exist: the retained index rule recognizes the src prefix.
        ['libs/backend/agent-generation/src/index.ts'],
      );
    });
    it('accepts code-style-reviewer / REVIEW_FOCUS', async () => {
      // @nx/enforce-module-boundaries, expected-resolvable.ts, expected-absent.ts, container.smoke.spec.ts, tokens.ts, register.ts, kebab-case.ts, src/index.ts, provide-markdown-rendering.ts, markdown-block.component.ts, ChangeDetectionStrategy.OnPush
      const result = await logVerdict(
        '@nx/enforce-module-boundaries, expected-resolvable.ts, expected-absent.ts, container.smoke.spec.ts, tokens.ts, register.ts, kebab-case.ts, src/index.ts, provide-markdown-rendering.ts, markdown-block.component.ts, ChangeDetectionStrategy.OnPush',
      );
      expect(result).toEqual({
        accepted: true,
        violations: [],
      });
    });
    it('accepts code-style-reviewer / REVIEW_FOCUS without kebab-case.ts', async () => {
      await accepts(
        '@nx/enforce-module-boundaries, expected-resolvable.ts, expected-absent.ts, container.smoke.spec.ts, tokens.ts, register.ts, src/index.ts, provide-markdown-rendering.ts, markdown-block.component.ts, ChangeDetectionStrategy.OnPush',
      );
    });
    it('accepts code-logic-reviewer / REVIEW_FOCUS', async () => {
      // register.ts, .message, error.message, run.store.ts, task.md
      await accepts(
        'register.ts, .message, error.message, run.store.ts, task.md',
      );
    });
    it('accepts visual-reviewer / REVIEW_FOCUS', async () => {
      // src/support/global-setup.ts, src/lib/postmessage-bridge.ts, page.evaluate, base-content-muted.spec.ts, src/index.html
      await accepts(
        'src/support/global-setup.ts, src/lib/postmessage-bridge.ts, page.evaluate, base-content-muted.spec.ts, src/index.html',
      );
    });
  });

  describe('citation resolution safeguards', () => {
    it.each([
      ['apps/ptah-extension-vscode/src/di/nonexistent-*.ts', false],
      ['apps/ptah-extension-vscode/src/di/phase-*.ts', true],
      ['libs/backend/platform-core/*.fake', false],
      ['*.py', false],
      ['*.spec.ts', true],
      ['**/*.spec.ts', true],
      ['src/**/*.test.ts', false],
    ])('requires disk matches for glob %s', async (path, accepted) => {
      const port = repositoryPort();
      const result = await verdict(
        new GeneratedSectionValidator(port),
        `${HEADING}\n- See \`${path}\`.`,
      );
      expect(result.accepted).toBe(accepted);
      expect(port.exists).not.toHaveBeenCalled();
      expect(port.findFiles).toHaveBeenCalledWith(
        path.startsWith('**') ? path : `**/${path}`,
        ['**/node_modules/**', '**/dist/**', '**/.git/**'],
        1,
        NO_PATHS.rootPath,
      );
    });

    it.each([
      ['*.py', false],
      ['*.spec.ts', true],
    ])('requires index suffix evidence for %s', async (path, accepted) => {
      const index = validator.buildPathIndex(
        NO_PATHS.rootPath,
        REPOSITORY_FILES,
      );
      expect(
        (await verdict(validator, `${HEADING}\n- See \`${path}\`.`, index))
          .accepted,
      ).toBe(accepted);
    });

    it('rejects an invented basename even in naming-convention prose', async () => {
      const result = await verdict(
        new GeneratedSectionValidator(repositoryPort()),
        `${HEADING}\nNaming convention: \`made-up.service.ts\`. See \`register.ts\`.`,
      );
      expect(result).toEqual({
        accepted: false,
        violations: [
          'cites path(s) that neither the analysis surfaced nor the workspace contains: made-up.service.ts',
        ],
      });
    });

    it.each([
      'libs/backend/does-not-exist/src/lib/made-up.service.ts',
      'totally-invented-file.ts',
      'totally-invented-directory/*.ts',
      'libs/backend/does-not-exist/src/index.ts',
    ])('rejects fabrication %s', async (path) => {
      const result = await verdict(
        new GeneratedSectionValidator(repositoryPort()),
        `${HEADING}\n- See \`${path}\`.`,
      );
      expect(result.accepted).toBe(false);
      expect(result.violations[0]).toContain(path);
    });

    it.each([
      '@ptah-extension/shared',
      '@nx/enforce-module-boundaries',
      '@ptah-extension/shared/testing',
      'process.env',
      'error.message',
      '.message',
      'page.evaluate',
      'e.g',
      'ChangeDetectionStrategy.OnPush',
      'text-base-content/60',
      'kebab-case.ts',
      'camelCase.ts',
      'snake_case.ts',
      'PascalCase.ts',
      'UPPER_SNAKE_CASE.ts',
      'SCREAMING_SNAKE_CASE.ts',
    ])('does not count %s as a citation', async (token) => {
      const result = await verdict(
        new GeneratedSectionValidator(repositoryPort()),
        `${HEADING}\n- Use \`${token}\`.`,
      );
      expect(result.accepted).toBe(false);
      expect(result.violations[0]).toContain('cites no path from the analysis');
    });

    it('rejects a section citing only a package and a dotted identifier', async () => {
      const result = await verdict(
        new GeneratedSectionValidator(repositoryPort()),
        `${HEADING}\n- Use \`@ptah-extension/shared\` and \`process.env\`.`,
      );
      expect(result.violations[0]).toContain('cites no path from the analysis');
    });

    it('resolves basenames and suffixes from the analysis without a port', async () => {
      const index = validator.buildPathIndex(
        NO_PATHS.rootPath,
        REPOSITORY_FILES,
      );
      const result = await verdict(
        validator,
        `${HEADING}\n- See \`register.ts\`, \`src/index.ts\`, \`src/lib/migrations/\`, \`src/**/*.spec.ts\`, and \`*.spec.ts\`.`,
        index,
      );
      expect(result).toEqual({ accepted: true, violations: [] });
    });

    it('caches basename hits and misses across templates, separately per root', async () => {
      const port = repositoryPort();
      const subject = new GeneratedSectionValidator(port);
      const text = `${HEADING}\n- See \`register.ts\` and \`totally-invented-file.ts\`.`;
      await verdict(subject, text);
      await verdict(subject, text);
      expect(port.findFiles).toHaveBeenCalledTimes(2);
      expect(port.findFiles).toHaveBeenCalledWith(
        '**/register.ts',
        ['**/node_modules/**', '**/dist/**', '**/.git/**'],
        1,
        NO_PATHS.rootPath,
      );
      await verdict(subject, text, { ...NO_PATHS, rootPath: '/other' });
      expect(port.findFiles).toHaveBeenCalledTimes(4);
    });

    it('never searches outside the root, including globs', async () => {
      const port = repositoryPort();
      const subject = new GeneratedSectionValidator(port);
      for (const path of ['../../*.ts', '/etc/*.ts', 'C:/outside/*.ts']) {
        expect(
          (await verdict(subject, `${HEADING}\n- See \`${path}\`.`)).accepted,
        ).toBe(false);
      }
      expect(port.exists).not.toHaveBeenCalled();
      expect(port.findFiles).not.toHaveBeenCalled();
    });

    it('fails closed when a suffix search throws or returns an outside path', async () => {
      const port = repositoryPort();
      jest
        .mocked(port.findFiles)
        .mockRejectedValueOnce(new Error('EACCES'))
        .mockResolvedValueOnce(['/outside/register.ts']);
      const subject = new GeneratedSectionValidator(port);
      for (const path of ['tokens.ts', 'register.ts']) {
        expect(
          (await verdict(subject, `${HEADING}\n- See \`${path}\`.`)).accepted,
        ).toBe(false);
      }
    });
  });

  describe('buildPathIndex', () => {
    it('mines paths out of analysis prose and adds their ancestors', () => {
      const index = makeValidator().buildPathIndex('/workspace/app', [
        'Key Files: libs/core/src/index.ts, package.json',
        'Entry point is /workspace/app/apps/api/src/main.ts.',
      ]);

      expect(index.paths.has('libs/core/src/index.ts')).toBe(true);
      expect(index.paths.has('libs/core')).toBe(true);
      expect(index.paths.has('libs')).toBe(true);
      expect(index.paths.has('package.json')).toBe(true);
      // The root prefix is stripped, so the model may cite either form.
      expect(index.paths.has('apps/api/src/main.ts')).toBe(true);
    });

    it('skips empty sources and keeps prose out of the index', () => {
      const index = makeValidator().buildPathIndex('/workspace/app', [
        '',
        'Use the and/or form. Prefer OnPush.',
      ]);
      expect(index.paths.size).toBe(0);
    });
  });
});
