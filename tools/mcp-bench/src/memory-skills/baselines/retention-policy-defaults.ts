import {
  MEMORY_LIFECYCLE_DEFAULTS,
  RETENTION_CAP_EVICTION_GRACE_MS,
} from '@ptah-extension/memory-curator';

import type { RetentionPolicySettings } from './retention-policies';

/** Product-derived settings supplied explicitly to pure retention policies. */
export const DEFAULT_RETENTION_POLICY_SETTINGS: RetentionPolicySettings = {
  archiveAfterDays: MEMORY_LIFECYCLE_DEFAULTS.archiveAfterDays,
  deleteAfterDays: MEMORY_LIFECYCLE_DEFAULTS.deleteAfterDays,
  maxPerWorkspace: MEMORY_LIFECYCLE_DEFAULTS.maxPerWorkspace,
  capEvictionGraceMs: RETENTION_CAP_EVICTION_GRACE_MS,
};
