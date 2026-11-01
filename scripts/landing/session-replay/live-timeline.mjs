/**
 * Turns the history events of a transcript window into the push messages the
 * webview consumes during a live turn, in real-time order, then compresses the
 * timing into a watchable replay.
 *
 * - Chat events come from `SessionReplayService` unchanged in shape; only their
 *   `source`, ids and timestamps change, and root assistant text is split into
 *   `stream` deltas the way a live turn delivers it.
 * - Background subagents get the live-only events: `background_agent_started`
 *   (live builder), `agent_progress`, `background_agent_completed` and the
 *   `session:subagentEnded` push (shapes from system-message.transformer.ts and
 *   SdkSubagentEndedPayload).
 * - CLI lanes become `agent-monitor:spawned` / `output` / `exited` pushes from
 *   their recorded references and output.
 */
import { backgroundAgentStarted, toTurnStateEvent } from './ptah-history.mjs';
import { excerpt, truncate } from './synthetic-text.mjs';

export const DEMO_SESSION_ID = '11111111-1111-4111-8111-111111111111';
export const DEMO_WORKSPACE = '/workspace/acme-app';
const CHUNK_GAP_MS = 45;
const MIN_GAP_MS = 90;
const MAX_GAP_MS = 2600;
const SAME_TIME_GAP_MS = 30;
const LEAD_MS = 400;

const streamOf = (event) => (event.eventType === 'agent_start' || event.eventType === 'agent_completed'
  ? 'main' : event.parentToolUseId ?? 'main');

function indexTimes(messages, agents) {
  const toolUse = new Map();
  const toolResult = new Map();
  const texts = new Map();
  const add = (message) => {
    const ts = Date.parse(message.timestamp);
    if (!Number.isFinite(ts)) return;
    const content = message.message?.content;
    const list = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
    for (const block of list) {
      if (block?.type === 'tool_use') toolUse.set(block.id, ts);
      else if (block?.type === 'tool_result') toolResult.set(block.tool_use_id, ts);
      else if (block?.type === 'text' || block?.type === 'thinking') {
        const key = String(block.text ?? block.thinking ?? '').trim();
        if (!key) continue;
        if (!texts.has(key)) texts.set(key, []);
        texts.get(key).push(ts);
      }
    }
  };
  messages.forEach(add);
  for (const agent of agents) agent.messages.forEach(add);
  return { toolUse, toolResult, texts };
}

/** Real time of each event: its own transcript row, else its message, else the previous event. */
function timeEvents(events, index) {
  const byMessage = new Map();
  for (const event of events) {
    let t;
    if (event.eventType === 'tool_start' || event.eventType === 'agent_start') t = index.toolUse.get(event.toolCallId);
    else if (event.eventType === 'tool_result') t = index.toolResult.get(event.toolCallId);
    else if (event.eventType === 'text_delta' || event.eventType === 'thinking_delta') {
      t = index.texts.get(String(event.delta ?? '').trim())?.shift();
    } else if (event.eventType === 'agent_completed' || (event.eventType === 'message_start' && event.role === 'user')) {
      t = event.timestamp;
    }
    event.__t = t;
    if (!byMessage.has(event.messageId)) byMessage.set(event.messageId, []);
    byMessage.get(event.messageId).push(event);
  }
  for (const list of byMessage.values()) {
    const known = list.map((event) => event.__t).filter(Number.isFinite);
    if (!known.length) continue;
    for (const event of list) {
      if (Number.isFinite(event.__t)) continue;
      if (event.eventType === 'message_start') event.__t = Math.min(...known);
      if (event.eventType === 'message_complete') event.__t = Math.max(...known);
    }
  }
  const last = new Map();
  for (const event of events) {
    const stream = streamOf(event);
    const previous = last.get(stream);
    if (!Number.isFinite(event.__t)) event.__t = previous ?? event.timestamp;
    if (previous !== undefined && event.__t < previous) event.__t = previous;
    last.set(stream, event.__t);
  }
}

function splitWords(text, size) {
  const parts = text.match(/\S+\s*|\s+/g) ?? [text];
  const chunks = [];
  for (let i = 0; i < parts.length; i += size) chunks.push(parts.slice(i, i + size).join(''));
  return chunks;
}

