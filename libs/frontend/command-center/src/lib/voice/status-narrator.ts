import type { CommandWorkNode } from '../model/command-center.store';
import { toSpokenText } from './spoken-text';

interface PendingNarration {
  readonly key: string;
  readonly workId: string;
  readonly state: string;
  readonly text: string;
}

/** Pure, owned-work narration buffer. Call drain only after the chat turn settles. */
export class StatusNarrator {
  private readonly previous = new Map<string, CommandWorkNode>();
  private readonly delivered = new Set<string>();
  private pending: PendingNarration[] = [];
  private root: string | null = null;
  private baselined = false;

  public observe(root: string, nodes: readonly CommandWorkNode[]): void {
    if (this.root !== root) {
      this.root = root;
      this.previous.clear();
      this.delivered.clear();
      this.pending = [];
      this.baselined = false;
    }
    const remaining = new Map(nodes.map((node) => [node.id, node]));
    const owned = new Map<string, CommandWorkNode>();
    const rootNode = remaining.get(root);
    if (rootNode) owned.set(root, rootNode);
    let grew = true;
    while (grew) {
      grew = false;
      for (const node of remaining.values()) {
        if (node.parentId && owned.has(node.parentId) && !owned.has(node.id)) {
          owned.set(node.id, node);
          grew = true;
        }
      }
    }
    if (!this.baselined) {
      if (!rootNode) return;
      for (const [id, node] of owned) this.previous.set(id, node);
      this.baselined = true;
      return;
    }
    this.pending = this.pending.filter(
      (item) => owned.get(item.workId)?.state === item.state,
    );
    for (const node of owned.values()) {
      const prior = this.previous.get(node.id);
      if (prior?.state === node.state || node.id === root) continue;
      const meaningful = this.meaningful(node);
      if (!meaningful) continue;
      const action =
        node.state === 'starting' || node.state === 'running'
          ? 'started'
          : node.state;
      const key = `${root}\u0000${node.id}\u0000${action}`;
      if (
        this.delivered.has(key) ||
        this.pending.some((item) => item.key === key)
      )
        continue;
      this.pending.push({
        key,
        workId: node.id,
        state: node.state,
        text: toSpokenText(`${node.label} ${action}.`, 'status'),
      });
    }
    this.previous.clear();
    for (const [id, node] of owned) this.previous.set(id, node);
  }

  private meaningful(node: CommandWorkNode): boolean {
    switch (node.kind) {
      case 'child':
      case 'agent':
        return ['starting', 'running', 'completed', 'failed'].includes(
          node.state,
        );
      case 'root':
        return false;
      default: {
        const exhaustive: never = node.kind;
        return exhaustive;
      }
    }
  }

  public drain(): string[] {
    const result = this.pending.map((item) => {
      this.delivered.add(item.key);
      return item.text;
    });
    this.pending = [];
    return result;
  }

  public clear(): void {
    this.pending = [];
    this.previous.clear();
    this.delivered.clear();
    this.root = null;
    this.baselined = false;
  }
}
