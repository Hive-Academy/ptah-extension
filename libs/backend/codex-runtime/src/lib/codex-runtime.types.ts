/** JSON data after protocol validation; nested collections are immutable. */
export type CodexJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CodexJsonValue[]
  | { readonly [key: string]: CodexJsonValue };
export type CodexPermissionLevel = 'ask' | 'plan' | 'auto-edit' | 'yolo';
export type CodexApprovalPolicy =
  | 'on-request'
  | 'on-failure'
  | 'untrusted'
  | 'never'
  | {
      readonly granular: {
        readonly sandbox_approval: boolean;
        readonly rules: boolean;
        readonly skill_approval: boolean;
        readonly request_permissions: boolean;
        readonly mcp_elicitations: boolean;
      };
    };
export interface CodexSandboxPolicy {
  readonly mode: 'read-only' | 'workspace-write' | 'danger-full-access';
  readonly networkAccess: boolean;
  readonly writableRoots: readonly string[];
}
export type CodexAttachment =
  | {
      readonly type: 'image';
      readonly data: string;
      readonly mediaType: string;
    }
  | { readonly type: 'file'; readonly path: string };
export interface CodexInstructionSource {
  readonly kind: 'skill' | 'file' | 'inline';
  readonly name: string;
  readonly content: string;
}
/** References resolve only at the process boundary; never place secret values here. */
export type CodexMcpServer =
  | {
      readonly name: string;
      readonly transport: 'stdio';
      readonly command: string;
      readonly args: readonly string[];
      readonly envReferences: Readonly<Record<string, string>>;
    }
  | {
      readonly name: string;
      readonly transport: 'http' | 'sse';
      readonly url: string;
      readonly headerReferences: Readonly<Record<string, string>>;
      readonly authReference?: string;
    };
/**
 * Validated and deeply frozen by buildCodexExecutionProfile (the profile-builder batch).
 * Home, identity and workspace stay fixed on resume. Secrets are excluded from the
 * fingerprint. Ask requires granular-all-true approvals and a read-only sandbox.
 * Full access is an explicit, evidence-gated choice, never inferred from a consumer.
 */
export interface CodexExecutionProfile {
  readonly contextId: string;
  readonly consumer: 'chat' | 'gateway' | 'lane' | 'usage';
  readonly normalizedHome: string;
  readonly accountId?: string;
  readonly providerId: string;
  readonly workspaceId: string;
  readonly cwd: string;
  readonly model: string;
  readonly effort?: string;
  readonly permissionLevel: CodexPermissionLevel;
  readonly approvalPolicy: CodexApprovalPolicy;
  readonly sandboxPolicy: CodexSandboxPolicy;
  readonly enhancedPrompt?: string;
  readonly systemPrompt?: string;
  readonly developerPrompt?: string;
  readonly outputStyle?: string;
  readonly instructionSources: readonly CodexInstructionSource[];
  readonly mcpServers: readonly CodexMcpServer[];
  readonly attachments: readonly CodexAttachment[];
  readonly lane?: {
    readonly suppressedTools: readonly string[];
    readonly maxTurns?: number;
    readonly maxBudgetUsd?: number;
    readonly explicitFullAccess: boolean;
  };
  readonly profileFingerprint: string;
}
export interface CodexThreadIdentity {
  readonly threadId: string;
  readonly contextId: string;
  readonly processGeneration: number;
  readonly normalizedHome: string;
  readonly workspaceId: string;
  readonly providerId: string;
  readonly profileFingerprint: string;
}
export interface CodexTurnInput {
  readonly text: string;
  readonly attachments?: readonly CodexAttachment[];
  readonly signal?: AbortSignal;
}
export interface CodexTurnReceipt {
  readonly threadId: string;
  readonly turnId: string;
  readonly revision: number;
}
/** Identity/home/workspace cannot be changed through a turn-settings patch. */
export interface CodexTurnSettings {
  readonly model?: string;
  readonly effort?: string;
  readonly permissionLevel?: CodexPermissionLevel;
}
export interface AppliedSettings {
  readonly timing: 'effectiveNow' | 'nextTurn';
  readonly revision: number;
}
/**
 * Edit = decline + follow-up message; it is not equivalent to Claude updatedInput.
 * acceptForSession is scoped by Ptah's rule store, not an unrestricted grant.
 */
export type CodexApprovalDecision =
  'accept' | 'acceptForSession' | 'decline' | 'cancel';
