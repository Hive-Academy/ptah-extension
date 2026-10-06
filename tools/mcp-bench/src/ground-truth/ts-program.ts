import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

export interface CorpusTsProgram {
  readonly root: string;
  readonly files: readonly string[];
  readonly program: ts.Program;
  readonly languageService: ts.LanguageService;
  readonly unresolvedExternalModules: number;
  readonly memory: { readonly heapUsed: number; readonly rss: number };
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);

/** A deterministic PRNG shared by the compiler-ground-truth generators. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function workspacePath(root: string, fileName: string): string {
  return relative(root, fileName).split(sep).join('/');
}

export function isCorpusFile(root: string, fileName: string): boolean {
  const normalizedRoot = resolve(root).replace(/\\/g, '/').toLowerCase();
  const normalizedFile = resolve(fileName).replace(/\\/g, '/').toLowerCase();
  return (
    normalizedFile === normalizedRoot ||
    normalizedFile.startsWith(`${normalizedRoot}/`)
  );
}

export function isTestFile(fileName: string): boolean {
  const normal = fileName.replace(/\\/g, '/');
  return /\.(spec|test)\.tsx?$/.test(normal) || normal.includes('/__tests__/');
}

export function loadCorpusTsProgram(corpusRoot: string): CorpusTsProgram {
  const root = resolve(corpusRoot);
  const configPath = join(root, 'tsconfig.base.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error !== undefined)
    throw new Error(
      ts.flattenDiagnosticMessageText(config.error.messageText, '\n'),
    );
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    root,
    undefined,
    configPath,
  );
  const files = eligibleFiles(root);
  const versions = new Map(files.map((file) => [file, '0']));
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => parsed.options,
    getScriptFileNames: () => files,
    getScriptVersion: (fileName) => versions.get(fileName) ?? '0',
    getScriptSnapshot: (fileName) => {
      if (!existsSync(fileName)) return undefined;
      return ts.ScriptSnapshot.fromString(readFileSync(fileName, 'utf8'));
    },
    getCurrentDirectory: () => root,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    realpath: ts.sys.realpath,
  };
  const languageService = ts.createLanguageService(
    host,
    ts.createDocumentRegistry(),
  );
  const program = languageService.getProgram();
  if (program === undefined)
    throw new Error('TypeScript language service did not create a program');
  const unresolvedExternalModules = program
    .getSemanticDiagnostics()
    .filter((diagnostic) => diagnostic.code === 2307).length;
  const usage = process.memoryUsage();
  return {
    root,
    files,
    program,
    languageService,
    unresolvedExternalModules,
    memory: { heapUsed: usage.heapUsed, rss: usage.rss },
  };
}

function eligibleFiles(root: string): string[] {
  const files: string[] = [];
  for (const top of ['libs', 'apps', 'tools']) {
    const directory = join(root, top);
    if (existsSync(directory)) collect(directory, files);
  }
  return files.sort();
}

function collect(directory: string, files: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const fileName = join(directory, entry.name);
    if (entry.isDirectory()) collect(fileName, files);
    else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(fileName)))
      files.push(fileName);
  }
}
