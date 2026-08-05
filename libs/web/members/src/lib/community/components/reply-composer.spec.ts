import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';

import { provideMarkdownRendering } from '@ptah-extension/markdown';

import { ReplyComposer } from './reply-composer';

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReplyComposer],
  template: `<ptah-reply-composer
    [replyingTo]="replyingTo()"
    [nested]="nested()"
    [submitting]="submitting()"
    [errorMessage]="errorMessage()"
    (submitted)="emitted.push($event)"
    (cancelled)="cancelCount = cancelCount + 1"
  />`,
})
class HostComponent {
  public readonly replyingTo = signal<string | null>(null);
  public readonly nested = signal(false);
  public readonly submitting = signal(false);
  public readonly errorMessage = signal<string | null>(null);
  public readonly emitted: string[] = [];
  public cancelCount = 0;
}

function render(): ComponentFixture<HostComponent> {
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  return fixture;
}

function type(fixture: ComponentFixture<HostComponent>, value: string): void {
  const textarea: HTMLTextAreaElement =
    fixture.nativeElement.querySelector('textarea');
  textarea.value = value;
  textarea.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function button(
  fixture: ComponentFixture<HostComponent>,
  text: string,
): HTMLButtonElement {
  const found = Array.from<HTMLButtonElement>(
    fixture.nativeElement.querySelectorAll('button'),
  ).find((b) => b.textContent?.trim().startsWith(text));
  if (!found) throw new Error(`No button starting with "${text}"`);
  return found;
}

describe('ReplyComposer', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      // The `'member'` preset — the SAME providers `app.routes.ts` installs on
      // the `/members` route. Rendering the preview without them would prove
      // nothing about the path the browser actually takes.
      providers: [provideMarkdownRendering({ extensions: 'member' })],
    });
  });

  it('emits the raw markdown the member typed', () => {
    const fixture = render();
    type(fixture, '  A **reply**  ');
    button(fixture, 'Post reply').click();

    // Trimmed, but otherwise untouched — the stored value is raw markdown, and
    // any transformation here would be a second content representation.
    expect(fixture.componentInstance.emitted).toEqual(['A **reply**']);
  });

  it('will not submit an empty or whitespace-only body', () => {
    const fixture = render();
    expect(button(fixture, 'Post reply').disabled).toBe(true);

    type(fixture, '   ');
    expect(button(fixture, 'Post reply').disabled).toBe(true);
    expect(fixture.componentInstance.emitted).toEqual([]);
  });

  it('renders the preview through <ptah-markdown-block>, never innerHTML', () => {
    // ⚠️ NFR-S2. This is the assertion that keeps the preview on the ONE
    // sanitizer (PRE-4, AD-1). `markdown-chokepoint.spec.ts` polices the source
    // text; this proves the wiring at runtime.
    const fixture = render();
    type(fixture, '# Heading');
    button(fixture, 'Preview').click();
    fixture.detectChanges();

    const preview = fixture.nativeElement.querySelector(
      '[data-testid="reply-preview"]',
    );
    expect(preview).not.toBeNull();
    expect(preview.querySelector('ptah-markdown-block')).not.toBeNull();
  });

  it('passes variant="auto" so the preview survives light mode (NFR-U5)', () => {
    // The component default is `'invert'` — always light-on-dark — which puts
    // near-white body text on the near-white base-200 of operator-member-light.
    const fixture = render();
    type(fixture, 'body');
    button(fixture, 'Preview').click();
    fixture.detectChanges();

    const markdown = fixture.nativeElement.querySelector('markdown');
    expect(markdown.className).toContain('dark:prose-invert');
    expect(markdown.className).not.toBe(
      'prose prose-sm prose-invert max-w-none',
    );
  });

  it('cannot preview an empty draft', () => {
    expect(button(render(), 'Preview').disabled).toBe(true);
  });

  it('toggles back to the textarea from the preview', () => {
    const fixture = render();
    type(fixture, 'body');
    button(fixture, 'Preview').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('textarea')).toBeNull();

    button(fixture, 'Edit').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('textarea')).not.toBeNull();
  });

  it('shows a server-side failure the member has to see', () => {
    const fixture = render();
    fixture.componentInstance.errorMessage.set(
      'This thread is locked — no new replies.',
    );
    fixture.detectChanges();

    const alert = fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert.textContent).toContain('This thread is locked');
  });

  it('disables the controls while a post is in flight', () => {
    const fixture = render();
    type(fixture, 'body');
    fixture.componentInstance.submitting.set(true);
    fixture.detectChanges();

    expect(button(fixture, 'Posting…').disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('textarea').disabled).toBe(true);
  });

  it('emits `cancelled` without emitting a post', () => {
    const fixture = render();
    type(fixture, 'discard me');
    button(fixture, 'Cancel').click();

    expect(fixture.componentInstance.cancelCount).toBe(1);
    expect(fixture.componentInstance.emitted).toEqual([]);
  });

  it('names the author being replied to', () => {
    const fixture = render();
    fixture.componentInstance.replyingTo.set('Ada Lovelace');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Replying to');
    expect(fixture.nativeElement.textContent).toContain('Ada Lovelace');
  });

  it('labels its textarea, and the label points at THIS instance', () => {
    // Two composers are open at once whenever a member replies inline while the
    // top-level one is showing. A duplicated id sends both labels to the first
    // field, which is a real keyboard/screen-reader failure, not a lint nit.
    const fixture = render();
    const label: HTMLLabelElement =
      fixture.nativeElement.querySelector('label');
    const textarea: HTMLTextAreaElement =
      fixture.nativeElement.querySelector('textarea');

    expect(textarea.id).toBeTruthy();
    expect(label.getAttribute('for')).toBe(textarea.id);

    const second = render();
    expect(second.nativeElement.querySelector('textarea').id).not.toBe(
      textarea.id,
    );
  });
});