function evenly(list, count) {
  if (list.length <= count) return list;
  const picked = new Set([0, list.length - 1]);
  for (let i = 1; picked.size < count; i++) picked.add(Math.round((i * (list.length - 1)) / count));
  return [...picked].sort((a, b) => a - b).map((i) => list[i]);
}

function toolOutputText(output) {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) return output.map((block) => (typeof block === 'string' ? block : block?.text ?? '')).join('\n');
  return output == null ? '' : JSON.stringify(output);
}

export function buildLiveTimeline({ events, window, agents, lanes, rewriter, options }) {
  const sid = DEMO_SESSION_ID;
  const rw = (text) => rewriter.text(text);
  const items = [];
  let seq = 0;
  const add = (t, message, stream = false) => items.push({ t, seq: seq++, stream, message });
  const chunk = (t, event, stream = false) => add(t, { type: 'chat:chunk', payload: { sessionId: sid, event } }, stream);

  timeEvents(events, indexTimes(window.rows.map((row) => row.message), agents));
  const promptId = window.rows[0].message.uuid;
  const mainEvents = events.filter((event) => streamOf(event) === 'main' && event.messageId !== promptId);
  const lateIds = window.lateNoticeToolIds;
  const rowTimes = window.rows.filter((row) => !row.late).map((row) => Date.parse(row.message.timestamp)).filter(Number.isFinite);
  const windowStart = Math.min(...rowTimes);
  const windowEnd = Math.max(...rowTimes);

  // Subagents: one card each, a few real steps spread evenly over its run, one completion.
  const starts = mainEvents.filter((event) => event.eventType === 'agent_start');
  const completions = new Map();
  for (const event of mainEvents) if (event.eventType === 'agent_completed') completions.set(event.parentToolUseId, event);
  const late = starts.filter((start) => lateIds.has(start.toolCallId));
  const spacing = Math.max(4000, (windowEnd - windowStart) * 0.02);
  const subagents = new Map();
  for (const start of starts) {
    const completion = completions.get(start.toolCallId);
    const lateIndex = late.indexOf(start);
    const end = lateIndex >= 0 ? windowEnd - (late.length - lateIndex) * spacing
      : completion?.__t ?? windowEnd - spacing;
    subagents.set(start.toolCallId, { start, completion, end: Math.max(end, start.__t + 2000) });
  }
  for (const [toolCallId, agent] of subagents) {
    const nested = events.filter((event) => event.parentToolUseId === toolCallId && streamOf(event) !== 'main'
      && event.eventType !== 'thinking_delta');
    const tools = nested.filter((event) => event.eventType === 'tool_start').slice(0, options.subagentSteps);
    const keepTools = new Set(tools.map((event) => event.toolCallId));
    const texts = nested.filter((event) => event.eventType === 'text_delta' && String(event.delta ?? '').trim());
    const lastToolAt = tools.length ? nested.indexOf(tools.at(-1)) : 0;
    const keepTexts = new Set([texts.find((event) => nested.indexOf(event) < lastToolAt), texts.at(-1)].filter(Boolean));
    const content = nested.filter((event) => keepTexts.has(event)
      || ((event.eventType === 'tool_start' || event.eventType === 'tool_result') && keepTools.has(event.toolCallId)));
    const units = content.filter((event) => event.eventType !== 'tool_result');
    const span = agent.end - agent.start.__t;
    units.forEach((event, k) => { event.__t = agent.start.__t + ((k + 1) / (units.length + 1)) * span; });
    for (const event of content) {
      if (event.eventType !== 'tool_result') continue;
      const owner = units.find((unit) => unit.toolCallId === event.toolCallId);
      event.__t = (owner?.__t ?? agent.start.__t) + span / (units.length + 1) / 2;
    }
    const messageIds = new Set(content.map((event) => event.messageId));
    for (const event of nested) {
      if (content.includes(event)) continue;
      if (!messageIds.has(event.messageId) || (event.eventType !== 'message_start' && event.eventType !== 'message_complete')) continue;
      const times = content.filter((other) => other.messageId === event.messageId).map((other) => other.__t);
      event.__t = event.eventType === 'message_start' ? Math.min(...times) - 1 : Math.max(...times) + 1;
      content.push(event);
    }
    agent.nested = content;
    agent.tools = tools;
  }

  const background = new Set(starts.filter((start) => start.agentId).map((start) => start.toolCallId));
  const rootAssistant = new Set(mainEvents.filter((event) => event.eventType === 'message_start' && event.role === 'assistant')
    .map((event) => event.messageId));
  let revision = 1;
  chunk(windowStart - 1, toTurnStateEvent(sid, { phase: 'generating', revision: ++revision, backgroundTasks: [], sessionCrons: [],
    terminalReason: null, lastAssistantMessage: null, timestamp: windowStart }));

  const stats = createStats(options.statsTemplate, sid);
  let lastText = '';
  for (const event of mainEvents) {
    if (event.eventType === 'thinking_delta') continue;
    const base = { ...event, sessionId: sid, source: 'complete' };
    if (event.eventType === 'agent_completed') {
      const agent = subagents.get(event.parentToolUseId);
      if (!agent) continue;
      const t = agent.end;
      const summary = truncate(rw(event.summary ?? ''), 240);
      chunk(t, { ...base, summary, outputFile: '' });
      chunk(t, { id: `${event.id}-bg`, eventType: 'background_agent_completed', timestamp: t, sessionId: sid, source: 'complete',
        messageId: event.messageId, toolCallId: event.parentToolUseId, agentId: agent.start.agentId,
        agentType: agent.start.agentType, result: summary });
      add(t, { type: 'session:subagentEnded', payload: { sessionId: sid, cwd: DEMO_WORKSPACE, agentId: agent.start.agentId,
        agentType: agent.start.agentType, toolCallId: event.parentToolUseId, lastAssistantMessage: summary,
        backgroundTasks: [], timestamp: t } });
      continue;
    }
    if (event.eventType === 'agent_start') {
      chunk(event.__t, { ...base, agentDescription: rw(event.agentDescription), agentPrompt: truncate(rw(event.agentPrompt ?? ''), 280) });
      const agent = subagents.get(event.toolCallId);
      for (const nested of agent?.nested ?? []) addNested(nested, agent);
      continue;
    }
    if (event.eventType === 'tool_start') {
      chunk(event.__t, { ...base, toolInput: rewriteInput(event.toolInput, rw) });
      continue;
    }
    if (event.eventType === 'tool_result') {
      const agent = subagents.get(event.toolCallId);
      if (agent && background.has(event.toolCallId)) {
        chunk(event.__t, backgroundAgentStarted({ toolCallId: event.toolCallId, content: event.output, messageId: event.messageId,
          sessionId: sid, agentId: agent.start.agentId, agentType: agent.start.agentType,
          agentDescription: rw(agent.start.agentDescription) }));
      }
      chunk(event.__t, { ...base, output: excerpt(rw(toolOutputText(event.output)), 6, 420) });
      continue;
    }
    if (event.eventType === 'text_delta') {
      const text = rw(event.delta ?? '');
      if (!text.trim()) continue;
      if (event.role !== 'user' && rootAssistant.has(event.messageId)) {
        lastText = text;
        splitWords(text, options.chunkWords).forEach((delta, i) => chunk(event.__t, { ...base, id: `${event.id}-${i}`, delta, source: 'stream' }, i > 0));
      } else {
        chunk(event.__t, { ...base, delta: rewriteEnvelope(text, options) });
      }
      continue;
    }
    if (event.eventType === 'message_start') {
      chunk(event.__t, { ...base, source: event.role === 'assistant' ? 'stream' : 'complete' });
      continue;
    }
    if (event.eventType === 'message_complete') {
      const { cost, ...rest } = withPublicUsage(base);
      chunk(event.__t, Number.isFinite(cost) ? { ...rest, cost } : rest);
      if (rootAssistant.has(event.messageId) && event.tokenUsage) {
        stats.addUsage(event);
        add(event.__t, { type: 'session:stats-live', payload: stats.live({ agents: countBefore(starts, event.__t),
          cliAgents: lanesBefore(lanes, event.__t) }) });
      }
      continue;
    }
    chunk(event.__t, base);
  }

  function addNested(event, agent) {
    const base = { ...event, sessionId: sid, source: 'complete' };
    if (event.eventType === 'tool_start') {
      chunk(event.__t, { ...base, toolInput: rewriteInput(event.toolInput, rw) });
      const index = agent.tools.indexOf(event);
      chunk(event.__t, { id: `${event.id}-progress`, eventType: 'agent_progress', timestamp: event.__t, sessionId: sid,
        messageId: `task_${agent.start.agentId}`, parentToolUseId: agent.start.toolCallId, taskId: agent.start.agentId,
        description: rw(agent.start.agentDescription), lastToolName: event.toolName, toolUses: index + 1,
        totalTokens: tokensBefore(agent.nested, event.__t),
        durationMs: Math.round(event.__t - agent.start.__t), agentId: agent.start.agentId });
    } else if (event.eventType === 'tool_result') {
      chunk(event.__t, { ...base, output: excerpt(rw(toolOutputText(event.output)), 4, 300) });
    } else if (event.eventType === 'text_delta') {
      chunk(event.__t, { ...base, delta: truncate(rw(event.delta ?? ''), 600) });
    } else {
      const { cost, ...rest } = withPublicUsage(base);
      chunk(event.__t, Number.isFinite(cost) ? { ...rest, cost } : rest);
    }
  }

  for (const lane of lanes) addLane(lane);

  function addLane(lane) {
    const spawnResult = mainEvents.find((event) => event.eventType === 'tool_result'
      && toolOutputText(event.output).toLowerCase().includes(lane.agentId.toLowerCase()));
    const spawnCall = spawnResult && mainEvents.find((event) => event.eventType === 'tool_start' && event.toolCallId === spawnResult.toolCallId);
    const start = spawnResult ? spawnResult.__t - 1 : Math.max(Date.parse(lane.startedAt), windowStart);
    let end = Math.min(Date.parse(lane.completedAt ?? lane.startedAt), windowEnd);
    if (!(end > start + 1500)) end = start + 1500;
    const info = lane.output.segments.find((segment) => segment.type === 'info')?.content ?? '';
    const model = lane.modelScope ?? /\(model: ([^)\s]+)/.exec(info)?.[1]?.replace(/\[.*$/, '');
    const displayName = lane.displayName;
    const process = {
      agentId: lane.agentId, cli: lane.cli, task: truncate(rw(lane.task ?? ''), 220), workingDirectory: DEMO_WORKSPACE,
      status: 'running', startedAt: new Date(start).toISOString(), parentSessionId: sid,
      ...(displayName ? { displayName } : {}), ...(model ? { model } : {}),
      ...(spawnCall?.toolInput?.role ? { role: spawnCall.toolInput.role } : {}),
      ...(lane.cli === 'ptah-cli' ? { ptahCliId: 'demo-ptah-cli', ptahCliName: displayName ?? 'PtahCode CLI' } : {}),
    };
    add(start, { type: 'agent-monitor:spawned', payload: process });
    const units = lane.output.streamEvents.length ? streamUnits(lane, rw, options) : segmentUnits(lane, rw, options);
    units.forEach((unit, k) => {
      const t = start + ((k + 1) / (units.length + 1)) * (end - start);
      add(t, { type: 'agent-monitor:output', payload: { agentId: lane.agentId, stdoutDelta: '', stderrDelta: '', timestamp: t, ...unit } });
    });
    add(end, { type: 'agent-monitor:exited', payload: { ...process, status: 'completed', completedAt: new Date(end).toISOString(), exitCode: 0 } });
  }

  return compress(items, { stats, options, lastText, sid, revision, starts, lanes });
}

function rewriteInput(input, rw) {
  if (!input || typeof input !== 'object') return input;
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') out[key] = truncate(rw(value), key === 'prompt' || key === 'task' ? 280 : 400);
    else if (Array.isArray(value)) out[key] = value.slice(0, 6).map((item) => (typeof item === 'string' ? rw(item) : rewriteInput(item, rw)));
    else if (value && typeof value === 'object') out[key] = rewriteInput(value, rw);
    else out[key] = value;
  }
  return out;
}

