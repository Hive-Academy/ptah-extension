/**
 * The agent-facing strings must not name a vendor as available (TASK_2026_233).
 *
 * ## Why this is a test and not a review note
 *
 * The set of AI CLI vendors is discovered at runtime, never written down.
 * Adapters ship between releases and every user configures a different provider
 * set — this very workspace has no codex and no copilot, while it does have a
 * Claude (Subscription) lane, and both of the missing two appeared in nearly
 * every hardcoded list in the codebase. A roster baked into a tool description
 * is therefore wrong on somebody's install, and unlike a stale comment it is
 * read by every agent BEFORE it picks a lane, where it reads as authoritative.
 *
 * `5cdb14d89` swept the tribunal and orchestration skills for exactly this and
 * had nothing to stop it coming back. These assertions are that stop.
 *
 * ## The rule being pinned
 *
 * An illustration marked as an illustration is fine; an assertion that drives
 * selection is not. So:
 *
 *  - the SYSTEM CLI family may be enumerated, because `SYSTEM_CLI_TYPES` is the
 *    single source of truth and the enumerations here are interpolated FROM it
 *    — they cannot drift from the spawn enum. That is asserted positively.
 *  - the PTAH CLI family may never be enumerated, because it is user data. No
 *    provider brand may appear in an agent-facing string at all.
 */
// `@ptah-extension/agent-sdk`'s barrel reaches tsyringe decorators on import.
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { SYSTEM_CLI_TYPES } from '@ptah-extension/shared';
import { PTAH_CORE_SYSTEM_PROMPT } from '@ptah-extension/agent-sdk';
import { PTAH_SYSTEM_PROMPT } from './ptah-system-prompt.constant';
import { HELP_DOCS } from './namespace-builders/system-namespace.builders';
import {
  buildAgentSpawnTool,
  buildAgentStatusTool,
} from './mcp-core/tool-description.builder';
import { formatAgentList } from './mcp-core/mcp-response-formatter';

/**
 * Provider and vendor brands that must not appear. Assembled from the two
 * families that were actually found hardcoded: the Ptah CLI providers in
 * `AnthropicProviderId`, and the two system CLIs whose brand names had spread
 * furthest past the generated enum.
 */
const BANNED_BRANDS = [
  'OpenRouter',
  'Moonshot',
  'Kimi',
  'Z.AI',
  'GLM',
  'Ollama',
  'LM Studio',
  'Sakana',
  'Codex',
  'Copilot',
  'Cursor Agent',
];

/** Every string an agent reads before choosing where to delegate. */
function agentFacingStrings(): ReadonlyArray<readonly [string, string]> {
  const spawn = buildAgentSpawnTool();
  const properties = spawn.inputSchema.properties as Record<
    string,
    { description?: string }
  >;
  return [
    ['PTAH_SYSTEM_PROMPT', PTAH_SYSTEM_PROMPT],
    // The one that is actually appended to every top-level `query()`. It was
    // absent from this list while it hardcoded a three-vendor roster AND a
    // priority order — the exact assertion the suite was written to stop, in the
    // string with the widest reach.
    ['PTAH_CORE_SYSTEM_PROMPT', PTAH_CORE_SYSTEM_PROMPT],
    ['HELP_DOCS.agent', HELP_DOCS['agent']],
    ['ptah_agent_spawn description', spawn.description],
    ['ptah_agent_status description', buildAgentStatusTool().description],
    ...Object.entries(properties).map(
      ([name, schema]) =>
        [`ptah_agent_spawn.${name}`, schema.description ?? ''] as const,
    ),
    ['formatAgentList (empty)', formatAgentList([])],
  ];
}

describe('agent-facing strings name no vendor as available', () => {
  it.each(agentFacingStrings())(
    '%s names no provider brand',
    (_label, text) => {
      const found = BANNED_BRANDS.filter((brand) => text.includes(brand));
      expect(found).toEqual([]);
    },
  );

  /**
   * Guards the interpolation itself: the derived list must have been evaluated,
   * not pasted into a plain string where it renders as its own source. Matched
   * on the expression rather than on a bare `${`, because the system prompt
   * carries TypeScript code samples with deliberately escaped interpolations.
   */
  it.each(agentFacingStrings())('%s evaluated its derived lists', (_l, text) =>
    expect(text).not.toContain('${SYSTEM_CLI_TYPES'),
  );
});

