import {
  Bot,
  ClipboardList,
  Container,
  DraftingCompass,
  Eye,
  FlaskConical,
  LayoutTemplate,
  Palette,
  ScanEye,
  ScrollText,
  SearchCheck,
  ServerCog,
  Sparkles,
  Telescope,
  Users,
} from 'lucide-angular';
import type { LucideIconData } from 'lucide-angular';
import type { CliType } from '@ptah-extension/shared';

/**
 * THE `cliId -> providerId` table for CLI lane marks. Every id resolves in
 * `ptah-provider-mark`: six through `PROVIDER_BRAND_SLUGS` (vendored art) and
 * `pi` / `ptah-cli` through `PROVIDER_MARKS` (hand-authored strokes). Keyed by
 * `CliType`, so a new CLI fails typecheck until it gets a row. The Claude
 * mark is never produced here: it belongs to the Orchestrator only.
 */
export const CLI_PROVIDER_MARK_IDS: Readonly<Record<CliType, string>> = {
  codex: 'codex',
  copilot: 'copilot',
  cursor: 'cursor',
  antigravity: 'antigravity',
  opencode: 'opencode',
  grok: 'grok',
  pi: 'pi',
  'ptah-cli': 'ptah-cli',
};

/** The mark of a CLI lane: a provider mark, or a lettered monogram. */
export type CliMark =
  | { readonly kind: 'provider'; readonly providerId: string }
  | { readonly kind: 'monogram'; readonly label: string };

/** Monogram label when a lane has no CLI id, so a tile is never blank. */
const NO_CLI_ID_LABEL = 'CLI lane';

/**
 * The mark of a CLI id. Only an id in `CLI_PROVIDER_MARK_IDS` gets a provider
 * mark; any other id is drawn as its own monogram (never `Bot`, never a
 * terminal glyph), and a missing id as the `CLI lane` monogram.
 */
export function cliMarkFor(cliId: string | null | undefined): CliMark {
  const id = cliId?.trim() ?? '';
  if (id.length === 0) return { kind: 'monogram', label: NO_CLI_ID_LABEL };
  if (Object.hasOwn(CLI_PROVIDER_MARK_IDS, id)) {
    return {
      kind: 'provider',
      providerId: CLI_PROVIDER_MARK_IDS[id as CliType],
    };
  }
  return { kind: 'monogram', label: id };
}

/** THE role-icon table: one lucide glyph per workspace agent type. */
export const AGENT_ROLE_ICONS: Readonly<Record<string, LucideIconData>> = {
  'frontend-developer': LayoutTemplate,
  'backend-developer': ServerCog,
  'software-architect': DraftingCompass,
  'team-leader': Users,
  'project-manager': ClipboardList,
  'ui-ux-designer': Palette,
  'senior-tester': FlaskConical,
  'code-logic-reviewer': SearchCheck,
  'code-style-reviewer': ScanEye,
  'researcher-expert': Telescope,
  'devops-engineer': Container,
  'technical-content-writer': ScrollText,
  'modernization-detector': Sparkles,
  'visual-reviewer': Eye,
};

/** The glyph of a sub-agent or background agent type; `Bot` when unknown. */
export function roleIconFor(
  agentType: string | null | undefined,
): LucideIconData {
  const key = agentType?.trim() ?? '';
  return Object.hasOwn(AGENT_ROLE_ICONS, key) ? AGENT_ROLE_ICONS[key] : Bot;
}
