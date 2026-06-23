import * as os from 'node:os';
import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { INTERNAL_QUERY_SERVICE_TOKEN } from './di/tokens';
import type { IInternalQuery } from './internal-query.interface';
import type { ExtractedTrajectory } from './trajectory-extractor';
import type { SkillSynthesisSettings } from './types';
import { resolveJudgeModel } from './model-resolver';

const SYNTHESIS_TIMEOUT_MS = 30_000;

const SynthesizedSkillSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  body: z.string().min(1),
});

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
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(INTERNAL_QUERY_SERVICE_TOKEN, { isOptional: true })
    private readonly internalQuery: IInternalQuery | null,
  ) {}

  async synthesize(
    trajectory: ExtractedTrajectory,
    settings: SkillSynthesisSettings,
  ): Promise<SynthesizedSkill | null> {
    if (!this.internalQuery) {
      this.logger.info(
        '[skill-synthesis] synthesizer: no internalQuery; using template fallback',
        { slug: trajectory.slug },
      );
      return this.fallback(trajectory);
    }

    const parsed = await this.runSynthesis(
      this.buildSystemPrompt(),
      this.buildPrompt(trajectory),
      settings,
    );
    if (!parsed) {
      this.logger.warn(
        '[skill-synthesis] synthesizer: LLM failed/parse failed; using template fallback',
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
    if (!this.internalQuery || members.length === 0) return null;
    const parsed = await this.runSynthesis(
      this.buildSystemPrompt(),
      this.buildClusterPrompt(members),
      settings,
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

  private async runSynthesis(
    systemPromptAppend: string,
    prompt: string,
    settings: SkillSynthesisSettings,
  ): Promise<SynthesizedSkill | null> {
    if (!this.internalQuery) return null;
    const model = resolveJudgeModel(
      settings.judgeModel,
      this.workspaceProvider,
    );
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(
      () => abortController.abort(),
      SYNTHESIS_TIMEOUT_MS,
    );
    try {
      const handle = await this.internalQuery.execute({
        cwd: os.homedir(),
        model,
        prompt,
        systemPromptAppend,
        isPremium: false,
        mcpServerRunning: false,
        maxTurns: 1,
        abortController,
      });

      let collected = '';
      for await (const msg of handle.stream) {
        if (msg.type === 'assistant') {
          for (const block of msg.message?.content ?? []) {
            if (block.type === 'text' && typeof block.text === 'string') {
              collected += block.text;
            }
          }
        }
        if (msg.type === 'result') break;
      }
      return this.parse(collected);
    } catch (error: unknown) {
      this.logger.warn('[skill-synthesis] synthesizer: LLM call failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private buildClusterPrompt(members: ClusterMemberInput[]): string {
    const sections = members.map((m, i) =>
      [`### Session ${i + 1} — ${m.description}`, m.body.slice(0, 3000)].join(
        '\n',
      ),
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
    return `You are distilling a successful AI coding session into a REUSABLE, repo-agnostic skill.
Strip workspace-specific paths, file names, and identifiers. Generalize the workflow so it applies to any project.
Output ONLY a single JSON object: {"name": string, "description": string, "body": string}.
- name: a short kebab-case slug for the skill.
- description: one sentence describing when this skill applies.
- body: a SKILL.md body in markdown with exactly these sections, in order:
## Description
## When to use
## Steps
Do not include YAML frontmatter. Output only the JSON object — no preamble, no code fences.`;
  }

  private buildPrompt(trajectory: ExtractedTrajectory): string {
    return [
      `Session signals: edits=${trajectory.editCount}, tools=${trajectory.toolUseCount}, testsPassed=${trajectory.bashTestPassed}, successMarker=${trajectory.hasSuccessMarker}.`,
      ``,
      `Normalized session trajectory (tool activity included):`,
      `---`,
      trajectory.canonicalText.slice(0, 8000),
      `---`,
    ].join('\n');
  }

  private parse(raw: string): SynthesizedSkill | null {
    const json = this.extractJsonObject(raw);
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
