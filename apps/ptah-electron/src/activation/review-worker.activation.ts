import { CRON_TOKENS, type IHandlerRegistry, type IJobStore } from '@ptah-extension/cron-scheduler';
import { REVIEW_CORE_TOKENS, type IReviewSettingsStore, type ReviewOrchestratorService } from '@ptah-extension/review-core';
import type { Logger } from '@ptah-extension/vscode-core';
import type { DependencyContainer } from 'tsyringe';

const HANDLER = 'review:discover';
const JOB_ID = '@ptah/review-discovery';

export interface ReviewWorkerHandle { dispose(): void; awaitStopped(): Promise<void> }

/** Registers discovery with cron, then drains the durable queue independently. */
export async function startReviewWorker(
  container: DependencyContainer,
  signal: AbortSignal,
  logger: Pick<Logger, 'error'>,
): Promise<ReviewWorkerHandle | null> {
  if (signal.aborted || !container.isRegistered(REVIEW_CORE_TOKENS.ORCHESTRATOR)) return null;
  const orchestrator = container.resolve<ReviewOrchestratorService>(REVIEW_CORE_TOKENS.ORCHESTRATOR);
  const settingsStore = container.resolve<IReviewSettingsStore>(REVIEW_CORE_TOKENS.SETTINGS_STORE);
  const jobs = container.resolve<IJobStore>(CRON_TOKENS.CRON_JOB_STORE);
  const registry = container.resolve<IHandlerRegistry>(CRON_TOKENS.CRON_HANDLER_REGISTRY);
  if (!registry.has(HANDLER)) registry.register(HANDLER, async ({ signal: tickSignal }) => {
    if (signal.aborted || tickSignal.aborted) return { outcome: 'skipped', reason: 'aborted' };
    const settings = await settingsStore.getSettings();
    const repos = (settings?.repositories.filter((entry) => entry.enabled) ?? [])
      .map((entry) => ({ owner: entry.owner, name: entry.name }));
    if (!settings || repos.length === 0) return { outcome: 'skipped', reason: 'review-disabled' };
    let count = 0;
    for (const repo of repos) {
      try {
        const last = await orchestrator.lastPollAt(repo);
        if (last === null || Date.now() - last >= settings.pollMinutes * 60_000) count += await orchestrator.pollAndRecord(repo);
      } catch (error: unknown) { logger.error('Review poll failed', error instanceof Error ? error : new Error(String(error))); }
    }
    return { summary: `Enqueued ${count} review heads` };
  });
  jobs.upsert({ id: JOB_ID, name: 'Review pull requests', cronExpr: '* * * * *',
    timezone: 'UTC', prompt: `handler:${HANDLER}`, enabled: true });

  try {
    const settings = await settingsStore.getSettings();
    const enabled = (settings?.repositories.filter((entry) => entry.enabled) ?? [])
      .map((entry) => ({ owner: entry.owner, name: entry.name }));
    for (const repo of enabled) {
      try { await orchestrator.startupPoll(await orchestrator.lastPollAt(repo), repo); }
      catch (error: unknown) { logger.error('Review startup poll failed', error instanceof Error ? error : new Error(String(error))); }
    }
  } catch (_error: unknown) {
    logger.error('Review startup poll failed', new Error('Review startup poll failed'));
  }
  let disposed = false;
  let draining = false;
  let activeDrain: Promise<void> | null = null;
  const drainController = new AbortController();
  const owner = `electron-review-${process.pid}-${Date.now()}`;
  const drain = (): void => {
    if (disposed || signal.aborted || draining) return;
    draining = true;
    activeDrain = orchestrator.drain(owner, Date.now() + 60_000, drainController.signal).then(() => undefined).catch((_error: unknown) => {
      logger.error('Review queue drain failed', new Error('Review queue drain failed'));
    }).finally(() => { draining = false; activeDrain = null; });
  };
  const timer = setInterval(drain, 30_000);
  timer.unref();
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    drainController.abort();
    clearInterval(timer);
    signal.removeEventListener('abort', dispose);
    registry.unregister(HANDLER);
  };
  signal.addEventListener('abort', dispose, { once: true });
  drain();
  return { dispose, awaitStopped: () => activeDrain ?? Promise.resolve() };
}

