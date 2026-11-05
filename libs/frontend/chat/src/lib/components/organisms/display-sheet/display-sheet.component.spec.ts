import type { DisplayFileItem } from '@ptah-extension/chat-ui';
import axe from 'axe-core';
import { Component, input, output, signal } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DisplayPanelComponent, type DisplayPanelViewStateChange } from '@ptah-extension/chat-ui/display-panel';
import type { DisplaySurface } from '@ptah-extension/chat-ui/display-panel';
import type { SurfaceViewState } from '@ptah-extension/declarative-dashboard';
import { DisplayDockState } from '../../../services/display-dock/display-dock.state';
import { DisplaySheetComponent } from './display-sheet.component';
import { ArtifactStore, panelArtifactsFrom } from '../../../services/artifact.store';

const artifact = { id: 'artifact_123456789', title: 'Preview', revision: 1, sessionId: 'tab-1', viewerUrl: 'ptah-artifact://artifact_123456789/index.html', createdAt: '2026-10-20T00:00:00.000Z' };
const records = signal<Readonly<Record<string, readonly typeof artifact[]>>>({});
const lastError = signal<string | null>(null);
const openLink = jest.fn().mockResolvedValue({ success: true, data: { opened: true } });
const artifactStoreStub = {
  records,
  lastError,
  panelArtifacts: (tabId: string | null, selectedArtifactId: string | null) =>
    panelArtifactsFrom(records() as never, tabId, selectedArtifactId),
};
const tabButton = (fixture: ComponentFixture<DisplaySheetComponent>): HTMLButtonElement | null =>
  (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="display-sheet-tab"] button');
const title = (fixture: ComponentFixture<DisplaySheetComponent>): string =>
  (fixture.nativeElement as HTMLElement).querySelector('[data-testid="display-sheet-title"]')?.textContent?.trim() ?? '';

@Component({ selector: 'ptah-display-panel', standalone: true, template: '' })
class StubPanel {
  readonly surfaces = input<readonly DisplaySurface[]>([]);
  readonly files = input<readonly DisplayFileItem[]>([]);
  readonly artifacts = input<readonly typeof artifact[]>([]);
  readonly open = input(true);
  readonly fullscreenArtifactId = input<string | null>(null);
  readonly fullscreenChange = output<boolean>();
  readonly selectedKey = input<string | null>(null);
  readonly scrollToSelectedOnMount = input(false);
  readonly pinned = input(false);
  readonly viewStates = input<unknown>(null);
  readonly selectedKeyChange = output<string>();
  readonly viewStateChange = output<DisplayPanelViewStateChange>();
  readonly openExternal = output<string>();
}

const surface: DisplaySurface = {
  key: 'id:a', displayId: 'a', content: {} as DisplaySurface['content'], title: 'A',
  description: null, turnKey: 'turn-1', fenceKey: 'fence-a', createdSeq: 1,
  updatedSeq: 1, componentSignatures: new Map(), retainedViewStateIds: new Set(),
};
const panel = (fixture: ComponentFixture<DisplaySheetComponent>): StubPanel =>
  fixture.debugElement.query(By.directive(StubPanel)).componentInstance as StubPanel;
const mountedPanel = async (fixture: ComponentFixture<DisplaySheetComponent>): Promise<StubPanel> => {
  await fixture.whenStable();
  fixture.detectChanges();
  return panel(fixture);
};