export interface CodexApprovalCorrelation {
  readonly contextId: string;
  readonly processGeneration: number;
  readonly threadId: string;
  readonly turnId: string;
  readonly requestId: string | number;
}
/** The bridge validates method-specific data before presenting a request. */
export interface CodexApprovalRequest extends CodexApprovalCorrelation {
  readonly kind:
    'command' | 'fileChange' | 'mcpElicitation' | 'permissions' | 'userInput';
  readonly normalizedHome: string;
  readonly workspaceId: string;
  readonly providerId: string;
  readonly toolId?: string;
  readonly toolName?: string;
  readonly message: string;
  readonly details: Readonly<Record<string, CodexJsonValue>>;
}
/** Only values reported by the server; missing counters are not zero. */
/**
 * Whole-turn usage: cumulative thread total minus the turn-start baseline,
 * including every model request/tool continuation. Updates are snapshots, not deltas.
 * OpenAI inputTokens INCLUDES cachedInputTokens; consumers with separate buckets
 * use inputTokens - cachedInputTokens for input and cachedInputTokens for cacheRead.
 * cacheWriteInputTokens is reported separately (wire omission defaults to zero).
 * reasoningOutputTokens is a subset of outputTokens. No cost is inferred.
 */
export interface CodexReportedUsage {
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly cacheWriteInputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningOutputTokens?: number;
  readonly totalTokens?: number;
  /** Context-window occupancy of the most recent model request in this turn (wire tokenUsage.last.totalTokens). NOT a whole-turn quantity; use it for compaction preTokens / context fill, never for turn cost. */
  readonly lastRequestTotalTokens?: number;
  readonly costUsd?: number;
}
/** Sanitized, consumer-safe information, never raw errors or credentials. */
export interface CodexRuntimeError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}
interface CodexEventIdentity {
  readonly contextId: string;
  readonly processGeneration: number;
  readonly threadId: string;
  readonly turnId: string;
  /** Monotonic within this process generation, preserving wire order. */
  readonly sequence: number;
}
export type CodexRuntimeEvent = CodexEventIdentity &
  (
    | {
        readonly type: 'textDelta';
        readonly itemId: string;
        readonly delta: string;
      }
    | {
        readonly type: 'textFinal';
        readonly itemId: string;
        readonly text: string;
      }
    | {
        readonly type: 'toolStarted';
        readonly toolId: string;
        readonly toolName: string;
        readonly input: CodexJsonValue;
      }
    | {
        readonly type: 'toolCompleted';
        readonly toolId: string;
        readonly output: CodexJsonValue;
        readonly status: 'completed' | 'failed' | 'cancelled';
      }
    | {
        readonly type: 'reasoning';
        readonly itemId: string;
        readonly text: string;
        readonly phase: 'delta' | 'final';
      }
    | {
        readonly type: 'file';
        readonly itemId: string;
        readonly path: string;
        readonly operation: 'add' | 'update' | 'delete';
        readonly diff?: string;
      }
    | {
        readonly type: 'image';
        readonly itemId: string;
        readonly image: Extract<CodexAttachment, { readonly type: 'image' }>;
      }
    | { readonly type: 'usage'; readonly usage: CodexReportedUsage }
    | {
        readonly type: 'compaction';
        readonly phase: 'started' | 'completed' | 'failed';
      }
    | {
        readonly type: 'approvalRequested';
        readonly request: CodexApprovalRequest;
      }
    | {
        readonly type: 'approvalSettled';
        readonly correlation: CodexApprovalCorrelation;
        readonly decision: CodexApprovalDecision;
      }
    | { readonly type: 'error'; readonly error: CodexRuntimeError }
    | {
        readonly type: 'terminal';
        readonly status: 'completed' | 'interrupted' | 'failed';
        readonly usage?: CodexReportedUsage;
        readonly error?: CodexRuntimeError;
      }
  );
export interface CodexRuntime {
  open(
    profile: CodexExecutionProfile,
    resume?: CodexThreadIdentity,
  ): Promise<CodexContext>;
}
export interface CodexModelInfo {
  /** Catalog key; use model for thread/start and turn/start. */
  readonly id: string;
  readonly model: string;
  readonly displayName: string;
  readonly description?: string;
  readonly isDefault: boolean;
  readonly supportedEfforts?: readonly string[];
}
export interface CodexContext {
  readonly identity: CodexThreadIdentity;
  listModels(): Promise<readonly CodexModelInfo[]>;
  events(signal: AbortSignal): AsyncIterable<CodexRuntimeEvent>;
  startTurn(input: CodexTurnInput): Promise<CodexTurnReceipt>;
  steer(input: CodexTurnInput): Promise<CodexTurnReceipt>;
  interrupt(turnId: string): Promise<boolean>;
  updateNextTurn(patch: CodexTurnSettings): Promise<AppliedSettings>;
  compact(): Promise<void>;
  close(): Promise<void>;
}
