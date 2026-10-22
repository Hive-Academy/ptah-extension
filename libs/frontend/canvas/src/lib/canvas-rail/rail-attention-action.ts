import type { AttentionItem } from '@ptah-extension/core';

export function isPrimaryAttentionAction(
  item: AttentionItem,
  action: AttentionItem['actions'][number],
): boolean {
  const decision = item.actions.find(candidate =>
    candidate.id.toLowerCase() === 'answer' || candidate.id.toLowerCase() === 'allow',
  );
  return !!decision && !decision.disabledReason
    ? action.id === decision.id
    : action.id.toLowerCase() === 'open';
}
