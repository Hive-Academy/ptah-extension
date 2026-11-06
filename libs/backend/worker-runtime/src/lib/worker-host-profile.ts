import { capabilities, type HostProfile } from '@ptah-extension/rpc-handlers';

export function createWorkerRpcHostProfile(): HostProfile {
  return {
    platform: 'cli',
    host: 'worker',
    capabilities: capabilities({
      memory: true,
      skillSynthesis: true,
      cron: true,
      gateway: true,
      voice: true,
      persistence: true,
      workspaceLifecycle: true,
      editorLauncher: true,
      filePicker: false,
      goVetDiagnostics: true,
    }),
    hostHandlers: {},
    wiring: {
      worktree: false,
      copilotPermission: false,
      persistCliSession: false,
      sdkSessionIdLookup: false,
      sessionMetadataEvents: false,
    },
    assertOnDrift: false,
  };
}
