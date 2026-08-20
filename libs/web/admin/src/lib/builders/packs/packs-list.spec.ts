import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { AdminApiService } from '../../services/admin-api.service';
import {
  AdminBuildersApiService,
  Pack,
} from '../../services/admin-builders-api.service';
import { PacksList } from './packs-list';

function pack(overrides: Partial<Pack> = {}): Pack {
  return {
    id: 'pack-1',
    slug: 'saas-starter',
    title: 'SaaS Starter Pack',
    description: 'A starter repo.',
    repoUrl: 'https://github.com/hive-academy/saas-starter',
    notes: null,
    tags: [],
    cohortKey: null,
    cohortName: null,
    createdBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('PacksList', () => {
  let fixture: ComponentFixture<PacksList>;
  let buildersApi: {
    listPacks: jest.Mock;
    createPack: jest.Mock;
    updatePack: jest.Mock;
    deletePack: jest.Mock;
  };
  let adminApi: { listGroups: jest.Mock };

  const createComponent = (): void => {
    fixture = TestBed.createComponent(PacksList);
    fixture.detectChanges();
  };

  beforeEach(() => {
    buildersApi = {
      listPacks: jest.fn().mockReturnValue(of([])),
      createPack: jest.fn(),
      updatePack: jest.fn(),
      deletePack: jest.fn(),
    };
    adminApi = { listGroups: jest.fn().mockReturnValue(of([])) };

    TestBed.configureTestingModule({
      imports: [PacksList],
      providers: [
        { provide: AdminBuildersApiService, useValue: buildersApi },
        { provide: AdminApiService, useValue: adminApi },
      ],
    });
  });

  it('derives the cohort filter from loaded rows, offering only cohorts that actually have a pack', () => {
    buildersApi.listPacks.mockReturnValue(
      of([
        pack({ id: 'p1', cohortKey: 'founders', cohortName: 'Founders' }),
        pack({ id: 'p2', cohortKey: null, cohortName: null }),
        pack({ id: 'p3', cohortKey: 'founders', cohortName: 'Founders' }),
      ]),
    );
    createComponent();

    const options = Array.from(
      fixture.nativeElement.querySelectorAll(
        'select[aria-label="Filter by cohort"] option',
      ),
    ) as HTMLOptionElement[];

    // "All cohorts" plus one deduped "Founders" entry — the unlabelled pack
    // does not contribute a second, meaningless option to the filter.
    expect(options.map((o) => o.textContent?.trim())).toEqual([
      'All cohorts',
      'Founders',
    ]);
  });

  it('applies search only when the form is submitted, not per keystroke', () => {
    createComponent();
    buildersApi.listPacks.mockClear();

    const input: HTMLInputElement =
      fixture.nativeElement.querySelector('#packs-search');
    input.value = 'starter';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(buildersApi.listPacks).not.toHaveBeenCalled();

    const form: HTMLFormElement = fixture.nativeElement.querySelector('form');
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();

    expect(buildersApi.listPacks).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'starter' }),
    );
  });

  describe('the cohort column is a bookkeeping label, not an access control (L12)', () => {
    it('renders an explicit "No cohort" chip for an unlabelled pack, never a blank cell', () => {
      buildersApi.listPacks.mockReturnValue(of([pack({ cohortKey: null })]));
      createComponent();

      const row = fixture.nativeElement.querySelector('tbody tr');
      expect(row.textContent).toContain('No cohort');
    });

    it('renders the cohort name badge for a labelled pack', () => {
      buildersApi.listPacks.mockReturnValue(
        of([pack({ cohortKey: 'founders', cohortName: 'Founders' })]),
      );
      createComponent();

      const row = fixture.nativeElement.querySelector('tbody tr');
      expect(row.textContent).toContain('Founders');
      expect(row.textContent).not.toContain('No cohort');
    });

    it('states plainly that nothing on the page grants or revokes repo access', () => {
      createComponent();
      expect(fixture.nativeElement.textContent).toContain(
        'Nothing on this page grants or revokes access.',
      );
    });
  });
});
