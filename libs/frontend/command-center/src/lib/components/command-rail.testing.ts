import { Component, input, output, signal } from '@angular/core';
import { ArtifactStore, type DisplayDockState } from '@ptah-extension/chat';
import type { ArtifactRecord } from '@ptah-extension/shared';
import type { CommandLiveTarget } from './command-live-panel.component';
import { CommandLivePanelComponent } from './command-live-panel.component';
import { CommandRailDisplayComponent } from './command-rail-display.component';

/** Stands in for the Live tab so page tests do not boot a full chat view. */
@Component({
  selector: 'ptah-command-live-panel',
  standalone: true,
  template: '<p data-testid="live-target">{{ target().tabId }}</p>',
})
export class LivePanelStubComponent {
  public readonly target = input.required<CommandLiveTarget>();
  public readonly visible = input(true);
  public readonly focused = input(true);
  public readonly hasSession = input(false);
  public readonly reducedMotion = input(false);
  public readonly displayDock = input<DisplayDockState | null>(null);
  public readonly openLane = output<string>();
  public readonly openSession = output<void>();
}

/** Stands in for the Display tab so page tests do not load the lazy panel. */
@Component({
  selector: 'ptah-command-rail-display',
  standalone: true,
  template: '<p data-testid="display-target">{{ tabId() }}</p>',
})
export class RailDisplayStubComponent {
  public readonly tabId = input<string | null>(null);
  public readonly dock = input<DisplayDockState | null>(null);
}

export function artifactStoreStub(
  records: Record<string, readonly ArtifactRecord[]> = {},
): Pick<ArtifactStore, 'records' | 'lastError'> {
  return {
    records: signal<Readonly<Record<string, readonly ArtifactRecord[]>>>(
      records,
    ),
    lastError: signal<string | null>(null),
  };
}

/** `TestBed.overrideComponent` pieces that swap the rail's heavy children for stubs. */
export const RAIL_STUB_OVERRIDE = {
  remove: [CommandLivePanelComponent, CommandRailDisplayComponent],
  add: [LivePanelStubComponent, RailDisplayStubComponent],
} as const;

export function railStubProviders(
  records: Record<string, readonly ArtifactRecord[]> = {},
) {
  return [{ provide: ArtifactStore, useValue: artifactStoreStub(records) }];
}
