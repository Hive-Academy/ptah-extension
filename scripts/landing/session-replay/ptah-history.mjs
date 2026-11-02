/**
 * Loads PtahCode's own session-history code so the converter replays a past
 * session through the same path `chat:resume` uses:
 *
 * - `JsonlReaderService.readJsonlMessages` / `loadAgentSessions`
 *   (libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts)
 * - `SessionReplayService.replayToStreamEvents`
 *   (libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts)
 *   as called by `SessionHistoryReaderService` (session-history-reader.service.ts).
 *
 * Live-only events reuse the live builders: `buildBackgroundAgentStartedEvent`
 * (message-transform/background-started-event.ts) and `toTurnStateEvent`
 * (helpers/session-turn-state.registry.ts).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '../../..');

require('reflect-metadata');
const { createJiti } = require('jiti');
const jiti = createJiti(import.meta.url, {
  alias: {
    '@ptah-extension/vscode-core': join(here, 'vscode-core-shim.cjs'),
    '@ptah-extension/shared': join(repoRoot, 'libs/shared/src/index.ts'),
    '@ptah-extension/auth-providers-tokens': join(
      repoRoot,
      'libs/backend/auth-providers-tokens/src/index.ts',
    ),
  },
});

/** Load a repository TypeScript module by its repo-relative path. */
export const loadRepoModule = (relativePath) => jiti(join(repoRoot, relativePath));

const HISTORY = 'libs/backend/agent-sdk/src/lib/helpers/history/';
const TRANSFORM = 'libs/backend/agent-sdk/src/lib/message-transform/';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };
/** Cost lookups use the model id as recorded and the shared pricing table. */
const identityModelResolver = {
  resolve: (model) => model,
  resolveForPricing: (model) => model,
  resolveForCost: (model) => ({ modelId: model, pricing: undefined }),
};

const { JsonlReaderService } = loadRepoModule(`${HISTORY}jsonl-reader.service.ts`);
const { SessionReplayService } = loadRepoModule(`${HISTORY}session-replay.service.ts`);
const { AgentCorrelationService } = loadRepoModule(`${HISTORY}agent-correlation.service.ts`);
const { HistoryEventFactory } = loadRepoModule(`${HISTORY}history-event-factory.ts`);
const helpers = loadRepoModule(`${TRANSFORM}message-transform-helpers.ts`);
const { buildBackgroundAgentStartedEvent } = loadRepoModule(
  `${TRANSFORM}background-started-event.ts`,
);
const { toTurnStateEvent } = loadRepoModule(
  'libs/backend/agent-sdk/src/lib/helpers/session-turn-state.registry.ts',
);
const shared = loadRepoModule('libs/shared/src/index.ts');

export const parseLaneEnvelope = shared.parseLaneEnvelope;
export const isHiddenTranscriptRecord = helpers.isHiddenTranscriptRecord;
export const isSkillOrMetaContent = helpers.isSkillOrMetaContent;
export { toTurnStateEvent };

/** Read a Claude transcript and its subagent transcripts the way PtahCode does. */
export async function readSession(sessionFile) {
  const reader = new JsonlReaderService(silentLogger);
  const sessionId = basename(sessionFile).replace(/\.jsonl$/, '');
  const sessionsDir = dirname(resolve(sessionFile));
  const messages = await reader.readJsonlMessages(resolve(sessionFile));
  const agents = await reader.loadAgentSessions(sessionsDir, sessionId);
  return { sessionId, sessionsDir, messages, agents, ...readRawFacts(sessionFile) };
}

/**
 * Facts the reader does not keep. A task notification that arrived during a
 * busy turn is stored only as a `queued_command` attachment (the reader keeps
 * attachment rows without their payload), so those are read by row uuid. The
 * row `cwd` and `gitBranch` values feed the runtime deny list of real names.
 */
function readRawFacts(sessionFile) {
  const attachments = new Map();
  const cwds = new Set();
  const branches = new Set();
  for (const line of readFileSync(resolve(sessionFile), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue; // A torn line is skipped, as the transcript reader skips it.
    }
    if (typeof row.cwd === 'string') cwds.add(row.cwd);
    if (typeof row.gitBranch === 'string') branches.add(row.gitBranch);
    if (row.type === 'attachment' && row.attachment?.type === 'queued_command') attachments.set(row.uuid, row.attachment);
  }
  return { attachments, cwds, branches };
}

/** Replay transcript messages into the FlatStreamEvent list `chat:resume` returns. */
export function replayToStreamEvents(sessionId, messages, agents) {
  const replay = new SessionReplayService(
    silentLogger,
    new AgentCorrelationService(silentLogger),
    new HistoryEventFactory(),
    identityModelResolver,
  );
  return replay.replayToStreamEvents(sessionId, messages, agents);
}

/**
 * The live `background_agent_started` event for a background Agent/Task call,
 * built by the live transformer's own builder with the identity the history
 * replay already resolved.
 */
export function backgroundAgentStarted({ toolCallId, content, messageId, sessionId, agentId, agentType, agentDescription }) {
  return buildBackgroundAgentStartedEvent({
    toolCallId,
    content,
    messageId,
    sessionId,
    state: { getBackgroundTaskInfo: () => ({ agentType, agentDescription }) },
    helpers: { subagentRegistry: { get: () => ({ agentId, agentType }) } },
  });
}
