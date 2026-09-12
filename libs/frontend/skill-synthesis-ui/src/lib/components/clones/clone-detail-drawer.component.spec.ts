import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { CloneSummary } from '@ptah-extension/shared';

import {
  CloneBodySaveRequest,
  CloneDetailDrawerComponent,
} from './clone-detail-drawer.component';

function clone(overrides: Partial<CloneSummary> = {}): CloneSummary {
  return {
    slug: 'deep-research',
    kind: 'skill',
    cloneStatus: 'clone',
    diverged: false,
    invocationCount: 10,
    successRate: 0.8,
    lastEnhancedAt: null,
    historyCount: 2,
    pendingSourceHash: null,
    enhanceMinInvocations: 5,
    enhanceCooldownUntil: null,
    ...overrides,
  };
}

type Fixture = ComponentFixture<CloneDetailDrawerComponent>;

interface Options {
  readonly canEditBody?: boolean;
  readonly body?: string | null;
  readonly bodySaving?: boolean;
  readonly busy?: boolean;
}

async function setup(options: Options = {}): Promise<Fixture> {
  await TestBed.configureTestingModule({
    imports: [CloneDetailDrawerComponent],
  }).compileComponents();

  const fixture = TestBed.createComponent(CloneDetailDrawerComponent);
  fixture.componentRef.setInput('clone', clone());
  fixture.componentRef.setInput('body', options.body ?? '# live body');
  fixture.componentRef.setInput('canEditBody', options.canEditBody ?? false);
  fixture.componentRef.setInput('bodySaving', options.bodySaving ?? false);
  fixture.componentRef.setInput('busy', options.busy ?? false);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

const find = (fixture: Fixture, testid: string): HTMLElement | null =>
  fixture.nativeElement.querySelector(`[data-testid="${testid}"]`);

const require_ = (fixture: Fixture, testid: string): HTMLElement => {
  const el = find(fixture, testid);
  expect(el).not.toBeNull();
  return el as HTMLElement;
};

async function enterEditMode(fixture: Fixture): Promise<void> {
  (require_(fixture, 'drawer-body-edit-btn') as HTMLButtonElement).click();
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('CloneDetailDrawerComponent — body edit mode', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('does NOT render the Edit affordance when canEditBody() is false', async () => {
    const fixture = await setup({ canEditBody: false });

    expect(find(fixture, 'drawer-body-edit-btn')).toBeNull();
    expect(find(fixture, 'drawer-body')).not.toBeNull();
  });

  it('renders the Edit affordance as a real button when canEditBody() is true', async () => {
    const fixture = await setup({ canEditBody: true });
    const button = require_(fixture, 'drawer-body-edit-btn');

    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('aria-label')).toContain('deep-research');
  });

  it('disables the Edit affordance while another action is in flight', async () => {
    const fixture = await setup({ canEditBody: true, busy: true });

    expect(
      (require_(fixture, 'drawer-body-edit-btn') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('REPLACES the markdown render with the editor in edit mode', async () => {
    const fixture = await setup({ canEditBody: true });
    expect(find(fixture, 'drawer-body')).not.toBeNull();

    await enterEditMode(fixture);

    // One body on screen, never two: the read-only block is gone, not hidden.
    expect(find(fixture, 'drawer-body')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('ptah-markdown-block'),
    ).toBeNull();
    expect(find(fixture, 'clone-body-editor')).not.toBeNull();
  });

  it('seeds the editor from the loaded body', async () => {
    const fixture = await setup({ canEditBody: true, body: '# seeded here' });
    await enterEditMode(fixture);

    const textarea = require_(
      fixture,
      'clone-body-editor-textarea',
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe('# seeded here');
  });

  it('emits bodySaved with the entry and the edited text on Save', async () => {
    const fixture = await setup({ canEditBody: true });
    const requests: CloneBodySaveRequest[] = [];
    fixture.componentInstance.bodySaved.subscribe((r) => requests.push(r));

    await enterEditMode(fixture);
    const textarea = require_(
      fixture,
      'clone-body-editor-textarea',
    ) as HTMLTextAreaElement;
    textarea.value = '# edited';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (
      require_(fixture, 'clone-body-editor-save') as HTMLButtonElement
    ).click();

    expect(requests).toHaveLength(1);
    expect(requests[0].body).toBe('# edited');
    expect(requests[0].clone.slug).toBe('deep-research');
  });

  it('emits nothing on Cancel and restores the read-only render', async () => {
    const fixture = await setup({ canEditBody: true });
    const requests: CloneBodySaveRequest[] = [];
    fixture.componentInstance.bodySaved.subscribe((r) => requests.push(r));

    await enterEditMode(fixture);
    (
      require_(fixture, 'clone-body-editor-cancel') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(requests).toEqual([]);
    expect(find(fixture, 'clone-body-editor')).toBeNull();
    expect(find(fixture, 'drawer-body')).not.toBeNull();
    expect(find(fixture, 'drawer-body-edit-btn')).not.toBeNull();
  });

  it('stays in edit mode when a save fails and the body never changes', async () => {
    const fixture = await setup({ canEditBody: true });

    await enterEditMode(fixture);
    const textarea = require_(
      fixture,
      'clone-body-editor-textarea',
    ) as HTMLTextAreaElement;
    textarea.value = '# edited';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (
      require_(fixture, 'clone-body-editor-save') as HTMLButtonElement
    ).click();

    // The view flips bodySaving on and back off without the body changing.
    fixture.componentRef.setInput('bodySaving', true);
    fixture.detectChanges();
    fixture.componentRef.setInput('bodySaving', false);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(find(fixture, 'clone-body-editor')).not.toBeNull();
    expect(
      (require_(fixture, 'clone-body-editor-textarea') as HTMLTextAreaElement)
        .value,
    ).toBe('# edited');
  });

  it('leaves edit mode once the reloaded body matches what was saved', async () => {
    const fixture = await setup({ canEditBody: true });

    await enterEditMode(fixture);
    const textarea = require_(
      fixture,
      'clone-body-editor-textarea',
    ) as HTMLTextAreaElement;
    textarea.value = '# edited';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (
      require_(fixture, 'clone-body-editor-save') as HTMLButtonElement
    ).click();

    fixture.componentRef.setInput('body', '# edited');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(find(fixture, 'clone-body-editor')).toBeNull();
    expect(find(fixture, 'drawer-body')).not.toBeNull();
  });

  it('drops edit mode when the drawer switches to a different entry', async () => {
    const fixture = await setup({ canEditBody: true });
    await enterEditMode(fixture);
    expect(find(fixture, 'clone-body-editor')).not.toBeNull();

    fixture.componentRef.setInput('clone', clone({ slug: 'other-entry' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(find(fixture, 'clone-body-editor')).toBeNull();
  });
});
