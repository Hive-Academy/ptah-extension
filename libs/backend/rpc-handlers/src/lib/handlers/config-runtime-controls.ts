import { SessionUnavailableError, type SdkAgentAdapter } from '@ptah-extension/agent-sdk';
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
  const apply = async (action: () => Promise<void>): Promise<boolean> => {
    try {
      await action();
      return true;
    } catch (error) {
      // Missing records and queries are save-only; live apply errors still reject.
      if (error instanceof SessionUnavailableError)
        return false;
      throw error;
    }
  };
  return (
    runtime ?? {
      setModel: (id, model) => apply(() => legacy.setSessionModel(id, model)),
      setPermission: (id, level) => apply(() => legacy.setSessionPermissionLevel(id, level)),
      setEffort: (id, effort) => apply(() => legacy.setSessionEffort(id, effort)),
    }
  );
}
