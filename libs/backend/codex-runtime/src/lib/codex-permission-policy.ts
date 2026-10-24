import type {
  CodexApprovalDecision,
  CodexApprovalRequest,
  CodexPermissionLevel,
} from './codex-runtime.types';

export type CodexPermissionDecision =
  'present' | Exclude<CodexApprovalDecision, 'cancel'>;

/** Local approval routing only; sandbox/profile construction belongs to the profile builder. */
export function codexPermissionPolicy(
  level: CodexPermissionLevel,
  kind: CodexApprovalRequest['kind'],
  ruleStoreHit: boolean,
  details?: CodexApprovalRequest['details'],
): CodexPermissionDecision {
  // Questions (including plan-exit interaction) cannot become an approval grant.
  if (kind === 'userInput') return 'present';
  // Approval requests can carry effects. A remembered grant cannot exit plan mode.
  if (level === 'plan') return 'decline';
  // Missing details cannot prove a file-only grant. Unknown fields fail closed too.
  if (
    kind === 'fileChange' &&
    ((!details && level === 'auto-edit') ||
      (details &&
        (details['grantRoot'] != null ||
          Object.keys(details).some(
            (key) =>
              ![
                'threadId',
                'turnId',
                'itemId',
                'startedAtMs',
                'reason',
                'grantRoot',
              ].includes(key),
          ))))
  )
    return 'present';
  if (ruleStoreHit) return 'acceptForSession';
  if (level === 'yolo' || (level === 'auto-edit' && kind === 'fileChange')) {
    return 'accept';
  }
  return 'present';
}
