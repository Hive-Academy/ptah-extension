import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import {
  AdminLearningApiService,
  type AdminCourseModule,
  type UpdateModuleRequest,
} from '../../../../services/admin-learning-api.service';
import { ModuleFormModal, type ModuleFormTarget } from './module-form-modal';

function savedModule(
  overrides: Partial<AdminCourseModule> = {},
): AdminCourseModule {
  return {
    id: 'module-1',
    courseId: 'course-1',
    slug: 'week-1',
    title: 'Week 1',
    description: null,
    sortOrder: 0,
    releaseAt: null,
    lessonCount: 0,
    deletedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * The module the release-date tests edit.
 *
 * 🔴 THE SECONDS ARE THE POINT. `datetime-local` is minute precision, so the
 * `:45` cannot survive the round trip through the control. A title-only edit
 * that echoes the control back would move this instant.
 */
function targetWithSeconds(): ModuleFormTarget {
  return {
    id: 'module-1',
    title: 'Week 1',
    description: null,
    releaseAt: '2026-09-10T09:00:45.000Z',
  };
}

describe('ModuleFormModal', () => {
  let fixture: ComponentFixture<ModuleFormModal>;
  let api: { createModule: jest.Mock; updateModule: jest.Mock };

  const q = {
    title: (): HTMLInputElement =>
      fixture.nativeElement.querySelector('#module-title'),
    releaseAt: (): HTMLInputElement =>
      fixture.nativeElement.querySelector('#module-release-at'),
    form: (): HTMLFormElement => fixture.nativeElement.querySelector('form'),
  };

  const typeInto = (el: HTMLInputElement, value: string): void => {
    el.value = value;
    el.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  const openEdit = (target: ModuleFormTarget): void => {
    fixture.componentRef.setInput('module', target);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
  };

  const openCreate = (): void => {
    fixture.componentRef.setInput('module', null);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
  };

  const submit = (): void => {
    q.form().dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  };

  /** The `PATCH` body the one `updateModule` call was made with. */
  const patchBody = (): UpdateModuleRequest => {
    expect(api.updateModule).toHaveBeenCalledTimes(1);
    return api.updateModule.mock.calls[0][1] as UpdateModuleRequest;
  };

  beforeEach(() => {
    api = {
      createModule: jest.fn().mockReturnValue(of(savedModule())),
      updateModule: jest.fn().mockReturnValue(of(savedModule())),
    };

    TestBed.configureTestingModule({
      imports: [ModuleFormModal],
      providers: [{ provide: AdminLearningApiService, useValue: api }],
    });
    fixture = TestBed.createComponent(ModuleFormModal);
    fixture.componentRef.setInput('courseId', 'course-1');
    fixture.detectChanges();
  });

  /* ---------------------------------------------------------------------- */
  /* `releaseAt` is omitted unless the admin changed it                      */
  /* ---------------------------------------------------------------------- */

  it('sends no releaseAt key when the admin edited only the title', () => {
    openEdit(targetWithSeconds());
    typeInto(q.title(), 'Week 1 — Foundations');
    submit();

    const body = patchBody();
    expect(body.title).toBe('Week 1 — Foundations');
    expect('releaseAt' in body).toBe(false);
  });

  it('sends no releaseAt key when the module never had a release date', () => {
    openEdit({
      id: 'module-1',
      title: 'Week 1',
      description: null,
      releaseAt: null,
    });
    typeInto(q.title(), 'Week One');
    submit();

    expect('releaseAt' in patchBody()).toBe(false);
  });

  it('sends the new instant when the admin retypes the date', () => {
    openEdit(targetWithSeconds());
    const retyped = '2026-09-11T09:00';
    typeInto(q.releaseAt(), retyped);
    submit();

    const body = patchBody();
    expect(body.releaseAt).toBe(new Date(retyped).toISOString());
  });

  it('sends an explicit null when the admin clears the date', () => {
    // `null` OPENS the module immediately and is distinct from omitting the key.
    openEdit(targetWithSeconds());
    typeInto(q.releaseAt(), '');
    submit();

    const body = patchBody();
    expect('releaseAt' in body).toBe(true);
    expect(body.releaseAt).toBeNull();
  });

  it('prefills the control from the stored instant in the operator zone', () => {
    openEdit(targetWithSeconds());

    const stored = new Date('2026-09-10T09:00:45.000Z');
    const local = new Date(
      stored.getTime() - stored.getTimezoneOffset() * 60_000,
    )
      .toISOString()
      .slice(0, 16);
    expect(q.releaseAt().value).toBe(local);
  });

  /* ---------------------------------------------------------------------- */
  /* Create mode still sends the date it was given                           */
  /* ---------------------------------------------------------------------- */

  it('sends the typed date on create and omits it when the box is empty', () => {
    openCreate();
    typeInto(q.title(), 'Week 2');
    submit();

    expect(api.createModule).toHaveBeenCalledWith({
      courseId: 'course-1',
      title: 'Week 2',
      description: undefined,
      releaseAt: undefined,
    });
  });
});
