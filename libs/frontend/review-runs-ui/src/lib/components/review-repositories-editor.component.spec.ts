import { TestBed } from '@angular/core/testing';
import { ReviewRepositoriesEditorComponent } from './review-repositories-editor.component';

describe('ReviewRepositoriesEditorComponent', () => {
  it('allows live repositories to return to dry-run without credentials', () => {
    TestBed.configureTestingModule({ imports: [ReviewRepositoriesEditorComponent] });
    const fixture = TestBed.createComponent(ReviewRepositoriesEditorComponent);
    const repo = { owner: 'Hive-Academy', name: 'PtahCode', enabled: true,
      dryRun: false, publicationPaused: false };
    const settings = { repositories: [repo], maintainerLogins: [], pollMinutes: 10,
      globalPublicationPaused: false, laneCapPerPr: 6, confidenceFloor: 0.8,
      maxNewInline: 10, fallbackFamilies: [] };
    fixture.componentRef.setInput('draft', settings);
    fixture.componentRef.setInput('hasToken', false);
    fixture.componentRef.setInput('botConnected', false);
    fixture.detectChanges();
    const checkbox = fixture.nativeElement.querySelectorAll('input[type="checkbox"]')[1] as HTMLInputElement;
    expect(checkbox.disabled).toBe(false);
    fixture.componentRef.setInput('draft', { ...settings, repositories: [{ ...repo, dryRun: true }] });
    fixture.detectChanges();
    expect(checkbox.disabled).toBe(true);
  });
});
