import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const GATE_PATH = join(REPO_ROOT, 'scripts', 'eager-closure-gate.js');
const eagerClosureGate = require(GATE_PATH) as {
  assertNoForbiddenEager(stats: ChunkStats): void;
  assertNoUnlistedEagerGrowth(head: ChunkStats, base: ChunkStats): void;
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

  it.each([
    'libs/shared/src/mcp-apps-contracts/ptah-ui-agents-source.ts',
    'libs/frontend/chat-ui/src/display-panel.ts',
    'libs/frontend/chat-ui/src/lib/organisms/display-panel/display-panel.component.ts',
  ])('fails closed when eager main.js lists %s', (input) => {
    expect(() =>
      eagerClosureGate.assertNoForbiddenEager(
        stats({ 'main.js': { inputs: { [input]: {} } } }),
      ),
    ).toThrow(`forbidden eager input(s): ${input}`);
  });

  it('passes an eager main.js that lists ptah-ui-display-dock.ts and no display-panel input', () => {
    const head = stats({
      'main.js': {
        inputs: {
          'libs/frontend/chat-ui/src/lib/services/ptah-ui-display-dock.ts': {},
        },
        imports: [{ path: 'display-panel.js', kind: 'dynamic-import' }],
      },
      'display-panel.js': {
        inputs: {
          'libs/frontend/chat-ui/src/lib/organisms/display-panel/display-surfaces.ts':
            {},
        },
      },
    });
    expect(() => eagerClosureGate.assertNoForbiddenEager(head)).not.toThrow();
    expect(() =>
      eagerClosureGate.assertNoUnlistedEagerGrowth(
        head,
        stats({ 'main.js': { inputs: {} } }),
      ),
    ).not.toThrow();
  });

  it.each([
    'libs/frontend/chat/src/lib/components/organisms/transcript/transcript-display-candidates.ts',
    'libs/frontend/chat/src/lib/components/organisms/transcript/transcript-agent-facts.ts',
    'libs/frontend/chat/src/lib/components/organisms/transcript/transcript-ptah-ui-host-sources.ts',
    'libs/frontend/chat/src/lib/components/organisms/transcript/transcript-display-feed.ts',
    'libs/frontend/chat/src/lib/components/organisms/transcript/transcript-turn-summaries.ts',
    'libs/frontend/chat/src/lib/components/organisms/transcript/transcript-turn-recap-loader.ts',
    'libs/frontend/chat/src/lib/services/display-dock/display-dock.state.ts',
    'libs/frontend/chat/src/lib/services/display-window/display-window-sync.service.ts',
    'libs/frontend/chat/src/lib/services/display-window/display-window-wire.ts',
    'libs/frontend/chat/src/lib/components/templates/display-sidebar-wiring.ts',
    'libs/frontend/chat/src/lib/components/organisms/transcript/transcript-turn-artifacts.ts',
    'libs/frontend/chat/src/lib/services/artifacts/published-artifact.ts',
    'libs/shared/src/lib/types/rpc/rpc-display-window.types.ts',
    'libs/frontend/chat/src/lib/components/organisms/display-sheet/display-sheet.component.ts',
    'libs/frontend/chat-ui/src/lib/services/ptah-ui-host-sources.ts',
    'libs/frontend/chat-ui/src/lib/services/ptah-ui-display-dock.ts',
    'libs/frontend/chat-ui/src/lib/atoms/copy-text-button.component.ts',
    'libs/frontend/chat-ui/src/lib/utils/tool-language.utils.ts',
  ])('allows listed eager growth input %s', (input) => {
    const head = stats({ 'main.js': { inputs: { [input]: {} } } });
    expect(() => eagerClosureGate.assertNoForbiddenEager(head)).not.toThrow();
    expect(() =>
      eagerClosureGate.assertNoUnlistedEagerGrowth(
        head,
        stats({ 'main.js': { inputs: {} } }),
      ),
    ).not.toThrow();
  });

  it('does not allow a display-panel input as eager growth', () => {
    const input =
      'libs/frontend/chat-ui/src/lib/organisms/display-panel/display-surfaces.ts';
    expect(() =>
      eagerClosureGate.assertNoUnlistedEagerGrowth(
        stats({ 'main.js': { inputs: { [input]: {} } } }),
        stats({ 'main.js': { inputs: {} } }),
      ),
    ).toThrow(`unlisted eager input growth: ${input}`);
  });

  it('does not allow the detached Display window component as eager growth', () => {
    const input =
      'libs/frontend/chat/src/lib/components/templates/display-window/display-window.component.ts';
    expect(() =>
      eagerClosureGate.assertNoUnlistedEagerGrowth(
        stats({ 'main.js': { inputs: { [input]: {} } } }),
        stats({ 'main.js': { inputs: {} } }),
      ),
    ).toThrow(`unlisted eager input growth: ${input}`);
  });

  it('does not allow an unlisted sibling of the allowed atoms as eager growth', () => {
    const input = 'libs/frontend/chat-ui/src/lib/atoms/other-new.component.ts';
    expect(() =>
      eagerClosureGate.assertNoUnlistedEagerGrowth(
        stats({ 'main.js': { inputs: { [input]: {} } } }),
        stats({ 'main.js': { inputs: {} } }),
      ),
    ).toThrow(`unlisted eager input growth: ${input}`);
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
