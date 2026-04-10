/**
 * PluginsSection -- Plugin list with enable/disable toggle for the TUI settings panel.
 *
 * TASK_2025_266 Batch 7
 *
 * Displays all available plugins with their category, skill count, and
 * enabled/disabled status. Users can toggle plugins on or off.
 *
 * Navigation:
 *   - Up/Down: Navigate plugin list
 *   - Enter: Toggle enabled/disabled for selected plugin
 *
 * Uses useRpc() for backend communication (plugins:list-available, plugins:get-config,
 * plugins:save-config).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

import { useRpc } from '../../hooks/use-rpc.js';
import { Spinner } from '../common/Spinner.js';
import { useTheme } from '../../hooks/use-theme.js';

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
  const theme = useTheme();
  const { call } = useRpc();

  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [toggling, setToggling] = useState(false);

  // Load plugins and their enabled state on mount
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
    async (pluginId: string): Promise<void> => {
      setToggling(true);

      // Get current config
      const configResult = await call<Record<string, never>, PluginConfigState>(
        'plugins:get-config',
        {} as Record<string, never>,
      );

      const currentEnabled = new Set(configResult?.enabledPluginIds ?? []);

      // Toggle the plugin
      if (currentEnabled.has(pluginId)) {
        currentEnabled.delete(pluginId);
      } else {
        currentEnabled.add(pluginId);
      }

      // Save updated config
      await call<{ enabledPluginIds: string[] }, { success: boolean }>(
        'plugins:save-config',
        { enabledPluginIds: Array.from(currentEnabled) },
      );

      // Refresh plugin list
      const refreshed = await loadPlugins();
      setPlugins(refreshed);
      setToggling(false);
    },
    [call, loadPlugins],
  );

  useInput(
    (_input, key) => {
      if (key.upArrow) {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      }
      if (key.downArrow) {
        setSelectedIndex((prev) => Math.min(plugins.length - 1, prev + 1));
      }
      if (key.return) {
        const plugin = plugins[selectedIndex];
        if (plugin) {
          void handleToggle(plugin.id);
        }
      }
    },
    { isActive: isActive && !toggling },
  );

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
        const isSelected = index === selectedIndex && isActive;

        return (
          <Box key={plugin.id}>
            <Text bold={isSelected} inverse={isSelected} dimColor={!isSelected}>
              {isSelected ? '> ' : '  '}
              {plugin.name}
            </Text>
            {plugin.category && (
              <Text color={theme.ui.dimmed}> ({plugin.category})</Text>
            )}
            {plugin.skillCount !== undefined && (
              <Text dimColor>
                {' '}
                {plugin.skillCount} skill{plugin.skillCount !== 1 ? 's' : ''}
              </Text>
            )}
            <Text> </Text>
            {plugin.enabled ? (
              <Text color={theme.status.success}>[enabled]</Text>
            ) : (
              <Text color={theme.ui.dimmed}>[disabled]</Text>
            )}
          </Box>
        );
      })}

      {toggling && (
        <Box marginTop={1}>
          <Spinner label="Updating..." />
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor italic>
          Enter: toggle plugin | Up/Down: navigate
        </Text>
      </Box>
    </Box>
  );
}
