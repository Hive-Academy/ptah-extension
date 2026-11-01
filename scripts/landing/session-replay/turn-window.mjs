/**
 * Selects the transcript window for one user turn: the turn itself plus the
 * peer turns (lane reports, lane completions, subagent notifications) that land
 * while the lanes it started are still running. Later human prompts inside that
 * span, and the assistant replies to them, are left out. Each background
 * subagent the window starts gets exactly one completion: its last recorded
 * `completed` notification, appended when it arrived after the window.
 */
import { isHiddenTranscriptRecord, isSkillOrMetaContent, parseLaneEnvelope } from './ptah-history.mjs';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const SPAWN_TOOL = /(?:^|__)ptah_agent_spawn$/;

export function textOf(message) {
  const content = message?.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  if (content.some((block) => block?.type === 'tool_result')) return '';
  return content.filter((block) => block?.type === 'text').map((block) => block.text).join('\n');
}

function blocks(message) {
  const content = message?.message?.content;
  return Array.isArray(content) ? content : [];
}

/** human | peer | notification | meta | tool-result | other */
export function classify(message) {
  if (message.type !== 'user') return 'other';
  if (blocks(message).some((block) => block?.type === 'tool_result')) return 'tool-result';
  if (isHiddenTranscriptRecord(message) || isSkillOrMetaContent(message)) return 'meta';
  const text = textOf(message).trim();
  if (!text) return 'meta';
  if (text.startsWith('<task-notification>')) return 'notification';
  if (text.startsWith('<system-reminder>')) return 'meta';
  if (parseLaneEnvelope(text)) return 'peer';
  return 'human';
}

function notificationField(text, tag) {
  return new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(text)?.[1]?.trim();
}

/**
 * A task notification as a user row. The CLI records one that arrives during a
 * busy turn as a `queued_command` attachment instead of a user row; the SDK
 * still delivered it live, so it is read as the user row it stands for.
 */
function notificationRow(message, attachments) {
  if (classify(message) === 'notification') return message;
  const attachment = message.type === 'attachment' ? attachments.get(message.uuid) : undefined;
  if (attachment?.type !== 'queued_command' || typeof attachment.prompt !== 'string'
    || !attachment.prompt.trimStart().startsWith('<task-notification>')) return null;
  return { ...message, type: 'user', message: { role: 'user', content: attachment.prompt } };
}

/** Name the spawning call in the notification so the replay binds it without a second lookup. */
function withToolUseId(message, toolUseId) {
  const text = textOf(message);
  if (notificationField(text, 'tool-use-id')) return message;
  const content = text.replace(/(<task-id>[^<]*<\/task-id>)/, `$1\n<tool-use-id>${toolUseId}</tool-use-id>`);
  return { ...message, message: { ...message.message, content } };
}

function findStart(messages, turn) {
  const humans = messages.flatMap((message, index) => (classify(message) === 'human' ? [index] : []));
  if (/^#\d+$/.test(turn)) {
    const index = humans[Number(turn.slice(1))];
    if (index === undefined) throw new Error(`No human turn ${turn}; the session has ${humans.length}`);
    return index;
  }
  const needle = turn.toLowerCase();
  const index = humans.find((i) => textOf(messages[i]).toLowerCase().includes(needle));
  if (index === undefined) throw new Error('No human turn matches --turn');
  return index;
}

/** Lane ids a ptah_agent_spawn tool result announces. */
function spawnedLaneIds(message, spawnCalls) {
  return blocks(message).flatMap((block) => {
    if (block?.type !== 'tool_result' || !spawnCalls.has(block.tool_use_id)) return [];
    const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? '');
    const id = /Agent ID:\**\s*([0-9a-f-]{36})/i.exec(text)?.[1] ?? UUID.exec(text)?.[0];
    return id ? [id.toLowerCase()] : [];
  });
}

export function selectTurnWindow(messages, { turn, endRow, attachments = new Map() }) {
  const start = findStart(messages, turn);
  const spawnCalls = new Set();
  const activeLanes = new Set();
  const excluded = [];
  let end = messages.length - 1;
  let skipping = false;
  for (let i = start; i < messages.length; i++) {
    if (endRow !== undefined && i > endRow) { end = endRow; break; }
    const message = messages[i];
    const kind = classify(message);
    if (i > start && kind === 'human') {
      if (endRow === undefined && activeLanes.size === 0) { end = i - 1; break; }
      skipping = true;
    } else if (kind === 'peer' || kind === 'notification') {
      skipping = false;
    }
    if (skipping) { excluded.push(i); continue; }
    for (const block of blocks(message)) {
      if (block?.type === 'tool_use' && SPAWN_TOOL.test(block.name)) spawnCalls.add(block.id);
    }
    for (const id of spawnedLaneIds(message, spawnCalls)) activeLanes.add(id);
    const envelope = kind === 'peer' ? parseLaneEnvelope(textOf(message)) : null;
    if (envelope?.kind === 'completed') activeLanes.delete(envelope.agentId.toLowerCase());
  }
  const skip = new Set(excluded);
  let rows = [];
  for (let i = start; i <= end; i++) if (!skip.has(i)) rows.push({ index: i, message: messages[i] });

  const subagentCalls = new Set(rows.flatMap(({ message }) => blocks(message)
    .filter((block) => block?.type === 'tool_use' && block.input?.run_in_background === true && block.input?.subagent_type)
    .map((block) => block.id)));
  // A notification names its subagent by tool-use id, or only by task id (the agent id).
  const callByAgent = new Map();
  for (const { message } of rows) {
    for (const block of blocks(message)) {
      if (block?.type !== 'tool_result' || !subagentCalls.has(block.tool_use_id)) continue;
      const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? '');
      const agentId = /agentId:\s*([A-Za-z0-9_-]+)/.exec(text)?.[1];
      if (agentId) callByAgent.set(agentId, block.tool_use_id);
    }
  }
  const callOf = (text) => {
    const toolUseId = notificationField(text, 'tool-use-id');
    return toolUseId && subagentCalls.has(toolUseId) ? toolUseId : callByAgent.get(notificationField(text, 'task-id'));
  };
  const finalNotice = new Map();
  messages.forEach((message, index) => {
    const notice = notificationRow(message, attachments);
    if (!notice) return;
    const text = textOf(notice);
    const call = callOf(text);
    if (call && notificationField(text, 'status') === 'completed') finalNotice.set(call, index);
  });
  const keepNotice = new Set(finalNotice.values());
  rows = rows.filter(({ index, message }) => classify(message) !== 'notification' || !callOf(textOf(message)) || keepNotice.has(index));
  const lateCalls = new Set();
  for (const [call, index] of [...finalNotice].sort((a, b) => a[1] - b[1])) {
    if (index <= end) continue;
    lateCalls.add(call);
    rows.push({ index, message: withToolUseId(notificationRow(messages[index], attachments), call), late: true });
  }
  return {
    start,
    end,
    excluded,
    rows,
    lateNoticeToolIds: lateCalls,
    laneIds: new Set([...spawnedLaneIdsInRows(rows, spawnCalls), ...envelopeLaneIds(rows)]),
    subagentCalls,
  };
}

function spawnedLaneIdsInRows(rows, spawnCalls) {
  return rows.flatMap(({ message }) => spawnedLaneIds(message, spawnCalls));
}

function envelopeLaneIds(rows) {
  return rows.flatMap(({ message }) => {
    const envelope = classify(message) === 'peer' ? parseLaneEnvelope(textOf(message)) : null;
    return envelope && envelope.cli !== 'subagent' ? [envelope.agentId.toLowerCase()] : [];
  });
}
