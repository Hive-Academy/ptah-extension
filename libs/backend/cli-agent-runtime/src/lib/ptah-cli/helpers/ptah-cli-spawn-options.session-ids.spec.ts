/**
 * PtahCliSpawnOptions — the two session ids a spawn's hooks receive
 * (TASK_2026_295).
 *
 * Both hook handlers were being built with the wrong identity, and both
 * failures were silent:
 *
 *  1. `subagentHookHandler.createHooks(cwd)` passed NO parentSessionId, so
 *     every subagent started inside a Ptah CLI agent failed
 *     `handleSubagentStart`'s `toolUseId && parentSessionId` gate and was never
 *     registered — `subagent:send-message`, `subagent:stop`, background listing
 *     and resume were all dead for them.
 *  2. `compactionHookHandler.createHooks('', cwd)` hardcoded an empty session
 *     id. Since TASK_2026_293 the handler treats `''` as absent and skips the
 *     fan-out, so a PreCompact payload without `session_id` never reached the
 *     memory curator.
 *
 * The second fix is NOT "pass the parent id": `MemoryCuratorService` feeds a
 * compaction's session id straight into `transcriptReader.read(sessionId, cwd)`,
 * so the parent's id there would curate the PARENT's conversation as if the
 * child had compacted. The compaction hook gets this agent's OWN id or the
 * absent marker — nothing else.
 *
 * Source-under-test:
 *   libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.service.ts
 */

import 'reflect-metadata';

import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import type { AuthEnv } from '@ptah-extension/shared';

// Same reason as the output-style spec: the `agent-generation` barrel reaches
// `workspace-intelligence`'s tree-sitter loader and its `import.meta.url`,
// which this Jest transform cannot parse. Only the DI token is needed.
jest.mock('@ptah-extension/agent-generation', () => ({
  AGENT_GENERATION_TOKENS: {
    ENHANCED_PROMPTS_SERVICE: Symbol.for('EnhancedPromptsService'),
  },
}));

import { PtahCliSpawnOptions } from './ptah-cli-spawn-options.service';

const AUTH_ENV = {
  ANTHROPIC_BASE_URL: 'http://127.0.0.1:51830',
} as unknown as AuthEnv;

const PARENT_SESSION = '11111111-2222-4333-8444-555555555555';
const OWN_SESSION = '99999999-8888-4777-8666-555555555555';

function buildService(): {
  service: PtahCliSpawnOptions;
  subagentCreateHooks: jest.Mock;
  compactionCreateHooks: jest.Mock;
  logger: ReturnType<typeof createMockLogger>;
} {
  const subagentCreateHooks = jest.fn().mockReturnValue({});
  const compactionCreateHooks = jest.fn().mockReturnValue({});
  const logger = createMockLogger();

  const service = new PtahCliSpawnOptions(
    logger as unknown as Logger,
    { createHooks: subagentCreateHooks } as never,
    { createHooks: compactionCreateHooks } as never,
    { getConfig: jest.fn().mockReturnValue({ enabled: false }) } as never,
    {
      getProjectGuidanceContent: jest.fn().mockResolvedValue(undefined),
    } as never,
    undefined,
    undefined,
  );

  return { service, subagentCreateHooks, compactionCreateHooks, logger };
}

describe('PtahCliSpawnOptions — hook session ids', () => {
  describe('subagent hooks', () => {
    it('passes the parent session id so nested subagents get registered', async () => {
      const { service, subagentCreateHooks } = buildService();

      await service.assembleSpawnOptions(AUTH_ENV, '/repo', undefined, 'opus', {
        parentSessionId: PARENT_SESSION,
      });

      expect(subagentCreateHooks).toHaveBeenCalledWith('/repo', PARENT_SESSION);
    });

    it('treats a blank parent session id as absent, not as an id', async () => {
      const { service, subagentCreateHooks } = buildService();

      await service.assembleSpawnOptions(AUTH_ENV, '/repo', undefined, 'opus', {
        parentSessionId: '',
      });

      expect(subagentCreateHooks).toHaveBeenCalledWith('/repo', undefined);
    });

    it('warns — instead of dropping subagents silently — when there is no parent', async () => {
      const { service, logger } = buildService();

      await service.assembleSpawnOptions(AUTH_ENV, '/repo');

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No parent session id'),
        expect.anything(),
      );
    });

    it('does not warn when a parent session id is present', async () => {
      const { service, logger } = buildService();

      await service.assembleSpawnOptions(AUTH_ENV, '/repo', undefined, 'opus', {
        parentSessionId: PARENT_SESSION,
      });

      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('No parent session id'),
        expect.anything(),
      );
    });
  });

  describe('compaction hooks', () => {
    it("passes the agent's own session id when resuming", async () => {
      const { service, compactionCreateHooks } = buildService();

      await service.assembleSpawnOptions(AUTH_ENV, '/repo', undefined, 'opus', {
        parentSessionId: PARENT_SESSION,
        ownSessionId: OWN_SESSION,
      });

      expect(compactionCreateHooks).toHaveBeenCalledWith(OWN_SESSION, '/repo');
    });

    it("never substitutes the parent's id for the compacting session", async () => {
      const { service, compactionCreateHooks } = buildService();

      await service.assembleSpawnOptions(AUTH_ENV, '/repo', undefined, 'opus', {
        parentSessionId: PARENT_SESSION,
      });

      // The curator reads a transcript by this id. The parent's id here would
      // curate the parent's conversation as the child's compaction.
      expect(compactionCreateHooks).not.toHaveBeenCalledWith(
        PARENT_SESSION,
        '/repo',
      );
      expect(compactionCreateHooks).toHaveBeenCalledWith('', '/repo');
    });

    it('collapses a blank own session id to the absent marker', async () => {
      const { service, compactionCreateHooks } = buildService();

      await service.assembleSpawnOptions(AUTH_ENV, '/repo', undefined, 'opus', {
        ownSessionId: '   ',
      });

      expect(compactionCreateHooks).toHaveBeenCalledWith('', '/repo');
    });
  });
});
