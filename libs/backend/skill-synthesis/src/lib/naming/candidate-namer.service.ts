/**
 * CandidateNamerService — gives a candidate a title a human can read.
 *
 * ## Why this exists
 *
 * `SkillCandidateRow.name` is a SLUG derived by slugifying the first 140
 * characters of the session's first user message
 * (`trajectory-extractor.ts:136-138`). It is an internal id: it is the
 * `SKILL.md` folder name and it carries a UNIQUE index. It was never a title,
 * and rendering it as one produces list rows like
 * `ok-so-i-need-you-to-look-at-the-thing-where-the-build-keeps` — the user's
 * opening sentence with the punctuation filed off.
 *
 * The slug KEEPS that job. This service adds a separate `display_name` column
 * beside it, so nothing that resolves a skill by slug changes.
 *
 * ## Cheap, and on the judge lane
 *
 * One pass, `{name, description}` only, no body — the smallest useful request
 * in the library, which is why it rides the `judge` lane (the cheapest tier)
 * rather than `synthesis`. It asks for a description as well as a name because
 * a model that has to state what the workflow DOES writes a better title than
 * one asked for a bare label; phase 1 persists only the name.
 *
 * ## The lane failing is not an error
 *
 * No lane in this host, a stalled lane, an unparseable answer — all of them
 * leave `display_name` NULL and return `null`, and the store is not touched at
 * all. A NULL display name is a complete, meaningful value: the UI falls back to
 * the slug, which is exactly where it was before this service ran. Writing a
 * placeholder, or writing the slug back as a title, would turn "not named yet"
 * into "named, badly" and there would be nothing left to retry.
 */
import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { SKILL_SYNTHESIS_TOKENS } from '../di/tokens';
import type { LaneRun, LaneRunnerService } from '../lanes/lane-runner.service';
import type { SkillCandidateStore } from '../skill-candidate.store';
import type { CandidateId } from '../types';

/**
 * Hard ceiling on a display name, enforced HERE rather than trusted from the
 * model. A title is rendered in a fixed-width list row; a model that ignores
 * the instruction and returns a paragraph must not be able to break the layout,
 * and clamping is cheaper than a re-run.
 */
export const CANDIDATE_DISPLAY_NAME_MAX_CHARS = 60;

/** The `{name, description}` pass, as a JSON Schema for lanes that honour one. */
export const CANDIDATE_NAMING_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      minLength: 1,
      maxLength: CANDIDATE_DISPLAY_NAME_MAX_CHARS,
    },
    description: { type: 'string', minLength: 1 },
  },
  required: ['name', 'description'],
  additionalProperties: false,
};

const CandidateNamingSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
});

/**
 * What the namer reads. Structural rather than `ExtractedTrajectory` so a
 * caller holding only a candidate row and its body can name it too — an
 * `ExtractedTrajectory` satisfies it as-is.
 */
export interface CandidateNamingSource {
  /** The extractor's slug. Read ONLY so a title identical to it is refused. */
  readonly slug: string;
  /** The truncated first user message. */
  readonly shortDescription: string;
  /** The normalized session text the title should describe. */
  readonly canonicalText: string;
}

export interface CandidateNaming {
  /** Clamped to `CANDIDATE_DISPLAY_NAME_MAX_CHARS`. Written to `display_name`. */
  readonly displayName: string;
  /** Requested for prompt quality; not persisted in phase 1. */
  readonly description: string;
}

const NAMING_RUBRIC = [
  `You are titling a reusable workflow skill distilled from an AI coding session, for a list of skills a human scans.`,
  ``,
  `Reply with ONLY: {"name": string, "description": string}. No preamble, no code fences.`,
  ``,
  `name: a SHORT human-readable title in Title Case, at most ${CANDIDATE_DISPLAY_NAME_MAX_CHARS} characters.`,
  `- Name the REUSABLE WORKFLOW, not this one session.`,
  `- NEVER echo the user's opening sentence, and never answer with a kebab-case slug.`,
  ``,
  `description: one sentence stating what the workflow does and when to use it.`,
].join('\n');

