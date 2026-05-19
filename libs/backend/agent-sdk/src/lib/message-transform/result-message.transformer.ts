import type { FlatStreamEventUnion } from '@ptah-extension/shared';

import type { SDKMessage } from '../types/sdk-types/claude-sdk.types';
import type { TransformerSessionId } from './transformer-state';
import type { TransformerHelpers } from './transformer-helpers';

export class ResultMessageTransformer {
  transform(
    _sdkMessage: SDKMessage,
    _helpers: TransformerHelpers,
    _sessionId?: TransformerSessionId,
  ): FlatStreamEventUnion[] {
    return [];
  }
}
