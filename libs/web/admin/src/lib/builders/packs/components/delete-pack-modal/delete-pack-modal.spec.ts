import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import {
  AdminBuildersApiService,
  Pack,
} from '../../../../services/admin-builders-api.service';
import { DeletePackModal } from './delete-pack-modal';

function pack(overrides: Partial<Pack> = {}): Pack {
  return {
    id: 'pack-1',
    slug: 'existing-pack',
    title: 'Existing Pack',
    description: 'desc',
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

describe('DeletePackModal', () => {
  let fixture: ComponentFixture<DeletePackModal>;
  let api: { deletePack: jest.Mock };

  const typedSlugInput = (): HTMLInputElement =>
    fixture.nativeElement.querySelector('input[type="text"]');
  const submitButton = (): HTMLButtonElement =>
    fixture.nativeElement.querySelector('button[type="submit"]');

  const typeInto = (el: HTMLInputElement, value: string): void => {
    el.value = value;
    el.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  beforeEach(() => {
    api = { deletePack: jest.fn().mockReturnValue(of({ deleted: true })) };
    TestBed.configureTestingModule({
      imports: [DeletePackModal],
      providers: [{ provide: AdminBuildersApiService, useValue: api }],
    });
    fixture = TestBed.createComponent(DeletePackModal);
  });

  it('keeps the confirm button disabled until the typed text exactly matches the slug', () => {
    fixture.componentRef.setInput('pack', pack({ slug: 'existing-pack' }));
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    expect(submitButton().disabled).toBe(true);

    typeInto(typedSlugInput(), 'existing-pac');
    expect(submitButton().disabled).toBe(true);

    typeInto(typedSlugInput(), 'existing-pack');
    expect(submitButton().disabled).toBe(false);
  });

  it('trims surrounding whitespace before comparing', () => {
    fixture.componentRef.setInput('pack', pack({ slug: 'existing-pack' }));
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    typeInto(typedSlugInput(), '  existing-pack  ');
    expect(submitButton().disabled).toBe(false);
  });

  it('resets the typed confirmation when reopened for a different pack', () => {
    fixture.componentRef.setInput('pack', pack({ slug: 'pack-one' }));
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    typeInto(typedSlugInput(), 'pack-one');
    expect(submitButton().disabled).toBe(false);

    fixture.componentRef.setInput('open', false);
    fixture.detectChanges();
    fixture.componentRef.setInput('pack', pack({ slug: 'pack-two' }));
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    // The stale "pack-one" text does not carry over and satisfy pack-two's check.
    expect(typedSlugInput().value).toBe('');
    expect(submitButton().disabled).toBe(true);
  });

  it('deletes by id and emits deleted on success', () => {
    let deletedEmitted = false;
    fixture.componentInstance.deleted.subscribe(() => (deletedEmitted = true));

    fixture.componentRef.setInput(
      'pack',
      pack({ id: 'pack-99', slug: 'existing-pack' }),
    );
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    typeInto(typedSlugInput(), 'existing-pack');

    fixture.nativeElement
      .querySelector('form')
      .dispatchEvent(new Event('submit', { cancelable: true }));

    expect(api.deletePack).toHaveBeenCalledWith('pack-99');
    expect(deletedEmitted).toBe(true);
  });

  it('surfaces a server error message and does not emit deleted', () => {
    api.deletePack.mockReturnValue(
      throwError(() => ({ error: { message: 'still referenced' } })),
    );
    let deletedEmitted = false;
    fixture.componentInstance.deleted.subscribe(() => (deletedEmitted = true));

    fixture.componentRef.setInput('pack', pack({ slug: 'existing-pack' }));
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    typeInto(typedSlugInput(), 'existing-pack');
    fixture.nativeElement
      .querySelector('form')
      .dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('still referenced');
    expect(deletedEmitted).toBe(false);
  });

  it("states that the GitHub repo and everyone's access are unaffected — only the record is lost (L12)", () => {
    fixture.componentRef.setInput('pack', pack());
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      "The GitHub repository and everyone's access to it are unaffected",
    );
  });
});
