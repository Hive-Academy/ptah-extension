import { z } from 'zod';
import type { RepositorySettings } from '@ptah-extension/review-contracts';
import { CRON_TOKENS, type IHandlerRegistry, type IJobStore } from '@ptah-extension/cron-scheduler';
import { PERSISTENCE_TOKENS, type SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import { REVIEW_CORE_TOKENS, type IReviewSettingsStore, type ReviewStageEnvironment, type ReviewOrchestratorService } from '@ptah-extension/review-core';
import type { Logger } from '@ptah-extension/vscode-core';
import type { DependencyContainer } from 'tsyringe';

const repo = { owner: 'Hive-Academy', name: 'PtahCode' } as const;
const HANDLER = 'review:discover';
const JOB_ID = '@ptah/review-discovery';
const pollRowSchema = z.object({ last_poll_at: z.number().int().nullable() });

export interface ReviewWorkerHandle { dispose(): void; awaitStopped(): Promise<void> }

/** Registers discovery with cron, then drains the durable queue independently. */
export async function startReviewWorker(
  container: DependencyContainer,
  signal: AbortSignal,
  logger: Pick<Logger, 'error'>,
): Promise<ReviewWorkerHandle | null> {
  if (signal.aborted || !container.isRegistered(REVIEW_CORE_TOKENS.ORCHESTRATOR)) return null;
  const orchestrator = container.resolve<ReviewOrchestratorService>(REVIEW_CORE_TOKENS.ORCHESTRATOR);
  const environment = container.resolve<ReviewStageEnvironment>(REVIEW_CORE_TOKENS.ENVIRONMENT);
  const settingsStore = container.resolve<IReviewSettingsStore>(REVIEW_CORE_TOKENS.SETTINGS_STORE);
  const jobs = container.resolve<IJobStore>(CRON_TOKENS.CRON_JOB_STORE);
  const registry = container.resolve<IHandlerRegistry>(CRON_TOKENS.CRON_HANDLER_REGISTRY);
  const sqlite = container.resolve<SqliteConnectionService>(PERSISTENCE_TOKENS.SQLITE_CONNECTION);
  const pollTime = (): number | null => {
    const raw = sqlite.db.prepare('SELECT last_poll_at FROM review_repositories WHERE repo_id = ?')
      .get('hive-academy/ptahcode');
    return raw ? pollRowSchema.parse(raw).last_poll_at : null;
  };
  const discover = async (): Promise<number> => {
    await environment.resolve(repo);
    const result = await orchestrator.discoveryHandler();
    sqlite.db.prepare('UPDATE review_repositories SET last_poll_at = ? WHERE repo_id = ?')
      .run(Date.now(), 'hive-academy/ptahcode');
    return Number(/\d+/.exec(result.summary)?.[0] ?? 0);
  };
  if (!registry.has(HANDLER)) registry.register(HANDLER, async ({ signal: tickSignal }) => {
    if (signal.aborted || tickSignal.aborted) return { outcome: 'skipped', reason: 'aborted' };
    const settings = await settingsStore.getSettings();
    const enabled = settings?.repositories.some((entry: RepositorySettings) => entry.enabled &&
      entry.owner === repo.owner && entry.name === repo.name);
    if (!settings || !enabled) return { outcome: 'skipped', reason: 'review-disabled' };
    const last = pollTime();
    if (last !== null && Date.now() - last < settings.pollMinutes * 60_000)
      return { outcome: 'skipped', reason: 'not-due' };
    const count = await discover();
    return { summary: `Enqueued ${count} review heads` };
  });
  jobs.upsert({ id: JOB_ID, name: 'Review pull requests', cronExpr: '* * * * *',
    timezone: 'UTC', prompt: `handler:${HANDLER}`, enabled: true });

  try {
    await environment.resolve(repo);
    const last = pollTime();
    await orchestrator.startupPoll(last);
    if (last === null || Date.now() - last >= 48 * 60 * 60 * 1000)
      sqlite.db.prepare('UPDATE review_repositories SET last_poll_at = ? WHERE repo_id = ?')
        .run(Date.now(), 'hive-academy/ptahcode');
  } catch {
    logger.error('Review startup poll failed', new Error('Review startup poll failed'));
  }
  let disposed = false;
  let draining = false;
  let activeDrain: Promise<void> | null = null;
  const owner = `electron-review-${process.pid}-${Date.now()}`;
  const drain = (): void => {
    if (disposed || signal.aborted || draining) return;
    draining = true;
    activeDrain = orchestrator.drain(owner, Date.now() + 60_000, signal).then(() => undefined).catch((_error: unknown) => {
      logger.error('Review queue drain failed', new Error('Review queue drain failed'));
    }).finally(() => { draining = false; activeDrain = null; });
  };
  const timer = setInterval(drain, 30_000);
  timer.unref();
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    clearInterval(timer);
    signal.removeEventListener('abort', dispose);
    registry.unregister(HANDLER);
  };
  signal.addEventListener('abort', dispose, { once: true });
  drain();
  return { dispose, awaitStopped: () => activeDrain ?? Promise.resolve() };
}
