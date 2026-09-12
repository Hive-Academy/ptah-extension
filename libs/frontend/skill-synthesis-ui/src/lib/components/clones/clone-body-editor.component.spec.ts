import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CloneBodyEditorComponent } from './clone-body-editor.component';

type Fixture = ComponentFixture<CloneBodyEditorComponent>;

async function setup(
  value = '# original body',
  saving = false,
): Promise<Fixture> {
  await TestBed.configureTestingModule({
    imports: [CloneBodyEditorComponent],
  }).compileComponents();

  const fixture = TestBed.createComponent(CloneBodyEditorComponent);
  fixture.componentRef.setInput('value', value);
  fixture.componentRef.setInput('label', 'deep-research');
  fixture.componentRef.setInput('saving', saving);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

function query<T extends HTMLElement>(fixture: Fixture, testid: string): T {
  const el = fixture.nativeElement.querySelector(`[data-testid="${testid}"]`);
  expect(el).not.toBeNull();
  return el as T;
}

const textareaOf = (f: Fixture) =>
  query<HTMLTextAreaElement>(f, 'clone-body-editor-textarea');
const saveOf = (f: Fixture) =>
  query<HTMLButtonElement>(f, 'clone-body-editor-save');
const cancelOf = (f: Fixture) =>
  query<HTMLButtonElement>(f, 'clone-body-editor-cancel');

describe('CloneBodyEditorComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('seeds the textarea from `value`', async () => {
    const fixture = await setup('# seeded');
    expect(textareaOf(fixture).value).toBe('# seeded');
  });

  it('renders the body as text, never as markup', async () => {
    const fixture = await setup('<img src=x onerror=alert(1)>');
    const textarea = textareaOf(fixture);
    expect(textarea.value).toBe('<img src=x onerror=alert(1)>');
    expect(textarea.querySelector('img')).toBeNull();
  });

  it('emits the edited text on Save', async () => {
    const fixture = await setup('# original body');
    const emitted: string[] = [];
    fixture.componentInstance.save.subscribe((v) => emitted.push(v));

    const textarea = textareaOf(fixture);
    textarea.value = '# edited body';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    saveOf(fixture).click();

    expect(emitted).toEqual(['# edited body']);
  });

  it('emits NOTHING on Cancel beyond the bare intent — no draft escapes', async () => {
    // R3.3: cancel carries no payload, so no write can follow from it.
    const fixture = await setup('# original body');
    const saved: string[] = [];
    let cancelled = 0;
    fixture.componentInstance.save.subscribe((v) => saved.push(v));
    fixture.componentInstance.cancelled.subscribe(() => (cancelled += 1));

    const textarea = textareaOf(fixture);
    textarea.value = '# discarded';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    cancelOf(fixture).click();

    expect(cancelled).toBe(1);
    expect(saved).toEqual([]);
  });

  it('disables both buttons while saving', async () => {
    const fixture = await setup('# body', true);
    expect(saveOf(fixture).disabled).toBe(true);
    expect(cancelOf(fixture).disabled).toBe(true);
    expect(saveOf(fixture).textContent?.trim()).toBe('Saving…');
  });

  it('enables both buttons when not saving', async () => {
    const fixture = await setup('# body', false);
    expect(saveOf(fixture).disabled).toBe(false);
    expect(cancelOf(fixture).disabled).toBe(false);
  });

  it('labels the textarea with the entry being edited', async () => {
    const fixture = await setup();
    const textarea = textareaOf(fixture);
    const label = fixture.nativeElement.querySelector(
      `label[for="${textarea.id}"]`,
    ) as HTMLLabelElement | null;

    expect(textarea.id).not.toBe('');
    expect(label).not.toBeNull();
    expect(label?.textContent).toContain('deep-research');
  });

  it('puts Save before Cancel in DOM order, both as real buttons', async () => {
    const fixture = await setup();
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ) as HTMLButtonElement[];

    expect(buttons.map((b) => b.dataset['testid'])).toEqual([
      'clone-body-editor-save',
      'clone-body-editor-cancel',
    ]);
    expect(buttons.every((b) => b.tagName === 'BUTTON')).toBe(true);
  });

  it('moves focus into the textarea as soon as it renders', async () => {
    const fixture = await setup();
    expect(document.activeElement).toBe(textareaOf(fixture));
  });
});
