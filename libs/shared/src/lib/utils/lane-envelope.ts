/**
 * Lane envelopes: the text a lane or a child session sends into its parent
 * session as a peer turn (`<agent-report …>` from `AgentReportRouter`,
 * `<agent-lane-completed …>` from `LaneCompletionNotifier`, an SDK
 * subagent's `<agent-message …>`, or another Claude Code session's
 * `<cross-session-message …>`).
 *
 * The live echo carries no `origin`; live attribution uses the yielded-entry
 * identity. The CLI does not write `origin` to the JSONL transcript, so history
 * recognises a peer turn by this envelope. The webview uses the same parse to
 * render a compact header instead of the raw tags.
 *
 * Every value here is display text. The attributes are self-reported by the
 * sender and must never be used as an identity or to authorize anything.
 */

export type LaneEnvelopeKind = 'report' | 'completed';

export interface LaneEnvelope {
  readonly kind: LaneEnvelopeKind;
  /** `agent-id` attribute, or `from` for an SDK subagent message. */
  readonly agentId: string;
  /** The lane label, or a short sender id for an SDK subagent message. */
  readonly agent: string;
  /** `cli` attribute; `subagent` for an SDK subagent message. */
  readonly cli: string;
  /** `status` attribute of a completion envelope. */
  readonly status?: string;
  /** `verdict` attribute of a completion envelope. */
  readonly verdict?: string;
  /** The text between the opening and the closing tag, trimmed. */
  readonly body: string;
  /** Set for a `<cross-session-message>` from another Claude Code session. */
  readonly crossSession?: true;
}

const TAG_KIND: Readonly<Record<string, LaneEnvelopeKind>> = {
  'agent-report': 'report',
  'agent-lane-completed': 'completed',
};

const ENVELOPE_PATTERN =
  /^\s*<(agent-report|agent-lane-completed)((?:\s+[a-z-]+="[^"]*")*)\s*>\n?([\s\S]*?)\n?<\/\1>\s*$/;

// The SDK safety trailer is one paragraph: a blank line after it starts other
// text, which must stay visible, so the whole message is then not an envelope.
const SDK_ENVELOPE_PATTERN =
  /^\s*(?:Another Claude session sent a message:\s*)?<agent-message\s+from\s*=\s*"([^"]+)"\s*>\n?([\s\S]*?)\n?<\/agent-message>(?:\s*That "other Claude session"[^\n]*(?:\n(?![ \t]*\n)[^\n]*)*)?\s*$/;
// A full opening tag with a `from` attribute; a bare `<agent-message` mention in
// the body is not a second envelope.
const SDK_ENVELOPE_TAG_PATTERN = /<agent-message\s+from\s*=\s*"[^"]*"\s*>/g;

// The CLI wraps a message from another Claude Code session in a preamble, the
// envelope and a one-paragraph safety trailer, like the SDK subagent form.
const CROSS_SESSION_PATTERN =
  /^\s*(?:Another Claude session sent a message:\s*)?<cross-session-message((?:\s+[a-z-]+="[^"]*")*)\s*>\n?([\s\S]*?)\n?<\/cross-session-message>(?:\s*This came from another Claude session[^\n]*(?:\n(?![ \t]*\n)[^\n]*)*)?\s*$/;
const CROSS_SESSION_TAG_PATTERN = /<cross-session-message(?:\s[^>]*)?>/g;

/** The `cli` value of a cross-session message: the sender is a Claude session. */
const CROSS_SESSION_CLI = 'claude';

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

function parseAttributes(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const [, name, value] of source.matchAll(ATTRIBUTE_PATTERN)) {
    attributes.set(name, unescapeAttribute(value));
  }
  return attributes;
}

function parseCrossSessionEnvelope(text: string): LaneEnvelope | null {
  if ([...text.matchAll(CROSS_SESSION_TAG_PATTERN)].length !== 1) return null;
  const match = CROSS_SESSION_PATTERN.exec(text);
  if (!match) return null;
  const attributes = parseAttributes(match[1]);
  const agentId = attributes.get('from')?.trim();
  if (!agentId) return null;
  return {
    kind: 'report',
    agentId,
    agent: attributes.get('from-name')?.trim() || 'Claude session',
    cli: CROSS_SESSION_CLI,
    body: match[2].trim(),
    crossSession: true,
  };
}

function parseSdkEnvelope(text: string): LaneEnvelope | null {
  if ([...text.matchAll(SDK_ENVELOPE_TAG_PATTERN)].length !== 1) return null;
  const match = SDK_ENVELOPE_PATTERN.exec(text);
  if (!match) return null;
  const agentId = unescapeAttribute(match[1]).trim();
  if (!agentId) return null;
  return {
    kind: 'report',
    agentId,
    agent: agentId.slice(0, 8),
    cli: 'subagent',
    body: match[2].trim(),
  };
}

/**
 * Parse one whole-message lane envelope. Returns `null` when the text is not
 * exactly one supported envelope, or when its required attributes are missing.
 */
export function parseLaneEnvelope(text: string): LaneEnvelope | null {
  const match = ENVELOPE_PATTERN.exec(text);
  if (!match) return parseSdkEnvelope(text) ?? parseCrossSessionEnvelope(text);
  const attributes = parseAttributes(match[2]);
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
 * `session · <agent>` for a child chat session. SDK subagents have no CLI
 * origin name in history, so their short sender id is the fallback. Another
 * Claude Code session's origin name is its self-reported session name.
 */
export function laneEnvelopePeerLabel(envelope: LaneEnvelope): string {
  if (envelope.cli === 'subagent' || envelope.crossSession)
    return envelope.agent;
  const sender = envelope.cli === SESSION_CHILD_CLI ? 'session' : envelope.cli;
  return `${sender} · ${envelope.agent}`;
}
