import React, { useCallback, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

import { useTheme } from '../../hooks/use-theme.js';
import { KeyHint, Spinner } from '../atoms/index.js';
import {
  CUSTOM_PROVIDER_FIELDS,
  customProviderActionLabel,
  customProviderFormActions,
  customProviderSecurityNote,
  customProviderSlotAt,
  moveCustomProviderFocus,
  toggleLane,
  validateCustomProviderForm,
  type CustomProviderFieldId,
  type CustomProviderFormAction,
  type CustomProviderFormError,
  type CustomProviderFormMode,
  type CustomProviderFormValues,
} from './custom-provider-form.js';
import type { CustomProviderEntry } from '@ptah-extension/shared';

export interface CustomProviderFormStatus {
  type: 'success' | 'error' | 'info';
  text: string;
}

export interface CustomProviderFormProps {
  mode: CustomProviderFormMode;
  initialValues: CustomProviderFormValues;
  /** True while an RPC is in flight — input is suspended, not just dimmed. */
  busy: boolean;
  /** Backend message, shown verbatim. Never paraphrased. */
  status: CustomProviderFormStatus | null;
  isActive: boolean;
  onSubmit: (entry: CustomProviderEntry, apiKey?: string) => void;
  onTest: () => void;
  onDelete: () => void;
  onCancel: () => void;
}

/**
 * The Ink "add / edit custom provider" form.
 *
 * Keyboard contract, chosen around what is already taken:
 *   ↑/↓     move between fields and buttons
 *   ←/→     switch the lane when the lane row holds focus
 *   Enter   advance a field, or press the focused button
 *   Esc     leave without saving (AuthSection holds the Escape claim)
 *
 * Deliberately NOT Tab: `SettingsPanel` binds Tab to "next settings section",
 * so a Tab-to-advance form would throw the user out of Settings mid-entry.
 * Deliberately NOT letter chords either — every letter has to reach the text
 * input under the cursor, which is why the actions are focusable rows rather
 * than an `S: save` hint like the read-only provider tiles use.
 *
 * All decisions (field list, focus movement, validation, payload shape) live in
 * `custom-provider-form.ts`; this component only renders them.
 */
export function CustomProviderForm({
  mode,
  initialValues,
  busy,
  status,
  isActive,
  onSubmit,
  onTest,
  onDelete,
  onCancel,
}: CustomProviderFormProps): React.JSX.Element {
  const theme = useTheme();
  const [values, setValues] = useState<CustomProviderFormValues>(initialValues);
  const [focus, setFocus] = useState(0);
  const [errors, setErrors] = useState<readonly CustomProviderFormError[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const actions = customProviderFormActions(mode);
  const slot = customProviderSlotAt(mode, focus);

  const setField = useCallback((id: CustomProviderFieldId, value: string) => {
    setValues((prev) => ({ ...prev, [id]: value }));
  }, []);

  const submit = useCallback(() => {
    const result = validateCustomProviderForm(values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors([]);
    onSubmit(result.entry, result.apiKey);
  }, [values, onSubmit]);

  const runAction = useCallback(
    (action: CustomProviderFormAction) => {
      if (action !== 'delete') setConfirmDelete(false);
      switch (action) {
        case 'save':
          submit();
          return;
        case 'test':
          onTest();
          return;
        case 'delete':
          if (!confirmDelete) {
            setConfirmDelete(true);
            return;
          }
          setConfirmDelete(false);
          onDelete();
          return;
        case 'cancel':
          onCancel();
          return;
      }
    },
    [submit, onTest, onDelete, onCancel, confirmDelete],
  );

  useInput(
    (_input, key) => {
      if (key.escape) {
        if (confirmDelete) {
          setConfirmDelete(false);
          return;
        }
        onCancel();
        return;
      }

      if (key.upArrow) {
        setConfirmDelete(false);
        setFocus((prev) => moveCustomProviderFocus(mode, prev, -1));
        return;
      }
      if (key.downArrow) {
        setConfirmDelete(false);
        setFocus((prev) => moveCustomProviderFocus(mode, prev, 1));
        return;
      }

      if (
        (key.leftArrow || key.rightArrow) &&
        slot.kind === 'field' &&
        slot.field.kind === 'lane'
      ) {
        setValues((prev) => ({ ...prev, lane: toggleLane(prev.lane) }));
        return;
      }

      if (key.return) {
        if (slot.kind === 'action') {
          runAction(slot.action);
          return;
        }
        // Enter on a field is "next", so a straight top-to-bottom pass with the
        // Return key lands on Save & Test.
        setFocus((prev) => moveCustomProviderFocus(mode, prev, 1));
      }
    },
    { isActive: isActive && !busy },
  );

  const errorFor = (id: CustomProviderFieldId): string | undefined =>
    errors.find((error) => error.field === id)?.message;
  const unscopedErrors = errors.filter((error) => error.field === undefined);

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text color={theme.ui.accent} bold>
          ◈ {mode === 'edit' ? 'Edit custom provider' : 'Add custom provider'}
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {CUSTOM_PROVIDER_FIELDS.map((field, index) => {
          const focused = !busy && slot.kind === 'field' && focus === index;
          const fieldError = errorFor(field.id);
          const value = values[field.id];

          return (
            <Box key={field.id} flexDirection="column">
              <Box gap={1}>
                <Text
                  color={focused ? theme.ui.accent : theme.ui.muted}
                  bold={focused}
                >
                  {focused ? '›' : ' '} {field.label}
                  {field.required ? '*' : ''}
                </Text>
                {field.kind === 'lane' ? (
                  <Box gap={1}>
                    <Text
                      inverse={values.lane === 'anthropic'}
                      color={theme.ui.brand}
                    >
                      {' '}
                      anthropic{' '}
                    </Text>
                    <Text
                      inverse={values.lane === 'openai'}
                      color={theme.ui.brand}
                    >
                      {' '}
                      openai{' '}
                    </Text>
                  </Box>
                ) : (
                  <TextInput
                    value={value}
                    onChange={(next: string) => setField(field.id, next)}
                    placeholder={field.placeholder}
                    focus={focused}
                    {...(field.kind === 'secret' ? { mask: '*' } : {})}
                  />
                )}
              </Box>
              {focused && field.hint && (
                <Text dimColor>
                  {'    '}
                  {field.hint}
                </Text>
              )}
              {fieldError && (
                <Text color={theme.status.error}>
                  {'    '}✗ {fieldError}
                </Text>
              )}
            </Box>
          );
        })}
      </Box>

      {unscopedErrors.map((error) => (
        <Text key={error.message} color={theme.status.error}>
          ✗ {error.message}
        </Text>
      ))}

      <Box marginTop={1}>
        <Text dimColor wrap="wrap">
          {customProviderSecurityNote(values.baseUrl)}
        </Text>
      </Box>

      {busy ? (
        <Box marginTop={1}>
          <Spinner label="Saving & testing…" />
        </Box>
      ) : (
        <Box marginTop={1} gap={2}>
          {actions.map((action, index) => {
            const slotIndex = CUSTOM_PROVIDER_FIELDS.length + index;
            const focused = slot.kind === 'action' && focus === slotIndex;
            const isDangerous = action === 'delete';
            const label =
              isDangerous && confirmDelete
                ? 'Press Enter again to delete'
                : customProviderActionLabel(action);
            return (
              <Box
                key={action}
                borderStyle="round"
                borderColor={focused ? theme.ui.accent : theme.ui.borderSubtle}
                paddingX={1}
              >
                <Text
                  color={
                    isDangerous
                      ? theme.status.error
                      : focused
                        ? theme.ui.accent
                        : theme.ui.muted
                  }
                  bold={focused}
                >
                  {label}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}

      {status && (
        <Box marginTop={1}>
          <Text
            color={
              status.type === 'success'
                ? theme.status.success
                : status.type === 'error'
                  ? theme.status.error
                  : theme.status.info
            }
            wrap="wrap"
          >
            {status.type === 'success'
              ? '✓ '
              : status.type === 'error'
                ? '✗ '
                : '○ '}
            {status.text}
          </Text>
        </Box>
      )}

      {!busy && (
        <Box marginTop={1} gap={2}>
          <KeyHint keys="↑↓" label="move" />
          <KeyHint keys="←→" label="lane" />
          <KeyHint keys="Enter" label="next / press" />
          <KeyHint keys="Esc" label="cancel" />
        </Box>
      )}
    </Box>
  );
}
