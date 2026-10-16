import { promises as fsPromises } from 'fs';
import { RpcUserError, type Logger } from '@ptah-extension/vscode-core';
import type {
  AnalysisFreshnessService,
  AnalysisStorageService,
} from '@ptah-extension/agent-generation';
import type {
  GenerationContextSource,
  SetupGenerationRunBinding,
  SetupGenerationTabBinding,
  SetupGenerationRejection,
  WizardGetGenerationRunStateResponse,
  WizardSubmitSelectionResponse,
} from '@ptah-extension/shared';
import type { PreparedGenerationRun } from './wizard-generation-checkpoint.service';

type Manifest = PreparedGenerationRun['manifest'];
type Freshness = Awaited<ReturnType<AnalysisFreshnessService['getStatus']>>;
type VerifiedManifest = Awaited<
  ReturnType<AnalysisStorageService['loadManifest']>
>;

export function generationRunState(
  manifest: Manifest,
  tabBinding: SetupGenerationTabBinding,
  active: SetupGenerationRunBinding | null,
): WizardGetGenerationRunStateResponse {
  const binding = { ...tabBinding, runId: manifest.runId };
  const isActive =
    active?.runId === manifest.runId &&
    active.tabId === binding.tabId &&
    active.workspacePath === binding.workspacePath;
  const status = isActive
    ? 'running'
    : manifest.lifecycle === 'completed'
      ? 'completed'
      : manifest.lifecycle === 'timed-out'
        ? 'timed-out'
        : manifest.lifecycle === 'paused'
          ? 'cancelled'
          : manifest.lifecycle === 'failed'
            ? 'failed'
            : 'starting';
  const source: GenerationContextSource = manifest.source ?? {
    kind: 'workspace-discovery',
    reason: 'missing',
  };
  const effectiveProvider = manifest.effectiveProvider ?? 'anthropic';
  const effectiveModel =
    manifest.effectiveModel ?? manifest.input.model ?? 'sonnet';
  return {
    run: {
      binding,
      status,
      source,
      effectiveProvider,
      effectiveModel,
      ...(status !== 'running' && status !== 'starting'
        ? {
            result: {
              status,
              success: status === 'completed',
              source,
              effectiveProvider,
              effectiveModel,
              enhancedPromptsUsed: manifest.enhancedPromptsUsed,
            },
          }
        : {}),
    },
  };
}

export function rejectSubmit(
  reason: SetupGenerationRejection['reason'],
): WizardSubmitSelectionResponse {
  return {
    success: false,
    rejection: { reason },
    error: 'Generation request was not accepted.',
  };
}

export function blockedSubmit(
  binding: SetupGenerationTabBinding,
  owner: SetupGenerationRunBinding | null,
): WizardSubmitSelectionResponse {
  const sameWorkspace = owner?.workspacePath === binding.workspacePath;
  return {
    success: false,
    rejection: {
      reason: 'blocked',
      ...(sameWorkspace && owner.tabId !== binding.tabId
        ? { ownerTabId: owner.tabId }
        : {}),
    },
    error: 'Agent generation is already in progress.',
  };
}

export async function authorizeTabWorkspace(
  hostRoot: string,
  binding: SetupGenerationTabBinding,
  logger: Logger,
): Promise<string | null> {
  try {
    const host = await fsPromises.realpath(hostRoot);
    const tab = await fsPromises.realpath(binding.workspacePath);
    return process.platform === 'win32'
      ? host.toLowerCase() === tab.toLowerCase()
        ? host
        : null
      : host === tab
        ? host
        : null;
  } catch (error: unknown) {
    logger.warn(
      'Could not authorize generation workspace',
      error instanceof Error ? error : new Error(String(error)),
    );
    return null;
  }
}

export function generationContextSource(
  trustedDir: string | null,
  tabBinding: SetupGenerationTabBinding | undefined,
  verifiedManifest: VerifiedManifest,
  requestedDir: string | null,
  freshDir: string | null,
  lookupFailed: boolean,
  status: Freshness,
): GenerationContextSource {
  return trustedDir && (!tabBinding || verifiedManifest?.runId)
    ? {
        kind: 'verified-analysis',
        analysisDir: trustedDir,
        analysisRunId: verifiedManifest?.runId ?? '',
      }
    : {
        kind: 'workspace-discovery',
        reason:
          requestedDir && freshDir && requestedDir !== freshDir
            ? 'not-latest'
            : lookupFailed
              ? 'lookup-failed'
              : status.reason === 'unreadable'
                ? 'unreadable'
                : status.state === 'missing'
                  ? 'missing'
                  : 'stale',
      };
}

