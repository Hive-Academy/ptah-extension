/**
 * MainAgentScopeBadgesComponent (TASK_2026_555 Batch 52.6): one badge per overridden scope layer, as in the prototype
 * ("App override", "Workspace override"), the App layer named after the host (Batch 27b). Each badge opens a dialog
 * listing that layer's fields as D16 field badges with their own clear actions.
 */
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { VSCodeService } from '@ptah-extension/core';
import type { ScopedSettingEntry, SettingScope } from '@ptah-extension/shared';
import { MainAgentScopeBadgesComponent, type MainAgentScopeClear, type MainAgentScopeField } from './main-agent-scope-badges.component';

const entry = (key: string, scope: SettingScope, hasOverride: boolean): ScopedSettingEntry => ({
  key, effectiveKey: key, scope, hasOverride, supportedTargets: ['global', 'app', 'workspace'],
  fallbackPreview: hasOverride ? { scope: 'global', value: 'medium' } : null, credentialSource: 'not-a-secret',
});
const field = (key: string, fieldName: string, shortFieldName: string, scope: SettingScope, hasOverride = true): MainAgentScopeField => ({
  key, fieldName, shortFieldName, entry: entry(key, scope, hasOverride), supportedTargets: ['global', 'app', 'workspace'],
  fallbackValueLabel: null, disabled: false,
});
const LIVE: readonly MainAgentScopeField[] = [
  field('provider.x.selectedModel', 'Main agent model', 'Model', 'global', false),
  field('provider.x.reasoningEffort', 'Reasoning effort', 'Effort', 'app'),
  field('authMethod', 'Main agent authentication', 'Authentication', 'workspace'),
  field('anthropicProviderId', 'Main agent provider', 'Provider', 'workspace'),
];

@Component({
  standalone: true,
  imports: [MainAgentScopeBadgesComponent],
  template: `<div class="flex flex-wrap"><ptah-main-agent-scope-badges [fields]="fields()" workspaceName="ws" (clearRequested)="cleared.push($event)" /></div>`,
})
class Host {
  readonly fields = signal<readonly MainAgentScopeField[]>(LIVE);
  readonly cleared: MainAgentScopeClear[] = [];
}

describe('MainAgentScopeBadgesComponent', () => {
  let fixture: ComponentFixture<Host>;
  const el = () => fixture.nativeElement as HTMLElement;
  const layers = () => Array.from(el().querySelectorAll<HTMLButtonElement>('[data-testid="main-scope-layer"]'));

  function create(isElectron: boolean): void {
    TestBed.configureTestingModule({ imports: [Host], providers: [{ provide: VSCodeService, useValue: { isElectron } }] });
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  }

  it('shows one badge per overridden layer, App first, named after the host (VS Code); inherited fields count for none', () => {
    create(false);
    expect(layers().map((badge) => badge.textContent?.trim())).toEqual(['VS Code override', 'Workspace override']);
    expect(layers().map((badge) => badge.getAttribute('data-layer'))).toEqual(['app', 'workspace']);
    expect(layers()[1].getAttribute('aria-label')).toBe('Workspace override: Main agent authentication, Main agent provider');
    expect(layers()[1].getAttribute('aria-haspopup')).toBe('dialog');
    // Never truncated: no truncate class, one line.
    expect(layers()[1].className).toContain('whitespace-nowrap');
    expect(layers()[1].className).not.toContain('truncate');
    expect(el().querySelector('[data-testid="scope-badge"]')).toBeNull();
  });

  it('names the App layer "Desktop app override" in Electron', () => {
    create(true);
    expect(layers()[0].textContent?.trim()).toBe('Desktop app override');
  });

  it('a layer badge opens a dialog listing that layer\'s field badges (D16), each with its own clear actions', () => {
    create(false);
    layers()[1].click();
    fixture.detectChanges();
    expect(layers()[1].getAttribute('aria-expanded')).toBe('true');
    const popover = el().querySelector('[data-testid="main-scope-layer-popover"]');
    expect(popover?.getAttribute('role')).toBe('dialog');
    const fieldBadges = Array.from(popover?.querySelectorAll<HTMLButtonElement>('[data-testid="scope-badge"]') ?? []);
    expect(fieldBadges.map((badge) => badge.getAttribute('data-field'))).toEqual(['Main agent authentication', 'Main agent provider']);
    expect(fieldBadges[0].textContent).toContain('Authentication · Workspace');
    fieldBadges[1].click();
    fixture.detectChanges();
    el().querySelector<HTMLButtonElement>('[data-testid="scope-clear-override"]')?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.cleared).toEqual([{ key: 'anthropicProviderId', target: 'nearest' }]);
    expect(el().querySelector('[data-testid="main-scope-layer-popover"]')).toBeNull();
  });

  it('one layer: one badge; nothing overridden: nothing', () => {
    create(false);
    fixture.componentInstance.fields.set(LIVE.slice(0, 2));
    fixture.detectChanges();
    expect(layers().map((badge) => badge.textContent?.trim())).toEqual(['VS Code override']);
    fixture.componentInstance.fields.set(LIVE.slice(0, 1));
    fixture.detectChanges();
    expect(layers()).toHaveLength(0);
  });
});