/** Keep the lane envelope tags intact and shorten only the body. */
function rewriteEnvelope(text, options) {
  const match = /^(\s*<(agent-report|agent-lane-completed)\b[^>]*>\n?)([\s\S]*?)(\n?<\/\2>\s*)$/.exec(text);
  if (!match) return truncate(text, options.peerChars);
  return `${match[1]}${truncate(match[3], options.peerChars)}${match[4]}`;
}

function segmentUnits(lane, rw, options) {
  const merged = [];
  for (const segment of lane.output.segments) {
    if (!segment?.type || segment.type === 'info' && merged.length) continue;
    const previous = merged.at(-1);
    if (previous && previous.type === segment.type && (segment.type === 'text' || segment.type === 'thinking')) {
      previous.content += segment.content ?? '';
    } else {
      merged.push({ ...segment, content: segment.content ?? '' });
    }
  }
  const useful = merged.filter((segment) => segment.type !== 'thinking' && (segment.content.trim() || segment.toolName));
  return evenly(useful, options.laneSegments).map((segment) => {
    // Raw CLI adapters put the shell command line in `toolName` / `toolArgs`, so every string field is content here.
    const out = {};
    for (const [key, value] of Object.entries(segment)) {
      out[key] = typeof value === 'string' && key !== 'type' ? truncate(rw(value), 240) : value;
    }
    out.content = segment.type === 'text' ? truncate(rw(segment.content), 360) : excerpt(rw(segment.content), 4, 260);
    if (segment.toolInput) out.toolInput = rewriteInput(segment.toolInput, rw);
    return { segments: [out] };
  });
}

