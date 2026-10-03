import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  AppStateManager, ProvidersSettingsStateService, type ProvidersSettingsCommit, type ProvidersSettingsSection,
} from '@ptah-extension/core';
import { OrchestrationSettingsComponent } from './orchestration-settings.component';
import { AgentOrchestrationConfigComponent } from './agent-orchestration-config.component';
import { CliOrchestrationMatrixComponent } from './cli-orchestration-matrix.component';
import { ProviderConsumerAssignmentsComponent } from '../providers/provider-consumer-assignments.component';
import type { BackgroundConsumerId } from '../providers/provider-consumer-rows';

@Component({ selector: 'ptah-agent-orchestration-config', standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush, template: '<p>Orchestration policy</p>' })
class OrchestrationPolicyStub {}

@Component({ selector: 'ptah-provider-consumer-assignments', standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush, template: '<p>Background roles</p>' })
class ConsumerStub {
  readonly disabled = input(false);
  readonly initialEditingConsumerId = input<BackgroundConsumerId | null>(null);
  readonly setupProviderRequested = output<string>();
  readonly deepLinkOpened = output<BackgroundConsumerId>();
  readonly assignmentSaved = output<{ id: BackgroundConsumerId; provider: string; model: string }>();
  readonly timeoutSaved = output<number>();
}

