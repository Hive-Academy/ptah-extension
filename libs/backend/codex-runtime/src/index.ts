// CodexRuntimeLogger is a narrow private port to keep logging sanitized without a host logger dependency.
// Public contracts and composition. Exporting these does not enable production routing.
export type {
  CodexJsonValue,
  CodexPermissionLevel,
  CodexApprovalPolicy,
  CodexSandboxPolicy,
  CodexAttachment,
  CodexInstructionSource,
  CodexMcpServer,
  CodexExecutionProfile,
  CodexThreadIdentity,
  CodexTurnInput,
  CodexTurnReceipt,
  CodexTurnSettings,
  AppliedSettings,
  CodexApprovalDecision,
  CodexApprovalCorrelation,
  CodexApprovalRequest,
  CodexReportedUsage,
  CodexRuntimeError,
  CodexRuntimeEvent,
  CodexContext,
  CodexModelInfo,
} from './lib/codex-runtime.types';
export type { CodexRuntime as CodexRuntimePort } from './lib/codex-runtime.types';
export type {
  CodexUsageEligibility,
  CodexAccountUsageStatus,
  CodexAccountUsageResult,
} from './lib/codex-account-usage.types';
export type {
  CodexExecutableManifestRow,
  CodexExecutableSource,
  ApprovalSink,
  CodexThreadIdentityStore,
  Clock as CodexClock,
  CodexRuntimeLogger,
  IProcessSpawner,
} from './lib/codex-runtime-ports';
export type {
  CodexHomeAuthEvent,
  CodexHomeAuthReader,
} from './lib/codex-home-auth-reader';
export { CODEX_RUNTIME_TOKENS } from './lib/di/tokens';
export {
  readCodexDevRouteOverride,
  type CodexDevRouteOverride,
} from './lib/codex-dev-route';
export { CodexRuntime, type CodexRuntimeOptions } from './lib/codex-runtime';
export { CodexAccountUsageClient } from './lib/codex-account-usage-client';
export {
  CodexParityGate,
  CODEX_PARITY_EVIDENCE,
  type CodexParityConsumer,
  type CodexParityPlatform,
  type CodexParityObservation,
  type CodexParityDecision,
} from './lib/codex-parity-gate';
export {
  registerCodexRuntime,
  resolveGatedCodexRuntime,
  type CodexRuntimeRegistrationPorts,
} from './lib/di/registration';
export {
  buildCodexExecutionProfile,
  type CodexProfileSettings,
  type CodexExecutionProfileInput,
  type BuiltCodexExecutionProfile,
} from './lib/codex-execution-profile';
// CodexExecutableManifestRow (ports above) is the canonical public pin; the
// process and validator remain implementation details.
export type { CodexBinaryIdentity } from './lib/codex-protocol-manifest';
export {
  normalizeCodexHomeKey,
  normalizeCodexWorkspaceKey,
} from './lib/codex-home-path';
