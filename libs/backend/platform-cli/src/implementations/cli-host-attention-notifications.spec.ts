import { runHostAttentionContract } from '@ptah-extension/platform-core/testing';

import { CliHostAttentionNotifications } from './cli-host-attention-notifications';

runHostAttentionContract('CLI', {
  createProvider: () => new CliHostAttentionNotifications(),
  presented: () => [],
  active: () => [],
  opened: () => [],
  setEligible: () => undefined,
  noOp: true,
});
