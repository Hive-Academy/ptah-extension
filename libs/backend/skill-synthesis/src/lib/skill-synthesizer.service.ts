/**
 * SkillSynthesizerService — turns a session trajectory (or a cluster of them)
 * into ONE reusable, repo-agnostic skill via a single LLM pass.
 *
 * ## Everything runs on the `synthesis` lane
 *
 * `SYNTHESIS_TIMEOUT_MS` and the hardcoded 8000-char trajectory slice are gone:
 * `LaneRunner` owns the `AbortController`, the lane's `timeoutMs` and the
 * `maxInputChars` clip. The authoring rules ride `systemPromptAppend`, which the
 * lane does NOT clip, so a long trajectory can never truncate the instructions
 * that tell the model what shape to answer in.
 *
 * `SYNTHESIZED_SKILL_JSON_SCHEMA` mirrors `SynthesizedSkillSchema` and goes out
 * as the lane's `outputSchema`. It is a request, not an assumption: an endpoint
 * that ignores `outputFormat` gets exactly one re-run without it (the runner's
 * ladder), and `extractJsonObject` below reads the answer out of prose. That
 * extractor is the ONLY path on a `structuredOutput: 'parse'` lane — deleting it
 * as "dead code" would silently disable synthesis for every such provider.
 */
import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { SKILL_SYNTHESIS_TOKENS } from './di/tokens';
import type { LaneRun, LaneRunnerService } from './lanes/lane-runner.service';
import type { ExtractedTrajectory } from './trajectory-extractor';
import type { SkillSynthesisSettings } from './types';

const SynthesizedSkillSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  body: z.string().min(1),
});

/**
 * The JSON Schema half of the contract above, kept field-for-field in step with
 * `SynthesizedSkillSchema`. Zod stays the authority on what is ACCEPTED; this
 * only shapes what is ASKED for, so a provider that honours it hands back
 * something the Zod parse then still has to agree with.
 */
export const SYNTHESIZED_SKILL_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
    description: { type: 'string', minLength: 1 },
    body: { type: 'string', minLength: 1 },
  },
  required: ['name', 'description', 'body'],
  additionalProperties: false,
};

/**
 * Per-member ceiling inside the cluster prompt.
 *
 * NOT a second input budget — the lane's `maxInputChars` is the budget, and it
 * clips the assembled prompt. This is a FAIRNESS bound: without it one
 * enormous member would consume the whole lane budget and the later members
 * would be clipped away entirely, which defeats the point of pooling them.
 */
const CLUSTER_MEMBER_MAX_CHARS = 3_000;

export interface SynthesizedSkill {
  name: string;
  description: string;
  body: string;
}

/** One cluster member's distilled signal fed into cluster synthesis. */
export interface ClusterMemberInput {
  description: string;
  body: string;
}

