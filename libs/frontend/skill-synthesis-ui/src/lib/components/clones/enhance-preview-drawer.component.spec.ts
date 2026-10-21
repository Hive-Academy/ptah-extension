import { TestBed } from '@angular/core/testing';

import { EnhancePreviewDrawerComponent } from './enhance-preview-drawer.component';

describe('EnhancePreviewDrawerComponent', () => {
  const preview = {
    proposed: true,
    skipReason: null,
    currentBody: 'before',
    proposedBody: 'after',
    judgeScore: 8,
    judgeReason: null,
    proposalId: null,
    draft: {
      before: 'before',
      after: 'after',
      diff: 'diff',
      evidence: { trajectory: '', findings: '', scorecard: '' },
      model: 'test',
      sourceHash: `sha256:${'a'.repeat(64)}`,
    },
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [EnhancePreviewDrawerComponent],
    });
  });

  function drawer() {
    const fixture = TestBed.createComponent(EnhancePreviewDrawerComponent);
    fixture.componentRef.setInput('clone', { kind: 'agent', slug: 'reviewer' });
    fixture.componentRef.setInput('preview', preview);
    fixture.detectChanges();
    return fixture;
  }

  it('renders a draft without saving and emits its body and source hash on Save', () => {
    const fixture = drawer();
    const onSave = jest.fn();
    fixture.componentInstance.save.subscribe(onSave);
    expect(onSave).not.toHaveBeenCalled();

    const button = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="preview-save-btn"]');
    expect(button).not.toBeNull();
    button?.click();
    expect(onSave).toHaveBeenCalledWith({
      body: 'after',
      expectedSourceHash: preview.draft.sourceHash,
    });
  });

  it('keeps the draft visible when the parent reports a stale save refusal', () => {
    const fixture = drawer();
    fixture.componentRef.setInput(
      'error',
      'This clone changed since the draft was created. Preview it again before saving.',
    );
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('[data-testid="preview-save-error"]')?.textContent,
    ).toContain('Preview it again');
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('[data-testid="preview-verdict"]'),
    ).not.toBeNull();
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector<HTMLButtonElement>('[data-testid="preview-save-btn"]')?.disabled,
    ).toBe(false);
  });
});
