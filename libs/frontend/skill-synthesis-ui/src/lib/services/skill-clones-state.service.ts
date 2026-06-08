import { Injectable, computed, inject, signal } from '@angular/core';
import type {
  CloneSummary,
  SkillCloneHistoryEntry,
  SkillCloneKind,
} from '@ptah-extension/shared';

import { SkillSynthesisRpcService } from './skill-synthesis-rpc.service';

export interface SkillCloneDetail {
  readonly clone: CloneSummary | null;
  readonly body: string | null;
  readonly history: SkillCloneHistoryEntry[];
}

@Injectable({
  providedIn: 'root',
})
export class SkillClonesStateService {
  private readonly rpc = inject(SkillSynthesisRpcService);

  public readonly clones = signal<CloneSummary[]>([]);
  public readonly loading = signal<boolean>(false);
  public readonly error = signal<string | null>(null);

  public readonly selectedSlug = signal<string | null>(null);
  public readonly selectedKind = signal<SkillCloneKind | null>(null);
  public readonly detail = signal<SkillCloneDetail | null>(null);
  public readonly detailLoading = signal<boolean>(false);

  public readonly divergedCount = computed(
    () => this.clones().filter((c) => c.diverged).length,
  );

  public async refreshClones(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const list = await this.rpc.listClones();
      this.clones.set(list);
    } catch (err) {
      this.error.set(this.toMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  public async loadDetail(slug: string, kind: SkillCloneKind): Promise<void> {
    this.selectedSlug.set(slug);
    this.selectedKind.set(kind);
    this.detailLoading.set(true);
    this.error.set(null);
    try {
      const detail = await this.rpc.getClone(slug, kind);
      this.detail.set(detail);
    } catch (err) {
      this.error.set(this.toMessage(err));
      this.detail.set(null);
    } finally {
      this.detailLoading.set(false);
    }
  }

  public clearDetail(): void {
    this.selectedSlug.set(null);
    this.selectedKind.set(null);
    this.detail.set(null);
  }

  private toMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