@injectable()
export class SkillSynthesizerService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SKILL_SYNTHESIS_TOKENS.LANE_RUNNER_SERVICE)
    private readonly laneRunner: LaneRunnerService,
  ) {}

  async synthesize(
    trajectory: ExtractedTrajectory,
    settings: SkillSynthesisSettings,
  ): Promise<SynthesizedSkill | null> {
    void settings;
    const parsed = await this.runSynthesis(
      this.buildSystemPrompt(),
      this.buildPrompt(trajectory),
    );
    if (!parsed) {
      this.logger.warn(
        '[skill-synthesis] synthesizer: lane unavailable/failed or parse failed; using template fallback',
        { slug: trajectory.slug },
      );
      return this.fallback(trajectory);
    }
    this.logger.debug('[skill-synthesis] synthesizer succeeded', {
      slug: trajectory.slug,
      name: parsed.name,
    });
    return parsed;
  }

  /**
   * Distill ONE reusable skill from a cluster of similar member trajectories
   * (Trace2Skill pooling). Soft-fails to null — the suggestion pass simply
   * skips the cluster on failure (no template fallback for clusters).
   */
  async synthesizeFromCluster(
    members: ClusterMemberInput[],
    settings: SkillSynthesisSettings,
  ): Promise<SynthesizedSkill | null> {
    void settings;
    if (members.length === 0) return null;
    const parsed = await this.runSynthesis(
      this.buildSystemPrompt(),
      this.buildClusterPrompt(members),
    );
    if (!parsed) {
      this.logger.info(
        '[skill-synthesis] cluster synthesis failed/parse failed; skipping',
        { clusterSize: members.length },
      );
      return null;
    }
    return parsed;
  }

  /**
   * One lane pass. Every non-success — no lane in this host, a stalled lane, a
   * thrown transport error, an answer that will not parse — collapses to `null`,
   * because both callers already have a policy for "no skill came back" and
   * neither can act on the difference.
   */
  private async runSynthesis(
    systemPromptAppend: string,
    prompt: string,
  ): Promise<SynthesizedSkill | null> {
    let result;
    try {
      result = await this.laneRunner.run({
        laneId: 'synthesis',
        systemPromptAppend,
        prompt,
        outputSchema: SYNTHESIZED_SKILL_JSON_SCHEMA,
      });
    } catch (error: unknown) {
      this.logger.warn('[skill-synthesis] synthesizer: lane call threw', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }

    if (result.status === 'unavailable') {
      this.logger.info(
        '[skill-synthesis] synthesizer: no synthesis lane in this host',
        { reason: result.reason },
      );
      return null;
    }
    if (result.status === 'failed') {
      this.logger.warn('[skill-synthesis] synthesizer: lane failed', {
        kind: result.failure.kind,
        reason: result.failure.reason,
      });
      return null;
    }
    return this.parse(result.run);
  }

  private buildClusterPrompt(members: ClusterMemberInput[]): string {
    const sections = members.map((m, i) =>
      [
        `### Session ${i + 1} — ${m.description}`,
        m.body.slice(0, CLUSTER_MEMBER_MAX_CHARS),
      ].join('\n'),
    );
    return [
      `These ${members.length} successful sessions are similar to each other.`,
      `Find the SINGLE COMMON reusable workflow they share and distill it into one`,
      `repo-agnostic skill. Ignore details specific to any one session.`,
      ``,
      ...sections,
    ].join('\n\n');
  }

  private buildSystemPrompt(): string {
    return `You are distilling a SUCCESSFUL AI coding session into ONE reusable, repo-agnostic skill that another AI agent will later load and follow. Apply skill-authoring best practices.

Output ONLY a single JSON object: {"name": string, "description": string, "body": string}. No preamble, no code fences.

name:
- short kebab-case slug naming the REUSABLE WORKFLOW in verb-first/imperative form (e.g. "add-zod-validated-rpc-method").
- NEVER echo the user's literal request or paste their opening sentence.

description: the MOST important field — it is the only text used to decide when this skill triggers.
- One or two sentences stating BOTH what the skill does AND the concrete trigger ("Use when ...").
- Put ALL "when to use" information here, NEVER in the body.

body: imperative/infinitive procedural instructions for another agent.
- Generalize: strip workspace-specific paths, file names, identifiers, and one-off details. Capture the transferable routine, not this session's specifics.
- Be concise — assume the agent is already capable; include only non-obvious, reusable procedural knowledge. Every line must justify its token cost.
- Match degrees of freedom to the task: exact steps where the operation is fragile or order-dependent, heuristics where multiple approaches are valid.
- Do NOT include: YAML frontmatter, a "When to use" section, README/changelog/auxiliary prose, or a replay of the session log.
- Prefer a short "## Steps" list, and add "## Gotchas" only when there are non-obvious pitfalls.

If the session has no transferable, reusable routine (pure one-off Q&A, a trivial single edit, or no coherent workflow), still produce the best generalization possible — the reviewer judges its value.`;
  }

  /**
   * The trajectory is handed over WHOLE. The lane's `maxInputChars` is what
   * bounds it, and the runner appends a truncation marker when it bites, so the
   * model can tell a deliberate excerpt from a corrupt one.
   */
  private buildPrompt(trajectory: ExtractedTrajectory): string {
    return [
      `Session signals: edits=${trajectory.editCount}, tools=${trajectory.toolUseCount}, testsPassed=${trajectory.bashTestPassed}, successMarker=${trajectory.hasSuccessMarker}.`,
      ``,
      `Normalized session trajectory (tool activity included):`,
      `---`,
      trajectory.canonicalText,
    ].join('\n');
  }

  /**
   * The lane's structured answer when there is one, otherwise the manual
   * extractor over the assistant text. Zod has the final say either way — a
   * provider that honoured the schema can still omit a field.
   */
  private parse(run: LaneRun): SynthesizedSkill | null {
    const json =
      run.json !== null && typeof run.json === 'object'
        ? run.json
        : this.extractJsonObject(run.text);
    if (!json) return null;
    const parsed = SynthesizedSkillSchema.safeParse(json);
    if (!parsed.success) return null;
    return {
      name: parsed.data.name,
      description: parsed.data.description,
      body: parsed.data.body,
    };
  }

  private extractJsonObject(text: string): unknown | null {
    if (!text) return null;
    const start = text.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const slice = text.slice(start, i + 1);
          try {
            return JSON.parse(slice);
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }

  private fallback(trajectory: ExtractedTrajectory): SynthesizedSkill {
    return {
      name: trajectory.slug,
      description: trajectory.shortDescription,
      body: this.synthesizeBody(
        trajectory.canonicalText,
        trajectory.shortDescription,
      ),
    };
  }

  private synthesizeBody(canonicalText: string, headline: string): string {
    return [
      `# ${headline}`,
      '',
      'This skill was synthesized automatically from a successful session trajectory.',
      'Edit the body below to make it reusable.',
      '',
      '## Trajectory (normalized)',
      '',
      '```',
      canonicalText.length > 4000
        ? `${canonicalText.slice(0, 4000)}\n…(truncated)…`
        : canonicalText,
      '```',
      '',
    ].join('\n');
  }
}
