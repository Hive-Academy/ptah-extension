import { z } from 'zod';

/**
 * System One wire contracts for `POST /v1/systemone` (plan part A §5,
 * `research-decision-models.md:50-58, 280-345`). Ollama decision models and
 * TypeSafe Jev share the endpoint, so one schema file serves both. Ptah sends
 * `choice` questions only; routing must not gate on a `score` answer, so no
 * other question or answer kind is modelled.
 */

/**
 * Criteria of a `choice` question: option label (`o1..oP`) -> option text.
 * The labels are short and anonymous so a model can only name an offered
 * option (plan §5 wire shape).
 */
export const SystemOneCriteriaSchema = z.record(z.string(), z.string());

/** The single question kind Ptah sends. */
export const SystemOneQuestionSchema = z
  .object({
    type: z.literal('choice'),
    instructions: z.string(),
    criteria: SystemOneCriteriaSchema,
  })
  .strict();

/** Questions of one request, keyed by question key (the phase id). */
export const SystemOneQuestionsSchema = z.record(
  z.string(),
  SystemOneQuestionSchema,
);

/**
 * Lane facts one roster entry carries. The NFR Security field set stops here:
 * lane id (the map key), family, model, limit state, score.
 */
export const SystemOneOptionFactsSchema = z
  .object({
    family: z.string(),
    model: z.string(),
    limitState: z.string(),
    score: z.number(),
  })
  .strict();

/** Aggregated outcome figures for one `${laneId}/${taskKind}` key. */
export const SystemOneOutcomeCountsSchema = z
  .object({
    delivered: z.number(),
    failed: z.number(),
  })
  .strict();

/** The shared state every question of one request sees. */
export const SystemOneStateSchema = z
  .object({
    request: z.string(),
    availableExecutors: z.record(z.string(), SystemOneOptionFactsSchema),
    pastOutcomes: z.record(z.string(), SystemOneOutcomeCountsSchema),
  })
  .strict();

/** Request body of `POST /v1/systemone`. Ptah builds every field it sends. */
export const SystemOneRequestBodySchema = z
  .object({
    model: z.string(),
    state: SystemOneStateSchema,
    questions: SystemOneQuestionsSchema,
  })
  .strict();

/** One validated `choice` answer; `probabilities` and `confidence` are optional. */
const SystemOneChoiceAnswerSchema = z
  .object({
    type: z.literal('choice'),
    choice: z.string(),
    probabilities: z.record(z.string(), z.number()).optional(),
    confidence: z.number().optional(),
  })
  .strict();

/**
 * Response body of `POST /v1/systemone`. The outer object is `.passthrough()`
 * and what Ptah reads (answers, usage) is strict — the combination plan §5
 * pins: a provider may add top-level fields, but a malformed answer or usage
 * block is a `bad-output` failure.
 */
export const SystemOneResultSchema = z
  .object({
    model: z.string(),
    answers: z.record(z.string(), SystemOneChoiceAnswerSchema),
    usage: z
      .object({
        input_tokens: z.number().optional(),
        output_tokens: z.number().optional(),
      })
      .strict()
      .optional(),
  })
  .passthrough();

export type SystemOneQuestion = z.infer<typeof SystemOneQuestionSchema>;
export type SystemOneQuestions = z.infer<typeof SystemOneQuestionsSchema>;
export type SystemOneState = z.infer<typeof SystemOneStateSchema>;
export type SystemOneRequestBody = z.infer<typeof SystemOneRequestBodySchema>;
export type SystemOneResult = z.infer<typeof SystemOneResultSchema>;
