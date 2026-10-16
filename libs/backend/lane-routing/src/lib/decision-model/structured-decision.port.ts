/**
 * Port for the third decision-model kind, a configured provider model with
 * structured output (plan part A §5 and the ports block at
 * `implementation-plan-part-a.md:713`). It is implemented outside this
 * library (`agent-sdk` structured-decision adapter, part A §10) and bound to
 * `LANE_ROUTING_TOKENS.STRUCTURED_DECISION` (`di/tokens.ts`), an optional
 * port: consumers receive it only when the host registers it.
 *
 * The pipeline renders each question as an enum property of one JSON schema
 * and maps the answer to the `DecisionAnswer` shape with `confidence: null`
 * (Req 1.8); any model-supplied text field is dropped (Req 13.1).
 */

/** One structured-output completion. */
export interface StructuredDecisionRequest {
  /** Configured provider id (for example `anthropic`, `openrouter`, `ollama`). */
  readonly providerId: string;
  /** Model id of that provider. */
  readonly model: string;
  /** Full prompt text the pipeline built. */
  readonly prompt: string;
  /** JSON schema the answer must satisfy; one enum property per question. */
  readonly jsonSchema: Record<string, unknown>;
  /** Abort budget of the routing call. */
  readonly signal: AbortSignal;
}

export interface StructuredDecisionCompleter {
  /**
   * True when the provider has what it needs to answer (a credential, or no
   * credential required). Used by the settings status probe, never as a
   * paid call.
   */
  isReady(providerId: string): Promise<boolean>;
  /**
   * Returns the parsed structured output, unvalidated. The caller validates
   * it against the schema it sent and maps every failure to a Req 12.7 cause.
   */
  complete(request: StructuredDecisionRequest): Promise<unknown>;
}
