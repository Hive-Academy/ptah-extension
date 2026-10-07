/**
 * `generate`: regenerates the frozen question files from the existing
 * generators (Batches 5-7). `ts` and `file-tools` check out the pinned corpus;
 * `memory` needs nothing; `relevance` needs `gh` and the network, so it runs
 * only when asked; a SCIP file is written only from an index passed with
 * `--scip-index` (the indexers are not run here).
 */

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { z } from 'zod';

import { benchProjectRoot, readPolyglotConfig } from './bench-hosts';
import { readCorpusConfig, withPinnedCorpus } from './corpus/corpus';
import { buildFileToolsQuestionFile } from './ground-truth/file-tool-questions';
import {
  generateGraphQuestions,
  writeGraphQuestions,
} from './ground-truth/graph-questions';
import { buildMemoryQuestionFile } from './ground-truth/memory-questions';
import { generateRelevanceQuestionFile } from './ground-truth/relevance-questions';
import {
  generatePolyglotQuestions,
  parseScipIndex,
  writePolyglotQuestions,
} from './ground-truth/scip-cross-check';
import {
  generateSymbolQuestions,
  writeSymbolQuestions,
} from './ground-truth/symbol-questions';
import { loadCorpusTsProgram } from './ground-truth/ts-program';

export const generateOptionsSchema = z.object({
  only: z.string().min(1).default('ts,file-tools,memory'),
  out: z.string().min(1).optional(),
  'scip-index': z
    .array(z.string().regex(/^[\w-]+=.+$/, 'expected <corpusId>=<path>'))
    .default([]),
});
export type GenerateOptions = z.infer<typeof generateOptionsSchema>;

export async function runGenerate(
  options: GenerateOptions,
  log: (line: string) => void,
): Promise<number> {
  const root = benchProjectRoot();
  const configPath = join(root, 'corpus.config.json');
  const config = await readCorpusConfig(configPath);
  const only = new Set(options.only.split(',').map((item) => item.trim()));
  const known = new Set(['ts', 'file-tools', 'memory', 'relevance']);
  for (const item of only)
    if (!known.has(item))
      throw new Error(
        `--only: unknown generator ${item} (known: ${[...known].join(', ')})`,
      );
  const outDir = options.out
    ? resolve(options.out)
    : join(root, 'questions', config.commit);
  const frozenAt = new Date().toISOString();
  const write = async (name: string, value: unknown): Promise<void> => {
    await mkdir(outDir, { recursive: true });
    await writeFile(
      join(outDir, `${name}.json`),
      `${JSON.stringify(value, null, 2)}\n`,
      'utf8',
    );
    log(`[generate] wrote ${join(outDir, `${name}.json`)}`);
  };
  if (only.has('memory'))
    await write(
      'memory',
      buildMemoryQuestionFile({ corpusCommit: config.commit, frozenAt }).file,
    );
  if (only.has('relevance')) {
    const generated = generateRelevanceQuestionFile(
      resolve(root, config.repository),
      config.commit,
      frozenAt,
    );
    if (generated.deviation !== null)
      log(`[generate] relevance deviation: ${generated.deviation}`);
    await write('relevance', generated.file);
  }
  if (only.has('ts') || only.has('file-tools')) {
    await withPinnedCorpus(configPath, async (corpus) => {
      if (only.has('file-tools'))
        await write(
          'file-tools',
          buildFileToolsQuestionFile(corpus.path, {
            corpusCommit: config.commit,
            frozenAt,
          }),
        );
      if (only.has('ts')) {
        const program = loadCorpusTsProgram(corpus.path);
        log(
          `[generate] TS program: ${program.files.length} files, heap ${Math.round(program.memory.heapUsed / 1e6)} MB`,
        );
        writeSymbolQuestions(
          outDir,
          generateSymbolQuestions(program, frozenAt),
        );
        writeGraphQuestions(outDir, generateGraphQuestions(program, frozenAt));
        log(
          `[generate] wrote symbols-*.json, references.json, definitions.json, dependents.json in ${outDir}`,
        );
      }
    });
  }
  const polyglot = await readPolyglotConfig(configPath);
  for (const item of options['scip-index']) {
    const [corpusId, indexPath] = item.split(/=(.*)/s, 2);
    const entry = polyglot.find((candidate) => candidate.id === corpusId);
    if (entry === undefined)
      throw new Error(
        `--scip-index: ${corpusId} is not a polyglot corpus of corpus.config.json`,
      );
    const scipDir = join(root, 'questions', 'scip');
    const existing = join(scipDir, `${corpusId}.json`);
    const seed = existsSync(existing)
      ? (JSON.parse(readFileSync(existing, 'utf8')) as { seed?: unknown }).seed
      : undefined;
    if (typeof seed !== 'number')
      throw new Error(
        `--scip-index: ${existing} names no seed to regenerate with`,
      );
    const envelope = generatePolyglotQuestions(
      parseScipIndex(readFileSync(resolve(indexPath))),
      {
        corpusId,
        corpusCommit: entry.commit,
        language: entry.language,
        frozenAt,
        seed,
      },
    );
    writePolyglotQuestions(scipDir, corpusId, envelope);
    log(`[generate] wrote ${existing}`);
  }
  return 0;
}
