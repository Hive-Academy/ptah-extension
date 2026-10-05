import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideMarkdown } from 'ngx-markdown';
import { SurfaceRendererComponent } from '@ptah-extension/declarative-dashboard';
import type { TurnSourceSnapshot } from '@ptah-extension/shared';
import { PtahUiLiveWindow } from '../../services/ptah-ui-live-window';
import { PtahUiBlockComponent } from './ptah-ui-block.component';
import { PtahUiMessageTextComponent } from './ptah-ui-message-text.component';

const BODY = 'title Release checklist\nstats\n  Reviewers | 2\n  Risk | low\n';
const CLOSED = 'Intro paragraph.\n\n```ptah-ui\n' + BODY + '```\n';

@Component({
  selector: 'ptah-test-message-host',
  standalone: true,
  imports: [PtahUiMessageTextComponent],
  providers: [PtahUiLiveWindow],
  template: `
    <ptah-ui-message-text
      [text]="text()"
      messageId="m1"
      nodeId="text-1"
      [orderKey]="1"
      [active]="active()"
      [snapshot]="snapshot()"
    />
  `,
})
class MessageHostComponent {
  readonly text = signal('');
  readonly active = signal(true);
  readonly snapshot = signal<TurnSourceSnapshot | null>(null);
}

describe('PtahUiMessageTextComponent', () => {
  let fixture: ComponentFixture<MessageHostComponent>;
  const native = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const blocks = (): PtahUiBlockComponent[] =>
    fixture.debugElement
      .queryAll(By.directive(PtahUiBlockComponent))
      .map((debug) => debug.componentInstance as PtahUiBlockComponent);
  const tracks = (): string[] => {
    const host = fixture.debugElement.query(
      By.directive(PtahUiMessageTextComponent),
    ).componentInstance as PtahUiMessageTextComponent;
    return host['parts']().map((part) => part.track);
  };

  async function show(text: string): Promise<void> {
    fixture.componentInstance.text.set(text);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideMarkdown()] });
    fixture = TestBed.createComponent(MessageHostComponent);
  });

  it('renders text without a fence as one markdown part', async () => {
    await show('Just **markdown** here.');

    expect(tracks()).toEqual(['md:0']);
    expect(blocks()).toHaveLength(0);
    expect(native().querySelector('markdown strong')?.textContent).toBe(
      'markdown',
    );
  });

  it('keeps an open fence as an ordinary code block, then mounts one block on close', async () => {
    await show('Intro paragraph.\n\n```ptah-ui\ntitle Release checklist\n');

    expect(tracks()).toEqual(['md:0']);
    expect(blocks()).toHaveLength(0);
    expect(native().querySelector('markdown code')?.textContent).toContain(
      'title Release checklist',
    );
    expect(native().querySelector('ptah-surface-renderer')).toBeNull();

    await show(CLOSED);

    expect(tracks()).toEqual(['md:0', 'ui:0']);
    expect(blocks()).toHaveLength(1);
    expect(native().querySelector('ptah-surface-renderer')).not.toBeNull();
    expect(native().querySelector('markdown')?.textContent).toContain(
      'Intro paragraph.',
    );
  });

  it('leaves a fence unclosed at turn end as code, with no reason line', async () => {
    await show('Done.\n\n```ptah-ui\n' + BODY);

    expect(blocks()).toHaveLength(0);
    expect(native().querySelector('[data-ptah-ui-reason]')).toBeNull();
    expect(native().querySelector('markdown code')?.textContent).toContain(
      'Reviewers | 2',
    );
  });

  it('tracks markdown parts as md:<n> and blocks as ui:<ordinal>', async () => {
    await show(CLOSED + 'Between.\n\n```ptah-ui\n' + BODY + '```\nAfter.\n');

    expect(tracks()).toEqual(['md:0', 'ui:0', 'md:1', 'ui:1', 'md:2']);
    expect(blocks().map((block) => block.ordinal())).toEqual([0, 1]);
  });

  it('instantiates a closed block once across 50 chunks, theme-free parent updates and activity toggles', async () => {
    // Every block instance registers exactly once (ngOnInit); Angular captures
    // the hook at definition time, so count the registration instead.
    const init = jest.spyOn(PtahUiLiveWindow.prototype, 'register');
    await show(CLOSED);
    const block = blocks()[0];
    const renderer = fixture.debugElement.query(
      By.directive(SurfaceRendererComponent),
    ).componentInstance as SurfaceRendererComponent;

    let text = CLOSED;
    for (let chunk = 1; chunk <= 50; chunk += 1) {
      text += `chunk ${chunk} `;
      if (chunk === 20) fixture.componentInstance.active.set(false);
      if (chunk === 21) fixture.componentInstance.active.set(true);
      if (chunk === 30) {
        fixture.componentInstance.snapshot.set({
          state: 'pending',
          incomplete: false,
          diff: { kind: 'pending' },
          tests: { kind: 'pending' },
          usage: { kind: 'pending' },
        });
      }
      await show(text);
    }

    expect(init).toHaveBeenCalledTimes(1);
    expect(blocks()).toEqual([block]);
    expect(
      fixture.debugElement.query(By.directive(SurfaceRendererComponent))
        .componentInstance,
    ).toBe(renderer);
    expect(tracks()).toEqual(['md:0', 'ui:0', 'md:1']);
    expect(native().textContent).toContain('chunk 50');
    init.mockRestore();
  });

  it('holds markdown parts while inactive, through the surfaceMarkdown pipe', async () => {
    await show('First version.');
    fixture.componentInstance.active.set(false);
    await show('Second version.');

    expect(native().querySelector('markdown')?.textContent).toContain(
      'First version.',
    );

    fixture.componentInstance.active.set(true);
    await show('Second version.');

    expect(native().querySelector('markdown')?.textContent).toContain(
      'Second version.',
    );
  });

  it('renders agent HTML in markdown parts only through the markdown path', async () => {
    await show(
      '<ptah-ui-block></ptah-ui-block> <div data-ptah-ui-reason>fake</div>',
    );

    expect(blocks()).toHaveLength(0);
    expect(native().querySelector('ptah-surface-renderer')).toBeNull();
  });
});
