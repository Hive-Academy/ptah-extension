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

function maybe<T extends HTMLElement>(
  fixture: Fixture,
  testid: string,
): T | null {
  return fixture.nativeElement.querySelector(
    `[data-testid="${testid}"]`,
  ) as T | null;
}

/** Type into the textarea the way the user does — through the DOM. */
function type(fixture: Fixture, text: string): void {
  const textarea = textareaOf(fixture);
  textarea.value = text;
  textarea.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

/** A background body change landing on the open editor. */
async function incomingBody(fixture: Fixture, body: string): Promise<void> {
  fixture.componentRef.setInput('value', body);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
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

  describe('draft ownership against a background body change', () => {
    it('KEEPS the typed text when the stored body changes underneath', async () => {
      // The regression: applying an enhancement proposal to the open entry
      // reloads the detail, `value` changes, and the draft used to re-seed from
      // it — throwing away everything the user had typed, with no prompt.
      const fixture = await setup('# original body');
      type(fixture, '# my unsaved work');

      await incomingBody(fixture, '# rewritten by the enhancement');

      expect(textareaOf(fixture).value).toBe('# my unsaved work');
    });

    it('TELLS the user the stored body moved, and keeps Save available', async () => {
      const fixture = await setup('# original body');
      type(fixture, '# my unsaved work');
      await incomingBody(fixture, '# rewritten by the enhancement');

      const conflict = query(fixture, 'clone-body-editor-conflict');
      expect(conflict.getAttribute('role')).toBe('alert');
      expect(conflict.textContent).toContain('changed while you were editing');
      expect(saveOf(fixture).disabled).toBe(false);
      expect(saveOf(fixture).getAttribute('aria-describedby')).toBe(
        conflict.id,
      );
    });

    it('adopts a new stored body while the draft is untouched', async () => {
      // The deliberate case the re-seed existed for.
      const fixture = await setup('# original body');
      await incomingBody(fixture, '# reloaded after a save');

      expect(textareaOf(fixture).value).toBe('# reloaded after a save');
      expect(maybe(fixture, 'clone-body-editor-conflict')).toBeNull();
    });

    it('reports no conflict when the reload is the user’s own text landing', async () => {
      const fixture = await setup('# original body');
      type(fixture, '# my text');
      await incomingBody(fixture, '# my text');

      expect(textareaOf(fixture).value).toBe('# my text');
      expect(maybe(fixture, 'clone-body-editor-conflict')).toBeNull();
    });

    it('emits the user’s text, not the incoming body, when they Save through it', async () => {
      const fixture = await setup('# original body');
      const emitted: string[] = [];
      fixture.componentInstance.save.subscribe((v) => emitted.push(v));

      type(fixture, '# my unsaved work');
      await incomingBody(fixture, '# rewritten by the enhancement');
      saveOf(fixture).click();

      expect(emitted).toEqual(['# my unsaved work']);
    });
  });

  describe('empty draft', () => {
    it('disables Save on an emptied draft and states why in plain language', async () => {
      // The schema's `.min(1)` is deliberate — an emptied clone is mirrored
      // outward as an empty skill — but its refusal reads
      // `Invalid parameters for skillSynthesis:saveCloneBody`. The floor is
      // mirrored here so that message is never reached.
      const fixture = await setup('# original body');
      type(fixture, '');

      const save = saveOf(fixture);
      const reason = query(fixture, 'clone-body-editor-empty-reason');
      expect(save.disabled).toBe(true);
      expect(reason.getAttribute('role')).toBe('status');
      expect(reason.textContent).toContain('cannot be emptied');
      expect(save.getAttribute('aria-describedby')).toBe(reason.id);
    });

    it('treats a whitespace-only draft as empty', async () => {
      const fixture = await setup('# original body');
      type(fixture, '   \n\t ');
      expect(saveOf(fixture).disabled).toBe(true);
    });

    it('emits NOTHING when Save is activated on an empty draft', async () => {
      const fixture = await setup('# original body');
      const emitted: string[] = [];
      fixture.componentInstance.save.subscribe((v) => emitted.push(v));

      type(fixture, '');
      saveOf(fixture).click();

      expect(emitted).toEqual([]);
    });

    it('re-enables Save, and drops the reason, once text returns', async () => {
      const fixture = await setup('# original body');
      type(fixture, '');
      type(fixture, '# back');

      expect(saveOf(fixture).disabled).toBe(false);
      expect(maybe(fixture, 'clone-body-editor-empty-reason')).toBeNull();
      expect(saveOf(fixture).getAttribute('aria-describedby')).toBeNull();
    });

    it('never offers Save on an entry that arrived empty', async () => {
      const fixture = await setup('');
      expect(saveOf(fixture).disabled).toBe(true);
      expect(query(fixture, 'clone-body-editor-empty-reason')).not.toBeNull();
    });
  });
});
