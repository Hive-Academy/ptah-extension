// Public contracts and composition. Exporting these does not enable production routing.
export type * from './lib/codex-runtime.types';
export type { CodexRuntime as CodexRuntimePort } from './lib/codex-runtime.types';
export type * from './lib/codex-account-usage.types';
export type * from './lib/codex-runtime-ports';
export type * from './lib/codex-home-auth-reader';
export { CODEX_RUNTIME_TOKENS } from './lib/di/tokens';
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
  type CodexRuntimeRegistrationPorts,
} from './lib/di/registration';
export {
  buildCodexExecutionProfile,
  type CodexProfileSettings,
  type CodexExecutionProfileInput,
  type BuiltCodexExecutionProfile,
} from './lib/codex-execution-profile';
// CodexExecutableManifestRow (ports above) is the canonical portable public pin.
// CodexProtocolManifest and the process/validator remain implementation details.
export type { CodexBinaryIdentity } from './lib/codex-protocol-manifest';
// Review follow-up (outside 2k ownership): the builder marks experimentalApi only
// for ask; the process always negotiates true, as required by the initialize
// validator literal in codex-protocol-validator.ts:539 (z.literal(true)). Until
// those contracts are aligned, profile.experimentalApi is not a handshake echo.
