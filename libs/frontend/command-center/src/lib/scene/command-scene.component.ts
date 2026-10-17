import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import type { CommandTheme, CommandVoiceState } from '../model/command-center.store';
import type { ProjectionResult } from '../model/work-projection';
import { EMPTY_PLATE_RESERVATION, type PlateReservation } from '../components/command-overlay-placement';
import type { Rect, SceneGeometry, StatusGroupKey } from './connector-geometry';
import { CommandConnectorsComponent } from './command-connectors.component';
import { CommandCoreComponent } from './command-core.component';
import { CommandStatusGroupsComponent } from './command-status-groups.component';
import { CommandStreamsComponent } from './command-streams.component';
import { buildSceneGeometry } from './scene-measurement';
import { placeScene } from './scene-placement';

@Component({
  selector: 'ptah-command-scene',
  standalone: true,
  imports: [CommandStreamsComponent, CommandCoreComponent, CommandStatusGroupsComponent, CommandConnectorsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './command-scene.component.css',
  template: `
    <div #stage class="scene-stage" data-scene-stage role="group" aria-label="Command Center scene"
      [attr.data-theme]="theme()">
      <h2 data-scene-heading tabindex="-1" class="scene-heading">Live orchestration</h2>
      <ptah-command-connectors [geometry]="geometry()" />
      <ptah-command-streams style="position: relative; z-index: 1" [placed]="placement().placed" [overflow]="placement().overflow"
        [now]="now()"
        [selectedId]="selectedId()" [activeId]="activeId()" [pinnedId]="pinnedId()"
        [inlineSlotHeight]="plateReservation().anchorKind === 'stream' ? plateReservation().inlineSlotHeight : 0"
        [reducedMotion]="reducedMotion() || visibilityPaused()"
        (activate)="onActivate($event)" (hover)="hoveredNodeId.emit($event)"
        (escape)="escape.emit($event)" (focusWorkList)="focusWorkList.emit($event)"
        (measureRequested)="requestMeasure()" />
      <div class="core-column" style="position: relative; z-index: 1">
        <ptah-command-core [root]="root()" [activeCount]="placement().activeCount"
          [voiceState]="voiceState()" [inputLevel]="inputLevel()" [outputLevel]="outputLevel()"
          [reducedMotion]="reducedMotion()" [visibilityPaused]="visibilityPaused()"
          [activeId]="activeId()" [pinnedId]="pinnedId()"
          (activateRoot)="onActivate($event)" (hoverRoot)="hoveredNodeId.emit($event)"
          (escapeRoot)="escape.emit($event)" />
        @if (plateReservation().anchorKind === 'root' && plateReservation().pinnedId) {
          <div class="root-plate-slot" [style.height.px]="plateReservation().reservedHeight"></div>
        }
      </div>
      <ptah-command-status-groups style="position: relative; z-index: 1" [counts]="placement().counts" />
    </div>
  `,
})
export class CommandSceneComponent {
  public readonly projection = input.required<ProjectionResult>();
  public readonly selectedId = input<string | null>(null);
  public readonly theme = input<CommandTheme>('dark');
  public readonly voiceState = input<CommandVoiceState>('idle');
  public readonly inputLevel = input(0);
  public readonly outputLevel = input(0);
  public readonly reducedMotion = input(false);
  public readonly now = input(Date.now());
  public readonly activeId = input<string | null>(null);
  public readonly pinnedId = input<string | null>(null);
  public readonly plateReservation = input<PlateReservation>(EMPTY_PLATE_RESERVATION);
  public readonly selection = output<string>();
  public readonly hoveredNodeId = output<string | null>();
  public readonly activate = output<string>();
  public readonly escape = output<string>();
  public readonly focusWorkList = output<string>();
  public readonly geometryChange = output<SceneGeometry | null>();
  public readonly placement = computed(() => placeScene(this.projection(), this.selectedId()));
  public readonly root = computed(() => this.projection().nodes.find(node => node.kind === 'root' && node.parentId === null) ?? null);
  public readonly geometry = signal<SceneGeometry | null>(null);
  public readonly visibilityPaused = signal(false);
  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');
  private readonly streams = viewChild.required(CommandStreamsComponent);
  private readonly core = viewChild.required(CommandCoreComponent);
  private readonly statusGroups = viewChild.required(CommandStatusGroupsComponent);
  private readonly destroyRef = inject(DestroyRef);
  private observer: ResizeObserver | null = null;
  private frame = 0;
  private destroyed = false;

  public constructor() {
    afterNextRender(() => {
      if (this.destroyed) return;
      if (typeof ResizeObserver !== 'undefined') {
        this.observer = new ResizeObserver(() => this.requestMeasure());
        this.observer.observe(this.stage().nativeElement);
      }
      document.addEventListener('visibilitychange', this.onVisibilityChange);
      this.onVisibilityChange();
      this.requestMeasure();
    });
    effect(() => { this.placement(); this.plateReservation(); this.requestMeasure(); });
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.observer?.disconnect();
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      if (this.frame) cancelAnimationFrame(this.frame);
      this.geometryChange.emit(null);
    });
  }
  public onActivate(id: string): void { this.selection.emit(id); this.activate.emit(id); }
  public requestMeasure(): void {
    if (this.destroyed || this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; if (!this.destroyed) this.measure(); });
  }
  private readonly onVisibilityChange = (): void => this.visibilityPaused.set(document.hidden);
  private measure(): void {
    const stage = this.stage().nativeElement;
    const { viewport, rows: rowElements } = this.streams().measurementElements();
    const { dial, root } = this.core().measurementElements();
    if (!viewport || !dial) { this.clearGeometry(); return; }
    const rect = (element: Element): Rect => {
      const r = element.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    };
    const rows: Record<string, Rect> = {};
    for (const row of rowElements) {
      const id = row.dataset['streamRowId']; if (id) rows[id] = rect(row);
    }
    const cards = {} as Record<StatusGroupKey, Rect>;
    for (const key of ['inProgress', 'waiting', 'finished', 'other'] as const) {
      const card = Array.from(this.statusGroups().measurementElements()).find(element => element.dataset['statusCard'] === key);
      if (!card) { this.clearGeometry(); return; }
      cards[key] = rect(card);
    }
    const style = getComputedStyle(viewport);
    const geometry = buildSceneGeometry({
      stage: rect(stage), streamViewport: rect(viewport), streamClientWidth: viewport.clientWidth,
      streamPaddingLeft: parseFloat(style.paddingLeft) || 0, streamPaddingRight: parseFloat(style.paddingRight) || 0,
      rows, dial: rect(dial), rootButton: rect(root ?? dial), cards,
    });
    this.geometry.set(geometry);
    this.geometryChange.emit(geometry);
  }
  private clearGeometry(): void {
    if (this.geometry() === null) return;
    this.geometry.set(null);
    this.geometryChange.emit(null);
  }
}
