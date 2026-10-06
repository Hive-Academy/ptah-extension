/**
 * Batch 6 specs: the relevance PR and commit split, the file-tool questions
 * and the seeded memory set. No test here runs `gh` or `git`, touches the
 * real home, or downloads any model: the relevance PR and commit data is
 * injected, the file-tool generators run on a tiny `mkdtemp` corpus, and
 * `seedMemory` runs against an in-memory fake store target.
 */

import 'reflect-metadata';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ChunkInsert,
  MemoryId,
  MemoryInsert,
} from '@ptah-extension/memory-curator';
import {
  buildRelevanceQuestionFile,
  commitCandidateSchema,
  filterRelevantCommits,
  filterRelevantPullRequests,
  isEligibleSourcePath,
  mergedPullRequestSchema,
  relevanceQuestionFileSchema,
  splitByDate,
  type CommitCandidate,
  type MergedPullRequest,
  type RelevanceGitDeps,
} from './relevance-questions';
import {
  buildAstQuestions,
  buildFileToolsQuestionFile,
  buildGlobQuestions,
  buildTextQuestions,
  extractTopLevelDeclarations,
  fileToolsQuestionFileSchema,
} from './file-tool-questions';
import {
  buildMemoryQuestionFile,
  memoryQuestionFileSchema,
  seedMemory,
} from './memory-questions';

const ANCESTOR_SHA = 'ancestor-sha-1';
const ORPHAN_SHA = 'orphan-sha-9';
const MISSING_AT_PIN = 'src/deleted-at-pin.ts';

const deps: RelevanceGitDeps = {
  isAncestor: (sha: string): boolean => sha !== ORPHAN_SHA,
  fileExistsAtPin: (path: string): boolean => path !== MISSING_AT_PIN,
};

function pr(
  number: number,
  paths: readonly string[],
  mergedAt: string,
  sha: string = ANCESTOR_SHA,
): MergedPullRequest {
  return mergedPullRequestSchema.parse({
    number,
    title: `PR ${number}`,
    body: null,
    files: paths.map((path) => ({ path })),
    mergeCommit: { oid: sha },
    mergedAt,
  });
}

const dayIso = (dayOffset: number): string =>
  new Date(Date.UTC(2026, 0, 1 + dayOffset)).toISOString();

function eligiblePrs(count: number): MergedPullRequest[] {
  return Array.from({ length: count }, (_, index) =>
    pr(index + 1, [`src/file-${index + 1}.ts`], dayIso(index)),
  );
}

function commit(
  sha: string,
  subject: string,
  paths: readonly string[],
  committedAt: string,
): CommitCandidate {
  return commitCandidateSchema.parse({
    sha,
    subject,
    committedAt,
    files: paths,
  });
}

function eligibleCommits(count: number): CommitCandidate[] {
  return Array.from({ length: count }, (_, index) =>
    commit(
      (index + 1).toString(16).padStart(12, '0'),
      `commit ${index + 1}`,
      [`src/commit-${index + 1}.ts`],
      dayIso(1000 + index),
    ),
  );
}

