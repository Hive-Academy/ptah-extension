import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import {
  AdminApiService,
  MemberGroup,
} from '../../../../services/admin-api.service';
import {
  AdminBuildersApiService,
  Pack,
} from '../../../../services/admin-builders-api.service';
import { PackFormModal } from './pack-form-modal';

function pack(overrides: Partial<Pack> = {}): Pack {
  return {
    id: 'pack-1',
    slug: 'existing-pack',
    title: 'Existing Pack',
    description: 'An existing repository.',
    repoUrl: 'https://github.com/hive-academy/existing-pack',
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

function group(overrides: Partial<MemberGroup> = {}): MemberGroup {
  return {
    id: 'grp-1',
    key: 'founders',
    name: 'Founders',
    description: null,
    discourseGroup: null,
    isDefault: false,
    memberCount: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('PackFormModal', () => {
  let fixture: ComponentFixture<PackFormModal>;
  let buildersApi: {
    createPack: jest.Mock;
    updatePack: jest.Mock;
  };
  let adminApi: { listGroups: jest.Mock };

  const q = {
    slug: (): HTMLInputElement =>
      fixture.nativeElement.querySelector(
        'input[placeholder="e.g. saas-starter"]',
      ),
    title: (): HTMLInputElement =>
      fixture.nativeElement.querySelector(
        'input[placeholder="e.g. SaaS Starter Pack"]',
      ),
    description: (): HTMLTextAreaElement =>
      fixture.nativeElement.querySelector(
        'textarea[placeholder="What is in this repository?"]',
      ),
    repoUrl: (): HTMLInputElement =>
      fixture.nativeElement.querySelector(
        'input[placeholder="https://github.com/owner/repo"]',
      ),
    cohortSelect: (): HTMLSelectElement =>
      fixture.nativeElement.querySelector('select'),
    submitButton: (): HTMLButtonElement =>
      fixture.nativeElement.querySelector('button[type="submit"]'),
    form: (): HTMLFormElement => fixture.nativeElement.querySelector('form'),
  };

  const typeInto = (
    el: HTMLInputElement | HTMLTextAreaElement,
    value: string,
  ): void => {
    el.value = value;
    el.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  const openCreate = (): void => {
    fixture.componentRef.setInput('pack', null);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
  };

  const openEdit = (target: Pack): void => {
    fixture.componentRef.setInput('pack', target);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
  };

  const closeModal = (): void => {
    fixture.componentRef.setInput('open', false);
    fixture.detectChanges();
  };

  const fillValidCreateForm = (): void => {
    typeInto(q.slug(), 'new-pack');
    typeInto(q.title(), 'New Pack');
    typeInto(q.description(), 'What it contains.');
    typeInto(q.repoUrl(), 'https://github.com/hive-academy/new-pack');
  };

  beforeEach(() => {
    buildersApi = {
      createPack: jest.fn().mockReturnValue(of(pack())),
      updatePack: jest.fn().mockReturnValue(of(pack())),
    };
    adminApi = { listGroups: jest.fn().mockReturnValue(of([group()])) };

    TestBed.configureTestingModule({
      imports: [PackFormModal],
      providers: [
        { provide: AdminBuildersApiService, useValue: buildersApi },
        { provide: AdminApiService, useValue: adminApi },
      ],
    });
    fixture = TestBed.createComponent(PackFormModal);
    fixture.detectChanges();
  });

  describe('validity / cohort-select logic (the branching this review flagged)', () => {
    it('disables submit in create mode until the slug matches the required shape', () => {
      openCreate();
      typeInto(q.title(), 'New Pack');
      typeInto(q.description(), 'What it contains.');
      typeInto(q.repoUrl(), 'https://github.com/hive-academy/new-pack');
      typeInto(q.slug(), 'Invalid Slug!');
      expect(q.submitButton().disabled).toBe(true);

      typeInto(q.slug(), 'valid-slug');
      expect(q.submitButton().disabled).toBe(false);
    });

    it('does not require a re-typed slug in edit mode — the prefilled slug already satisfies validity', () => {
      // slugValid() short-circuits true via isEdit() rather than
      // re-validating the (disabled, immutable) slug field's value.
      openEdit(pack({ slug: 'existing-pack' }));
      expect(q.slug().disabled).toBe(true);
      expect(q.submitButton().disabled).toBe(false);
    });

    it('disables submit when the repo URL does not match the GitHub shape, in both modes', () => {
      openCreate();
      fillValidCreateForm();
      expect(q.submitButton().disabled).toBe(false);

      typeInto(q.repoUrl(), 'https://gitlab.com/hive-academy/new-pack');
      expect(q.submitButton().disabled).toBe(true);
    });

    it('disables submit when the description is blank', () => {
      openCreate();
      typeInto(q.title(), 'New Pack');
      typeInto(q.repoUrl(), 'https://github.com/hive-academy/new-pack');
      typeInto(q.slug(), 'new-pack');
      expect(q.submitButton().disabled).toBe(true);

      typeInto(q.description(), 'Now it has one.');
      expect(q.submitButton().disabled).toBe(false);
    });

    it('fetches the cohort list once on first open and reuses the cached result on reopen', () => {
      openCreate();
      expect(adminApi.listGroups).toHaveBeenCalledTimes(1);

      closeModal();
      openCreate();

      expect(adminApi.listGroups).toHaveBeenCalledTimes(1);
    });

    it('degrades to a warning (not a blocked form) when the cohort list fails to load, and allows a retry on next open', () => {
      adminApi.listGroups.mockReturnValue(throwError(() => new Error('boom')));
      openCreate();

      expect(fixture.nativeElement.textContent).toContain(
        'Could not load cohorts',
      );
      fillValidCreateForm();
      // A pack can still be saved without a cohort label.
      expect(q.submitButton().disabled).toBe(false);

      closeModal();
      adminApi.listGroups.mockReturnValue(of([group()]));
      openCreate();

      expect(adminApi.listGroups).toHaveBeenCalledTimes(2);
    });
  });

  describe('the cohort field is a label, not a permission (L12)', () => {
    it('renders "Not tied to a cohort" as the null option — never "All Builders" or other access-implying wording', () => {
      openCreate();
      const firstOption = q.cohortSelect().options[0];
      expect(firstOption.value).toBe('');
      expect(firstOption.textContent?.trim()).toBe('Not tied to a cohort');
    });

    it('sends cohortKey: null when the null option is selected, and the group key otherwise', () => {
      openCreate();
      fillValidCreateForm();
      q.form().dispatchEvent(new Event('submit', { cancelable: true }));

      expect(buildersApi.createPack).toHaveBeenCalledWith(
        expect.objectContaining({ cohortKey: null }),
      );

      buildersApi.createPack.mockClear();
      closeModal();
      openCreate();
      fillValidCreateForm();
      const select = q.cohortSelect();
      select.value = 'founders';
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      q.form().dispatchEvent(new Event('submit', { cancelable: true }));

      expect(buildersApi.createPack).toHaveBeenCalledWith(
        expect.objectContaining({ cohortKey: 'founders' }),
      );
    });
  });

  describe('submit routing', () => {
    it('creates via POST when pack is null and updates via PATCH when pack is set', () => {
      openCreate();
      fillValidCreateForm();
      q.form().dispatchEvent(new Event('submit', { cancelable: true }));

      expect(buildersApi.createPack).toHaveBeenCalledTimes(1);
      expect(buildersApi.updatePack).not.toHaveBeenCalled();

      buildersApi.createPack.mockClear();
      closeModal();
      const existing = pack({ id: 'pack-42', slug: 'existing-pack' });
      openEdit(existing);
      q.form().dispatchEvent(new Event('submit', { cancelable: true }));

      expect(buildersApi.updatePack).toHaveBeenCalledWith(
        'pack-42',
        expect.objectContaining({ title: existing.title }),
      );
      expect(buildersApi.createPack).not.toHaveBeenCalled();
    });
  });
});
