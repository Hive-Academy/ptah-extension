import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from '@angular/core';
import {
  DeferBlockBehavior,
  DeferBlockState,
  TestBed,
  type ComponentFixture,
} from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  AppStateManager,
  ProvidersSettingsStateService,
  type ProvidersSettingsCommit,
  type ProvidersSettingsSection,
} from '@ptah-extension/core';
import { AgentsRoutingSettingsComponent } from './agents-routing-settings.component';
import { CliOrchestrationMatrixComponent } from '../ptah-ai/cli-orchestration-matrix.component';
import { ProviderConsumerAssignmentsComponent } from './provider-consumer-assignments.component';
import type { ProviderConsumerId } from './provider-consumer-rows';

@Component({
  selector: 'ptah-provider-consumer-assignments',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<p>Background roles</p>',
})
class ConsumerStub {
  readonly disabled = input(false);
  readonly initialEditingConsumerId = input<ProviderConsumerId | null>(null);
  readonly setupProviderRequested = output<string>();
  readonly deepLinkOpened = output<ProviderConsumerId>();
  readonly assignmentSaved = output<{
    id: ProviderConsumerId;
    provider: string;
    model: string;
  }>();
  readonly timeoutSaved = output<number>();
}

/** The deferred matrix: only its focus target, the table the `cli-agents` deep link lands on (Batch 34). */
@Component({
  selector: 'ptah-cli-orchestration-matrix',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template:
    '<table data-testid="cli-matrix" tabindex="-1" aria-label="CLI matrix"><tbody><tr><td>Codex</td></tr></tbody></table>',
})
class CliMatrixStub {}

const ready = <T>(data: T): ProvidersSettingsSection<T> => ({
  status: 'ready',
  data,
  error: null,
});
const idle: ProvidersSettingsCommit = {
  status: 'idle',
  saved: [],
  unsaved: [],
  unconfirmed: [],
  refreshFailed: false,
  message: null,
};

/** The component's own reads (its children are stubs). */
class StateStub {
  readonly commit = signal<ProvidersSettingsCommit>(idle);
  readonly cliAgents = signal<ProvidersSettingsSection<unknown[]>>(ready([]));
  readonly cliModels = signal<
    ProvidersSettingsSection<Record<string, unknown>>
  >(ready({}));
  readonly orchestration = signal<
    ProvidersSettingsSection<Record<string, string>>
  >(ready({}));
  readonly open = jest.fn(async () => undefined);
  readonly refresh = jest.fn(async () => undefined);
  readonly refreshEnhancement = jest.fn(async () => undefined);
  readonly refreshCliAgents = jest.fn(async () => undefined);
  readonly refreshCliModels = jest.fn(async () => undefined);
  readonly refreshOrchestration = jest.fn(async () => undefined);
}

function button(element: HTMLElement, label: string): HTMLButtonElement {
  const result = Array.from(element.querySelectorAll('button')).find(
    (node) => node.textContent?.trim() === label,
  );
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}

