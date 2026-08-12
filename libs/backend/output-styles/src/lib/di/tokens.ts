/**
 * DI Token Registry — Output Style Tokens.
 *
 * Convention mirrors `libs/backend/task-specs/src/lib/di/tokens.ts`:
 *  - Always `Symbol.for('Name')` (globally interned across bundles).
 *  - Each description globally unique.
 *  - Frozen `as const`.
 *
 * All four tokens are declared up front even though only `DISCOVERY` has an
 * implementation registered at this point. The file is pure symbols with zero
 * imports, so declaring the full set cannot break a consumer, and it keeps the
 * token surface stated in one place rather than accreting.
 *
 * There is deliberately NO plugin-roots token here — plugin-tier discovery is
 * deferred, and adding a token for an enumerator that does not exist would
 * imply a seam nothing implements.
 */
export const OUTPUT_STYLE_TOKENS = {
  /** OutputStyleDiscoveryService — tier scan, SDK merge order, collision flags. */
  DISCOVERY: Symbol.for('OutputStyleDiscovery'),
  /** OutputStyleFileWriter — upsert/delete of user- and project-tier `.md` files. */
  FILE_WRITER: Symbol.for('OutputStyleFileWriter'),
  /** ClaudeSettingsWriter — merge-preserving CLI-parity settings write. */
  CLAUDE_SETTINGS_WRITER: Symbol.for('OutputStyleClaudeSettingsWriter'),
  /** OutputStyleActivationResolver — the single flag-vs-inject decision point. */
  ACTIVATION_RESOLVER: Symbol.for('OutputStyleActivationResolver'),
  /**
   * OutputStyleSessionActivationService — the composition that turns "a session
   * is starting" into the two `AISessionConfig` fields. Shared by the chat path
   * (`rpc-handlers`) and the CLI-agent spawn path (`cli-agent-runtime`), which
   * cannot see each other.
   */
  SESSION_ACTIVATION: Symbol.for('OutputStyleSessionActivation'),
} as const;

export type OutputStyleDIToken = keyof typeof OUTPUT_STYLE_TOKENS;
