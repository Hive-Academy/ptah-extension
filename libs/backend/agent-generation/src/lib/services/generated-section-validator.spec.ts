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
