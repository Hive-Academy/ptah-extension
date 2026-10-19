export { SkillSynthesisTabComponent } from './lib/components/skill-synthesis-tab.component';
export { SkillSpecsControlComponent } from './lib/components/skill-specs-control.component';
export { SkillClonesViewComponent } from './lib/components/clones/skill-clones-view.component';
export { CloneCardComponent } from './lib/components/clones/clone-card.component';
export { CloneDetailDrawerComponent } from './lib/components/clones/clone-detail-drawer.component';
export type {
  CloneBodySaveRequest,
  CloneHistoryDiff,
  CloneHistoryRequest,
} from './lib/components/clones/clone-detail-drawer.component';
export { EnhancePreviewDrawerComponent } from './lib/components/clones/enhance-preview-drawer.component';
export {
  BULK_REBASE_EXPLANATION,
  canEditCloneBody,
  cloneActionModel,
  cloneStatusLabel,
  eligibleForBulkRebase,
  hasUpstreamSource,
  KEEP_MINE_EXPLANATION,
  REBASE_EXPLANATION,
} from './lib/components/clones/clone-action-gating';
export type {
  CloneActionModel,
  CloneActionState,
  CloneEnhanceEligibility,
} from './lib/components/clones/clone-action-gating';
export { SkillSynthesisRpcService } from './lib/services/skill-synthesis-rpc.service';
export { SkillSynthesisStateService } from './lib/services/skill-synthesis-state.service';
export { SkillClonesStateService } from './lib/services/skill-clones-state.service';
export type { SkillCloneDetail } from './lib/services/skill-clones-state.service';
