/**
 * @ptah-extension/rpc-handlers
 *
 * Shared RPC handler classes for the Ptah Extension.
 * These handlers are platform-agnostic (no vscode imports) and can be
 * used by both VS Code and Electron applications.
 */

export {
  AgentRpcHandlers,
  CommandRpcHandlers,
  FileSystemRpcHandlers,
  FilePickerRpcHandlers,
  ImagePickerRpcHandlers,
  SessionRpcHandlers,
  ContextRpcHandlers,
  AutocompleteRpcHandlers,
  SubagentRpcHandlers,
  LlmRpcHandlers,
  BootRpcHandlers,
  PluginRpcHandlers,
  PtahCliRpcHandlers,
  SetupRpcHandlers,
  WizardGenerationRpcHandlers,
  ConfigRpcHandlers,
  LicenseRpcHandlers,
  ChatRpcHandlers,
  AuthRpcHandlers,
  EnhancedPromptsRpcHandlers,
  QualityRpcHandlers,
  ProviderRpcHandlers,
  WebSearchRpcHandlers,
  HarnessRpcHandlers,
  McpDirectoryRpcHandlers,
  OutputStyleRpcHandlers,
  SkillsShRpcHandlers,
  GitRpcHandlers,
  WorkspaceRpcHandlers,
  SettingsRpcHandlers,
  MemoryRpcHandlers,
  MemRpcHandlers,
  CorpusRpcHandlers,
  SkillsSynthesisRpcHandlers,
  CronRpcHandlers,
  EmbedderRpcHandlers,
  GatewayRpcHandlers,
  VoiceRpcHandlers,
  UpdateRpcHandlers,
  PersistenceRpcHandlers,
  mintResetChallengeToken,
  IndexingRpcHandlers,
  TasksRpcHandlers,
  asAuthCommandRunner,
  ElectronFileOpenRpcHandlers,
  EditorRpcHandlers,
  FileViewRpcHandlers,
  FileLinkRootPolicy,
  CREDENTIAL_DENY_LIST,
  isCredentialPath,
} from './lib/handlers';
/**
 * Path-policy surface exported for the HOSTS that must apply the same rules.
 *
 * `FileOpenRpcParamsSchema` and `checkLinkedPathForm` are consumed by the VS
 * Code `file:open` handler, which lives in the app rather than this library.
 * Exporting them keeps ONE definition of the wire shape and the form gate —
 * a second copy in the host is exactly how the two drift into disagreeing
 * about what a safe path looks like.
 */
export { FileOpenRpcParamsSchema } from './lib/handlers/file-open-rpc.schema';
export {
  checkLinkedPathForm,
  type LinkedFileResolution,
} from './lib/handlers/workspace-file-path';
export type {
  DbHealthResult,
  DbHealthParams,
  DbResetParams,
  DbResetResult,
  AuthCommandRequest,
  AuthCommandResult,
  IAuthCommandRunner,
} from './lib/handlers';
export type {
  IPlatformCommands,
  IPlatformAuthProvider,
  ISaveDialogProvider,
  IModelDiscovery,
} from '@ptah-extension/platform-core';
export * from './lib/host-profile';
export * from './lib/verify-and-report';
export {
  registerSharedRpcHandlers,
  activateSessionLifecycleNotifier,
} from './lib/register-shared-rpc-handlers';
export { HARNESS_TOKENS, registerHarnessServices } from './lib/harness';
export { CHAT_TOKENS, registerChatServices } from './lib/chat';
export { isAuthorizedWorkspace } from './lib/utils/workspace-authorization';

/**
 * The `agent:resumeCliSession` wire contract, exported so PRODUCERS of that
 * payload can be tested against the schema that will actually judge them
 * (TASK_2026_297).
 *
 * This is the first boundary schema exported from this lib and it is a
 * deliberate, narrow precedent: `ptah agent-cli resume` spent its entire life
 * sending a payload the backend could not route, and stayed green because its
 * only test mocked the transport and asserted call shape. A test that mocks the
 * transport must not be the only coverage of a value the transport validates —
 * so `apps/ptah-cli`'s spec now parses its real payload with this exact schema.
 *
 * Export only. Nothing about the schema or the handler changed; in particular
 * the `.min(1)` rules on `task` and `cliSessionId` are correct as written
 * (TASK_2026_296) and must not be relaxed to accommodate a caller.
 */
export {
  AgentResumeCliSessionParamsSchema,
  type AgentResumeCliSessionInput,
} from './lib/handlers/agent-rpc.schema';
