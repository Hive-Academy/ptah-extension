/**
 * Compact, on-demand pointer for Electron coding sessions. The skill carries
 * the normative grammar and examples. This prompt names the `display [id]`
 * target, the id-update rule, every host source, and the report-versus-compact
 * choice. The report sentence does not fit the old 100-token cap
 * (TASK_2026_623 R8.1); the spec pins the new ceiling.
 *
 * Codex chat must not use {@link PTAH_UI_HINT}: it has no skill instruction
 * source, and a load sentence makes the model search the filesystem.
 * {@link PTAH_UI_HINT_CODEX} still states the HTML publish rule inline.
 */
const PTAH_UI_HINT_SHARED = `Use \`\`\`ptah-ui blocks for compact turn summaries, stats, changed files, test results or charts in Ptah Electron; \`\`\`ptah-ui display [id] shows one in the side panel, and reusing an id updates it in place. Reference $diff $tests $usage $agents $limits; the host supplies real values—never type them yourself. For a report, dashboard or other visual view of the work, publish one self-contained HTML page with ptah_artifact_publish and describe it in one sentence. Do not answer a report with ptah-ui blocks alone.`;

const PTAH_UI_HINT_SKILL_SENTENCE =
  'Load the ptah-surface-authoring skill and any available design or data-visualization skill such as frontend-design or dataviz before publishing.';

export const PTAH_UI_HINT = `${PTAH_UI_HINT_SHARED} ${PTAH_UI_HINT_SKILL_SENTENCE}`;

/** Same sentences as {@link PTAH_UI_HINT}, without a skill-file lookup. */
export const PTAH_UI_HINT_CODEX = PTAH_UI_HINT_SHARED;

export type SurfaceRequestKind = 'report' | 'compact';

export interface SurfaceRoute {
  readonly kind: SurfaceRequestKind;
  readonly guidance: string;
}

export interface SurfaceRouteOptions {
  /**
   * True when the host can load a skill file. False for Codex and any other
   * host whose prompt must not name a skill path.
   */
  readonly skillLookup: boolean;
}

const COMPACT_SURFACE_GUIDANCE =
  'Compact summary: use a ptah-ui block. Reference $diff $tests $usage $agents $limits; the host supplies the values.';

const REPORT_SURFACE_GUIDANCE_WITH_SKILLS =
  'Report or visual view: load the ptah-surface-authoring skill and any available design or data-visualization skill (frontend-design, dataviz). Publish one attractive self-contained HTML artifact with ptah_artifact_publish, then one sentence in chat. Do not answer with ptah-ui blocks alone.';

const REPORT_SURFACE_GUIDANCE_WITHOUT_SKILLS =
  'Report or visual view: publish one attractive self-contained HTML artifact with ptah_artifact_publish, then one sentence in chat. Do not answer with ptah-ui blocks alone.';

const VISUAL_REQUEST =
  /\b(?:dashboard|infographic|visualize|visualization)\b|\b(?:visual|representational)\s+(?:view|page|report|overview|summary|representation)\b|\boverview\s+page\b|\bwith\s+charts?\b|\b(?:make|create|draw|show|give|build|plot|graph|chart)\b.{0,60}\b(?:charts?|graphs?|plots?|diagrams?|infographics?)\b|\b(?:a|an|the)\s+(?:charts?|graphs?|plots?|diagrams?|infographics?)\s+of\b|\b(?:ui|visual|html|page)\s+prototype\b|\bprototype\s+(?:page|dashboard|ui)\b|\bhtml\s+(?:artifact|dashboard|report|page)\b/i;

const REPORT_REQUEST =
  /\b(?:status|progress|task|tasks|work|activity|weekly|daily)\s+report\b|\breport\s+(?:of|on)\b|\b(?:send|give|show|make|build|publish|write|prepare|create)\s+(?:me\s+)?(?:a|an|the)\s+report\b|\ba\s+report\b/i;

const NOT_A_VISUAL_REPORT =
  /\b(?:bug|error|crash|incident|sentry)\s+report\b|\breport\s+(?:a|an|the|this)\s+(?:bug|error|issue|problem|crash)\b|\breport\s+on\s+(?:this\s+|the\s+|a\s+|an\s+)?(?:bug|error|issue|problem|crash)\b/i;

/**
 * Report and visual requests publish an HTML artifact. Compact recaps stay
 * on ptah-ui. A host without skill-file lookup gets the publish rule and
 * no skill name.
 */
export function routeSurfaceRequest(
  text: string,
  options: SurfaceRouteOptions,
): SurfaceRoute {
  const kind = classifySurfaceRequest(text);
  if (kind === 'compact') {
    return { kind, guidance: COMPACT_SURFACE_GUIDANCE };
  }
  return {
    kind,
    guidance: options.skillLookup
      ? REPORT_SURFACE_GUIDANCE_WITH_SKILLS
      : REPORT_SURFACE_GUIDANCE_WITHOUT_SKILLS,
  };
}

/**
 * Current-turn guidance for the Claude UserPromptSubmit hook. Compact
 * prompts add nothing. This host can load skill files.
 */
export function surfaceHookGuidance(prompt: string): string | null {
  const route = routeSurfaceRequest(prompt, { skillLookup: true });
  return route.kind === 'report' ? route.guidance : null;
}

function classifySurfaceRequest(text: string): SurfaceRequestKind {
  const value = text.trim();
  if (value.length === 0) return 'compact';
  const visual = VISUAL_REQUEST.test(value);
  if (NOT_A_VISUAL_REPORT.test(value) && !visual) return 'compact';
  if (visual || REPORT_REQUEST.test(value)) return 'report';
  return 'compact';
}
