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
import { SYSTEM_CLI_TYPES } from '@ptah-extension/shared';
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
