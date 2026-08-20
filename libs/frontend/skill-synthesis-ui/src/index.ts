export { SkillSynthesisTabComponent } from './lib/components/skill-synthesis-tab.component';
export { SkillStatsStripComponent } from './lib/components/skill-stats-strip.component';
export { SkillPipelineStatusComponent } from './lib/components/skill-pipeline-status.component';
export { SkillDigestPanelComponent } from './lib/components/skill-digest-panel.component';
export { SkillCandidatesTableComponent } from './lib/components/skill-candidates-table.component';
export type { SkillCandidateAction } from './lib/components/skill-candidates-table.component';
export { SkillInvocationsPanelComponent } from './lib/components/skill-invocations-panel.component';
export { SkillSettingsPanelComponent } from './lib/components/skill-settings-panel.component';
export { SkillClonesViewComponent } from './lib/components/clones/skill-clones-view.component';
export { CloneCardComponent } from './lib/components/clones/clone-card.component';
export { CloneDetailDrawerComponent } from './lib/components/clones/clone-detail-drawer.component';
export type {
  CloneHistoryDiff,
  CloneHistoryRequest,
} from './lib/components/clones/clone-detail-drawer.component';
export { EnhancePreviewDrawerComponent } from './lib/components/clones/enhance-preview-drawer.component';
export {
  cloneActionModel,
  cloneStatusLabel,
  hasUpstreamSource,
  KEEP_MINE_EXPLANATION,
  REBASE_EXPLANATION,
} from './lib/components/clones/clone-action-gating';
export type {
  CloneActionModel,
  CloneActionState,
  CloneEnhanceEligibility,
} from './lib/components/clones/clone-action-gating';
export { SkillSuggestionsViewComponent } from './lib/components/suggestions/skill-suggestions-view.component';
export { SkillSynthesisRpcService } from './lib/services/skill-synthesis-rpc.service';
export { SkillSynthesisStateService } from './lib/services/skill-synthesis-state.service';
export { SkillSynthesisLiveService } from './lib/services/skill-synthesis-live.service';
export { SkillClonesStateService } from './lib/services/skill-clones-state.service';
export type { SkillStatusFilter } from './lib/services/skill-synthesis-state.service';
export type { SkillCloneDetail } from './lib/services/skill-clones-state.service';