describe('relevance questions', () => {
  it('keeps a PR on its eligible files and ignores its docs, spec and lockfile changes', () => {
    const candidates: MergedPullRequest[] = [
      pr(1, ['src/a.ts', 'src/b.ts'], dayIso(0)),
      pr(2, ['src/a.ts', 'package-lock.json', 'notes.md'], dayIso(1)),
      pr(3, ['docs/readme.md', 'notes.md'], dayIso(2)),
      pr(4, ['src/a.spec.ts'], dayIso(3)),
      pr(
        5,
        Array.from({ length: 9 }, (_, index) => `src/many-${index}.ts`),
        dayIso(4),
      ),
      pr(6, ['src/orphan.ts'], dayIso(5), ORPHAN_SHA),
      pr(7, ['src/a.ts', MISSING_AT_PIN], dayIso(6)),
      pr(8, ['src/kept.ts', 'gone.md'], dayIso(7)),
    ];
    const kept = filterRelevantPullRequests(candidates, deps);
    expect(kept.map((candidate) => candidate.id)).toEqual([
      'pr-1',
      'pr-2',
      'pr-8',
    ]);
    expect(kept[1]?.truthFiles).toEqual(['src/a.ts']);
    expect(kept[1]?.source).toBe('pr');
    expect(kept[1]?.query).toBe('PR 2');
    expect(kept[1]?.date).toBe(dayIso(1));
    expect(kept[2]?.truthFiles).toEqual(['src/kept.ts']);
  });

  it('recognises eligible source paths and rejects tests and lockfiles', () => {
    expect(isEligibleSourcePath('libs/a/src/service.ts')).toBe(true);
    expect(isEligibleSourcePath('libs/a/src/service.tsx')).toBe(true);
    expect(isEligibleSourcePath('libs/a/src/component.jsx')).toBe(true);
    expect(isEligibleSourcePath('libs/a/src/service.spec.ts')).toBe(false);
    expect(isEligibleSourcePath('libs/a/__tests__/helper.ts')).toBe(false);
    expect(isEligibleSourcePath('package-lock.json')).toBe(false);
    expect(isEligibleSourcePath('yarn.lock')).toBe(false);
    expect(isEligibleSourcePath('docs/readme.md')).toBe(false);
    expect(isEligibleSourcePath('libs/a/src/style.css')).toBe(false);
  });

  it('keeps qualifying commits and drops Merge subjects, PR merge commits and duplicate file sets', () => {
    const prCandidates = filterRelevantPullRequests(
      [
        pr(10, ['src/shared.ts'], dayIso(0), 'merge-sha-of-pr-10'),
        pr(11, ['src/other.ts'], dayIso(1)),
      ],
      deps,
    );
    const commits: CommitCandidate[] = [
      commit(
        'a1b2c3d4e5f6',
        'feat: standalone commit',
        ['src/commit.ts'],
        dayIso(2),
      ),
      commit(
        'b1b2c3d4e5f6',
        'Merge pull request #12 from feature',
        ['src/merge-subject.ts'],
        dayIso(3),
      ),
      commit(
        'merge-sha-of-pr-10',
        'feat: squashed PR 10',
        ['src/squash.ts'],
        dayIso(4),
      ),
      commit(
        'c1b2c3d4e5f6',
        'chore: same files as the PR',
        ['src/shared.ts'],
        dayIso(5),
      ),
      commit('d1b2c3d4e5f6', 'docs: notes only', ['docs/notes.md'], dayIso(6)),
      commit(
        'e1b2c3d4e5f6',
        'fix: too many files',
        Array.from({ length: 9 }, (_, index) => `src/many-${index}.ts`),
        dayIso(7),
      ),
      commit(
        'f1b2c3d4e5f6',
        'fix: missing at the pin',
        [MISSING_AT_PIN],
        dayIso(8),
      ),
    ];
    const kept = filterRelevantCommits(commits, prCandidates, deps);
    expect(kept.map((candidate) => candidate.id)).toEqual([
      'commit-a1b2c3d4e5f6',
    ]);
    expect(kept[0]?.truthFiles).toEqual(['src/commit.ts']);
    expect(kept[0]?.source).toBe('commit');
    expect(kept[0]?.mergeCommitSha).toBeNull();
  });

  it('merges PRs and commits into one date-ordered question set', () => {
    const result = buildRelevanceQuestionFile(
      [pr(1, ['src/a.ts'], dayIso(2))],
      [
        commit('older0000000', 'older commit', ['src/old.ts'], dayIso(1)),
        commit('newer0000000', 'newer commit', ['src/new.ts'], dayIso(3)),
      ],
      deps,
      { corpusCommit: '7910f34cf', frozenAt: dayIso(0) },
    );
    expect(result.deviation).toContain('3 questions qualified');
    expect(result.file.questions.map((question) => question.id)).toEqual([
      'commit-older0000000',
      'pr-1',
      'commit-newer0000000',
    ]);
    expect(result.file.questions.map((question) => question.source)).toEqual([
      'commit',
      'pr',
      'commit',
    ]);
    expect(result.file.counts).toEqual({
      test: 2,
      tune: 1,
      total: 3,
      pr: 1,
      commit: 2,
    });
  });

  it('keeps only the PR when a commit changes the identical file set', () => {
    const result = buildRelevanceQuestionFile(
      [pr(5, ['src/dup.ts', 'docs/dup.md'], dayIso(0))],
      [
        commit(
          'dup000000000',
          'chore: same change as the PR',
          ['src/dup.ts'],
          dayIso(1),
        ),
        commit(
          'other0000000',
          'feat: different change',
          ['src/other.ts'],
          dayIso(2),
        ),
      ],
      deps,
      { corpusCommit: '7910f34cf', frozenAt: dayIso(0) },
    );
    expect(result.file.questions.map((question) => question.id)).toEqual([
      'pr-5',
      'commit-other0000000',
    ]);
    expect(result.file.questions[0]?.truthFiles).toEqual(['src/dup.ts']);
  });

  it('splits the most recent 200 as test and the rest as tune', () => {
    const prCandidates = filterRelevantPullRequests(eligiblePrs(120), deps);
    const commitCandidates = filterRelevantCommits(
      eligibleCommits(130),
      prCandidates,
      deps,
    );
    const split = splitByDate([...prCandidates, ...commitCandidates]);
    expect(split.test).toHaveLength(200);
    expect(split.tune).toHaveLength(50);
    expect(split.deviation).toBeNull();
    const latestTune = split.tune[split.tune.length - 1];
    const earliestTest = split.test[0];
    expect(Date.parse(latestTune?.date ?? '')).toBeLessThan(
      Date.parse(earliestTest?.date ?? ''),
    );
  });

  it('falls back to the most recent half when fewer than 200 qualify', () => {
    const prCandidates = filterRelevantPullRequests(eligiblePrs(6), deps);
    const commitCandidates = filterRelevantCommits(
      eligibleCommits(4),
      prCandidates,
      deps,
    );
    const split = splitByDate([...prCandidates, ...commitCandidates]);
    expect(split.test).toHaveLength(5);
    expect(split.tune).toHaveLength(5);
    expect(split.deviation).toContain('10 questions qualified');
  });

  it('builds and validates a frozen question file with both sources counted', () => {
    const result = buildRelevanceQuestionFile(
      eligiblePrs(120),
      eligibleCommits(130),
      deps,
      { corpusCommit: '7910f34cf', frozenAt: dayIso(0) },
    );
    expect(result.keptCount).toBe(250);
    expect(result.deviation).toBeNull();
    expect(result.file.counts).toEqual({
      test: 200,
      tune: 50,
      total: 250,
      pr: 120,
      commit: 130,
    });
    const parsed = relevanceQuestionFileSchema.parse(result.file);
    expect(parsed.questions).toHaveLength(250);
    expect(new Set(parsed.questions.map((question) => question.split))).toEqual(
      new Set(['test', 'tune']),
    );
    expect(
      new Set(parsed.questions.map((question) => question.source)),
    ).toEqual(new Set(['pr', 'commit']));
    const firstPr = parsed.questions.find((question) => question.id === 'pr-1');
    expect(firstPr?.query).toBe('PR 1');
    expect(firstPr?.truthFiles).toEqual(['src/file-1.ts']);
    const firstCommit = parsed.questions.find(
      (question) => question.id === 'commit-000000000001',
    );
    expect(firstCommit?.query).toBe('commit 1');
    expect(firstCommit?.truthFiles).toEqual(['src/commit-1.ts']);
  });

  it('rejects a file whose pr and commit counts do not add up to the total', () => {
    const result = buildRelevanceQuestionFile(
      eligiblePrs(3),
      eligibleCommits(2),
      deps,
      { corpusCommit: '7910f34cf', frozenAt: dayIso(0) },
    );
    const broken = {
      ...result.file,
      counts: { ...result.file.counts, pr: result.file.counts.pr + 1 },
    };
    const check = relevanceQuestionFileSchema.safeParse(broken);
    expect(check.success).toBe(false);
    if (!check.success) {
      expect(
        check.error.issues.some((issue) =>
          issue.message.includes(
            'counts.pr + counts.commit must equal counts.total',
          ),
        ),
      ).toBe(true);
    }
  });

  it('normalises backslash paths in truth files', () => {
    const result = buildRelevanceQuestionFile(
      [pr(1, ['src\\win.ts'], dayIso(0))],
      [commit('win000000000', 'win commit', ['src\\win2.ts'], dayIso(1))],
      deps,
      { corpusCommit: '7910f34cf', frozenAt: dayIso(0) },
    );
    expect(result.file.questions[0]?.truthFiles).toEqual(['src/win.ts']);
    expect(result.file.questions[1]?.truthFiles).toEqual(['src/win2.ts']);
  });
});