function streamUnits(lane, rw, options) {
  const keep = new Set(['message_start', 'text_delta', 'tool_start', 'tool_result', 'message_complete']);
  const messages = new Map();
  for (const event of lane.output.streamEvents) {
    if (!keep.has(event.eventType)) continue;
    if (!messages.has(event.messageId)) messages.set(event.messageId, []);
    const list = messages.get(event.messageId);
    const previous = list.at(-1);
    if (event.eventType === 'text_delta' && previous?.eventType === 'text_delta' && previous.blockIndex === event.blockIndex) {
      previous.delta += event.delta ?? '';
    } else if (event.eventType === 'message_complete' && list.some((other) => other.eventType === 'message_complete')) {
      continue;
    } else {
      list.push({ ...event });
    }
  }
  const useful = [...messages.values()].filter((list) => list.some((event) => event.eventType === 'tool_start'
    || (event.eventType === 'text_delta' && event.delta?.trim())));
  const info = lane.output.segments.find((segment) => segment.type === 'info');
  const units = info ? [{ segments: [{ type: 'info', content: excerpt(rw(info.content), 1, 160) }] }] : [];
  for (const list of evenly(useful, options.laneSegments)) {
    units.push({ streamEvents: list.map((event) => {
      const out = { ...withPublicUsage(event), source: 'complete' };
      if (event.eventType === 'text_delta') out.delta = truncate(rw(event.delta ?? ''), 420);
      if (event.eventType === 'tool_start') out.toolInput = rewriteInput(event.toolInput, rw);
      if (event.eventType === 'tool_result') out.output = excerpt(rw(toolOutputText(event.output)), 4, 260);
      return out;
    }) });
  }
  return units;
}

