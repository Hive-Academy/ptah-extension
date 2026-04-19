/**
 * PluginsSection -- Plugin list with enable/disable toggle.
 *
 * Displays all available plugins with their category, skill count, and
 * enabled/disabled status. Users can toggle plugins on or off.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';

import { useRpc } from '../../hooks/use-rpc.js';
import { useKeyboardNav } from '../../hooks/use-keyboard-nav.js';
import { Badge, KeyHint, Spinner } from '../atoms/index.js';
import { ListItem } from '../molecules/index.js';

// ---------------------------------------------------------------------------
// Types for RPC responses
// ---------------------------------------------------------------------------

interface PluginInfo {
  id: string;
  name: string;
  category?: string;
  description?: string;
  skillCount?: number;
  enabled: boolean;
}

interface RpcPluginInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  skillCount: number;
  commandCount: number;
  isDefault: boolean;
  keywords: string[];
}

interface PluginConfigState {
  enabledPluginIds: string[];
  lastUpdated?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface PluginsSectionProps {
  isActive: boolean;
}

export function PluginsSection({
  isActive,
}: PluginsSectionProps): React.JSX.Element {
  const { call } = useRpc();

  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  const loadPlugins = useCallback(async (): Promise<PluginInfo[]> => {
    const [pluginListResult, configResult] = await Promise.all([
      call<Record<string, never>, { plugins: RpcPluginInfo[] }>(
        'plugins:list-available',
        {} as Record<string, never>,
      ),
      call<Record<string, never>, PluginConfigState>(
        'plugins:get-config',
        {} as Record<string, never>,
      ),
    ]);

    const enabledIds = new Set(configResult?.enabledPluginIds ?? []);
    const rawPlugins = pluginListResult?.plugins ?? [];

    return rawPlugins.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      description: p.description,
      skillCount: p.skillCount,
      enabled: enabledIds.has(p.id),
    }));
  }, [call]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      const result = await loadPlugins();
      if (!cancelled) {
        setPlugins(result);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadPlugins]);

  const handleToggle = useCallback(
    async (index: number): Promise<void> => {
      const plugin = plugins[index];
      if (!plugin) return;
      setToggling(true);

      const configResult = await call<Record<string, never>, PluginConfigState>(
        'plugins:get-config',
        {} as Record<string, never>,
      );

      const currentEnabled = new Set(configResult?.enabledPluginIds ?? []);

      if (currentEnabled.has(plugin.id)) {
        currentEnabled.delete(plugin.id);
      } else {
        currentEnabled.add(plugin.id);
      }

      await call<{ enabledPluginIds: string[] }, { success: boolean }>(
        'plugins:save-config',
        { enabledPluginIds: Array.from(currentEnabled) },
      );

      const refreshed = await loadPlugins();
      setPlugins(refreshed);
      setToggling(false);
    },
    [call, loadPlugins, plugins],
  );

  const { activeIndex } = useKeyboardNav({
    itemCount: plugins.length,
    isActive: isActive && !toggling,
    onSelect: (i) => {
      void handleToggle(i);
    },
  });

  if (loading) {
    return <Spinner label="Loading plugins..." />;
  }

  if (plugins.length === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>No plugins available.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {plugins.map((plugin, index) => {
        const isSelected = index === activeIndex && isActive;
        const meta: string[] = [];
        if (plugin.category) meta.push(plugin.category);
        if (plugin.skillCount !== undefined) {
          meta.push(
            `${plugin.skillCount} skill${plugin.skillCount !== 1 ? 's' : ''}`,
          );
        }

        return (
          <ListItem
            key={plugin.id}
            label={plugin.name}
            description={meta.length > 0 ? meta.join(' · ') : undefined}
            isSelected={isSelected}
            badge={
              <Badge variant={plugin.enabled ? 'success' : 'ghost'}>
                {plugin.enabled ? 'enabled' : 'disabled'}
              </Badge>
            }
          />
        );
      })}

      {toggling && (
        <Box marginTop={1}>
          <Spinner label="Updating..." />
        </Box>
      )}

      <Box marginTop={1} gap={2}>
        <KeyHint keys="↑↓" label="navigate" />
        <KeyHint keys="Enter" label="toggle" />
      </Box>
    </Box>
  );
}