describe('file-tool questions', () => {
  let corpusRoot: string;

  const alphaTs = [
    '// sample file',
    'export interface Shape {',
    '  id: number;',
    '}',
    "export type Kind = 'a' | 'b';",
    'export enum Mode { On, Off }',
    'const helperToken = 1;',
    'export function alphaFn(x: number): number {',
    '  return x + 1;',
    '}',
    'export class Alpha {',
    '  run(): void {',
    '    const omegaHandle = alphaFn(1);',
    '  }',
    '}',
    '',
  ].join('\n');

  const betaTs = [
    'const omegaHandle = 2;',
    'const kappaNode = 3;',
    'const kappaNodeAgain = kappaNode + omegaHandle;',
    '',
  ].join('\n');

  const notesMd = ['alphaFn appears in docs', ''].join('\n');

  const corpusFiles = (): string[] => [
    ...readdirSync(join(corpusRoot, 'src')).map((name) => `src/${name}`),
    'docs/notes.md',
  ];

  const corpusLines = (): Map<string, string[]> => {
    const lines = new Map<string, string[]>();
    for (const path of corpusFiles()) {
      lines.set(
        path,
        readFileSync(join(corpusRoot, path), 'utf8').split(/\r?\n/),
      );
    }
    return lines;
  };

  beforeAll(() => {
    corpusRoot = mkdtempSync(join(tmpdir(), 'b6-file-tools-'));
    mkdirSync(join(corpusRoot, 'src'), { recursive: true });
    mkdirSync(join(corpusRoot, 'docs'), { recursive: true });
    writeFileSync(join(corpusRoot, 'src', 'alpha.ts'), alphaTs);
    writeFileSync(join(corpusRoot, 'src', 'beta.ts'), betaTs);
    writeFileSync(join(corpusRoot, 'docs', 'notes.md'), notesMd);
  });

  it('extracts top-level declarations with lines', () => {
    const declarations = extractTopLevelDeclarations(alphaTs);
    expect(declarations).toEqual([
      { name: 'Shape', kind: 'interface', startLine: 2, endLine: 4 },
      { name: 'Kind', kind: 'type', startLine: 5, endLine: 5 },
      { name: 'Mode', kind: 'enum', startLine: 6, endLine: 6 },
      { name: 'helperToken', kind: 'variable', startLine: 7, endLine: 7 },
      { name: 'alphaFn', kind: 'function', startLine: 8, endLine: 10 },
      { name: 'Alpha', kind: 'class', startLine: 11, endLine: 15 },
    ]);
  });

  it('builds ast questions with stratum counts from a tiny corpus', () => {
    const result = buildAstQuestions(corpusRoot, { fileCount: 1 });
    expect(result.considered).toBe(2);
    expect(result.strataCounts).toEqual({ small: 1, medium: 0, large: 0 });
    const question = result.questions[0];
    expect(question?.file).toBe('src/alpha.ts');
    expect(question?.stratum).toBe('small');
    expect(question?.lineCount).toBe(alphaTs.split('\n').length);
    expect(question?.declarations.map((d) => d.name)).toContain('alphaFn');
  });

  it('builds glob questions with a zero-match pattern and picomatch truth', () => {
    const result = buildGlobQuestions(corpusRoot);
    expect(result.zeroMatchCount).toBeGreaterThan(0);
    const tsSweep = result.questions.find((q) => q.pattern === '**/*.ts');
    expect(tsSweep?.truth).toContain('src/alpha.ts');
    expect(tsSweep?.truth).toContain('src/beta.ts');
    expect(tsSweep?.truth).not.toContain('docs/notes.md');
    const zeroMatch = result.questions.find(
      (q) => q.pattern === '**/*.zzz-missing-ext',
    );
    expect(zeroMatch?.truth).toEqual([]);
  });

  it('builds literal text questions whose truth is the exact line set', () => {
    const result = buildTextQuestions(corpusRoot, { literalCount: 2 });
    const literal = result.questions.filter((q) => q.kind === 'text-literal');
    expect(literal).toHaveLength(2);
    const lines = corpusLines();
    for (const question of literal) {
      const expected: string[] = [];
      for (const [path, fileLines] of lines) {
        fileLines.forEach((line, index) => {
          if (line.includes(question.query))
            expected.push(`${path}:${index + 1}`);
        });
      }
      expect(new Set(question.truth)).toEqual(new Set(expected.sort()));
      expect(question.truth.length).toBeGreaterThan(0);
    }
  });

  it('builds regex text questions whose truth matches the compiled pattern', () => {
    const result = buildTextQuestions(corpusRoot, {
      literalCount: 2,
      regexCount: 2,
    });
    const regexQuestions = result.questions.filter(
      (q) => q.kind === 'text-regex',
    );
    expect(regexQuestions).toHaveLength(2);
    const lines = corpusLines();
    for (const question of regexQuestions) {
      const regex = new RegExp(question.query);
      const expected: string[] = [];
      for (const [path, fileLines] of lines) {
        fileLines.forEach((line, index) => {
          if (regex.test(line)) expected.push(`${path}:${index + 1}`);
        });
      }
      expect(new Set(question.truth)).toEqual(new Set(expected.sort()));
    }
  });

  it('validates a built file-tools envelope through its schema', () => {
    const file = buildFileToolsQuestionFile(corpusRoot, {
      corpusCommit: '7910f34cf',
      frozenAt: dayIso(0),
      astCount: 1,
      textLiteralCount: 2,
      textRegexCount: 2,
    });
    const parsed = fileToolsQuestionFileSchema.parse(file);
    expect(parsed.counts.total).toBe(parsed.questions.length);
    expect(parsed.counts.globZeroMatch).toBeGreaterThan(0);
  });
});