describe('the system CLI family is derived, not written down', () => {
  it('spawn advertises exactly the adapters SYSTEM_CLI_TYPES ships', () => {
    const description = buildAgentSpawnTool().description;
    for (const cli of SYSTEM_CLI_TYPES) {
      expect(description).toContain(cli);
    }
  });

  it('the spawn enum stays the source the description was built from', () => {
    const cli = (
      buildAgentSpawnTool().inputSchema.properties as Record<
        string,
        { enum?: string[] }
      >
    )['cli'];
    expect(cli.enum).toEqual([...SYSTEM_CLI_TYPES]);
  });

  it('the system prompt lists every shipped adapter', () => {
    for (const cli of SYSTEM_CLI_TYPES) {
      expect(PTAH_SYSTEM_PROMPT).toContain(cli);
    }
  });

  /**
   * Both families must point the agent at discovery rather than at a list. The
   * spawn description is the one an agent reads at the moment of choosing.
   */
  it('spawn sends the agent to ptah_agent_list', () => {
    expect(buildAgentSpawnTool().description).toContain('ptah_agent_list');
  });
});

/**
 * F2. `ptah_agent_status` emits `CLI Session ID` when the adapter reports one
 * (see `formatAgentStatus`), and both skills decide resume-vs-respawn on its
 * presence. The description omitted it, and a reviewer reading only the
 * description concluded every resume path in both skills was dead code.
 */
describe('ptah_agent_status documents the field resume depends on', () => {
  it('names the CLI Session ID and what it is for', () => {
    const description = buildAgentStatusTool().description;
    expect(description).toContain('CLI Session ID');
    expect(description).toContain('resume_session_id');
  });
});

/**
 * The injected core prompt used to close its delegation section with
 * `Priority: ptah-cli > codex > copilot` and a hand-paste instruction telling
 * the orchestrator to copy a delegation paragraph into every subagent prompt.
 * Both are gone: the roster is discovered, and the delegation rules reach
 * subagents through the `_shared/cli-delegation.md` template partial.
 */
describe('the injected core prompt sends the agent to discovery', () => {
  it('names ptah_agent_list where it used to name a roster', () => {
    expect(PTAH_CORE_SYSTEM_PROMPT).toContain('ptah_agent_list');
  });

  it('no longer asks the orchestrator to hand-paste delegation text', () => {
    // The instruction was a request to the MODEL to copy a paragraph by hand,
    // and nothing verified it happened. Composition belongs in the templates.
    expect(PTAH_CORE_SYSTEM_PROMPT).not.toContain('ALWAYS inject');
  });
});

// ---------------------------------------------------------------------------
// Asset trees — the corpus that was outside every guard
// ---------------------------------------------------------------------------

/**
 * The two markdown corpora an agent reads as instructions: the subagent
 * templates and the bundled plugin skills. Neither was scanned by anything, and
 * both accumulated the same class of assertion the constants above are guarded
 * against — a per-machine fact written down as if it were true everywhere.
 */
function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, 'nx.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate the Nx workspace root from ' + __dirname);
}

const REPO_ROOT = findRepoRoot();

const ASSET_ROOTS = [
  'libs/backend/agent-generation/templates/agents',
  'apps/ptah-extension-vscode/assets/plugins',
] as const;

function walkMarkdown(dir: string): string[] {
  const found: string[] = [];
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walkMarkdown(full));
    else if (entry.name.endsWith('.md')) {
      found.push(path.relative(REPO_ROOT, full).split(path.sep).join('/'));
    }
  }
  return found;
}

function assetMarkdownFiles(): string[] {
  return ASSET_ROOTS.flatMap((rel) => walkMarkdown(path.join(REPO_ROOT, rel)));
}

/** Vendor tokens, as they are written in prose. */
const VENDOR_TOKEN = String.raw`(?:codex|copilot|cursor|antigravity|opencode|ptah-cli)`;

/**
 * A priority order over vendors. There is no correct form of this sentence.
 *
 * It asserts BOTH which lanes exist and which is better, and both are the
 * caller's to read out of `ptah_agent_list` at the moment of choosing. This is
 * the shape that was live in the injected core prompt (`Priority: ptah-cli >
 * codex > copilot`) until it was replaced with a discovery instruction.
 */
const PRIORITY_CLAIM = new RegExp(
  String.raw`Priority:\s*\`?${VENDOR_TOKEN}\`?\s*>`,
  'i',
);