function countBefore(starts, t) {
  return starts.filter((start) => start.__t <= t).length;
}

function lanesBefore(lanes, t) {
  return [...new Set(lanes.filter((lane) => Date.parse(lane.startedAt) <= t).map((lane) => lane.cli))];
}

function createStats(template, sid) {
  const totals = { input: 0, output: 0, cost: 0, messages: 0, model: template.live.sessionStats.model, revision: 0 };
  return {
    addUsage(event) {
      totals.input += event.tokenUsage.input ?? 0;
      totals.output += event.tokenUsage.output ?? 0;
      totals.cost += Number.isFinite(event.cost) ? event.cost : 0;
      totals.messages += 1;
      if (event.model) totals.model = event.model;
    },
    sessionStats({ agents, cliAgents, provisional }) {
      const stats = structuredClone(template.live.sessionStats);
      const cost = Number(totals.cost.toFixed(4));
      Object.assign(stats, {
        sessionId: sid, model: totals.model, totalCost: cost, knownCost: cost,
        tokens: { input: totals.input, output: totals.output, cacheRead: 0, cacheCreation: 0 },
        tokenCount: totals.input + totals.output, messageCount: totals.messages, agentSessionCount: agents,
        cliAgents, revision: ++totals.revision,
      });
      stats.modelUsageList = [{ ...stats.modelUsageList[0], model: totals.model, inputTokens: totals.input,
        outputTokens: totals.output, cacheRead: 0, cacheCreation: 0, costUSD: cost }];
      if (provisional) stats.provisional = true; else delete stats.provisional;
      return stats;
    },
    live(context) {
      const payload = structuredClone(template.live);
      payload.sessionId = sid;
      payload.sessionStats = this.sessionStats({ ...context, provisional: true });
      payload.context = { ...payload.context, model: totals.model, contextTokens: Math.min(totals.input + totals.output, 180000) };
      return payload;
    },
    result(context, duration) {
      const payload = structuredClone(template.result);
      const sessionStats = this.sessionStats({ ...context, provisional: false });
      Object.assign(payload, { sessionId: sid, turnCost: sessionStats.totalCost, tokens: sessionStats.tokens, duration, sessionStats });
      payload.modelUsage = [{ ...payload.modelUsage[0], model: totals.model, inputTokens: totals.input, outputTokens: totals.output,
        cacheReadInputTokens: 0, costUSD: sessionStats.totalCost,
        contextCapacity: { ...payload.modelUsage[0].contextCapacity, model: totals.model } }];
      return payload;
    },
  };
}

