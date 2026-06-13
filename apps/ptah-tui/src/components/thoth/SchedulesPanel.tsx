import React, { useCallback, useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type {
  CronCreateResult,
  CronDeleteResult,
  CronListResult,
  CronRunNowResult,
  CronRunsResult,
  CronToggleResult,
  JobRunDto,
  ScheduledJobDto,
} from '@ptah-extension/shared';

import { useRpc } from '../../hooks/use-rpc.js';
import { useTheme } from '../../hooks/use-theme.js';
import { useKeyboardNav } from '../../hooks/use-keyboard-nav.js';
import { Badge, KeyHint, Spinner } from '../atoms/index.js';
import { FormField, ListItem } from '../molecules/index.js';

interface SchedulesPanelProps {
  isActive: boolean;
  degraded: boolean;
  reason?: string;
}

type SchedulesMode = 'list' | 'runs' | 'create';

interface CreateForm {
  name: string;
  cronExpr: string;
  prompt: string;
}

const CREATE_FIELDS: readonly (keyof CreateForm)[] = [
  'name',
  'cronExpr',
  'prompt',
];

const EMPTY_FORM: CreateForm = { name: '', cronExpr: '', prompt: '' };

function runStatusColor(
  status: JobRunDto['status'],
  theme: ReturnType<typeof useTheme>,
): string {
  switch (status) {
    case 'succeeded':
      return theme.status.success;
    case 'failed':
      return theme.status.error;
    case 'running':
    case 'pending':
      return theme.status.info;
    case 'skipped':
    default:
      return theme.ui.dimmed;
  }
}

export function SchedulesPanel({
  isActive,
  degraded,
  reason,
}: SchedulesPanelProps): React.JSX.Element {
  const theme = useTheme();
  const { call } = useRpc();

  const [mode, setMode] = useState<SchedulesMode>('list');
  const [jobs, setJobs] = useState<ScheduledJobDto[]>([]);
  const [runs, setRuns] = useState<JobRunDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [formField, setFormField] = useState(0);

  const loadJobs = useCallback(async (): Promise<void> => {
    const result = await call<Record<string, never>, CronListResult>(
      'cron:list',
      {},
    );
    setJobs(result?.jobs ?? []);
  }, [call]);

  useEffect(() => {
    if (degraded) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      await loadJobs();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [degraded, loadJobs]);

  const navActive =
    isActive && !degraded && mode === 'list' && !busy;

  const { activeIndex } = useKeyboardNav({
    itemCount: jobs.length,
    isActive: navActive,
  });

  const toggleJob = useCallback(
    async (job: ScheduledJobDto): Promise<void> => {
      setBusy(true);
      await call<{ id: string; enabled: boolean }, CronToggleResult>(
        'cron:toggle',
        { id: job.id, enabled: !job.enabled },
      );
      await loadJobs();
      setBusy(false);
    },
    [call, loadJobs],
  );

  const runNow = useCallback(
    async (job: ScheduledJobDto): Promise<void> => {
      setBusy(true);
      await call<{ id: string }, CronRunNowResult>('cron:runNow', {
        id: job.id,
      });
      await loadJobs();
      setBusy(false);
    },
    [call, loadJobs],
  );

  const deleteJob = useCallback(
    async (job: ScheduledJobDto): Promise<void> => {
      setBusy(true);
      await call<{ id: string }, CronDeleteResult>('cron:delete', {
        id: job.id,
      });
      await loadJobs();
      setBusy(false);
    },
    [call, loadJobs],
  );

  const openRuns = useCallback(
    async (job: ScheduledJobDto): Promise<void> => {
      const result = await call<{ id: string; limit: number }, CronRunsResult>(
        'cron:runs',
        { id: job.id, limit: 20 },
      );
      setRuns(result?.runs ?? []);
      setMode('runs');
    },
    [call],
  );

  const submitCreate = useCallback(async (): Promise<void> => {
    if (!form.name.trim() || !form.cronExpr.trim() || !form.prompt.trim()) {
      return;
    }
    setBusy(true);
    await call<
      { name: string; cronExpr: string; prompt: string; enabled: boolean },
      CronCreateResult
    >('cron:create', {
      name: form.name.trim(),
      cronExpr: form.cronExpr.trim(),
      prompt: form.prompt.trim(),
      enabled: true,
    });
    setForm(EMPTY_FORM);
    setFormField(0);
    await loadJobs();
    setBusy(false);
    setMode('list');
  }, [call, form, loadJobs]);

  useInput(
    (input, key) => {
      if (degraded || busy) return;

      if (mode === 'runs') {
        if (key.escape || input === 'q') setMode('list');
        return;
      }

      if (mode === 'create') {
        if (key.escape) {
          setMode('list');
          return;
        }
        return;
      }

      if (key.ctrl || key.meta) return;

      if (input === 'n') {
        setForm(EMPTY_FORM);
        setFormField(0);
        setMode('create');
        return;
      }
      const job = jobs[activeIndex];
      if (!job) return;
      if (input === 't') void toggleJob(job);
      if (input === 'x') void runNow(job);
      if (input === 'd') void deleteJob(job);
      if (key.return || input === 'h') void openRuns(job);
    },
    { isActive: isActive && !degraded && !busy },
  );

  if (degraded) {
    return (
      <Box flexDirection="column">
        <Text color={theme.status.warning}>
          Schedules subsystem degraded{reason ? ` — ${reason}` : ''}.
        </Text>
        <Text dimColor>Chat remains available; cron features are paused.</Text>
      </Box>
    );
  }

  if (loading) {
    return <Spinner label="Loading schedules…" />;
  }

  if (mode === 'runs') {
    return (
      <Box flexDirection="column">
        <Text color={theme.ui.accent} bold>
          Run history
        </Text>
        {runs.length === 0 ? (
          <Text dimColor>No runs recorded.</Text>
        ) : (
          runs.map((run) => (
            <Box key={run.id}>
              <Text color={runStatusColor(run.status, theme)}>
                {run.status}
              </Text>
              <Text dimColor>
                {' '}
                {new Date(run.scheduledFor).toISOString()}
                {run.errorMessage ? ` — ${run.errorMessage}` : ''}
              </Text>
            </Box>
          ))
        )}
        <Box marginTop={1}>
          <KeyHint keys="Esc" label="back" />
        </Box>
      </Box>
    );
  }

  if (mode === 'create') {
    return (
      <Box flexDirection="column">
        <Text color={theme.ui.accent} bold>
          New scheduled job
        </Text>
        {CREATE_FIELDS.map((field, index) => (
          <FormField
            key={field}
            label={field === 'cronExpr' ? 'cron expression' : field}
            required
          >
            <TextInput
              value={form[field]}
              onChange={(val) => setForm((prev) => ({ ...prev, [field]: val }))}
              onSubmit={() => {
                if (index < CREATE_FIELDS.length - 1) {
                  setFormField(index + 1);
                } else {
                  void submitCreate();
                }
              }}
              focus={formField === index}
              placeholder={
                field === 'cronExpr' ? '0 9 * * 1-5' : `enter ${field}`
              }
            />
          </FormField>
        ))}
        {busy ? <Spinner label="Creating…" /> : null}
        <Box marginTop={1} gap={2}>
          <KeyHint keys="Enter" label="next / submit" />
          <KeyHint keys="Esc" label="cancel" />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {jobs.length === 0 ? (
        <Text dimColor>No scheduled jobs. Press N to create one.</Text>
      ) : (
        jobs.slice(0, 12).map((job, index) => (
          <ListItem
            key={job.id}
            label={job.name}
            description={`${job.cronExpr} · ${job.timezone}`}
            isSelected={index === activeIndex && isActive}
            badge={
              <Badge variant={job.enabled ? 'success' : 'ghost'}>
                {job.enabled ? 'enabled' : 'disabled'}
              </Badge>
            }
          />
        ))
      )}

      {busy ? (
        <Box marginTop={1}>
          <Spinner label="Working…" />
        </Box>
      ) : null}

      <Box marginTop={1} gap={2}>
        <KeyHint keys="↑↓" label="navigate" />
        <KeyHint keys="T" label="toggle" />
        <KeyHint keys="X" label="run now" />
        <KeyHint keys="Enter" label="runs" />
        <KeyHint keys="N" label="new" />
        <KeyHint keys="D" label="delete" />
      </Box>
    </Box>
  );
}

export default SchedulesPanel;
