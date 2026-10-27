/**
 * Lane envelopes: the text a lane or a child session sends into its parent
 * session as a peer turn (`<agent-report …>` from `AgentReportRouter`,
 * `<agent-lane-completed …>` from `LaneCompletionNotifier`).
 *
 * The live stream carries the sender on `origin`, but the CLI does not write
 * `origin` to the JSONL transcript, so a history reload can only recognise a
 * peer turn by this envelope. The webview uses the same parse to render a
 * compact header instead of the raw tags.
 *
 * Every value here is display text. The attributes are self-reported by the
 * sender and must never be used as an identity or to authorize anything.
 */

export type LaneEnvelopeKind = 'report' | 'completed';

export interface LaneEnvelope {
  readonly kind: LaneEnvelopeKind;
  /** `agent-id` attribute: the lane id or the child session id. */
  readonly agentId: string;
  /** `agent` attribute: the lane label a person recognizes. */
  readonly agent: string;
  /** `cli` attribute; `ptah-session` for a child chat session. */
  readonly cli: string;
  /** `status` attribute of a completion envelope. */
  readonly status?: string;
  /** `verdict` attribute of a completion envelope. */
  readonly verdict?: string;
  /** The text between the opening and the closing tag, trimmed. */
  readonly body: string;
}

const TAG_KIND: Readonly<Record<string, LaneEnvelopeKind>> = {
  'agent-report': 'report',
  'agent-lane-completed': 'completed',
};

const ENVELOPE_PATTERN =
  /^\s*<(agent-report|agent-lane-completed)((?:\s+[a-z-]+="[^"]*")*)\s*>\n?([\s\S]*?)\n?<\/\1>\s*$/;

const ATTRIBUTE_PATTERN = /([a-z-]+)="([^"]*)"/g;

/** The `cli` attribute of an envelope from a child chat session. */
const SESSION_CHILD_CLI = 'ptah-session';

function unescapeAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Parse one whole-message lane envelope. Returns `null` when the text is not
 * exactly one envelope, or when `agent-id`, `agent` or `cli` is missing.
 */
export function parseLaneEnvelope(text: string): LaneEnvelope | null {
  const match = ENVELOPE_PATTERN.exec(text);
  if (!match) return null;
  const attributes = new Map<string, string>();
  for (const [, name, value] of match[2].matchAll(ATTRIBUTE_PATTERN)) {
    attributes.set(name, unescapeAttribute(value));
  }
  const agentId = attributes.get('agent-id');
  const agent = attributes.get('agent');
  const cli = attributes.get('cli');
  if (!agentId || !agent || !cli) return null;
  const status = attributes.get('status');
  const verdict = attributes.get('verdict');
  return {
    kind: TAG_KIND[match[1]],
    agentId,
    agent,
    cli,
    ...(status ? { status } : {}),
    ...(verdict ? { verdict } : {}),
    body: match[3].trim(),
  };
}

/**
 * The peer label the live stream shows for this envelope's sender. It is the
 * `origin.name` the senders set: `<cli> · <agent>` for a CLI lane and
 * `session · <agent>` for a child chat session.
 */
export function laneEnvelopePeerLabel(envelope: LaneEnvelope): string {
  const sender = envelope.cli === SESSION_CHILD_CLI ? 'session' : envelope.cli;
  return `${sender} · ${envelope.agent}`;
}