describe('AgentsRoutingSettingsComponent', () => {
  let fixture: ComponentFixture<AgentsRoutingSettingsComponent>;
  let element: HTMLElement;
  let state: StateStub;
  let appState: { requestSettingsTab: jest.Mock };

  beforeEach(async () => {
    state = new StateStub();
    appState = { requestSettingsTab: jest.fn() };
    await TestBed.configureTestingModule({
      imports: [AgentsRoutingSettingsComponent],
      providers: [
        { provide: ProvidersSettingsStateService, useValue: state },
        { provide: AppStateManager, useValue: appState },
      ],
    })
      .overrideComponent(AgentsRoutingSettingsComponent, {
        remove: {
          imports: [
            ProviderConsumerAssignmentsComponent,
            CliOrchestrationMatrixComponent,
          ],
        },
        add: {
          imports: [ConsumerStub, CliMatrixStub],
        },
      })
      .compileComponents();
    fixture = TestBed.createComponent(AgentsRoutingSettingsComponent);
    element = fixture.nativeElement as HTMLElement;
  });
  afterEach(() => {
    fixture.destroy();
    TestBed.resetTestingModule();
  });

  async function render() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
  const consumer = () =>
    fixture.debugElement
      .query(By.directive(ConsumerStub))
      .injector.get(ConsumerStub);
  const rolesDetails = () =>
    element.querySelector<HTMLDetailsElement>(
      '[data-testid="background-roles-details"]',
    );
  const matrixTable = () =>
    element.querySelector<HTMLElement>('[data-testid="cli-matrix"]');

  it('does not open the shared state (the Providers page beside it does)', async () => {
    await render();
    expect(state.open).not.toHaveBeenCalled();
  });

  // Batch 34: the old Ptah CLI instance manager is gone; the matrix (deferred) holds every instance capability.
  it('mounts the CLI matrix (which holds the policy toolbar) and the background roles, in that order, and no old CLI manager', async () => {
    await render();
    const order = [
      '[data-testid="cli-matrix"]',
      '[data-testid="background-roles-details"]',
    ].map((selector) => element.querySelector(selector));
    expect(element.querySelector('ptah-agent-orchestration-config')).toBeNull();
    expect(
      element.querySelector(
        '#providers-cli-heading, [data-focus="cli-agents"]',
      ),
    ).toBeNull();
    expect(order.every(Boolean)).toBe(true);
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1]?.compareDocumentPosition(order[i] as Node)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }
  });

  it('wraps the background roles in a <details> that is closed by default (deviation 4)', async () => {
    await render();
    const details = rolesDetails();
    expect(details?.tagName).toBe('DETAILS');
    expect(details?.open).toBe(false);
    expect(
      details?.querySelector('ptah-provider-consumer-assignments'),
    ).not.toBeNull();
    const summary = details?.querySelector('summary');
    expect(summary?.getAttribute('data-testid')).toBe(
      'background-roles-summary',
    );
    expect(summary?.textContent).toContain('Background Model Roles');
    expect(summary?.textContent).toContain('3 roles');
    expect(
      summary
        ?.querySelector('[data-testid="background-roles-list"]')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim(),
    ).toBe(
      'Memory curator, enhancement, decision',
    );
    const list = Array.from(summary?.querySelectorAll('span') ?? []).find(
      (span) => span.textContent?.includes('enhancement'),
    );
    // Secondary helper text must use the theme's contrast-tested muted-content token.
    expect(list?.className).toContain('text-base-content-muted');
  });

  // Batch 34 revise 1: › closed, ⌄ open. lucide-angular copies its host class onto the <svg>, so the turn must sit on the
  // wrapper only (a rotate on the icon applied twice and pointed it left). Rendered angles: settings-visual.e2e.spec.ts.
  it('turns the summary chevron on its decorative wrapper, never on the icon', async () => {
    await render();
    const chevron = element.querySelector(
      '[data-testid="background-roles-chevron"]',
    );
    expect(rolesDetails()?.classList.contains('group')).toBe(true);
    expect(chevron?.getAttribute('aria-hidden')).toBe('true');
    expect(chevron?.classList.contains('group-open:rotate-90')).toBe(true);
    expect(
      chevron?.querySelector('lucide-angular')?.className ?? '',
    ).not.toContain('rotate');
  });

  it.each([
    'memory-curator',
    'enhancement',
  ] as const)(
    'opens the roles for the %s deep link, forwards the role and focuses the background section',
    async (target) => {
      fixture.componentRef.setInput('focusTarget', target);
      await render();
      expect(rolesDetails()?.open).toBe(true);
      expect(consumer().initialEditingConsumerId()).toBe(target);
      expect(document.activeElement).toBe(
        element.querySelector('[data-focus="background-models"]'),
      );
    },
  );

  it('opens the roles and focuses the section without preselecting a role for background-models', async () => {
    fixture.componentRef.setInput('focusTarget', 'background-models');
    await render();
    expect(rolesDetails()?.open).toBe(true);
    expect(consumer().initialEditingConsumerId()).toBeNull();
    expect(document.activeElement).toBe(
      element.querySelector('[data-focus="background-models"]'),
    );
  });

  it('focuses the CLI matrix table for cli-agents and leaves the roles closed', async () => {
    fixture.componentRef.setInput('focusTarget', 'cli-agents');
    await render();
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
      fixture.componentRef.setInput('focusTarget', 'enhancement');
      await render();
      expect(consumed).not.toHaveBeenCalled();
      consumer().deepLinkOpened.emit('enhancement');
      expect(consumed).toHaveBeenCalledTimes(1);
    });

    it('consumes when the popover opened first (rows loaded before the section focus ran)', async () => {
      await render();
      fixture.componentRef.setInput('focusTarget', 'memory-curator');
      consumer().deepLinkOpened.emit('memory-curator');
      expect(consumed).not.toHaveBeenCalled();
      await render();
      expect(consumed).toHaveBeenCalledTimes(1);
    });

    it.each(['cli-agents', 'background-models'] as const)(
      'consumes the %s link once its section is focused',
      async (target) => {
        fixture.componentRef.setInput('focusTarget', target);
        await render();
        expect(consumed).toHaveBeenCalledTimes(1);
      },
    );

    it('applies the same role again after the target was consumed and cleared: roles re-open and take focus', async () => {
      fixture.componentRef.setInput('focusTarget', 'enhancement');
      await render();
      consumer().deepLinkOpened.emit('enhancement');
      fixture.componentRef.setInput('focusTarget', null);
      await render();
      expect(consumer().initialEditingConsumerId()).toBeNull();
      // The user closes the roles and moves on, still on this tab.
      const details = rolesDetails();
      if (details) details.open = false;
      (document.activeElement as HTMLElement | null)?.blur();
      fixture.componentRef.setInput('focusTarget', 'enhancement');
      await render();
      expect(rolesDetails()?.open).toBe(true);
      expect(consumer().initialEditingConsumerId()).toBe('enhancement');
      expect(document.activeElement).toBe(
        element.querySelector('[data-focus="background-models"]'),
      );
      consumer().deepLinkOpened.emit('enhancement');
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
    fixture.componentRef.setInput('focusTarget', 'cli-agents');
    await render();
    (document.activeElement as HTMLElement).blur();
    fixture.componentRef.setInput('focusTarget', null);
    await render();
    fixture.componentRef.setInput('focusTarget', 'cli-agents');
    await render();
    expect(document.activeElement).toBe(matrixTable());
  });

  // Batch 35 (plan :772-774): the existing deep-link path opens the setup wizard on Providers.
  it("routes a role's provider setup to the Providers wizard for that provider, and refreshes after saves", async () => {
    await render();
    consumer().setupProviderRequested.emit('kimi-code');
    consumer().assignmentSaved.emit({
      id: 'enhancement',
      provider: 'kimi-code',
      model: 'kimi',
    });
    consumer().timeoutSaved.emit(30);
    expect(appState.requestSettingsTab).toHaveBeenCalledWith({
      tab: 'providers',
      providerId: 'kimi-code',
    });
    expect(state.refresh).toHaveBeenCalledTimes(1);
    expect(state.refreshEnhancement).toHaveBeenCalledTimes(1);
  });

  it('disables the assignments while a save is in flight', async () => {
    state.commit.set({ ...idle, status: 'saving' });
    await render();
    expect(consumer().disabled()).toBe(true);
  });

  it('retries only the failed CLI read', async () => {
    state.cliModels.set({
      status: 'error',
      data: {},
      error: 'Could not load this section. Retry.',
    });
    await render();
    button(element, 'Retry CLI instance models').click();
    await render();
    expect(state.refreshCliModels).toHaveBeenCalledTimes(1);
    expect(state.refreshCliAgents).not.toHaveBeenCalled();
  });
});

