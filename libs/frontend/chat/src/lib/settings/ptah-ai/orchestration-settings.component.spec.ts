import {
  ChangeDetectionStrategy,
  Component,
  input,
  signal,
} from '@angular/core';
import {
  DeferBlockState,
  TestBed,
  type ComponentFixture,
} from '@angular/core/testing';
import {
  ProvidersSettingsStateService,
  type ProvidersSettingsCommit,
} from '@ptah-extension/core';
import { OrchestrationSettingsComponent } from './orchestration-settings.component';
import { SubagentCacheTtlSettingComponent } from './subagent-cache-ttl-setting.component';
import { SessionBudgetSettingsComponent } from './session-budget-settings.component';
import { LaneGuardsSettingsComponent } from './lane-guards-settings.component';
import { AdvancedSettingsGroupComponent } from '../advanced/advanced-settings-group.component';

@Component({
  selector: 'ptah-subagent-cache-ttl-setting',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<section data-testid="subagent-cache-ttl-setting">TTL</section>',
})
class SubagentCacheTtlStub {}

@Component({
  selector: 'ptah-session-budget-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<section data-testid="session-budget-settings">Budget</section>',
})
class SessionBudgetStub {}

@Component({
  selector: 'ptah-lane-guards-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<section data-testid="lane-guards-settings">Guards</section>',
})
class LaneGuardsStub {}

@Component({
  selector: 'ptah-advanced-settings-group',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<section [attr.data-testid]="\'group-\' + groupId()"></section>',
})
class AdvancedGroupStub {
  readonly groupId = input.required<string>();
}

const idle: ProvidersSettingsCommit = {
  status: 'idle',
  saved: [],
  unsaved: [],
  unconfirmed: [],
  refreshFailed: false,
  message: null,
};

/** The container's own reads (its children are stubs). */
class StateStub {
  readonly commit = signal<ProvidersSettingsCommit>(idle);
  readonly open = jest.fn(async () => undefined);
}

/** Context Management tab (tab id `orchestration`). */
describe('OrchestrationSettingsComponent', () => {
  let fixture: ComponentFixture<OrchestrationSettingsComponent>;
  let element: HTMLElement;
  let state: StateStub;

  beforeEach(async () => {
    state = new StateStub();
    await TestBed.configureTestingModule({
      imports: [OrchestrationSettingsComponent],
      providers: [{ provide: ProvidersSettingsStateService, useValue: state }],
    })
      .overrideComponent(OrchestrationSettingsComponent, {
        remove: {
          imports: [
            SubagentCacheTtlSettingComponent,
            SessionBudgetSettingsComponent,
            LaneGuardsSettingsComponent,
            AdvancedSettingsGroupComponent,
          ],
        },
        add: {
          imports: [
            SubagentCacheTtlStub,
            SessionBudgetStub,
            LaneGuardsStub,
            AdvancedGroupStub,
          ],
        },
      })
      .compileComponents();
    fixture = TestBed.createComponent(OrchestrationSettingsComponent);
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

  it('opens the shared state once when mounted alone (a user can land here first)', async () => {
    await render();
    await render();
    expect(state.open).toHaveBeenCalledTimes(1);
  });

  // The CLI matrix and the background roles moved to the Providers tab (AgentsRoutingSettingsComponent).
  it('holds no CLI matrix, no background roles and no deep-link focus section', async () => {
    await render();
    expect(element.querySelector('ptah-cli-orchestration-matrix')).toBeNull();
    expect(
      element.querySelector('[data-testid="cli-matrix-placeholder"]'),
    ).toBeNull();
    expect(element.querySelector('ptah-provider-consumer-assignments')).toBeNull();
    expect(
      element.querySelector('[data-testid="background-roles-details"]'),
    ).toBeNull();
    expect(element.querySelector('[data-focus]')).toBeNull();
  });

  it('defers the subagent cache TTL card behind a placeholder, first on the tab', async () => {
    await render();
    const ttl = () =>
      element.querySelector('[data-testid="subagent-cache-ttl-setting"]');
    const blocks = await fixture.getDeferBlocks();
    const block = blocks[0];
    await block.render(DeferBlockState.Placeholder);
    expect(
      element.querySelector('[data-testid="subagent-cache-ttl-placeholder"]'),
    ).not.toBeNull();
    expect(ttl()).toBeNull();
    await block.render(DeferBlockState.Complete);
    expect(ttl()).not.toBeNull();
  });

  it('keeps Lane guards independent from the viewport-deferred session budget card', async () => {
    await render();
    const budget = () =>
      element.querySelector('[data-testid="session-budget-settings"]');
    const blocks = await fixture.getDeferBlocks();
    expect(blocks).toHaveLength(3);
    const block = blocks[1];
    await block.render(DeferBlockState.Placeholder);
    expect(
      element.querySelector('[data-testid="session-budget-placeholder"]'),
    ).not.toBeNull();
    expect(budget()).toBeNull();
    // Lane guards is intentionally direct: it must not depend on a viewport/defer trigger.
    expect(
      element.querySelector('[data-testid="lane-guards-settings"]'),
    ).not.toBeNull();
    await block.render(DeferBlockState.Complete);
    await blocks[0].render(DeferBlockState.Complete);
    const ttl = element.querySelector(
      '[data-testid="subagent-cache-ttl-setting"]',
    );
    expect(ttl?.compareDocumentPosition(budget() as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    const guards = element.querySelector(
      '[data-testid="lane-guards-settings"]',
    );
    expect(budget()?.compareDocumentPosition(guards as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('defers the advanced orchestration groups behind a one-row placeholder, after the session budget and Lane guards (TASK_2026_658)', async () => {
    await render();
    const groupIds = () =>
      Array.from(
        element.querySelectorAll<HTMLElement>('[data-testid^="group-"]'),
      ).map((node) => node.dataset['testid']);
    const blocks = await fixture.getDeferBlocks();
    const block = blocks[2];
    await block.render(DeferBlockState.Placeholder);
    expect(
      element.querySelector(
        '[data-testid="orchestration-advanced-placeholder"]',
      ),
    ).not.toBeNull();
    expect(groupIds()).toEqual([]);

    await block.render(DeferBlockState.Complete);
    await blocks[1].render(DeferBlockState.Complete);
    expect(groupIds()).toEqual([
      'group-context-budgets',
      'group-codex-agents',
      'group-background-queries',
    ]);
    const first = element.querySelector(
      '[data-testid="group-context-budgets"]',
    ) as Node;
    for (const before of [
      '[data-testid="session-budget-settings"]',
      '[data-testid="lane-guards-settings"]',
    ]) {
      expect(
        element.querySelector(before)?.compareDocumentPosition(first),
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  });

  it('shows commit feedback naming saved, unsaved and unconfirmed fields', async () => {
    state.commit.set({
      ...idle,
      status: 'unconfirmed',
      saved: ['CLI instance'],
      unsaved: ['Tier'],
      unconfirmed: ['Key'],
    });
    await render();
    const feedback = element.querySelector(
      '[data-testid="providers-commit-feedback"]',
    );
    expect(feedback?.getAttribute('role')).toBe('status');
    expect(feedback?.textContent).toContain('Saved: CLI instance.');
    expect(feedback?.textContent).toContain('Not saved: Tier.');
    expect(feedback?.textContent).toContain('Save not confirmed: Key.');
  });
});