export async function resolveGenerationContext(
  freshness: AnalysisFreshnessService,
  storage: AnalysisStorageService,
  workspaceRoot: string,
  analysisDir: string | null,
  tabBinding: SetupGenerationTabBinding | undefined,
  logger: Logger,
): Promise<{
  status: Freshness;
  freshDir: string | null;
  trustedDir: string | null;
  source: GenerationContextSource;
}> {
  let status: Freshness;
  let lookupFailed = false;
  try {
    status = await freshness.getStatus(workspaceRoot);
  } catch (error: unknown) {
    // degradation-audit: optional-capability - freshness lookup failure
    // leaves generation available through current workspace discovery.
    logger.warn(
      'RPC: wizard:submit-selection could not determine analysis freshness',
      { cause: error instanceof Error ? error.name : typeof error },
    );
    lookupFailed = true;
    status = {
      state: 'stale',
      reason: 'unreadable',
      analysisDir: null,
      checkedAt: new Date().toISOString(),
      analyzedAt: null,
    };
  }
  const freshDir =
    status.state === 'fresh' && status.analysisDir
      ? storage.resolveAuthorizedAnalysisDir(workspaceRoot, status.analysisDir)
      : null;
  const requestedDir = analysisDir;
  const trustedDir =
    freshDir && (!requestedDir || requestedDir === freshDir) ? freshDir : null;
  let verifiedManifest: VerifiedManifest = null;
  if (tabBinding && trustedDir) {
    try {
      verifiedManifest = await storage.loadManifest(trustedDir);
    } catch (error: unknown) {
      lookupFailed = true;
      logger.error(
        'Verified analysis manifest lookup failed',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
  return {
    status,
    freshDir,
    trustedDir,
    source: generationContextSource(
      trustedDir,
      tabBinding,
      verifiedManifest,
      requestedDir,
      freshDir,
      lookupFailed,
      status,
    ),
  };
}

export function acceptedSubmit(
  tabBinding: SetupGenerationTabBinding | undefined,
  prepared: PreparedGenerationRun,
  source: GenerationContextSource,
  route: { provider: string; model: string } | null,
): WizardSubmitSelectionResponse {
  return tabBinding
    ? {
        success: true,
        accepted: {
          runId: prepared.manifest.runId,
          source,
          status: 'starting',
          effectiveProvider:
            prepared.manifest.effectiveProvider ??
            route?.provider ??
            'anthropic',
          effectiveModel:
            prepared.manifest.effectiveModel ?? route?.model ?? 'sonnet',
        },
      }
    : { success: true };
}

export function consumeConfirmedPreview(
  confirmedPreviews: Map<string, string>,
  tabBinding: SetupGenerationTabBinding,
  workspaceRoot: string,
  currentPreview: string,
): boolean {
  const previewKey = `${tabBinding.tabId}\0${workspaceRoot}`;
  const confirmed = confirmedPreviews.get(previewKey) === currentPreview;
  confirmedPreviews.delete(previewKey);
  return confirmed;
}

export interface GenerationProviderModels {
  resolveActiveProviderId(): string;
  getModelTiers(
    providerId: string,
    scope: 'mainAgent',
  ): { sonnet: string | null; opus: string | null; haiku: string | null };
}

export function resolveProviderRoute(
  models: GenerationProviderModels,
  requestedModel?: string,
): { provider: string; model: string } {
  const provider = models.resolveActiveProviderId();
  const tiers = models.getModelTiers(provider, 'mainAgent');
  const supported = [
    'sonnet',
    'opus',
    'haiku',
    ...Object.values(tiers).filter((v): v is string => !!v),
  ];
  if (
    requestedModel &&
    !supported.includes(requestedModel) &&
    !(
      provider === 'anthropic' &&
      /^claude-(sonnet|opus|haiku)-[\w-]+$/.test(requestedModel)
    )
  )
    throw new RpcUserError(
      'The selected model is unavailable for this provider.',
      'INVALID_PARAMS',
    );
  return { provider, model: requestedModel ?? tiers.sonnet ?? 'sonnet' };
}
