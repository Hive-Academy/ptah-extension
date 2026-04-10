/**
 * WebSearchSection -- Web search API key management and testing for the TUI settings panel.
 *
 * TASK_2025_266 Batch 6
 *
 * Displays a list of web search providers (Tavily, Serper, Exa) with their
 * API key status. Supports entering/removing keys and testing connectivity.
 *
 * Navigation:
 *   - Up/Down: Navigate providers
 *   - Enter: Edit API key for selected provider (masked input)
 *   - R: Remove API key
 *   - T: Test connectivity
 *   - Escape: Cancel key entry mode
 *
 * Uses useRpc() for backend communication (webSearch:getApiKeyStatus, webSearch:setApiKey,
 * webSearch:deleteApiKey, webSearch:test).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

import { useRpc } from '../../hooks/use-rpc.js';
import { Spinner } from '../common/Spinner.js';
import { useTheme } from '../../hooks/use-theme.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProviderInfo {
  id: string;
  label: string;
  configured: boolean;
}

interface TestResult {
  provider: string;
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WEB_SEARCH_PROVIDERS = [
  { id: 'tavily', label: 'Tavily' },
  { id: 'serper', label: 'Serper' },
  { id: 'exa', label: 'Exa' },
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface WebSearchSectionProps {
  isActive: boolean;
}

export function WebSearchSection({
  isActive,
}: WebSearchSectionProps): React.JSX.Element {
  const theme = useTheme();
  const { call } = useRpc();

  const [providers, setProviders] = useState<ProviderInfo[]>(
    WEB_SEARCH_PROVIDERS.map((p) => ({ ...p, configured: false })),
  );
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // Load key status for all providers on mount
  const loadStatuses = useCallback(async (): Promise<void> => {
    const updatedProviders: ProviderInfo[] = [];

    for (const provider of WEB_SEARCH_PROVIDERS) {
      const result = await call<{ provider: string }, { configured: boolean }>(
        'webSearch:getApiKeyStatus',
        { provider: provider.id },
      );
      updatedProviders.push({
        ...provider,
        configured: result?.configured ?? false,
      });
    }

    setProviders(updatedProviders);
  }, [call]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);

      const updatedProviders: ProviderInfo[] = [];
      for (const provider of WEB_SEARCH_PROVIDERS) {
        const result = await call<
          { provider: string },
          { configured: boolean }
        >('webSearch:getApiKeyStatus', { provider: provider.id });
        if (cancelled) return;
        updatedProviders.push({
          ...provider,
          configured: result?.configured ?? false,
        });
      }

      if (!cancelled) {
        setProviders(updatedProviders);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [call]);

  const handleSaveKey = useCallback(
    async (providerId: string, apiKey: string): Promise<void> => {
      if (!apiKey.trim()) {
        setEditingProvider(null);
        setInputValue('');
        return;
      }

      setSaving(true);

      const result = await call<
        { provider: string; apiKey: string },
        { success: boolean }
      >('webSearch:setApiKey', { provider: providerId, apiKey: apiKey.trim() });

      if (result?.success) {
        await loadStatuses();
      }

      setSaving(false);
      setEditingProvider(null);
      setInputValue('');
    },
    [call, loadStatuses],
  );

  const handleDeleteKey = useCallback(
    async (providerId: string): Promise<void> => {
      await call<{ provider: string }, { success: boolean }>(
        'webSearch:deleteApiKey',
        { provider: providerId },
      );
      await loadStatuses();
    },
    [call, loadStatuses],
  );

  const handleTest = useCallback(
    async (providerId: string): Promise<void> => {
      setTesting(providerId);
      setTestResult(null);

      // The webSearch:test RPC reads the active provider from config.
      // We set it first so the test targets the selected provider.
      await call<{ provider: string }, { success: boolean }>(
        'webSearch:setConfig',
        { provider: providerId },
      );

      const result = await call<
        Record<string, never>,
        { success: boolean; provider: string; error?: string }
      >('webSearch:test', {} as Record<string, never>);

      setTestResult(
        result
          ? {
              provider: providerId,
              success: result.success,
              error: result.error,
            }
          : { provider: providerId, success: false, error: 'No response' },
      );
      setTesting(null);
    },
    [call],
  );

  useInput(
    (input, key) => {
      // If editing, Escape cancels (Enter handled by TextInput onSubmit)
      if (editingProvider !== null) {
        if (key.escape) {
          setEditingProvider(null);
          setInputValue('');
        }
        return;
      }

      if (key.upArrow) {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      }
      if (key.downArrow) {
        setSelectedIndex((prev) =>
          Math.min(WEB_SEARCH_PROVIDERS.length - 1, prev + 1),
        );
      }
      if (key.return) {
        const provider = WEB_SEARCH_PROVIDERS[selectedIndex];
        if (provider) {
          setEditingProvider(provider.id);
          setInputValue('');
          setTestResult(null);
        }
      }

      // 'r' to remove key
      if (input === 'r' && !key.ctrl && !key.meta) {
        const provider = WEB_SEARCH_PROVIDERS[selectedIndex];
        if (provider) {
          void handleDeleteKey(provider.id);
        }
      }

      // 't' to test
      if (input === 't' && !key.ctrl && !key.meta) {
        const provider = WEB_SEARCH_PROVIDERS[selectedIndex];
        if (provider) {
          void handleTest(provider.id);
        }
      }
    },
    { isActive: isActive && !saving && testing === null },
  );

  if (loading) {
    return <Spinner label="Loading web search status..." />;
  }

  return (
    <Box flexDirection="column">
      {providers.map((provider, index) => {
        const isSelected = index === selectedIndex && isActive;
        const isEditing = editingProvider === provider.id;
        const isTesting = testing === provider.id;

        return (
          <Box key={provider.id} flexDirection="column">
            <Box>
              <Text
                bold={isSelected}
                inverse={isSelected && !isEditing}
                dimColor={!isSelected}
              >
                {isSelected ? '> ' : '  '}
                {provider.label}:{' '}
              </Text>
              {provider.configured ? (
                <Text color={theme.status.success}>Configured</Text>
              ) : (
                <Text color={theme.status.error}>Not configured</Text>
              )}
              {isTesting && (
                <Box marginLeft={1}>
                  <Spinner label="Testing..." />
                </Box>
              )}
            </Box>

            {/* Inline key entry */}
            {isEditing && (
              <Box marginLeft={4} marginTop={0}>
                {saving ? (
                  <Spinner label="Saving..." />
                ) : (
                  <Box>
                    <Text color={theme.status.warning}>Key: </Text>
                    <TextInput
                      value={inputValue}
                      onChange={setInputValue}
                      onSubmit={(val) => {
                        void handleSaveKey(provider.id, val);
                      }}
                      placeholder="Paste API key and press Enter"
                      focus={true}
                      mask="*"
                    />
                  </Box>
                )}
              </Box>
            )}

            {/* Inline test result */}
            {testResult && testResult.provider === provider.id && (
              <Box marginLeft={4}>
                {testResult.success ? (
                  <Text color={theme.status.success}>Connected</Text>
                ) : (
                  <Text color={theme.status.error}>
                    Failed: {testResult.error ?? 'Unknown error'}
                  </Text>
                )}
              </Box>
            )}
          </Box>
        );
      })}

      {/* Help text */}
      <Box marginTop={1}>
        <Text dimColor italic>
          Enter: edit key | R: remove | T: test | Up/Down: navigate
        </Text>
      </Box>
    </Box>
  );
}