@injectable()
export class CandidateNamerService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SKILL_SYNTHESIS_TOKENS.LANE_RUNNER_SERVICE)
    private readonly laneRunner: LaneRunnerService,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_CANDIDATE_STORE)
    private readonly store: SkillCandidateStore,
  ) {}

  /**
   * Name a candidate and persist the title. Returns `null` — leaving
   * `display_name` untouched — whenever no trustworthy title was produced.
   */
  async nameCandidate(
    id: CandidateId,
    source: CandidateNamingSource,
  ): Promise<CandidateNaming | null> {
    const naming = await this.requestNaming(id, source);
    if (!naming) return null;

    this.store.setDisplayName(id, naming.displayName);
    this.logger.debug('[skill-naming] display name written', {
      candidateId: id,
      displayName: naming.displayName,
    });
    return naming;
  }

  private async requestNaming(
    id: CandidateId,
    source: CandidateNamingSource,
  ): Promise<CandidateNaming | null> {
    let result;
    try {
      result = await this.laneRunner.run({
        laneId: 'judge',
        systemPromptAppend: NAMING_RUBRIC,
        prompt: buildNamingPrompt(source),
        outputSchema: CANDIDATE_NAMING_JSON_SCHEMA,
      });
    } catch (error: unknown) {
      this.logger.warn('[skill-naming] lane call threw; leaving name unset', {
        candidateId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }

    if (result.status === 'unavailable') {
      this.logger.debug('[skill-naming] no naming lane in this host', {
        candidateId: id,
        reason: result.reason,
      });
      return null;
    }
    if (result.status === 'failed') {
      this.logger.warn('[skill-naming] lane failed; leaving name unset', {
        candidateId: id,
        kind: result.failure.kind,
        reason: result.failure.reason,
      });
      return null;
    }

    const parsed = CandidateNamingSchema.safeParse(readJson(result.run));
    if (!parsed.success) {
      this.logger.warn('[skill-naming] unusable naming response', {
        candidateId: id,
        raw: result.run.text.slice(0, 200),
      });
      return null;
    }

    /**
     * The echo check runs BEFORE the clamp, and that order is the whole of it.
     * A slug built from 140 characters of prose is longer than the 60-char
     * ceiling, so clamping first turns an exact echo into a 60-char PREFIX of
     * the slug — which compares unequal, and the internal id gets persisted as
     * a title anyway. Compare what the model actually said.
     */
    const cleaned = parsed.data.name.replace(/\s+/g, ' ').trim();
    if (cleaned.length === 0 || cleaned === source.slug) {
      this.logger.warn(
        '[skill-naming] model echoed the slug or named nothing',
        {
          candidateId: id,
          slug: source.slug,
        },
      );
      return null;
    }
    return {
      displayName: clampTitle(cleaned),
      description: parsed.data.description,
    };
  }
}

/**
 * The session material. Handed over WHOLE — the `judge` lane's `maxInputChars`
 * is what bounds it, and the runner marks the clip.
 */
function buildNamingPrompt(source: CandidateNamingSource): string {
  return [
    `What the session opened with: ${source.shortDescription}`,
    ``,
    `Normalized session trajectory:`,
    `---`,
    source.canonicalText,
  ].join('\n');
}

/** The lane's structured answer when it is an object, else nothing. */
function readJson(run: LaneRun): unknown {
  if (run.json !== null && typeof run.json === 'object') return run.json;
  return undefined;
}

/**
 * Collapse whitespace and cut to the ceiling on a word boundary. Cutting
 * mid-word produces titles like `Refactor The Authentication Tok`, which reads
 * as corruption rather than as an excerpt.
 */
function clampTitle(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= CANDIDATE_DISPLAY_NAME_MAX_CHARS) return collapsed;
  const cut = collapsed.slice(0, CANDIDATE_DISPLAY_NAME_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd();
}