describe('DisplaySheetComponent', () => {
  beforeEach(() => {
    records.set({});
    lastError.set(null);
    openLink.mockClear();
    TestBed.configureTestingModule({
      imports: [DisplaySheetComponent],
      providers: [DisplayDockState,
        { provide: ArtifactStore, useValue: artifactStoreStub },
        { provide: ClaudeRpcService, useValue: { call: openLink } }],
    });
    TestBed.overrideComponent(DisplaySheetComponent, {
      remove: { imports: [DisplayPanelComponent] }, add: { imports: [StubPanel] },
    });
  });

  it('passes session artifacts to the panel, selects their key, and relays external links through RPC', async () => {
    records.set({ 'tab-1': [artifact] });
    const fixture = TestBed.createComponent(DisplaySheetComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    const dock = TestBed.inject(DisplayDockState);
    dock.openArtifact('tab-1', artifact.id);
    fixture.detectChanges();
    const display = await mountedPanel(fixture);
    expect((fixture.nativeElement as HTMLElement).querySelector('.sheet-shell')?.getAttribute('data-glass-surface')).toBe('chrome');
    expect(display.artifacts()).toEqual([artifact]);
    expect(display.selectedKey()).toBe(`artifact:${artifact.id}`);
    expect(title(fixture)).toBe('Display · 1');
    display.openExternal.emit('https://example.com');
    expect(openLink).toHaveBeenCalledWith('artifacts:openLink', { url: 'https://example.com' });
    display.selectedKeyChange.emit('artifact:other');
    expect(dock.tab('tab-1').selection).toEqual({ kind: 'artifact', artifactId: 'other' });
    fixture.destroy();
  });

  it('unmounts the panel on collapse and drives the single viewer full screen request', async () => {
    const fixture = TestBed.createComponent(DisplaySheetComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    const dock = TestBed.inject(DisplayDockState);
    dock.openArtifact('tab-1', artifact.id);
    dock.requestFullscreenArtifact('tab-1', artifact.id);
    fixture.detectChanges();
    const child = await mountedPanel(fixture);
    expect(child.fullscreenArtifactId()).toBe(artifact.id);
    child.fullscreenChange.emit(false);
    expect(dock.fullscreenArtifact('tab-1')).toBeNull();
    dock.close('tab-1');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('ptah-display-panel')).toBeNull();
    fixture.destroy();
  });

  it('alerts when an external link is not opened and displays list failure', async () => {
    openLink.mockResolvedValueOnce({ success: false });
    const fixture = TestBed.createComponent(DisplaySheetComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    TestBed.inject(DisplayDockState).open('tab-1');
    fixture.detectChanges();
    const child = await mountedPanel(fixture);
    child.openExternal.emit('https://example.com');
    await Promise.resolve();
    lastError.set('Unable to load artifacts.');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Could not open the link.');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Unable to load artifacts.');
    fixture.destroy();
  });

  it('keeps the sheet open when Escape starts inside a dialog', () => {
    const fixture = TestBed.createComponent(DisplaySheetComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    const dock = TestBed.inject(DisplayDockState);
    dock.open('tab-1');
    fixture.detectChanges();
    const region = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-testid="display-sheet-region"]')!;
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    region.append(dialog);
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(dock.tab('tab-1').open).toBe(true);
    fixture.destroy();
  });

  it('takes no space when the tab has no display content and is closed', () => {
    const fixture = TestBed.createComponent(DisplaySheetComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.style.display).toBe('none');
    expect(tabButton(fixture)?.getClientRects()).toHaveLength(0);
    fixture.destroy();
  });

  it('shows the bar when the tab has one surface', () => {
    const fixture = TestBed.createComponent(DisplaySheetComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    TestBed.inject(DisplayDockState).setSurfaces('tab-1', { surfaces: [surface], statuses: new Map() });
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.style.display).not.toBe('none');
    expect(tabButton(fixture)?.getAttribute('aria-label')).toBe('Toggle Display · 1 panel');
    expect(tabButton(fixture)?.getAttribute('aria-expanded')).toBe('false');
    fixture.destroy();
  });

  it('includes the new-item count in the bar name only when it is above zero', () => {
    const fixture = TestBed.createComponent(DisplaySheetComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    const dock = TestBed.inject(DisplayDockState);
    dock.setLiveTurn('tab-1', 'turn-1');
    dock.setSurfaces('tab-1', { surfaces: [surface], statuses: new Map() });
    fixture.detectChanges();
    expect(dock.tab('tab-1').newCount).toBe(0);
    expect(tabButton(fixture)?.getAttribute('aria-label')).toBe('Toggle Display · 1 panel');
    expect(tabButton(fixture)?.querySelector('[data-testid="sidebar-tab-new"]')).toBeNull();

    dock.open('tab-1');
    dock.close('tab-1');
    dock.requestAutoOpen('tab-1', 'turn-1', 'id:a');
    dock.requestAutoOpen('tab-1', 'turn-1', 'id:b');
    fixture.detectChanges();
    expect(dock.tab('tab-1').newCount).toBe(2);
    expect(tabButton(fixture)?.getAttribute('aria-label')).toBe('Toggle Display · 1 panel, 2 new');
    fixture.destroy();
  });

  it('shows the open sidebar when explicitly opened without content', () => {
    const fixture = TestBed.createComponent(DisplaySheetComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    TestBed.inject(DisplayDockState).open('tab-1');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.style.display).not.toBe('none');
    expect(tabButton(fixture)).toBeNull();
    const collapse = host.querySelector('[data-testid="display-sheet-close"]');
    expect(collapse?.getAttribute('aria-expanded')).toBe('true');
    expect(collapse?.getAttribute('aria-controls')).toBe(host.querySelector('[data-testid="display-sheet-region"]')?.id);
    fixture.destroy();
  });

  it('opens from the sidebar tab, pins, and collapses with Escape back onto the tab', async () => {
    const fixture = TestBed.createComponent(DisplaySheetComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    TestBed.inject(DisplayDockState).setSurfaces('tab-1', { surfaces: [surface], statuses: new Map() });
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[data-testid="display-sheet-region"]')).toBeNull();
    tabButton(fixture)!.click();
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="display-sheet-region"]')).not.toBeNull();
    expect(host.classList.contains('sheet-open')).toBe(true);
    expect(host.querySelector('[data-testid="display-sheet-height"]')).toBeNull();
    const pin = host.querySelector<HTMLButtonElement>('[data-testid="display-sheet-pin"]')!;
    expect(pin.textContent?.trim()).toBe('Keep current view');
    expect(pin.getAttribute('aria-label')).toBe('Keep current view');
    expect(pin.getAttribute('title')).toBe('New or updated displays will not switch items or scroll this panel.');
    expect(pin.getAttribute('aria-description')).toBe('New or updated displays will not switch items or scroll this panel.');
    pin.click();
    fixture.detectChanges();
    expect(pin.getAttribute('aria-pressed')).toBe('true');
    host.querySelector('[data-testid="display-sheet-region"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    TestBed.tick();
    expect(host.querySelector('[data-testid="display-sheet-region"]')).toBeNull();
    expect(tabButton(fixture)?.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(tabButton(fixture));
    fixture.destroy();
  });

  it('offers Detach only when detachable, emits the request and shows a detach error', () => {
    const fixture = TestBed.createComponent(DisplaySheetComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    TestBed.inject(DisplayDockState).open('tab-1');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[data-testid="display-sheet-detach"]')).toBeNull();
    const requested = jest.fn();
    fixture.componentInstance.detachRequested.subscribe(requested);
    fixture.componentRef.setInput('detachable', true);
    fixture.componentRef.setInput('detachError', 'Could not open the Display window.');
    fixture.detectChanges();
    host.querySelector<HTMLButtonElement>('[data-testid="display-sheet-detach"]')!.click();
    expect(requested).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not open the Display window.');
    fixture.destroy();
  });

  it('marks the region as an overlay drawer for a narrow host', () => {
    const fixture = TestBed.createComponent(DisplaySheetComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    fixture.componentRef.setInput('overlay', true);
    TestBed.inject(DisplayDockState).open('tab-1');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.classList.contains('sheet-overlay')).toBe(true);
    expect(host.querySelector('[role="region"].overlay')).not.toBeNull();
    expect(host.querySelector('.sheet-shell')?.getAttribute('data-glass-surface')).toBe('overlay');
    fixture.destroy();
  });

  it('lists a selected artifact from another session bucket', async () => {
    const other = { ...artifact, id: 'artifact_other0001', sessionId: 'tab-9' };
    records.set({ 'tab-9': [other] });
    const fixture = TestBed.createComponent(DisplaySheetComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    TestBed.inject(DisplayDockState).openArtifact('tab-1', other.id);
    fixture.detectChanges();
    const display = await mountedPanel(fixture);
    expect(display.artifacts()).toEqual([other]);
    fixture.destroy();
  });

  it('auto-opens after a publication and respects close suppression', () => {
    const fixture = TestBed.createComponent(DisplaySheetComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    const dock = TestBed.inject(DisplayDockState);
    dock.setLiveTurn('tab-1', 'turn-1');
    dock.requestAutoOpen('tab-1', 'turn-1', 'id:a');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="display-sheet-region"]')).not.toBeNull();
    dock.close('tab-1');
    dock.requestAutoOpen('tab-1', 'turn-1', 'id:b');
    fixture.detectChanges();
    expect(dock.tab('tab-1').open).toBe(false);
    expect(dock.tab('tab-1').newCount).toBe(1);
    fixture.destroy();
  });

  it('keeps the same panel mounted while collapsed and preserves its inputs on reopen', async () => {
    const fixture = TestBed.createComponent(DisplaySheetComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    const dock = TestBed.inject(DisplayDockState);
    dock.setSurfaces('tab-1', { surfaces: [surface], statuses: new Map() });
    dock.openSurface('tab-1', 'id:a');
    fixture.detectChanges();
    const first = await mountedPanel(fixture);
    expect(first.surfaces()).toEqual([surface]);
    expect(first.selectedKey()).toBe('id:a');
    expect(first.scrollToSelectedOnMount()).toBe(true);
    dock.setPinned('tab-1', true);
    const viewState: SurfaceViewState = { components: {}, drafts: {} };
    first.viewStateChange.emit({ surfaceKey: 'id:a', viewState });
    fixture.detectChanges();
    expect(first.pinned()).toBe(true);
    expect(first.viewStates()).toBe(dock.tab('tab-1').viewStates);
    expect(dock.tab('tab-1').viewStates.get('id:a')).toBe(viewState);
    dock.close('tab-1');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="display-sheet-region"]')).toBeNull();
    dock.open('tab-1');
    fixture.detectChanges();
    const reopened = await mountedPanel(fixture);
    expect(reopened).not.toBe(first);
    expect(reopened.viewStates()).toBe(dock.tab('tab-1').viewStates);
    fixture.destroy();
  });

  it('does not pulse for existing content on first visit to a tab', () => {
    const dock = TestBed.inject(DisplayDockState);
    dock.setLiveTurn('tab-2', 'turn-2');
    dock.requestAutoOpen('tab-2', 'turn-2', 'id:a');
    const fixture = TestBed.createComponent(DisplaySheetComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    fixture.detectChanges();
    fixture.componentRef.setInput('tabId', 'tab-2');
    dock.open('tab-2');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.sheet-pulse')).toBeNull();
    dock.setLiveTurn('tab-1', 'turn-1');
    dock.requestAutoOpen('tab-1', 'turn-1', 'id:later');
    fixture.componentRef.setInput('tabId', 'tab-1');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.sheet-pulse')).toBeNull();
    fixture.destroy();
  });

  it('pulses when a new surface arrives in the visible tab', async () => {
    const fixture = TestBed.createComponent(DisplaySheetComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    fixture.detectChanges();
    const dock = TestBed.inject(DisplayDockState);
    dock.setLiveTurn('tab-1', 'turn-1');
    dock.requestAutoOpen('tab-1', 'turn-1', 'id:a');
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.sheet-pulse')).not.toBeNull();
    fixture.destroy();
  });

  it('restores each tab’s count, selection and pin when returning', async () => {
    const fixture = TestBed.createComponent(DisplaySheetComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    const dock = TestBed.inject(DisplayDockState);
    dock.setSurfaces('tab-1', { surfaces: [surface], statuses: new Map() });
    dock.openSurface('tab-1', 'id:a');
    dock.setPinned('tab-1', true);
    fixture.detectChanges();
    fixture.componentRef.setInput('tabId', 'tab-2');
    fixture.detectChanges();
    expect(tabButton(fixture)?.getAttribute('aria-label')).toBe('Toggle Display · 0 panel');
    fixture.componentRef.setInput('tabId', 'tab-1');
    fixture.detectChanges();
    expect(title(fixture)).toBe('Display · 1');
    await mountedPanel(fixture);
    expect(panel(fixture).selectedKey()).toBe('id:a');
    expect(panel(fixture).pinned()).toBe(true);
    fixture.destroy();
  });

  it('leaves an inner Escape handler in control', () => {
    const fixture = TestBed.createComponent(DisplaySheetComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    const dock = TestBed.inject(DisplayDockState);
    dock.open('tab-1');
    fixture.detectChanges();
    const region = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-testid="display-sheet-region"]')!;
    const inner = document.createElement('button');
    region.append(inner);
    inner.addEventListener('keydown', (event) => event.preventDefault());
    inner.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(dock.tab('tab-1').open).toBe(true);
    fixture.destroy();
  });

  it('has an accessible header and open region', async () => {
    const fixture = TestBed.createComponent(DisplaySheetComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    TestBed.inject(DisplayDockState).open('tab-1');
    fixture.detectChanges();
    const results = await axe.run(fixture.nativeElement as Parameters<typeof axe.run>[0], {
      rules: { 'color-contrast': { enabled: false }, 'target-size': { enabled: false } },
    });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
    fixture.destroy();
  });
});
