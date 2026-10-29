import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { PROVIDER_MODELS_LOADER } from '@ptah-extension/ui';
import { CLI_TEST_FAILED, type InstanceCliMatrixRow } from './cli-matrix-rows';
import { PtahCliInstancesComponent } from './ptah-cli-instances.component';

const GLM: InstanceCliMatrixRow = {
  kind: 'instance',
  id: 'glm-1',
  name: 'Glm',
  status: { kind: 'ready', label: 'Ready', tone: 'success' },
  enabled: true,
  interactive: true,
  permission: { badge: 'Auto', tone: 'neutral', detail: 'Runs unattended.' },
  providerId: 'z-ai',
  provider: 'Z.AI',
  keyStatus: { kind: 'key-set', label: 'Key set' },
  tiers: [
    { tier: 'sonnet', label: 'Sonnet', model: 'glm-5.3' },
    { tier: 'haiku', label: 'Haiku', model: 'glm-4.5' },
  ],
  selectedModel: '',
  effort: '',
  lastTest: null,
};

describe('PtahCliInstancesComponent', () => {
  let fixture: ComponentFixture<PtahCliInstancesComponent>;
  const element = () => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(selector: string) =>
    element().querySelector(selector) as T | null;
  const text = (node: Element | null | undefined) =>
    node?.textContent?.replace(/\s+/g, ' ').trim();

  function set(inputs: Record<string, unknown>) {
    for (const [name, value] of Object.entries(inputs))
      fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PtahCliInstancesComponent],
      providers: [
        {
          provide: PROVIDER_MODELS_LOADER,
          useValue: {
            listModels: jest.fn(async () => ({ models: [], totalCount: 0 })),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(PtahCliInstancesComponent);
    set({ rows: [GLM], canWrite: true });
  });

  describe('section', () => {
    it('is its own labelled sub-section under a hairline, saying what an instance is', () => {
      const section = q('[data-testid="cli-instances"]');
      expect(section?.className).toContain('border-t');
      expect(section?.className).toContain('border-base-content/15');
      expect(section?.getAttribute('aria-labelledby')).toBe(
        'cli-instances-heading',
      );
      expect(text(q('#cli-instances-heading'))).toBe('Ptah CLI instances');
      expect(section?.textContent).toContain('connected providers');
    });

    it('offers one Add while instances exist, and emits its origin', () => {
      const emitted: string[] = [];
      fixture.componentInstance.addRequested.subscribe((origin) =>
        emitted.push(origin),
      );
      const add = q<HTMLButtonElement>('[data-testid="cli-matrix-add"]');
      expect(text(add)).toBe('Add Ptah CLI Instance');
      expect(add?.className).toContain('btn-sm');
      add?.click();
      expect(emitted).toEqual(['header']);
      expect(q('[data-testid="cli-matrix-no-instances"]')).toBeNull();
    });

    it('shows a helpful empty state with its own Add instead of the header one', () => {
      const emitted: string[] = [];
      fixture.componentInstance.addRequested.subscribe((origin) =>
        emitted.push(origin),
      );
      set({ rows: [], empty: true });
      const empty = q('[data-testid="cli-matrix-no-instances"]');
      expect(empty?.textContent).toContain('No Ptah CLI instance yet.');
      expect(q('[data-testid="cli-matrix-add"]')).toBeNull();
      empty?.querySelector('button')?.click();
      expect(emitted).toEqual(['empty']);
    });

    it('disables both Adds while a save runs or nothing can be written', () => {
      set({ busy: true });
      expect(
        q<HTMLButtonElement>('[data-testid="cli-matrix-add"]')?.disabled,
      ).toBe(true);
      set({ busy: false, canWrite: false, rows: [], empty: true });
      expect(
        q<HTMLButtonElement>('[data-testid="cli-matrix-no-instances"] button')
          ?.disabled,
      ).toBe(true);
    });
  });

  describe('instance card', () => {
    it('shows name, provider, status and key status', () => {
      const card = q('[data-testid="cli-matrix-row-glm-1"]');
      expect(card?.getAttribute('data-kind')).toBe('instance');
      expect(card?.textContent).toContain('Glm');
      expect(card?.textContent).toContain('Z.AI');
      expect(text(card?.querySelector('[data-testid="cli-matrix-status"]'))).toBe(
        'Ready',
      );
      expect(
        text(card?.querySelector('[data-testid="cli-matrix-key-status"]')),
      ).toBe('Key set');
    });

    it('maps every tier to its model, with an explained "Not set" state', () => {
      const tiers = Array.from(element().querySelectorAll('[data-tier]'));
      expect(tiers.map((node) => node.getAttribute('data-tier'))).toEqual([
        'sonnet',
        'opus',
        'haiku',
      ]);
      expect(tiers.map((node) => node.textContent?.replace(/\s+/g, ''))).toEqual(
        ['Sonnet:glm-5.3', 'Opus:Notset', 'Haiku:glm-4.5'],
      );
      expect(tiers[1].getAttribute('title')).toContain('No model of its own');
      const summary = q('[data-testid="cli-matrix-tier-summary"]');
      expect(text(summary)).toBe('Model tiers · 2 of 3 set');
      expect(summary?.getAttribute('title')).toBe(
        'Sonnet: glm-5.3, Haiku: glm-4.5',
      );
    });

    it('says when no tier is set, and while tiers load', () => {
      set({ rows: [{ ...GLM, tiers: [] }] });
      expect(text(q('[data-testid="cli-matrix-tier-summary"]'))).toContain(
        'none set',
      );
      set({ rows: [{ ...GLM, tiers: null, selectedModel: null }] });
      expect(text(q('[data-testid="cli-matrix-tier-summary"]'))).toContain(
        'loading',
      );
      expect(q('[data-testid="cli-matrix-model-glm-1"]')).toBeNull();
    });

    it('shows the last Test: not run, passed with latency, or the fixed failure sentence', () => {
      const result = () => text(q('[data-testid="cli-matrix-test-result"]'));
      expect(result()).toBe('Not run yet');
      set({
        rows: [
          { ...GLM, lastTest: { success: true, latencyMs: 90, reason: null } },
        ],
      });
      expect(result()).toBe('Passed in 90ms');
      set({
        rows: [
          {
            ...GLM,
            lastTest: { success: false, latencyMs: null, reason: 'Timed out.' },
          },
        ],
      });
      expect(result()).toBe(`${CLI_TEST_FAILED} Timed out.`);
    });

    it('shows "Testing…" on the instance under test', () => {
      set({ testing: true, testingId: 'glm-1' });
      expect(text(q('[data-testid="cli-matrix-test-glm-1"]'))).toBe('Testing…');
    });
  });

  describe('actions emit to the matrix', () => {
    it('toggle, Tiers and Test', () => {
      const component = fixture.componentInstance;
      const seen: string[] = [];
      component.toggled.subscribe(({ row }) => seen.push(`toggle:${row.id}`));
      component.tiersRequested.subscribe((row) => seen.push(`tiers:${row.id}`));
      component.testRequested.subscribe((id) => seen.push(`test:${id}`));
      q<HTMLInputElement>('[data-testid="cli-matrix-toggle-glm-1"]')?.dispatchEvent(
        new Event('change'),
      );
      q<HTMLButtonElement>('[data-testid="cli-matrix-tiers-glm-1"]')?.click();
      q<HTMLButtonElement>('[data-testid="cli-matrix-test-glm-1"]')?.click();
      expect(seen).toEqual(['toggle:glm-1', 'tiers:glm-1', 'test:glm-1']);
    });

    it('More opens through the matrix; Edit and Delete emit from its menu', () => {
      const component = fixture.componentInstance;
      const seen: string[] = [];
      component.cellToggled.subscribe(({ rowId, kind }) =>
        seen.push(`${kind}:${rowId}`),
      );
      component.editRequested.subscribe((row) => seen.push(`edit:${row.id}`));
      component.deleteAsked.subscribe((id) => seen.push(`delete:${id}`));
      const trigger = q<HTMLButtonElement>('[data-testid="cli-matrix-more-glm-1"]');
      expect(trigger?.getAttribute('aria-expanded')).toBe('false');
      trigger?.click();
      expect(seen).toEqual(['more:glm-1']);
      set({ openCell: { rowId: 'glm-1', kind: 'more' } });
      expect(trigger?.getAttribute('aria-expanded')).toBe('true');
      q<HTMLButtonElement>('[data-testid="cli-matrix-edit-glm-1"]')?.click();
      q<HTMLButtonElement>('[data-testid="cli-matrix-delete-glm-1"]')?.click();
      expect(seen).toEqual(['more:glm-1', 'edit:glm-1', 'delete:glm-1']);
    });

    it('the inline delete confirm emits confirm and cancel', () => {
      const component = fixture.componentInstance;
      const seen: string[] = [];
      component.deleteConfirmed.subscribe((row) => seen.push(`confirm:${row.id}`));
      component.deleteCancelled.subscribe((id) => seen.push(`cancel:${id}`));
      set({ confirmDeleteId: 'glm-1' });
      const confirm = q('[data-testid="cli-matrix-delete-confirm-glm-1"]');
      expect(confirm?.textContent).toContain('Delete Glm?');
      expect(q('[data-testid="cli-matrix-tiers-glm-1"]')).toBeNull();
      confirm
        ?.querySelector<HTMLButtonElement>('[aria-label="Confirm delete Glm"]')
        ?.click();
      confirm?.querySelector<HTMLButtonElement>('[data-cancel-delete]')?.click();
      expect(seen).toEqual(['confirm:glm-1', 'cancel:glm-1']);
    });
  });
});