/** The deferred matrix: only its focus target, the table the `cli-agents` deep link lands on (Batch 34). */
@Component({ selector: 'ptah-cli-orchestration-matrix', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<table data-testid="cli-matrix" tabindex="-1" aria-label="CLI matrix"><tbody><tr><td>Codex</td></tr></tbody></table>' })
class CliMatrixStub {}

const ready = <T,>(data: T): ProvidersSettingsSection<T> => ({ status: 'ready', data, error: null });
const idle: ProvidersSettingsCommit = { status: 'idle', saved: [], unsaved: [], unconfirmed: [], refreshFailed: false, message: null };

/** The container's own reads (its children are stubs). */
class StateStub {
  readonly commit = signal<ProvidersSettingsCommit>(idle);
  readonly cliAgents = signal<ProvidersSettingsSection<unknown[]>>(ready([]));
  readonly cliModels = signal<ProvidersSettingsSection<Record<string, unknown>>>(ready({}));
  readonly orchestration = signal<ProvidersSettingsSection<Record<string, string>>>(ready({}));
  readonly open = jest.fn(async () => undefined);
  readonly refresh = jest.fn(async () => undefined);
  readonly refreshJudging = jest.fn(async () => undefined);
  readonly refreshCliAgents = jest.fn(async () => undefined);
  readonly refreshCliModels = jest.fn(async () => undefined);
  readonly refreshOrchestration = jest.fn(async () => undefined);
}

function button(element: HTMLElement, label: string): HTMLButtonElement {
  const result = Array.from(element.querySelectorAll('button')).find((node) => node.textContent?.trim() === label);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}

describe('OrchestrationSettingsComponent', () => {
  let fixture: ComponentFixture<OrchestrationSettingsComponent>;
  let element: HTMLElement;
  let state: StateStub;
  let appState: { requestSettingsTab: jest.Mock };

  beforeEach(async () => {
    state = new StateStub();
    appState = { requestSettingsTab: jest.fn() };
    await TestBed.configureTestingModule({
      imports: [OrchestrationSettingsComponent],
      providers: [
        { provide: ProvidersSettingsStateService, useValue: state },
        { provide: AppStateManager, useValue: appState },
      ],
    }).overrideComponent(OrchestrationSettingsComponent, {
      remove: { imports: [AgentOrchestrationConfigComponent, ProviderConsumerAssignmentsComponent, CliOrchestrationMatrixComponent] },
      add: { imports: [OrchestrationPolicyStub, ConsumerStub, CliMatrixStub] },
    }).compileComponents();
    fixture = TestBed.createComponent(OrchestrationSettingsComponent);
    element = fixture.nativeElement as HTMLElement;
  });
  afterEach(() => { fixture.destroy(); TestBed.resetTestingModule(); });

  async function render() { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); }
  const consumer = () => fixture.debugElement.query(By.directive(ConsumerStub)).injector.get(ConsumerStub);
  const rolesDetails = () => element.querySelector<HTMLDetailsElement>('[data-testid="background-roles-details"]');
  const matrixTable = () => element.querySelector<HTMLElement>('[data-testid="cli-matrix"]');

  it('opens the shared state once when mounted alone (a user can land here first)', async () => {
    await render();
    await render();
    expect(state.open).toHaveBeenCalledTimes(1);
  });

  // Batch 34: the old Ptah CLI instance manager is gone; the matrix (deferred) holds every instance capability.
  it('mounts the policy bar, the CLI matrix and the background roles, in that order, and no old CLI manager', async () => {
    await render();
    const order = ['ptah-agent-orchestration-config', '[data-testid="cli-matrix"]', '[data-testid="background-roles-details"]']
      .map((selector) => element.querySelector(selector));
    expect(element.querySelector('#providers-cli-heading, [data-focus="cli-agents"]')).toBeNull();
    expect(order.every(Boolean)).toBe(true);
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1]?.compareDocumentPosition(order[i] as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  });

  it('wraps the background roles in a <details> that is closed by default (deviation 4)', async () => {
    await render();
    const details = rolesDetails();
    expect(details?.tagName).toBe('DETAILS');
    expect(details?.open).toBe(false);
    expect(details?.querySelector('ptah-provider-consumer-assignments')).not.toBeNull();
    const summary = details?.querySelector('summary');
    expect(summary?.getAttribute('data-testid')).toBe('background-roles-summary');
    expect(summary?.textContent).toContain('Background Model Roles');
    expect(summary?.textContent).toContain('6 roles');
    // Batch 35 revise R2 (deviation 6): the role list is plain text, never the theme's tinted muted colour.
    const list = Array.from(summary?.querySelectorAll('span') ?? []).find((span) => span.textContent?.includes('archaeologist'));
    expect(list?.className).toContain('text-base-content');
    expect(list?.className).not.toContain('text-base-content-muted');
  });

  // Batch 34 revise 1: › closed, ⌄ open. lucide-angular copies its host class onto the <svg>, so the turn must sit on the
  // wrapper only (a rotate on the icon applied twice and pointed it left). Rendered angles: settings-visual.e2e.spec.ts.
  it('turns the summary chevron on its decorative wrapper, never on the icon', async () => {
    await render();
    const chevron = element.querySelector('[data-testid="background-roles-chevron"]');
    expect(rolesDetails()?.classList.contains('group')).toBe(true);
    expect(chevron?.getAttribute('aria-hidden')).toBe('true');
    expect(chevron?.classList.contains('group-open:rotate-90')).toBe(true);
    expect(chevron?.querySelector('lucide-angular')?.className ?? '').not.toContain('rotate');
  });

  it.each(['memory-curator', 'archaeologist', 'synthesis', 'judge', 'replay', 'judging-enhancement'] as const)(
    'opens the roles for the %s deep link, forwards the role and focuses the background section',
    async (target) => {
      fixture.componentRef.setInput('focusTarget', target); await render();
      expect(rolesDetails()?.open).toBe(true);
      expect(consumer().initialEditingConsumerId()).toBe(target);
      expect(document.activeElement).toBe(element.querySelector('[data-focus="background-models"]'));
    },
  );

  it('opens the roles and focuses the section without preselecting a role for background-models', async () => {
    fixture.componentRef.setInput('focusTarget', 'background-models'); await render();
    expect(rolesDetails()?.open).toBe(true);
    expect(consumer().initialEditingConsumerId()).toBeNull();
    expect(document.activeElement).toBe(element.querySelector('[data-focus="background-models"]'));
  });

  it('focuses the CLI matrix table for cli-agents and leaves the roles closed', async () => {
    fixture.componentRef.setInput('focusTarget', 'cli-agents'); await render();
    expect(matrixTable()).not.toBeNull();
    expect(document.activeElement).toBe(matrixTable());
    expect(rolesDetails()?.open).toBe(false);
  });

  describe('deep-link consumption (Gate V 36, M-1)', () => {
    let consumed: jest.Mock;
    beforeEach(() => {
      consumed = jest.fn();
      fixture.componentInstance.focusTargetConsumed.subscribe(consumed);
    });

    it('consumes a role link only once the roles are focused and the role popover has opened', async () => {
      fixture.componentRef.setInput('focusTarget', 'judge'); await render();
      expect(consumed).not.toHaveBeenCalled();
      consumer().deepLinkOpened.emit('judge');
      expect(consumed).toHaveBeenCalledTimes(1);
    });

    it('consumes when the popover opened first (rows loaded before the section focus ran)', async () => {
      await render();
      fixture.componentRef.setInput('focusTarget', 'replay');
      consumer().deepLinkOpened.emit('replay');
      expect(consumed).not.toHaveBeenCalled();
      await render();
      expect(consumed).toHaveBeenCalledTimes(1);
    });

    it.each(['cli-agents', 'background-models'] as const)('consumes the %s link once its section is focused', async (target) => {
      fixture.componentRef.setInput('focusTarget', target); await render();
      expect(consumed).toHaveBeenCalledTimes(1);
    });

    it('applies the same role again after the target was consumed and cleared: roles re-open and take focus', async () => {
      fixture.componentRef.setInput('focusTarget', 'judge'); await render();
      consumer().deepLinkOpened.emit('judge');
      fixture.componentRef.setInput('focusTarget', null); await render();
      expect(consumer().initialEditingConsumerId()).toBeNull();
      // The user closes the roles and moves on, still on this tab.
      const details = rolesDetails();
      if (details) details.open = false;
      (document.activeElement as HTMLElement | null)?.blur();
      fixture.componentRef.setInput('focusTarget', 'judge'); await render();
      expect(rolesDetails()?.open).toBe(true);
      expect(consumer().initialEditingConsumerId()).toBe('judge');
      expect(document.activeElement).toBe(element.querySelector('[data-focus="background-models"]'));
      consumer().deepLinkOpened.emit('judge');
      expect(consumed).toHaveBeenCalledTimes(2);
    });
  });

  it('V36-2: the roles summary list is 12 px helper text', async () => {
    await render();
    const list = element.querySelector('[data-testid="background-roles-list"]');
    expect(list?.className).toContain('text-xs');
    expect(list?.className).not.toMatch(/text-\[1[01]px\]/);
  });

  it('re-focuses a target requested again after being cleared', async () => {
    fixture.componentRef.setInput('focusTarget', 'cli-agents'); await render();
    (document.activeElement as HTMLElement).blur();
    fixture.componentRef.setInput('focusTarget', null); await render();
    fixture.componentRef.setInput('focusTarget', 'cli-agents'); await render();
    expect(document.activeElement).toBe(matrixTable());
  });

  // Batch 35 (plan :772-774): the existing deep-link path opens the setup wizard on Providers.
  it('routes a role\'s provider setup to Providers with the wizard\'s provider, and refreshes after saves', async () => {
    await render();
    consumer().setupProviderRequested.emit('moonshot');
    consumer().assignmentSaved.emit({ id: 'judge', provider: 'moonshot', model: 'kimi' });
    consumer().timeoutSaved.emit(30);
    expect(appState.requestSettingsTab).toHaveBeenCalledWith({ tab: 'providers', providerId: 'moonshot' });
    expect(state.refresh).toHaveBeenCalledTimes(1);
    expect(state.refreshJudging).toHaveBeenCalledTimes(1);
  });

  it('disables the assignments while a save is in flight', async () => {
    state.commit.set({ ...idle, status: 'saving' }); await render();
    expect(consumer().disabled()).toBe(true);
  });

  it('shows commit feedback naming saved, unsaved and unconfirmed fields', async () => {
    state.commit.set({ ...idle, status: 'unconfirmed', saved: ['CLI instance'], unsaved: ['Tier'], unconfirmed: ['Key'] });
    await render();
    const feedback = element.querySelector('[data-testid="providers-commit-feedback"]');
    expect(feedback?.getAttribute('role')).toBe('status');
    expect(feedback?.textContent).toContain('Saved: CLI instance.');
    expect(feedback?.textContent).toContain('Not saved: Tier.');
    expect(feedback?.textContent).toContain('Save not confirmed: Key.');
  });

  it('retries only the failed CLI read', async () => {
    state.cliModels.set({ status: 'error', data: {}, error: 'Could not load this section. Retry.' });
    await render();
    button(element, 'Retry CLI instance models').click(); await render();
    expect(state.refreshCliModels).toHaveBeenCalledTimes(1);
    expect(state.refreshCliAgents).not.toHaveBeenCalled();
  });
});