describe('memory questions', () => {
  const { set, file } = buildMemoryQuestionFile({
    corpusCommit: '7910f34cf',
    frozenAt: '2026-10-07T00:00:00.000Z',
  });

  it('produces the required fact and question counts', () => {
    expect(set.counts).toEqual({
      facts: 150,
      rows: 300,
      verbatim: 150,
      paraphrase: 300,
      worktree: 15,
      abstention: 20,
      labelled: 4,
      total: 489,
    });
    expect(set.facts).toHaveLength(150);
    expect(set.questions).toHaveLength(489);
  });

  it('validates the frozen envelope through its schema', () => {
    const parsed = memoryQuestionFileSchema.parse(file);
    expect(parsed.counts.total).toBe(489);
    expect(parsed.method).toBe('seeded');
  });

  it('keeps every paraphrase lexically divergent from its verbatim query', () => {
    const words = (text: string): Set<string> =>
      new Set(
        text
          .toLowerCase()
          .split(/\s+/)
          .filter((word) => word.length > 0),
      );
    for (const fact of set.facts) {
      const verbatim = set.questions.find((q) => q.id === `${fact.id}-v`);
      const p1 = set.questions.find((q) => q.id === `${fact.id}-p1`);
      const p2 = set.questions.find((q) => q.id === `${fact.id}-p2`);
      expect(verbatim).toBeDefined();
      expect(p1?.query).not.toBe(verbatim?.query);
      expect(p2?.query).not.toBe(verbatim?.query);
      expect(p1?.query).not.toBe(p2?.query);
      const verbatimWords = words(verbatim?.query ?? '');
      for (const paraphrase of [p1?.query ?? '', p2?.query ?? '']) {
        const shared = [...words(paraphrase)].filter((word) =>
          verbatimWords.has(word),
        ).length;
        expect(shared / verbatimWords.size).toBeLessThanOrEqual(0.6);
      }
    }
  });

  it('expects only the newer value of every temporal pair', () => {
    for (const fact of set.facts) {
      for (const suffix of ['-v', '-p1', '-p2']) {
        const question = set.questions.find(
          (q) => q.id === `${fact.id}${suffix}`,
        );
        expect(question?.expectedFactIds).toEqual([`${fact.id}-new`]);
        expect(question?.expectedLeakCount).toBe(0);
      }
    }
  });

  it('shares subjects across roots with different values, so a leak is detectable', () => {
    const bySubject = new Map<string, typeof set.facts>();
    for (const fact of set.facts) {
      bySubject.set(fact.subject, [
        ...(bySubject.get(fact.subject) ?? []),
        fact,
      ]);
    }
    expect(bySubject.size).toBe(75);
    for (const facts of bySubject.values()) {
      expect(facts).toHaveLength(2);
      const [a, b] = facts as [
        (typeof set.facts)[number],
        (typeof set.facts)[number],
      ];
      const aNew = a.rows.find((row) => row.age === 'new');
      const bNew = b.rows.find((row) => row.age === 'new');
      expect(aNew?.content).not.toBe(bNew?.content);
    }
    // A B-scoped query never expects an A fact and vice versa.
    for (const question of set.questions) {
      if (question.expectedFactIds.length === 0) continue;
      const fact = set.facts.find((candidate) =>
        question.expectedFactIds.includes(`${candidate.id}-new`),
      );
      expect(fact).toBeDefined();
      if (question.scope === '<rootB>') {
        expect(fact?.root).toBe('B');
      } else {
        expect(fact?.root).toBe('A');
      }
    }
  });

  it('expects A facts for worktree-scoped queries', () => {
    const worktree = set.questions.filter((q) => q.id.startsWith('wt-'));
    expect(worktree).toHaveLength(15);
    for (const question of worktree) {
      const fact = set.facts.find((candidate) =>
        question.expectedFactIds.includes(`${candidate.id}-new`),
      );
      expect(fact?.root).toBe('A');
    }
  });

  it('marks abstention queries with an empty expectation', () => {
    const abstention = set.questions.filter((q) => q.abstain === true);
    expect(abstention).toHaveLength(20);
    for (const question of abstention) {
      expect(question.expectedFactIds).toEqual([]);
      expect(question.expectedLeakCount).toBe(0);
    }
  });

  it('keeps the track-A queries as unscorable labelled questions', () => {
    const labelled = set.questions.filter((q) => q.method === 'labelled');
    expect(labelled).toHaveLength(4);
    for (const question of labelled) {
      expect(question.raterCount).toBe(1);
      expect(question.scorable).toBe(false);
      expect(question.unscorableReason).toContain('cannot be seeded');
    }
  });

  it('seeds facts through the store API, old before new, mapped to real roots', async () => {
    const calls: {
      insert: MemoryInsert;
      chunks: readonly Omit<ChunkInsert, 'memoryId'>[];
    }[] = [];
    let next = 0;
    const returned = new Map<string, MemoryId>();
    const target = {
      insertMemoryWithChunks: async (
        insert: MemoryInsert,
        chunks: readonly Omit<ChunkInsert, 'memoryId'>[],
      ): Promise<MemoryId> => {
        calls.push({ insert, chunks });
        next++;
        const id = `mid-${next}` as MemoryId;
        returned.set(`mid-${next}`, id);
        return id;
      },
    };
    const roots = {
      rootA: 'D:/workspaces/root-a',
      rootB: 'D:/workspaces/root-b',
      worktreeOfA: 'D:/workspaces/root-a/.claude-worktrees/wt',
    };
    const insertedIds = await seedMemory(target, set, roots);
    expect(calls).toHaveLength(300);
    expect(insertedIds.size).toBe(300);
    set.facts.forEach((fact, index) => {
      const oldCall = calls[index * 2];
      const newCall = calls[index * 2 + 1];
      const expectedRoot = fact.root === 'A' ? roots.rootA : roots.rootB;
      expect(oldCall?.insert.content).toBe(fact.rows[0]?.content);
      expect(newCall?.insert.content).toBe(fact.rows[1]?.content);
      for (const call of [oldCall, newCall]) {
        expect(call?.insert.workspaceRoot).toBe(expectedRoot);
        expect(call?.insert.subject).toBe(fact.subject);
        expect(call?.insert.kind).toBe(fact.kind);
        expect(call?.insert.tier).toBe(fact.tier);
        expect(call?.chunks[0]?.tokenCount).toBeGreaterThan(0);
      }
      expect(oldCall?.chunks[0]?.text).toBe(fact.rows[0]?.content);
      expect(insertedIds.get(`${fact.id}-old`)).toBe(
        returned.get(`mid-${index * 2 + 1}`),
      );
      expect(insertedIds.get(`${fact.id}-new`)).toBe(
        returned.get(`mid-${index * 2 + 2}`),
      );
    });
  });
});
