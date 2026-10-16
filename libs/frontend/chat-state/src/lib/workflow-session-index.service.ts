import { Injectable, signal } from '@angular/core';
import {
  isWorkflowKind,
  type TabState,
  type WorkflowKind,
} from '@ptah-extension/chat-types';

const STORAGE_KEY = 'ptah.workflow-sessions.v1';
const MAX_ENTRIES = 500;
const MAX_PATH_LENGTH = 4096;
const MAX_SESSION_LENGTH = 200;

interface WorkflowSessionEntry {
  workspacePath: string;
  sessionId: string;
  kind: WorkflowKind;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidKey(workspacePath: unknown, sessionId: unknown): boolean {
  return (
    typeof workspacePath === 'string' &&
    workspacePath.length > 0 &&
    workspacePath.length <= MAX_PATH_LENGTH &&
    typeof sessionId === 'string' &&
    sessionId.length > 0 &&
    sessionId.length <= MAX_SESSION_LENGTH
  );
}

function parseEntry(value: unknown): WorkflowSessionEntry | null {
  if (!isRecord(value)) return null;
  const { workspacePath, sessionId, kind } = value;
  if (!isValidKey(workspacePath, sessionId) || !isWorkflowKind(kind)) {
    return null;
  }
  return {
    workspacePath: workspacePath as string,
    sessionId: sessionId as string,
    kind,
  };
}

/** Small, workspace-partitioned history badge index. No transcript data is stored. */
@Injectable({ providedIn: 'root' })
export class WorkflowSessionIndexService {
  private readonly entries = new Map<string, WorkflowSessionEntry>();
  private readonly _warning = signal<string | null>(null);
  readonly warning = this._warning.asReadonly();

  constructor() {
    this.restore();
  }

  get(sessionId: string, workspacePath: string): WorkflowKind | null {
    if (!isValidKey(workspacePath, sessionId)) return null;
    return this.entries.get(this.key(workspacePath, sessionId))?.kind ?? null;
  }

  rememberTab(
    tab: Pick<TabState, 'claudeSessionId' | 'workflow'>,
    workspacePath: string | null,
  ): void {
    if (
      !workspacePath ||
      !tab.claudeSessionId ||
      !isWorkflowKind(tab.workflow)
    ) {
      return;
    }
    this.set(String(tab.claudeSessionId), workspacePath, tab.workflow);
  }

  forget(sessionId: string, workspacePath: string): void {
    if (!isValidKey(workspacePath, sessionId)) return;
    if (this.entries.delete(this.key(workspacePath, sessionId))) this.persist();
  }

  private set(
    sessionId: string,
    workspacePath: string,
    kind: WorkflowKind,
  ): void {
    if (!isValidKey(workspacePath, sessionId)) return;
    const key = this.key(workspacePath, sessionId);
    if (this.entries.get(key)?.kind === kind) return;
    this.entries.delete(key);
    this.entries.set(key, { workspacePath, sessionId, kind });
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.persist();
  }

  private key(workspacePath: string, sessionId: string): string {
    return JSON.stringify([workspacePath, sessionId]);
  }

  private restore(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return;
      const parsed: unknown = JSON.parse(stored);
      if (
        !isRecord(parsed) ||
        parsed['version'] !== 1 ||
        !Array.isArray(parsed['entries'])
      ) {
        return;
      }
      for (const raw of parsed['entries'].slice(-MAX_ENTRIES)) {
        const entry = parseEntry(raw);
        if (entry)
          this.entries.set(
            this.key(entry.workspacePath, entry.sessionId),
            entry,
          );
      }
    } catch {
      this.warn();
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: 1, entries: [...this.entries.values()] }),
      );
      this._warning.set(null);
    } catch {
      this.warn();
    }
  }

  private warn(): void {
    const message =
      'Workflow history badges could not be saved in this webview.';
    this._warning.set(message);
    console.warn(`[WorkflowSessionIndex] ${message}`);
  }
}
