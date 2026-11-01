import { z } from 'zod';
import type {
  ApprovalSink,
  Clock,
  CodexRuntimeLogger,
} from './codex-runtime-ports';
import type {
  CodexApprovalCorrelation,
  CodexApprovalDecision,
  CodexApprovalRequest,
  CodexJsonValue,
  CodexPermissionLevel,
  CodexThreadIdentity,
} from './codex-runtime.types';
import { codexPermissionPolicy } from './codex-permission-policy';
import { CodexPermissionRuleStore } from './codex-permission-rule-store';
import type { CodexPermissionRuleTarget } from './codex-permission-rule-store';
import {
  codexServerRequestSchemas,
  validateCodexFrame,
  validateCodexResult,
} from './codex-protocol-validator';

type Method = keyof typeof codexServerRequestSchemas;
const kinds: Record<Method, CodexApprovalRequest['kind']> = {
  'item/commandExecution/requestApproval': 'command',
  'item/fileChange/requestApproval': 'fileChange',
  'item/permissions/requestApproval': 'permissions',
  'item/tool/requestUserInput': 'userInput',
  'mcpServer/elicitation/request': 'mcpElicitation',
};
/** Auto-decline delay for approvals when no timeout is configured. */
const DEFAULT_APPROVAL_TIMEOUT_MS = 240_000;
/**
 * AskUserQuestion's idle auto-pick is 300s. This package must not import
 * agent-sdk, so the floor is restated here. The question backstop must be
 * later, or the bridge declines before the host answers.
 */
const HOST_QUESTION_IDLE_TIMEOUT_MS = 300_000;
const USER_INPUT_BACKSTOP_MS = 330_000;
const answersSchema = z.record(
  z.string(),
  z.object({ answers: z.array(z.string()) }),
);
type Answers = z.infer<typeof answersSchema>;

export interface CodexApprovalBridgeOptions {
  readonly identity: CodexThreadIdentity;
  readonly sink: ApprovalSink;
  readonly rules: CodexPermissionRuleStore;
  readonly clock: Clock;
  readonly permissionLevel: () => CodexPermissionLevel;
  readonly isCurrent: (correlation: CodexApprovalCorrelation) => boolean;
  readonly isWritable: () => boolean;
  readonly close: () => void;
  readonly timeoutMs?: number;
  /** Production passes the runtime logger. Absent only in bridges built outside this package. */
  readonly logger?: CodexRuntimeLogger;
  /** Only validated item notifications may supply paths or explicit MCP tool attribution. */
  readonly resolveTarget?: (
    request: CodexApprovalRequest,
  ) => CodexPermissionRuleTarget | undefined;
  /** Questions are a separate interaction; approval decisions never become answers. */
  readonly requestUserInput?: (
    request: CodexApprovalRequest,
    signal: AbortSignal,
  ) => Promise<Answers>;
}

export interface CodexApprovalBridgeResult {
  /** Return this value from CodexAppServerHandlers.onRequest, exactly once. */
  readonly response: unknown;
  /** The consumer must send the decline response BEFORE delivering any follow-up via steer. */
  readonly editNotSupported?: true;
  readonly followUpMessage?: string;
  /**
   * User-authored deny-with-message text for turn/steer.
   * Absent for Allow, plain Deny (cancel), and a blank reason.
   * The consumer must write `response` before steering this.
   */
  readonly denialFeedback?: string;
}

/** ApprovalSink can only return a decision or the edit marker. This extra field is the typed reason. */
function denialReasonText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

function denialToolLabel(
  kind: CodexApprovalRequest['kind'],
): string | undefined {
  switch (kind) {
    case 'command':
      return 'command';
    case 'fileChange':
      return 'file change';
    case 'permissions':
      return 'permissions';
    case 'mcpElicitation':
      return 'MCP elicitation';
    case 'userInput':
      return undefined;
  }
}

