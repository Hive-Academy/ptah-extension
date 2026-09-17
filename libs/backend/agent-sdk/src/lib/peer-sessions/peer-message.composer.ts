/**
 * The prompt Ptah composes to reach another session (TASK_2026_402, Task 10.3).
 *
 * ## Why a prompt and not a socket write
 *
 * Task 10.1 (`research-report-addressing.md`) closed the other two routes. The
 * SDK has no peer-send function and no message-shaped control request, and
 * writing the registry's `messagingSocketPath` directly means reimplementing
 * an undocumented private protocol recovered from a compiled binary — ruled
 * out of scope. What is left, route (b), is that the CLI already gives the
 * MODEL a peer-send tool. So Ptah's contribution is the prompt that asks for
 * it, composed into the user's own session.
 *
 * Two costs follow from that and are not hidden: the send consumes a turn in
 * the sending session, and the model performs it, so it may reword the message
 * or decline. Both are constants on `PeerSessionSendResult`.
 *
 * ## The honesty instruction is part of the payload
 *
 * The envelope tells the model, in the text it will act on, not to report the
 * message as received. Without it the natural summary of a successful tool
 * call is "sent it" — and a confident report of a delivery nobody observed is
 * the defect this whole task exists to fix. The rule has to travel with the
 * request, because the model, not Ptah, writes the answer the user reads.
 *
 * The envelope shape mirrors the CLI's own inbound `<cross-session-message>`
 * wrapper so there is one mental model on both sides of the channel.
 */

/** What a composed request needs to know about its target. */
export interface PeerMessageTarget {
  readonly sessionId: string;
  readonly name: string;
  readonly workspace: string;
}

/**
 * Build the turn that asks the sending session's model to relay `message`.
 *
 * The target's identifying fields are placed in attributes and the user's text
 * in the body, so a message containing angle brackets cannot be read as
 * addressing instructions.
 */
export function composePeerMessageRequest(
  target: PeerMessageTarget,
  message: string,
): string {
  return [
    `<peer-message-request target-session="${escapeAttribute(target.sessionId)}"`,
    ` target-name="${escapeAttribute(target.name)}"`,
    ` target-workspace="${escapeAttribute(target.workspace)}">`,
    '\n',
    'The user wants the message below relayed to another Claude Code session ',
    'on this machine, identified by the attributes above.\n\n',
    'Use your cross-session messaging tool to send it to that session id. ',
    'Send the message body as written — do not summarise it, and do not add ',
    'commentary of your own to it.\n\n',
    'Then report back exactly what the tool returned. The tool result tells ',
    'you only that the message was handed to the other session\'s inbox. It is ',
    'not evidence that the other session read it or acted on it, so do not ',
    'tell the user it was received, delivered or acknowledged. If the tool is ',
    'unavailable or it fails, say so plainly rather than describing the send ',
    'as successful.\n\n',
    '<message>\n',
    message,
    '\n</message>\n',
    '</peer-message-request>',
  ].join('');
}

/**
 * The caveat carried on every `peerSession:send` response.
 *
 * A constant rather than prose assembled at each call site, so there is one
 * wording to review and no path that can quietly ship a softer one.
 */
export const PEER_SEND_ACCEPTANCE_CAVEAT =
  'Accepted means the request was handed to this session for relay. Ptah ' +
  'cannot observe whether the other session received it: the send is ' +
  'performed by the model calling the CLI\'s own peer-messaging tool, and ' +
  'that tool reports only that the message reached the peer\'s inbox. Confirm ' +
  'arrival by reading the other session, never from this result.';

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
