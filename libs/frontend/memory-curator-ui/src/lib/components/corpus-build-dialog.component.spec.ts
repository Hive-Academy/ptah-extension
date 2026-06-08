import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { AppStateManager } from '@ptah-extension/core';

import { CorpusBuildDialogComponent } from './corpus-build-dialog.component';

describe('CorpusBuildDialogComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CorpusBuildDialogComponent],
      providers: [
        {
          provide: AppStateManager,
          useValue: {
            workspaceInfo: signal({
              name: 'w',
              path: '/ws',
              type: 'workspace',
            }),
          },
        },
      ],
    }).compileComponents();
  });

  it('disables Build until a name is entered', () => {
    const fixture = TestBed.createComponent(CorpusBuildDialogComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const buildBtn = Array.from(root.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === 'Build',
    ) as HTMLButtonElement | undefined;
    expect(buildBtn?.disabled).toBe(true);

    const nameInput = root.querySelector(
      'input[aria-label="Corpus name"]',
    ) as HTMLInputElement;
    nameInput.value = 'auth';
    nameInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(buildBtn?.disabled).toBe(false);
  });

  it('emits submit with assembled CorpusBuildParams including workspace scope', async () => {
    const fixture = TestBed.createComponent(CorpusBuildDialogComponent);
    fixture.detectChanges();

    let emitted: unknown = null;
    fixture.componentInstance.submitParams.subscribe((value) => {
      emitted = value;
    });

    const root = fixture.nativeElement as HTMLElement;
    const nameInput = root.querySelector(
      'input[aria-label="Corpus name"]',
    ) as HTMLInputElement;
    nameInput.value = 'auth';
    nameInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const conceptInput = root.querySelector(
      'input[aria-label="Comma-separated concepts"]',
    ) as HTMLInputElement;
    conceptInput.value = 'jwt, session';
    conceptInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const buildBtn = Array.from(root.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === 'Build',
    ) as HTMLButtonElement;
    buildBtn.click();
    fixture.detectChanges();

    expect(emitted).toEqual(
      expect.objectContaining({
        name: 'auth',
        workspaceRoot: '/ws',
        concepts: ['jwt', 'session'],
        limit: 100,
      }),
    );
  });

  it('emits cancel when Cancel is clicked', () => {
    const fixture = TestBed.createComponent(CorpusBuildDialogComponent);
    fixture.detectChanges();
    let cancelled = false;
    fixture.componentInstance.cancelDialog.subscribe(() => {
      cancelled = true;
    });

    const cancelBtn = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find(
      (b) => (b.textContent ?? '').trim() === 'Cancel',
    ) as HTMLButtonElement;
    cancelBtn.click();

    expect(cancelled).toBe(true);
  });

  it('omits workspaceRoot when "Scope to current workspace" is unchecked', () => {
    const fixture = TestBed.createComponent(CorpusBuildDialogComponent);
    fixture.detectChanges();

    let emitted: Record<string, unknown> | null = null;
    fixture.componentInstance.submitParams.subscribe((value) => {
      emitted = value as Record<string, unknown>;
    });

    const root = fixture.nativeElement as HTMLElement;
    const nameInput = root.querySelector(
      'input[aria-label="Corpus name"]',
    ) as HTMLInputElement;
    nameInput.value = 'global';
    nameInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const checkbox = root.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const buildBtn = Array.from(root.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === 'Build',
    ) as HTMLButtonElement;
    buildBtn.click();

    expect(emitted).not.toBeNull();
    expect((emitted as Record<string, unknown>).workspaceRoot).toBeUndefined();
  });
});
