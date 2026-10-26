import type { SdkAgentAdapter } from '@ptah-extension/agent-sdk';
import type { SessionRuntimeControls } from '@ptah-extension/shared';

type ConfigControls = {
  [K in 'setModel' | 'setPermission' | 'setEffort']: (
    ...args: Parameters<SessionRuntimeControls[K]>
  ) => Promise<unknown>;
};

/** Keep legacy aliases and max-effort mapping inside agent-sdk. */
export function configRuntimeControls(
  runtime: SessionRuntimeControls | null,
  legacy: Pick<
    SdkAgentAdapter,
    'setSessionModel' | 'setSessionPermissionLevel' | 'setSessionEffort'
  >,
): ConfigControls {
  return (
    runtime ?? {
      setModel: (id, model) => legacy.setSessionModel(id, model),
      setPermission: (id, level) => legacy.setSessionPermissionLevel(id, level),
      setEffort: (id, effort) => legacy.setSessionEffort(id, effort),
    }
  );
}
