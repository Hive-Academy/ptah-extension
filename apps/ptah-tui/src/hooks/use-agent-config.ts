import { useCallback, useEffect, useState } from 'react';

import { useTuiContext } from '../context/TuiContext.js';

export type EffortLevel = 'low' | 'medium' | 'high' | 'max';
export type PermissionLevel = 'ask' | 'auto-edit' | 'yolo' | 'plan';

const EFFORT_ORDER: readonly EffortLevel[] = ['low', 'medium', 'high', 'max'];
const PERMISSION_ORDER: readonly PermissionLevel[] = [
  'ask',
  'auto-edit',
  'yolo',
  'plan',
];

export interface AgentConfig {
  model: string | null;
  effort: EffortLevel;
  permissionLevel: PermissionLevel;
  autopilotEnabled: boolean;
}

export interface UseAgentConfigResult extends AgentConfig {
  cycleEffort: () => Promise<void>;
  cyclePermission: () => Promise<void>;
  refresh: () => Promise<void>;
}

interface ModelEntry {
  id: string;
  name: string;
  isSelected: boolean;
}

interface ModelsListResult {
  models: ModelEntry[];
}

interface EffortGetResult {
  effort: string | undefined;
}

interface AutopilotGetResult {
  enabled: boolean;
  permissionLevel: string;
}

function nextOf<T>(order: readonly T[], current: T): T {
  const idx = order.indexOf(current);
  return order[(idx + 1) % order.length] ?? order[0];
}

export function nextEffort(current: EffortLevel): EffortLevel {
  return nextOf(EFFORT_ORDER, current);
}

export function nextPermissionToggle(current: PermissionLevel): {
  permissionLevel: PermissionLevel;
  enabled: boolean;
} {
  const permissionLevel = nextOf(PERMISSION_ORDER, current);
  return { permissionLevel, enabled: permissionLevel !== 'ask' };
}

export function useAgentConfig(): UseAgentConfigResult {
  const { transport, pushAdapter } = useTuiContext();

  const [model, setModel] = useState<string | null>(null);
  const [effort, setEffort] = useState<EffortLevel>('medium');
  const [permissionLevel, setPermissionLevel] =
    useState<PermissionLevel>('ask');
  const [autopilotEnabled, setAutopilotEnabled] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    const [modelsRes, effortRes, autopilotRes] = await Promise.all([
      transport.call<void, ModelsListResult>(
        'config:models-list',
        undefined as unknown as void,
      ),
      transport.call<Record<string, never>, EffortGetResult>(
        'config:effort-get',
        {} as Record<string, never>,
      ),
      transport.call<Record<string, never>, AutopilotGetResult>(
        'config:autopilot-get',
        {} as Record<string, never>,
      ),
    ]);

    if (modelsRes.success && modelsRes.data?.models) {
      const selected = modelsRes.data.models.find((m) => m.isSelected);
      setModel(selected ? selected.name || selected.id : null);
    }

    if (effortRes.success) {
      const value = effortRes.data?.effort;
      if (value && EFFORT_ORDER.includes(value as EffortLevel)) {
        setEffort(value as EffortLevel);
      }
    }

    if (autopilotRes.success && autopilotRes.data) {
      setAutopilotEnabled(autopilotRes.data.enabled);
      const level = autopilotRes.data.permissionLevel;
      if (PERMISSION_ORDER.includes(level as PermissionLevel)) {
        setPermissionLevel(level as PermissionLevel);
      }
    }
  }, [transport]);

  useEffect(() => {
    void refresh();
    const onModelChanged = (): void => {
      void refresh();
    };
    pushAdapter.on('providers:modelChanged', onModelChanged);
    return () => {
      pushAdapter.off('providers:modelChanged', onModelChanged);
    };
  }, [refresh, pushAdapter]);

  const cycleEffort = useCallback(async (): Promise<void> => {
    const next = nextEffort(effort);
    const res = await transport.call<{ effort: string }, EffortGetResult>(
      'config:effort-set',
      { effort: next },
    );
    if (res.success) {
      setEffort((res.data?.effort as EffortLevel) ?? next);
    }
  }, [transport, effort]);

  const cyclePermission = useCallback(async (): Promise<void> => {
    const { permissionLevel: next, enabled } =
      nextPermissionToggle(permissionLevel);
    const res = await transport.call<
      { enabled: boolean; permissionLevel: string },
      AutopilotGetResult
    >('config:autopilot-toggle', { enabled, permissionLevel: next });
    if (res.success && res.data) {
      setAutopilotEnabled(res.data.enabled);
      setPermissionLevel((res.data.permissionLevel as PermissionLevel) ?? next);
    }
  }, [transport, permissionLevel]);

  return {
    model,
    effort,
    permissionLevel,
    autopilotEnabled,
    cycleEffort,
    cyclePermission,
    refresh,
  };
}
