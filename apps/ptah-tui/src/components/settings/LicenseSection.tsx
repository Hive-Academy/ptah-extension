/**
 * LicenseSection -- License management section for the TUI settings panel.
 *
 * Displays current license status and provides actions to enter or clear
 * a license key.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

import { useRpc } from '../../hooks/use-rpc.js';
import { useTheme } from '../../hooks/use-theme.js';
import { useKeyboardNav } from '../../hooks/use-keyboard-nav.js';
import { Badge, KeyHint, Spinner } from '../atoms/index.js';
import { ListItem } from '../molecules/index.js';
import type { BadgeVariant } from '../atoms/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LicenseStatus {
  valid: boolean;
  tier: string;
  isPremium: boolean;
  isCommunity: boolean;
  daysRemaining: number | null;
  trialActive: boolean;
  trialDaysRemaining: number | null;
  plan?: {
    name: string;
    description: string;
    features: string[];
  };
  reason?: 'expired' | 'trial_ended' | 'no_license';
  user?: {
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
}

interface LicenseSetKeyResult {
  success: boolean;
  error?: string;
  tier?: string;
  plan?: { name: string };
}

interface LicenseClearKeyResult {
  success: boolean;
  error?: string;
}

const ACTIONS = ['Enter License Key', 'Clear License'] as const;

function tierBadgeVariant(tier: string): BadgeVariant {
  if (tier === 'pro') return 'success';
  if (tier === 'trial_pro') return 'warning';
  if (tier === 'community') return 'ghost';
  return 'ghost';
}

function tierLabel(tier: string): string {
  if (tier === 'pro') return 'Pro';
  if (tier === 'trial_pro') return 'Trial';
  if (tier === 'community') return 'Community';
  return tier;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface LicenseSectionProps {
  isActive: boolean;
}

export function LicenseSection({
  isActive,
}: LicenseSectionProps): React.JSX.Element {
  const theme = useTheme();
  const { call } = useRpc();

  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    type: 'success' | 'error';
  } | null>(null);

  const loadStatus = useCallback(async (): Promise<void> => {
    setLoading(true);
    const result = await call<void, LicenseStatus>(
      'license:getStatus',
      undefined as unknown as void,
    );
    if (result) {
      setStatus(result);
    }
    setLoading(false);
  }, [call]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      const result = await call<void, LicenseStatus>(
        'license:getStatus',
        undefined as unknown as void,
      );
      if (!cancelled && result) {
        setStatus(result);
      }
      if (!cancelled) {
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [call]);

  const handleSetKey = useCallback(
    async (licenseKey: string): Promise<void> => {
      if (!licenseKey.trim()) {
        setEditMode(false);
        setInputValue('');
        return;
      }

      setSaving(true);
      setMessage(null);

      const result = await call<{ licenseKey: string }, LicenseSetKeyResult>(
        'license:setKey',
        { licenseKey: licenseKey.trim() },
      );

      if (result?.success) {
        setMessage({
          text: 'License key activated successfully',
          type: 'success',
        });
        await loadStatus();
      } else {
        setMessage({
          text: result?.error ?? 'Failed to set license key',
          type: 'error',
        });
      }

      setSaving(false);
      setEditMode(false);
      setInputValue('');
    },
    [call, loadStatus],
  );

  const handleClearKey = useCallback(async (): Promise<void> => {
    setSaving(true);
    setMessage(null);

    const result = await call<void, LicenseClearKeyResult>(
      'license:clearKey',
      undefined as unknown as void,
    );

    if (result?.success) {
      setMessage({ text: 'License key cleared', type: 'success' });
      await loadStatus();
    } else {
      setMessage({
        text: result?.error ?? 'Failed to clear license key',
        type: 'error',
      });
    }

    setSaving(false);
  }, [call, loadStatus]);

  const { activeIndex } = useKeyboardNav({
    itemCount: ACTIONS.length,
    isActive: isActive && !saving && !editMode,
    onSelect: (i) => {
      if (i === 0) {
        setEditMode(true);
        setInputValue('');
        setMessage(null);
      } else if (i === 1) {
        void handleClearKey();
      }
    },
  });

  useInput(
    (_input, key) => {
      if (editMode && key.escape) {
        setEditMode(false);
        setInputValue('');
      }
    },
    { isActive: isActive && editMode },
  );

  if (loading) {
    return <Spinner label="Loading license status..." />;
  }

  const tier = status?.tier ?? 'unknown';

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Box gap={1}>
          <Text>Tier:</Text>
          <Badge variant={tierBadgeVariant(tier)}>{tierLabel(tier)}</Badge>
          <Badge variant={status?.valid ? 'success' : 'error'}>
            {status?.valid ? 'Valid' : 'Invalid'}
          </Badge>
        </Box>

        {status?.daysRemaining !== null &&
          status?.daysRemaining !== undefined && (
            <Box>
              <Text dimColor>Days remaining: </Text>
              <Text>{status.daysRemaining}</Text>
            </Box>
          )}

        {status?.trialActive && status.trialDaysRemaining !== null && (
          <Box>
            <Text color={theme.status.warning}>Trial: </Text>
            <Text>{status.trialDaysRemaining} days remaining</Text>
          </Box>
        )}

        {status?.user?.email && (
          <Box>
            <Text dimColor>Email: </Text>
            <Text>{status.user.email}</Text>
          </Box>
        )}

        {status?.plan?.name && (
          <Box>
            <Text dimColor>Plan: </Text>
            <Text>{status.plan.name}</Text>
          </Box>
        )}
      </Box>

      {ACTIONS.map((action, index) => (
        <ListItem
          key={action}
          label={action}
          isSelected={index === activeIndex && isActive && !editMode}
        />
      ))}

      {editMode && (
        <Box marginLeft={4} marginTop={1}>
          {saving ? (
            <Spinner label="Verifying license key..." />
          ) : (
            <Box>
              <Text color={theme.status.warning}>Key: </Text>
              <TextInput
                value={inputValue}
                onChange={setInputValue}
                onSubmit={(val) => {
                  void handleSetKey(val);
                }}
                placeholder="Paste license key and press Enter"
                focus={true}
                mask="*"
              />
            </Box>
          )}
        </Box>
      )}

      {message && (
        <Box marginTop={1}>
          <Text
            color={
              message.type === 'success'
                ? theme.status.success
                : theme.status.error
            }
          >
            {message.type === 'success' ? '✓' : '✗'} {message.text}
          </Text>
        </Box>
      )}

      <Box marginTop={1} gap={2}>
        <KeyHint keys="↑↓" label="navigate" />
        <KeyHint keys="Enter" label="select" />
        <KeyHint keys="Esc" label="cancel" />
      </Box>
    </Box>
  );
}