/** Real-time order → replay time: gaps scale by one factor, clamped, solved for the target length. */
function compress(items, { stats, options, lastText, sid, revision, starts, lanes }) {
  items.sort((a, b) => a.t - b.t || a.seq - b.seq);
  const gap = (item, previous, scale) => {
    if (item.stream) return CHUNK_GAP_MS;
    const real = item.t - previous.t;
    return real <= 0 ? SAME_TIME_GAP_MS : Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, real * scale));
  };
  const tail = 1400;
  const total = (scale) => items.reduce((sum, item, i) => sum + (i ? gap(item, items[i - 1], scale) : 0), LEAD_MS + tail);
  const target = options.durationMs;
  if (total(0) > target) throw new Error(`Window too dense for ${target} ms; raise --duration or lower the step limits`);
  let low = 0;
  let high = 1;
  while (total(high) < target && high < 1e6) high *= 2;
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (total(mid) < target) low = mid; else high = mid;
  }
  const scale = (low + high) / 2;
  const timeline = [];
  let at = LEAD_MS;
  const realToAt = new Map();
  items.forEach((item, i) => {
    if (i) at += gap(item, items[i - 1], scale);
    const rounded = Math.round(at);
    realToAt.set(item, rounded);
    timeline.push({ at: rounded, item });
  });
  const end = at;
  const finalContext = { agents: starts.length, cliAgents: [...new Set(lanes.map((lane) => lane.cli))] };
  const tailItems = [
    { at: end + 300, message: { type: 'session:stats', payload: stats.result(finalContext, Math.round(end)) } },
    { at: end + 600, message: { type: 'chat:chunk', payload: { sessionId: sid, event: toTurnStateEvent(sid, {
      phase: 'idle', revision: revision + 1, backgroundTasks: [], sessionCrons: [], terminalReason: 'completed',
      lastAssistantMessage: truncate(lastText, 280), timestamp: 0 }) } } },
    { at: end + 900, message: { type: 'session:turnEnded', payload: { sessionId: sid, cwd: DEMO_WORKSPACE,
      lastAssistantMessage: truncate(lastText, 280), backgroundTasks: [], sessionCrons: [], terminalReason: 'completed', timestamp: 0 } } },
    { at: end + 1200, message: { type: 'session:stats-live', payload: stats.live(finalContext) } },
  ];
  return { scale, entries: [...timeline.map(({ at: when, item }) => ({ at: when, message: item.message })), ...tailItems] };
}

/** Cumulative input + output tokens of a subagent's messages completed by `t`. */
function tokensBefore(nested, t) {
  return nested.filter((event) => event.eventType === 'message_complete' && event.__t <= t && event.tokenUsage)
    .reduce((sum, event) => sum + (event.tokenUsage.input ?? 0) + (event.tokenUsage.output ?? 0), 0);
}

/** Keep only the `MessageCompleteEvent.tokenUsage` fields the webview contract declares. */
function withPublicUsage(event) {
  if (!event.tokenUsage) return event;
  const { input = 0, output = 0, contextTokens } = event.tokenUsage;
  return { ...event, tokenUsage: Number.isFinite(contextTokens) ? { input, output, contextTokens } : { input, output } };
}
