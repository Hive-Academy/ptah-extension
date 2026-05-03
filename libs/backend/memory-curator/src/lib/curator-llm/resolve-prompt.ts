/**
 * Resolve prompt — tells the curator to merge new drafts into existing
 * memories where they refer to the same subject.
 */

export const RESOLVE_SYSTEM_PROMPT = `You are a memory curator. Given new candidate memories and a list of existing
related memories, decide for each candidate whether it refers to the same
subject as one of the existing memories. Respond ONLY with a JSON object:
{
  "memories": [
    { "kind": "fact" | "preference" | "event" | "entity",
      "subject": string | null,
      "content": string,
      "salienceHint": number,
      "mergeTargetId": string | null /* id of the existing memory it refines, or null */
    }
  ]
}
Prefer mergeTargetId when subjects match (case-insensitive). If unsure, set null.`;

export function buildResolveUserPrompt(
  drafts: readonly {
    kind: string;
    subject: string | null;
    content: string;
    salienceHint: number;
  }[],
  related: readonly { id: string; subject: string | null; content: string }[],
): string {
  return `Candidates:\n${JSON.stringify(drafts, null, 2)}\n\nExisting:\n${JSON.stringify(related, null, 2)}\n\nReturn ONLY the JSON object.`;
}