describe('AgentsRoutingSettingsComponent matrix chunk', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('keeps the matrix in its own deferred chunk behind a same-footprint, aria-busy placeholder', async () => {
    TestBed.configureTestingModule({
      imports: [AgentsRoutingSettingsComponent],
      providers: [
        { provide: ProvidersSettingsStateService, useValue: new StateStub() },
        {
          provide: AppStateManager,
          useValue: { requestSettingsTab: jest.fn() },
        },
      ],
      deferBlockBehavior: DeferBlockBehavior.Manual,
    }).overrideComponent(AgentsRoutingSettingsComponent, {
      remove: {
        imports: [
          ProviderConsumerAssignmentsComponent,
          CliOrchestrationMatrixComponent,
        ],
      },
      add: { imports: [ConsumerStub, CliMatrixStub] },
    });
    const fixture = TestBed.createComponent(AgentsRoutingSettingsComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const placeholder = element.querySelector(
      '[data-testid="cli-matrix-placeholder"]',
    );
    expect(placeholder?.getAttribute('aria-busy')).toBe('true');
    expect(element.querySelector('[data-testid="cli-matrix"]')).toBeNull();
    const [block] = await fixture.getDeferBlocks();
    await block.render(DeferBlockState.Complete);
    expect(element.querySelector('[data-testid="cli-matrix"]')).not.toBeNull();
    fixture.destroy();
  });
});