/**
 * A row of pasted `ptah_agent_list` output: a table whose third cell is a
 * status word.
 *
 * ## Why this shape and not a prose scan
 *
 * The first version of this guard matched any vendor name within 30 characters
 * of an install-state word. It found eight lines and SIX were correct writing:
 * `relay.md:73` and `cli-agent-delegation.md:86` teach the reader how to
 * interpret the Status column, and `agent-cli.md:34-40` exists specifically to
 * record that an earlier claim about `copilot` and `cursor` being
 * Windows-blocked was FALSE. A guard that flags the retraction of a false claim
 * alongside the claim is noise, and a noisy guard gets deleted — which costs
 * more than the drift it was catching.
 *
 * What has no legitimate un-marked form is a captured roster: one machine's
 * answer, at one moment, pasted in as if it were everyone's.
 *
 * The TYPE cell is what makes the match unambiguous. Matching a status word in
 * the third column alone also hit `tribunal/SKILL.md`'s reference index, whose
 * third column says `Available` about a documentation file. `cli` / `ptah-cli`
 * in column two is the `ptah_agent_list` shape and nothing else's.
 */
const ROSTER_TABLE_ROW =
  /^\s*\|[^|]*\|\s*`?(?:cli|ptah-cli)`?\s*\|\s*`?(?:not installed|installed|unavailable|available|disabled)\b[^|]*\|/i;

/**
 * Wording that marks a pasted roster as one machine's output.
 *
 * The rule this encodes is the suite's own: an illustration marked as an
 * illustration is fine; an assertion that drives selection is not. So paste a
 * sample if you must — and say, within ten lines, that the reader's will
 * differ.
 */
const SAMPLE_DISCLAIMER =
  /yours will differ|one machine's output|one machine’s output|illustrative|for illustration|not a roster|example only/i;

/** How far below a row the disclaimer may sit. */
const DISCLAIMER_WINDOW = 10;

/**
 * Files permitted to carry a claim, each with the reason it is not drift.
 *
 * EXPLICIT and closed, in the style of `harness-blocked-wording.ts`: an entry
 * here is a review conversation. An empty allowlist is the correct starting
 * state — the disclaimer rule above is a mechanical exemption anyone can earn,
 * so nothing should need a hand-written one.
 */
const CLAIM_ALLOWLIST: ReadonlyArray<{ file: string; why: string }> = [];

const ALLOWLISTED = new Set(CLAIM_ALLOWLIST.map((e) => e.file));

describe('agent-readable assets assert no roster', () => {
  it('ranks no vendor above another', () => {
    const offenders: string[] = [];
    for (const relPath of assetMarkdownFiles()) {
      if (ALLOWLISTED.has(relPath)) continue;
      fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (PRIORITY_CLAIM.test(line)) offenders.push(`${relPath}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it('pastes no roster without saying it is one machine’s', () => {
    const offenders: string[] = [];
    for (const relPath of assetMarkdownFiles()) {
      if (ALLOWLISTED.has(relPath)) continue;
      const lines = fs
        .readFileSync(path.join(REPO_ROOT, relPath), 'utf8')
        .split('\n');
      lines.forEach((line, i) => {
        if (!ROSTER_TABLE_ROW.test(line)) return;
        const window = lines.slice(i, i + DISCLAIMER_WINDOW + 1).join('\n');
        if (SAMPLE_DISCLAIMER.test(window)) return;
        offenders.push(`${relPath}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('has an allowlist whose every entry still exists', () => {
    const missing = CLAIM_ALLOWLIST.filter(
      (entry) => !fs.existsSync(path.join(REPO_ROOT, entry.file)),
    ).map((entry) => entry.file);
    expect(missing).toEqual([]);
  });

  it('actually scanned both asset trees (a zero-file scan is a lie)', () => {
    const files = assetMarkdownFiles();
    for (const root of ASSET_ROOTS) {
      expect(files.some((f) => f.startsWith(root))).toBe(true);
    }
  });

  /**
   * The disclaimer exemption must be reachable, not theoretical. The bundled
   * delegation reference is the worked example of the rule: it pastes a roster
   * AND says the reader's will differ, five lines down.
   */
  it('the disclaimer exemption is exercised by a real file', () => {
    const delegation = assetMarkdownFiles().find((f) =>
      f.endsWith('orchestration/references/cli-agent-delegation.md'),
    );
    expect(delegation).toBeDefined();
    const lines = fs
      .readFileSync(path.join(REPO_ROOT, delegation as string), 'utf8')
      .split('\n');
    const rows = lines.filter((line) => ROSTER_TABLE_ROW.test(line));
    expect(rows.length).toBeGreaterThan(0);
    expect(lines.join('\n')).toMatch(SAMPLE_DISCLAIMER);
  });
});
