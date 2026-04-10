/**
 * LicenseSection -- License management section for the TUI settings panel.
 *
 * TASK_2025_266 Batch 6
 *
 * Displays current license status (tier, validity, trial info, user email)
 * and provides actions to enter or clear a license key.
 *
 * Navigation:
 *   - Up/Down: Navigate between actions
 *   - Enter: Execute selected action (enter key / clear license)
 *   - Escape: Cancel key entry mode
 *
 * Uses useRpc() for backend communication (license:getStatus, license:setKey, license:clearKey).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

import { useRpc } from '../../hooks/use-rpc.js';
import { Spinner } from '../common/Spinner.js';
import { useTheme } from '../../hooks/use-theme.js';

// ---------------------------------------------------------------------------
// Types for RPC responses
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACTIONS = ['Enter License Key', 'Clear License'] as const;

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
  const [selectedAction, setSelectedAction] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    type: 'success' | 'error';
  } | null>(null);

  // Load license status on mount
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

  useInput(
    (input, key) => {
      // If in edit mode, only handle Escape (Enter handled by TextInput onSubmit)
      if (editMode) {
        if (key.escape) {
          setEditMode(false);
          setInputValue('');
        }
        return;
      }

      if (key.upArrow) {
        setSelectedAction((prev) => Math.max(0, prev - 1));
      }
      if (key.downArrow) {
        setSelectedAction((prev) => Math.min(ACTIONS.length - 1, prev + 1));
      }
      if (key.return) {
        if (selectedAction === 0) {
          // Enter License Key
          setEditMode(true);
          setInputValue('');
          setMessage(null);
        } else if (selectedAction === 1) {
          // Clear License
          void handleClearKey();
        }
      }

      // Dismiss message on any other key
      if (input && message) {
        setMessage(null);
      }
    },
    { isActive: isActive && !saving },
  );

  if (loading) {
    return <Spinner label="Loading license status..." />;
  }

  // Determine tier display
  const tierLabel = status?.tier ?? 'unknown';
  const tierColor =
    tierLabel === 'pro'
      ? theme.ui.accent
      : tierLabel === 'trial_pro'
        ? theme.status.warning
        : theme.ui.dimmed;

  return (
    <Box flexDirection="column">
      {/* Status display */}
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text>Tier: </Text>
          <Text bold color={tierColor}>
            [
            {tierLabel === 'pro'
              ? 'Pro'
              : tierLabel === 'trial_pro'
                ? 'Trial'
                : tierLabel === 'community'
                  ? 'Community'
                  : tierLabel}
            ]
          </Text>
          <Text> </Text>
          {status?.valid ? (
            <Text color={theme.status.success}>Valid</Text>
          ) : (
            <Text color={theme.status.error}>Invalid</Text>
          )}
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

      {/* Actions */}
      {ACTIONS.map((action, index) => {
        const isSelected = index === selectedAction && isActive && !editMode;

        return (
          <Box key={action}>
            <Text bold={isSelected} inverse={isSelected} dimColor={!isSelected}>
              {isSelected ? '> ' : '  '}
              {action}
            </Text>
          </Box>
        );
      })}

      {/* Key entry mode */}
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

      {/* Status message */}
      {message && (
        <Box marginTop={1}>
          <Text
            color={
              message.type === 'success'
                ? theme.status.success
                : theme.status.error
            }
          >
            {message.text}
          </Text>
        </Box>
      )}

      {/* Help text */}
      <Box marginTop={1}>
        <Text dimColor italic>
          Enter: select action | Up/Down: navigate | Esc: cancel
        </Text>
      </Box>
    </Box>
  );
}
