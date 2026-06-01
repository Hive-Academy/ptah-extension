export const RESOLVE_SYSTEM_PROMPT = `You are a memory curator. Given new candidate memories and a list of existing
related memories, decide for each candidate whether it refers to the same
subject as one of the existing memories. Respond ONLY with a JSON object:
{
  "memories": [
    { "kind": "fact" | "preference" | "event" | "entity",
      "subject": string | null,
      "content": string,
      "salienceHint": number,
      "request": string | null,
      "investigated": string | null,
      "learned": string | null,
      "completed": string | null,
      "nextSteps": string | null,
      "type": "bugfix" | "feature" | "decision" | "discovery" | "refactor" | "change",
      "concepts": string[],   /* up to 5 short tags */
      "files": string[],
      "mergeTargetId": string | null /* id of the existing memory it refines, or null */
    }
  ]
}
Prefer mergeTargetId when subjects match (case-insensitive). If unsure, set null.
Preserve every structured field from the candidate (type/concepts/files and the
five summary fields) unless the candidate omits them — never invent values.`;

export function buildResolveUserPrompt(
  drafts: readonly {
    kind: string;
    subject: string | null;
    content: string;
    salienceHint: number;
    request?: string;
    investigated?: string;
    learned?: string;
    completed?: string;
    nextSteps?: string;
    type?: string;
    concepts?: readonly string[];
    files?: readonly string[];
  }[],
  related: readonly { id: string; subject: string | null; content: string }[],
): string {
  return `Candidates:\n${JSON.stringify(drafts, null, 2)}\n\nExisting:\n${JSON.stringify(related, null, 2)}\n\nReturn ONLY the JSON object.`;
}
