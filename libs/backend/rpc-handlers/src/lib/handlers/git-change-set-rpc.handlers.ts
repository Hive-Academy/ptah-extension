/**
 * GitChangeSetRpcHandlers (TASK_2026_576 Component 19).
 *
 * `git:turnChangeSets` returns the change sets {@link TurnChangeSetRecorder}
 * persisted for one session, oldest first, so a reopened session can show
 * the cards its turns produced. Read-only: recording happens in the recorder,
 * never through RPC.
 */

import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import {
  RpcHandler,
  RpcUserError,
  TOKENS,
} from '@ptah-extension/vscode-core';
import type {
  GitTurnChangeSetsParams,
  GitTurnChangeSetsResult,
  RpcMethodName,
} from '@ptah-extension/shared';

import { TurnChangeSetStore } from '../chat/change-set/turn-change-set.store';

/** The id becomes part of a storage key; a bounded, non-empty string. */
const GitTurnChangeSetsParamsSchema = z
  .object({ sessionId: z.string().min(1).max(512) })
  .strict();

@injectable()
export class GitChangeSetRpcHandlers {
  /** RPC methods owned by this handler (manifest coverage invariant). */
  static readonly METHODS = [
    'git:turnChangeSets',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TurnChangeSetStore) private readonly store: TurnChangeSetStore,
  ) {}

  register(): void {
    this.rpcHandler.registerMethod<
      GitTurnChangeSetsParams,
      GitTurnChangeSetsResult
    >('git:turnChangeSets', async (rawParams) => {
      const parsed = GitTurnChangeSetsParamsSchema.safeParse(rawParams);
      if (!parsed.success) {
        throw new RpcUserError(
          'Invalid git:turnChangeSets params (sessionId)',
          'INVALID_PARAMS',
        );
      }
      // A storage failure rejects and reaches the caller as an RPC error:
      // "no history" and "history could not be read" must stay distinct.
      const changeSets = await this.store.list(parsed.data.sessionId);
      return { changeSets };
    });
  }
}
