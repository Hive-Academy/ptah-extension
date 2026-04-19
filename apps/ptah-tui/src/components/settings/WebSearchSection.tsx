/**
 * WebSearchSection -- Web search API key management and testing.
 *
 * Displays a list of web search providers (Tavily, Serper, Exa) with their
 * API key status. Supports entering/removing keys and testing connectivity.
 *
 * Navigation: Up/Down navigate providers, Enter edit key, R remove, T test.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

import { useRpc } from '../../hooks/use-rpc.js';
import { useTheme } from '../../hooks/use-theme.js';
import { useKeyboardNav } from '../../hooks/use-keyboard-nav.js';
import { Badge, KeyHint, Spinner } from '../atoms/index.js';
import { ListItem } from '../molecules/index.js';

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
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

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

  const navActive =
    isActive && editingProvider === null && !saving && testing === null;

  const { activeIndex } = useKeyboardNav({
    itemCount: WEB_SEARCH_PROVIDERS.length,
    isActive: navActive,
    onSelect: (i) => {
      const provider = WEB_SEARCH_PROVIDERS[i];
      if (provider) {
        setEditingProvider(provider.id);
        setInputValue('');
        setTestResult(null);
      }
    },
  });

  useInput(
    (input, key) => {
      if (editingProvider !== null) {
        if (key.escape) {
          setEditingProvider(null);
          setInputValue('');
        }
        return;
      }

      if (key.ctrl || key.meta) return;

      if (input === 'r') {
        const provider = WEB_SEARCH_PROVIDERS[activeIndex];
        if (provider) {
          void handleDeleteKey(provider.id);
        }
      }
      if (input === 't') {
        const provider = WEB_SEARCH_PROVIDERS[activeIndex];
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
        const isSelected = index === activeIndex && isActive;
        const isEditing = editingProvider === provider.id;
        const isTesting = testing === provider.id;

        return (
          <Box key={provider.id} flexDirection="column">
            <ListItem
              label={provider.label}
              isSelected={isSelected && !isEditing}
              badge={
                <Badge variant={provider.configured ? 'success' : 'error'}>
                  {provider.configured ? 'configured' : 'not configured'}
                </Badge>
              }
              trailing={isTesting ? <Spinner label="Testing..." /> : undefined}
            />

            {isEditing && (
              <Box marginLeft={4}>
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

            {testResult && testResult.provider === provider.id && (
              <Box marginLeft={4}>
                {testResult.success ? (
                  <Text color={theme.status.success}>✓ Connected</Text>
                ) : (
                  <Text color={theme.status.error}>
                    ✗ Failed: {testResult.error ?? 'Unknown error'}
                  </Text>
                )}
              </Box>
            )}
          </Box>
        );
      })}

      <Box marginTop={1} gap={2}>
        <KeyHint keys="↑↓" label="navigate" />
        <KeyHint keys="Enter" label="edit key" />
        <KeyHint keys="R" label="remove" />
        <KeyHint keys="T" label="test" />
      </Box>
    </Box>
  );
}
