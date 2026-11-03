import { isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { CandidateFindingSchema, SeveritySchema, type CandidateFinding } from '@ptah-extension/review-contracts';
import type { EffectiveReviewSettings } from '../review-policy.service';

export interface ReviewArtifactFileSystem {
  realpath(path: string): Promise<string>;
  writeFile(path: string, content: string, encoding: 'utf8'): Promise<void>;
}

const PreviewInputSchema = z.object({
  headSha: z.string().regex(/^[0-9a-f]{40}$/),
  walkthrough: z.string().max(200_000),
  accepted: z.array(CandidateFindingSchema).max(100),
  previouslyPublished: z.array(CandidateFindingSchema).max(100).default([]),
  suppressed: z.array(z.object({ finding: CandidateFindingSchema, reason: z.string().min(1).max(4000) }).strict()).max(100),
  selectedLenses: z.array(z.object({ lens: z.string().min(1), family: z.string().min(1), scope: z.string().min(1), outcome: z.string().min(1) }).strict()).max(6),
  secrets: z.array(z.string().min(4)).max(100).default([]),
}).strict();
export type ReviewPreviewInput = z.input<typeof PreviewInputSchema>;

const SettingsSchema = z.object({
  maxNewInline: z.number().int().min(0).max(100),
  minimumSeverity: SeveritySchema,
  confidenceFloor: z.number().min(0).max(1),
  laneCapPerPr: z.number().int().min(1).max(6),
}).strict();
const severityRank: Record<CandidateFinding['severity'], number> = {
  Critical: 4, Major: 3, Minor: 2, Nitpick: 1,
};

function safeText(value: string, secrets: readonly string[]): string {
  let text = value;
  for (const secret of secrets) text = text.split(secret).join('[REDACTED]');
  return text
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g, '[REDACTED]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi, '[REDACTED]')
    .replace(/\b(authorization|x-api-key|api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)\s*=\s*[^\s,;]+/g, '[REDACTED]')
    .replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char] ?? char)
    .replace(/[\\`*_{}[\]()#+.!|]/g, '\\$&');
}

function formatFinding(finding: CandidateFinding, secrets: readonly string[]): string {
  const safe = (value: string): string => safeText(value, secrets);
  const evidence = finding.evidence.map((item) =>
    `  - ${safe(item.path)}:${item.line} — ${safe(item.excerpt)}`).join('\n');
  return `- **${finding.severity} · ${safe(finding.category)} · ${safe(finding.title)}** — ${safe(finding.path)}${finding.line === null ? ' (outside diff or no line)' : `:${finding.line}`}\n  - Failure: ${safe(finding.failureMode)}\n  - Affected behavior: ${safe(finding.affectedBehavior)}\n  - Scenario: ${safe(finding.scenario)}\n  - Confidence: ${finding.confidence}\n  - Evidence:\n${evidence}\n  - Affected caller: ${finding.affectedCaller ? safe(finding.affectedCaller) : 'None identified'}\n  - Suggested diff: ${finding.suggestedDiff ? safe(finding.suggestedDiff) : 'Omitted; uncertain or unsupported'}\n  - Prompt for AI agents: ${safe(finding.fixPrompt)}`;
}

export class ReviewArtifactWriter {
  constructor(private readonly fs: ReviewArtifactFileSystem) {}

  renderPreview(raw: ReviewPreviewInput, effective: EffectiveReviewSettings): string {
    const input = PreviewInputSchema.parse(raw);
    const settings = SettingsSchema.parse(effective);
    const safe = (value: string): string => safeText(value, input.secrets);
    const eligible = input.accepted.filter((finding) =>
      severityRank[finding.severity] >= severityRank[settings.minimumSeverity] &&
      finding.confidence >= settings.confidenceFloor);
    const ranked = [...eligible].sort((a, b) =>
      severityRank[b.severity] - severityRank[a.severity] || b.confidence - a.confidence);
    const inline = ranked.filter((finding) => finding.line !== null).slice(0, settings.maxNewInline);
    const suppressed = [
      ...input.suppressed.map(({ finding, reason }) => ({ finding, reason })),
      ...input.accepted.filter((finding) => !eligible.includes(finding)).map((finding) => ({
        finding, reason: severityRank[finding.severity] < severityRank[settings.minimumSeverity]
          ? `Below minimum severity ${settings.minimumSeverity}` : `Below confidence floor ${settings.confidenceFloor}`,
      })),
    ];
    const lines = [
      '# Dry-run review preview',
      `Reviewed head: ${input.headSha}`,
      'Publication: dry run; no GitHub mutation requested.',
      '## Walkthrough', safe(input.walkthrough),
      '## Lane coverage',
      ...input.selectedLenses.map((lane) => `- ${safe(lane.lens)} — ${safe(lane.family)}; scope: ${safe(lane.scope)}; outcome: ${safe(lane.outcome)}`),
      '## Accepted findings',
      ...(input.accepted.length ? input.accepted.map((finding) => formatFinding(finding, input.secrets)) : ['None.']),
      '## Previously published findings (edits do not use a new inline slot)',
      ...(input.previouslyPublished.length ? input.previouslyPublished.map((finding) => formatFinding(finding, input.secrets)) : ['None.']),
      '## Suppressed findings',
      ...(suppressed.length ? suppressed.map(({ finding, reason }) => `${formatFinding(finding, input.secrets)}\n  - Suppression reason: ${safe(reason)}`) : ['None.']),
      `## Inline-comment candidates (${inline.length}/${settings.maxNewInline})`,
      ...(inline.length ? inline.map((finding) => formatFinding(finding, input.secrets)) : ['None.']),
      `Additional eligible findings outside inline cap or without a line: ${eligible.length - inline.length}.`,
    ];
    return lines.join('\n\n') + '\n';
  }

  async writePreview(outRoot: string, raw: ReviewPreviewInput, effective: EffectiveReviewSettings): Promise<string> {
    if (!isAbsolute(outRoot)) throw new Error('Output root must be absolute');
    const root = await this.fs.realpath(outRoot);
    if (root.split(/[\\/]/).at(-1) !== 'out') throw new Error('Output root must be out/');
    const target = resolve(root, 'review-preview.md');
    const rel = relative(root, target);
    if (!rel || rel === '..' || rel.startsWith(`..\\`) || rel.startsWith('../') || isAbsolute(rel))
      throw new Error('Artifact path escapes out/');
    const content = this.renderPreview(raw, effective);
    await this.fs.writeFile(join(root, rel), content, 'utf8');
    return target;
  }
}
