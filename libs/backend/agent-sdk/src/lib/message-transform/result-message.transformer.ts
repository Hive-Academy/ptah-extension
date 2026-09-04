import type { FlatStreamEventUnion } from '@ptah-extension/shared';

import type { SDKMessage } from '../types/sdk-types/claude-sdk.types';
import { toTurnStateEvent } from '../helpers/session-turn-state.registry';
import type { TransformerSessionId } from './transformer-state';
import type { TransformerHelpers } from './transformer-helpers';

/**
 * The `result` message is the turn boundary ON the stream. It settles the
 * session's turn state from the snapshots the Stop / StopFailure hooks left
 * and emits exactly one `turn_state` event, ordered after every chunk of the
 * turn it closes (TASK_2026_360 §2.2).
 */
export class ResultMessageTransformer {
  transform(
    _sdkMessage: SDKMessage,
    helpers: TransformerHelpers,
    sessionId?: TransformerSessionId,
  ): FlatStreamEventUnion[] {
    // A turn state with no session cannot be routed — skip the registry.
    if (!sessionId) {
      return [];
    }
    return [
      toTurnStateEvent(sessionId, helpers.turnState.settleTurn(sessionId)),
    ];
  }
}