/** Claude deny_with_message wording, on a native steer because decline has no reason field. */
function denialFeedbackMessage(
  kind: CodexApprovalRequest['kind'],
  reason: string,
): string | undefined {
  const tool = denialToolLabel(kind);
  if (tool === undefined) return undefined;
  const quoted = reason.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  return `The user denied this ${tool} request with the message: "${quoted}". Respect this decision, do not retry the same call, and adjust your approach.`;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const FORM_FIELD_KEYS = [
  'type',
  'title',
  'description',
  'default',
  'const',
  'enum',
];

function declaredFieldValue(field: Record<string, unknown>): unknown {
  if ('const' in field) return field['const'];
  if ('default' in field) return field['default'];
  return undefined;
}

/** The only non-declared value: Codex tool-approval's required `approve` boolean. */
function approvalGrant(
  name: string,
  field: Record<string, unknown>,
  required: boolean,
): boolean {
  return (
    required &&
    name === 'approve' &&
    field['type'] === 'boolean' &&
    !('const' in field) &&
    !('default' in field)
  );
}

function fieldValueFits(
  field: Record<string, unknown>,
  value: unknown,
): value is string | boolean | number {
  const choices = field['enum'];
  const typed =
    (field['type'] === 'string' && typeof value === 'string') ||
    (field['type'] === 'boolean' && typeof value === 'boolean') ||
    (field['type'] === 'number' &&
      typeof value === 'number' &&
      Number.isFinite(value)) ||
    (field['type'] === 'integer' &&
      typeof value === 'number' &&
      Number.isSafeInteger(value));
  return (
    typed &&
    (!Array.isArray(choices) || choices.includes(value)) &&
    (typeof value === 'string' ||
      typeof value === 'boolean' ||
      typeof value === 'number')
  );
}

/**
 * Content is schema `const`/`default` values, plus `approve: true` for the
 * tool-approval boolean. Other required fields without those values cannot
 * be answered. Unknown constraints fail closed.
 */
function formContent(
  params: Record<string, unknown>,
): Record<string, CodexJsonValue> | undefined {
  if (params['mode'] !== 'form') return undefined;
  const schema = record(params['requestedSchema']);
  const properties = record(schema['properties']);
  const required = schema['required'];
  const names = Array.isArray(required) ? required : [];
  const content: Record<string, CodexJsonValue> = {};
  for (const [name, raw] of Object.entries(properties)) {
    const field = record(raw);
    const requiredField = names.includes(name);
    if (Object.keys(field).some((key) => !FORM_FIELD_KEYS.includes(key))) {
      if (requiredField) return undefined;
      continue;
    }
    const declared = declaredFieldValue(field);
    const value =
      declared !== undefined
        ? declared
        : approvalGrant(name, field, requiredField)
          ? true
          : undefined;
    if (fieldValueFits(field, value)) {
      Object.defineProperty(content, name, { value, enumerable: true });
    } else if (requiredField) return undefined;
  }
  return names.every(
    (name) => typeof name === 'string' && Object.hasOwn(content, name),
  )
    ? content
    : undefined;
}

function elicitationAnswerable(params: Record<string, unknown>): boolean {
  return params['mode'] === 'form' && formContent(params) !== undefined;
}

/** One instance per process generation. Transport remains the process's single writer. */
export class CodexApprovalBridge {
  private readonly seen = new Set<string>();
  private readonly pending = new Set<() => void>();
  private disposed = false;

  constructor(private readonly options: CodexApprovalBridgeOptions) {
    const timeout = this.approvalTimeout();
    if (
      !Number.isFinite(timeout) ||
      timeout <= 0 ||
      USER_INPUT_BACKSTOP_MS <= HOST_QUESTION_IDLE_TIMEOUT_MS
    ) {
      throw new Error('Invalid approval timeout');
    }
  }

  async handle(
    value: unknown,
    turnId: string,
    signal: AbortSignal,
  ): Promise<CodexApprovalBridgeResult> {
    const frame = validateCodexFrame(value);
    if (
      !('method' in frame) ||
      !('id' in frame) ||
      !Object.hasOwn(kinds, frame.method)
    ) {
      throw new Error('Unsupported approval request');
    }
    const method = frame.method as Method;
    const params = record(frame.params);
    const identity = this.options.identity;
    const correlation: CodexApprovalCorrelation = {
      contextId: identity.contextId,
      processGeneration: identity.processGeneration,
      threadId: identity.threadId,
      turnId,
      requestId: frame.id,
    };
    const key = JSON.stringify([
      correlation.contextId,
      correlation.processGeneration,
      correlation.threadId,
      correlation.turnId,
      correlation.requestId,
    ]);
    // Retained until generation disposal, so even a completed request cannot be replayed.
    if (this.seen.has(key)) throw new Error('Duplicate approval request');
    this.seen.add(key);
    const request: CodexApprovalRequest = {
      ...identity,
      ...correlation,
      kind: kinds[method],
      ...(typeof params['itemId'] === 'string' && params['itemId']
        ? { toolId: params['itemId'] }
        : {}),
      expiresAt:
        this.options.clock.now() + this.approvalTimeout(kinds[method]),
      message:
        typeof params['message'] === 'string'
          ? params['message']
          : typeof params['reason'] === 'string'
            ? params['reason']
            : 'Codex requests approval',
      details: record(frame.params) as Record<string, CodexJsonValue>,
    };
    if (request.kind === 'mcpElicitation' && !elicitationAnswerable(params)) {
      this.options.logger?.warn(
        'Codex elicitation cannot be answered without user input.',
        {
          code: 'codex-elicitation-unanswerable',
          mode: typeof params['mode'] === 'string' ? params['mode'] : 'unknown',
          serverName:
            typeof params['serverName'] === 'string' ? params['serverName'] : '',
        },
      );
      const response = validateCodexResult(method, { action: 'decline' });
      if (!this.options.isWritable()) {
        this.options.close();
        throw new Error('Approval transport unavailable');
      }
      return { response };
    }
    const current = () =>
      !this.disposed &&
      params['threadId'] === identity.threadId &&
      (params['turnId'] == null
        ? request.kind === 'mcpElicitation' && turnId.length > 0
        : params['turnId'] === turnId) &&
      this.options.isCurrent(correlation);
    const target = this.target(request, params);
    let reply: unknown = 'decline';
    if (current() && !signal.aborted) {
      const policy = codexPermissionPolicy(
        this.options.permissionLevel(),
        request.kind,
        target !== undefined && this.options.rules.matches(identity, target),
        request.details,
      );
      reply = await this.interact(request, signal, policy);
    }
    const edited = record(reply);
    const userDenial = denialReasonText(edited['denialReason']);
    const isEdit =
      request.kind !== 'userInput' &&
      (edited['editNotSupported'] === true ||
        [
          'updatedInput',
          'modifiedInput',
          'editedInput',
          'followUpMessage',
        ].some((key) => Object.hasOwn(edited, key)));
    const live = current() && !signal.aborted;
    const decision: CodexApprovalDecision = this.disposed
      ? 'decline'
      : !live
        ? 'cancel'
        : isEdit ||
            (request.kind !== 'userInput' &&
              this.options.permissionLevel() === 'plan')
          ? 'decline'
          : reply === 'accept' ||
              reply === 'acceptForSession' ||
              reply === 'cancel'
            ? reply
            : 'decline';
    const response = validateCodexResult(
      method,
      this.response(
        method,
        params,
        decision,
        live && !isEdit ? reply : undefined,
      ),
    );
    if (!this.options.isWritable()) {
      this.options.close();
      throw new Error('Approval transport unavailable');
    }
    // Only a validated grant from a live reply may create a reusable rule.
    if (
      live &&
      !isEdit &&
      decision === 'acceptForSession' &&
      target !== undefined &&
      (request.kind !== 'mcpElicitation' ||
        record(response)['action'] === 'accept')
    ) {
      this.options.rules.record(identity, target, decision);
    }
    const text = [
      edited['followUpMessage'],
      edited['editedInput'],
      edited['modifiedInput'],
      edited['updatedInput'],
    ].find((entry) => typeof entry === 'string');
    const denialFeedback =
      live && !isEdit && decision === 'decline' && userDenial !== undefined
        ? denialFeedbackMessage(request.kind, userDenial)
        : undefined;
    return {
      response,
      ...(live && isEdit
        ? {
            editNotSupported: true as const,
            ...(typeof text === 'string' ? { followUpMessage: text } : {}),
          }
        : {}),
      ...(denialFeedback !== undefined ? { denialFeedback } : {}),
    };
  }

  private target(
    request: CodexApprovalRequest,
    params: Record<string, unknown>,
  ): CodexPermissionRuleTarget | undefined {
    if (request.kind === 'command') {
      return typeof params['command'] === 'string' &&
        typeof params['cwd'] === 'string' &&
        params['kind'] !== 'writeStdin' &&
        params['networkApprovalContext'] == null
        ? { kind: 'command', command: params['command'], cwd: params['cwd'] }
        : undefined;
    }
    if (request.kind !== 'fileChange' && request.kind !== 'mcpElicitation')
      return undefined;
    const target = this.options.resolveTarget?.(request);
    if (target?.kind !== request.kind) return undefined;
    if (
      target.kind === 'mcpElicitation' &&
      target.server !== params['serverName']
    )
      return undefined;
    return target;
  }

  /**
   * Presented deadline and auto-decline delay for this kind.
   * `timeoutMs` scales approvals only. Questions stay on the 330s backstop
   * so a shorter approval timeout cannot beat the host auto-pick.
   */
  private approvalTimeout(kind?: CodexApprovalRequest['kind']): number {
    if (kind === 'userInput') return USER_INPUT_BACKSTOP_MS;
    return this.options.timeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;
  }

  private interact(
    request: CodexApprovalRequest,
    signal: AbortSignal,
    policy: string,
  ): Promise<unknown> {
    return new Promise((resolve) => {
      const controller = new AbortController();
      let settled = false;
      const finish = (reply: unknown) => {
        if (settled) return;
        settled = true;
        timer.dispose();
        signal.removeEventListener('abort', abort);
        this.pending.delete(dispose);
        controller.abort();
        resolve(reply);
      };
      const abort = () => finish('cancel');
      const dispose = () => finish('decline');
      const timer = this.options.clock.setTimeout(
        dispose,
        this.approvalTimeout(request.kind),
      );
      this.pending.add(dispose);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      void Promise.resolve()
        .then(() => {
          if (settled) return 'decline';
          if (request.kind === 'userInput')
            return (
              this.options.requestUserInput?.(request, controller.signal) ?? {}
            );
          return policy === 'present'
            ? this.options.sink.request(request, controller.signal)
            : policy;
        })
        .then(finish, () => finish('decline'));
    });
  }

  private response(
    method: Method,
    params: Record<string, unknown>,
    decision: CodexApprovalDecision,
    reply: unknown,
  ): unknown {
    const accepted = decision === 'accept' || decision === 'acceptForSession';
    switch (method) {
      case 'item/commandExecution/requestApproval':
      case 'item/fileChange/requestApproval':
        return { decision };
      case 'item/permissions/requestApproval':
        return {
          permissions: accepted ? params['permissions'] : {},
          scope: decision === 'acceptForSession' ? 'session' : 'turn',
        };
      case 'mcpServer/elicitation/request': {
        const content = accepted ? formContent(params) : undefined;
        return content !== undefined
          ? { action: 'accept', content }
          : { action: decision === 'cancel' ? 'cancel' : 'decline' };
      }
      case 'item/tool/requestUserInput': {
        const parsed = answersSchema.safeParse(reply);
        const questions = Array.isArray(params['questions'])
          ? params['questions']
          : [];
        const ids = new Set(
          questions.map((question) => record(question)['id']),
        );
        return {
          answers: parsed.success
            ? Object.fromEntries(
                Object.entries(parsed.data).filter(([id]) => ids.has(id)),
              )
            : {},
        };
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const finish of this.pending) finish();
    this.seen.clear();
  }
}
