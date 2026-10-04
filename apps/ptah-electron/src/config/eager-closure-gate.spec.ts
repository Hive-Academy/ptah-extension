import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describeIfBuiltOrFail } from './build-artifact-gate';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const STATS_PATH = join(
  REPO_ROOT,
  'dist',
  'apps',
  'ptah-extension-webview',
  'stats.json',
);
const GATE_PATH = join(REPO_ROOT, 'scripts', 'eager-closure-gate.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const eagerClosureGate = require(GATE_PATH) as {
  assertNoForbiddenEager(stats: ChunkStats): void;
};

interface ChunkStats {
  outputs: Record<
    string,
    {
      bytes?: number;
      inputs?: Record<string, unknown>;
      imports?: { path: string; kind: string }[];
    }
  >;
}

function stats(outputs: ChunkStats['outputs']): ChunkStats {
  return { outputs };
}

describe('eager-closure bundle gate', () => {
  it('throws when stats do not contain main.js', () => {
    expect(() =>
      eagerClosureGate.assertNoForbiddenEager(
        stats({
          'renamed-entry.js': { inputs: {} },
        }),
      ),
    ).toThrow('missing required main.js entry');
  });

  it('throws for a forbidden input in main.js', () => {
    expect(() =>
      eagerClosureGate.assertNoForbiddenEager(
        stats({
          'main.js': {
            inputs: {
              'libs/frontend/declarative-dashboard/src/lib/fence.ts': {},
            },
          },
        }),
      ),
    ).toThrow('forbidden eager input');
  });

  it('throws for a forbidden input in a statically imported chunk', () => {
    expect(() =>
      eagerClosureGate.assertNoForbiddenEager(
        stats({
          'main.js': {
            imports: [{ path: 'chunk.js', kind: 'import-statement' }],
          },
          'chunk.js': {
            inputs: {
              'libs/shared/src/mcp-apps-contracts/ptah-ui-parser.ts': {},
            },
          },
        }),
      ),
    ).toThrow('mcp-apps-contracts');
  });

  it('allows a forbidden input reached only through a dynamic import', () => {
    expect(() =>
      eagerClosureGate.assertNoForbiddenEager(
        stats({
          'main.js': {
            imports: [{ path: 'lazy.js', kind: 'dynamic-import' }],
          },
          'lazy.js': {
            inputs: {
              'libs/frontend/chat-ui/src/ptah-ui.ts': {},
            },
          },
        }),
      ),
    ).not.toThrow();
  });

  it('throws for unlisted eager growth when invoked with --base', () => {
    const directory = mkdtempSync(join(tmpdir(), 'eager-closure-gate-'));
    const basePath = join(directory, 'base-stats.json');
    const headPath = join(directory, 'head-stats.json');
    try {
      writeFileSync(
        basePath,
        JSON.stringify(stats({ 'main.js': { inputs: {} } })),
      );
      writeFileSync(
        headPath,
        JSON.stringify(
          stats({
            'main.js': {
              inputs: { 'libs/frontend/chat/src/lib/new-eager.ts': {} },
            },
          }),
        ),
      );
      expect(() =>
        execFileSync(
          process.execPath,
          [GATE_PATH, headPath, '--base', basePath],
          {
            encoding: 'utf8',
            stdio: 'pipe',
          },
        ),
      ).toThrow('unlisted eager input growth');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describeIfBuiltOrFail(
  STATS_PATH,
  'npx nx build ptah-extension-webview --configuration=production --skip-nx-cache --stats-json',
)('eager-closure production build gate', () => {
  it('has no forbidden eager input', () => {
    const builtStats = JSON.parse(
      readFileSync(STATS_PATH, 'utf8'),
    ) as ChunkStats;
    expect(() =>
      eagerClosureGate.assertNoForbiddenEager(builtStats),
    ).not.toThrow();
  });
});
