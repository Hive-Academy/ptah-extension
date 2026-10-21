import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ThemeService } from '@ptah-extension/core';
import type { ArtifactRecord } from '@ptah-extension/shared';
import type { ArtifactThemeMessage } from '@ptah-extension/shared/mcp-apps-contracts';
import {
  ArtifactViewerComponent,
  clampArtifactHeight,
} from './artifact-viewer.component';

/**
 * ArtifactViewerComponent specs (TASK_2026_710, batch 7). The bridge is
 * exercised through the component: a `load` event on the iframe attaches
 * it, and the specs read the live nonce back from the component's public
 * bridge field. jsdom never fetches the custom-scheme src, so no frame
 * content ever actually loads here — the bridge is driven by hand.
 */

/** A record whose viewerUrl passes the viewer's strict URL check. */
const RECORD: ArtifactRecord = {
  id: 'artifact-demo-1234567890',
  title: 'Quarterly report',
  revision: 1,
  sessionId: 'session-1',
  viewerUrl: 'ptah-artifact://artifact-demo-1234567890/index.html',
  createdAt: '2026-10-20T10:00:00Z',
};

/** The same session's second immutable revision, with its own URL. */
const SECOND_RECORD: ArtifactRecord = {
  ...RECORD,
  id: 'artifact-demo-1234567891',
  viewerUrl: 'ptah-artifact://artifact-demo-1234567891/index.html',
};

/** A wrong-but-schema-shaped nonce: same length, different characters. */
const WRONG_NONCE = 'w'.repeat(24);

function createViewer(
  record: ArtifactRecord = RECORD,
): ComponentFixture<ArtifactViewerComponent> {
  const fixture = TestBed.createComponent(ArtifactViewerComponent);
  fixture.componentRef.setInput('artifact', record);
  fixture.detectChanges();
  return fixture;
}

function frameOf(
  fixture: ComponentFixture<ArtifactViewerComponent>,
): HTMLIFrameElement {
  const frame = fixture.nativeElement.querySelector(
    'iframe',
  ) as HTMLIFrameElement | null;
  if (frame === null) throw new Error('viewer iframe not rendered');
  return frame;
}

/** Fire the frame's `load` so the bridge attaches and the channel opens. */
function loadedFrame(
  fixture: ComponentFixture<ArtifactViewerComponent>,
): HTMLIFrameElement {
  const frame = frameOf(fixture);
  frame.dispatchEvent(new Event('load'));
  fixture.detectChanges();
  return frame;
}

/** The live nonce after load; every bridge message must echo it. */
function nonceOf(
  fixture: ComponentFixture<ArtifactViewerComponent>,
): string {
  const nonce = fixture.componentInstance.bridge.nonce();
  if (nonce === null) throw new Error('bridge nonce missing after load');
  return nonce;
}

/**
 * One `window` message, by default from the frame's content window, then a
 * change detection so an accepted height lands in the DOM.
 */
function dispatchFrameMessage(
  fixture: ComponentFixture<ArtifactViewerComponent>,
  data: unknown,
  source?: Window,
): void {
  const frame = frameOf(fixture);
  window.dispatchEvent(
    new MessageEvent('message', {
      source: source ?? frame.contentWindow,
      data,
    }),
  );
  fixture.detectChanges();
}

describe('ArtifactViewerComponent', () => {
  let isDarkMode: ReturnType<typeof signal<boolean>>;

  beforeEach(async () => {
    isDarkMode = signal(false);
    await TestBed.configureTestingModule({
      imports: [ArtifactViewerComponent],
      providers: [
        {
          provide: ThemeService,
          useValue: { isDarkMode: isDarkMode.asReadonly() },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('frame markup', () => {
    it('renders exactly sandbox="allow-scripts", no-referrer and a title', () => {
      const frame = frameOf(createViewer());
      expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
      expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
      expect(frame.getAttribute('title')).toBe('Quarterly report artifact');
      expect(frame.getAttribute('src')).toBe(RECORD.viewerUrl);
    });

    it('starts the frame at the minimum height', () => {
      const frame = frameOf(createViewer());
      expect(frame.style.height).toBe(`${160}px`);
    });
  });

  describe('invalid viewerUrl', () => {
    it.each([
      'https://evil.example/index.html',
      'ptah-artifact://UPPERCASE1234567890/index.html',
      'ptah-artifact://artifact-demo-1234567890/index.html?x=1',
      'about:blank',
    ])('shows an accessible error and renders no iframe for %s', (viewerUrl) => {
      const fixture = createViewer({ ...RECORD, viewerUrl });
      const error = fixture.nativeElement.querySelector(
        '[data-testid="artifact-viewer-error"]',
      );
      expect(error).not.toBeNull();
      expect(error.getAttribute('role')).toBe('alert');
      expect(error.textContent).toContain(RECORD.title);
      expect(fixture.nativeElement.querySelector('iframe')).toBeNull();
    });
  });

  describe('incoming bridge messages', () => {
    it('rejects messages whose source is not the frame content window', () => {
      const fixture = createViewer();
      const frame = loadedFrame(fixture);
      dispatchFrameMessage(
        fixture,
        { type: 'height', px: 400, nonce: nonceOf(fixture) },
        window,
      );
      expect(frame.style.height).toBe(`${160}px`);
    });

    it('rejects messages with a wrong nonce', () => {
      const fixture = createViewer();
      const frame = loadedFrame(fixture);
      dispatchFrameMessage(fixture, {
        type: 'height',
        px: 400,
        nonce: WRONG_NONCE,
      });
      expect(frame.style.height).toBe(`${160}px`);
    });

    it('rejects payloads that fail the schema', () => {
      const fixture = createViewer();
      const frame = loadedFrame(fixture);
      const nonce = nonceOf(fixture);
      dispatchFrameMessage(fixture, { type: 'height', px: 'tall', nonce });
      dispatchFrameMessage(fixture, { type: 'open-link', url: 5, nonce });
      dispatchFrameMessage(fixture, { type: 'close', nonce });
      dispatchFrameMessage(fixture, 'not-an-object');
      expect(frame.style.height).toBe(`${160}px`);
    });

    it('applies a schema-valid height message to the frame height', () => {
      const fixture = createViewer();
      const frame = loadedFrame(fixture);
      dispatchFrameMessage(fixture, {
        type: 'height',
        px: 320,
        nonce: nonceOf(fixture),
      });
      expect(frame.style.height).toBe(`${320}px`);
    });

    it('ignores a second height change inside the 100 ms throttle window', () => {
      const fixture = createViewer();
      const frame = loadedFrame(fixture);
      const nonce = nonceOf(fixture);
      dispatchFrameMessage(fixture, { type: 'height', px: 320, nonce });
      dispatchFrameMessage(fixture, { type: 'height', px: 480, nonce });
      expect(frame.style.height).toBe(`${320}px`);
    });

    it('emits openExternal only for http(s) open-link messages', () => {
      const fixture = createViewer();
      loadedFrame(fixture);
      const nonce = nonceOf(fixture);
      const opened: string[] = [];
      fixture.componentInstance.openExternal.subscribe((url) =>
        opened.push(url),
      );
      dispatchFrameMessage(fixture, {
        type: 'open-link',
        url: 'javascript:alert(1)',
        nonce,
      });
      dispatchFrameMessage(fixture, {
        type: 'open-link',
        url: 'ftp://example.com/file',
        nonce,
      });
      expect(opened).toEqual([]);
      dispatchFrameMessage(fixture, {
        type: 'open-link',
        url: 'https://example.com/report',
        nonce,
      });
      expect(opened).toEqual(['https://example.com/report']);
    });

    it('clamps reported heights into the fixed window', () => {
      expect(clampArtifactHeight(5_000)).toBe(1_600);
      expect(clampArtifactHeight(50)).toBe(160);
      expect(clampArtifactHeight(320)).toBe(320);
    });
  });

  describe('lifecycle and staleness', () => {
    it('offers Retry after load timeout and re-arms the frame', () => {
      jest.useFakeTimers();
      try {
        const fixture = createViewer();
        jest.advanceTimersByTime(10_001);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('iframe')).toBeNull();
        const retry = fixture.nativeElement.querySelector('[data-testid="artifact-viewer-error"] button') as HTMLButtonElement;
        retry.click();
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('iframe')).not.toBeNull();
        fixture.destroy();
      } finally { jest.useRealTimers(); }
    });
    it('removes the window message listener on destroy', () => {
      const fixture = createViewer();
      const frame = loadedFrame(fixture);
      const nonce = nonceOf(fixture);
      const removeSpy = jest.spyOn(window, 'removeEventListener');
      fixture.destroy();
      expect(removeSpy).toHaveBeenCalledWith('message', expect.any(Function));
      window.dispatchEvent(
        new MessageEvent('message', {
          source: frame.contentWindow,
          data: { type: 'height', px: 320, nonce },
        }),
      );
      expect(frame.style.height).toBe(`${160}px`);
    });

    it('drops the nonce and the listener when the record (src) changes', () => {
      const fixture = createViewer();
      const frame = loadedFrame(fixture);
      const nonce = nonceOf(fixture);
      const removeSpy = jest.spyOn(window, 'removeEventListener');
      fixture.componentRef.setInput('artifact', SECOND_RECORD);
      fixture.detectChanges();
      expect(removeSpy).toHaveBeenCalledWith('message', expect.any(Function));
      expect(fixture.componentInstance.bridge.nonce()).toBeNull();
      // A stale frame message with the old nonce has nothing to match now.
      window.dispatchEvent(
        new MessageEvent('message', {
          source: frame.contentWindow,
          data: { type: 'height', px: 320, nonce },
        }),
      );
      expect(frame.style.height).toBe(`${160}px`);
    });
  });

  describe('theme bridge', () => {
    it('omits overlong theme values and still sends the other tokens', () => {
      document.documentElement.style.setProperty('--b1', 'x'.repeat(201));
      document.documentElement.style.setProperty('--b2', 'short');
      try {
        const fixture = createViewer();
        const target = frameOf(fixture).contentWindow;
        if (target === null) throw new Error('frame has no content window');
        const sent = jest.spyOn(target, 'postMessage');
        loadedFrame(fixture);
        const message = sent.mock.calls[0][0] as ArtifactThemeMessage;
        expect(message.vars['--b1']).toBeUndefined();
        expect(message.vars['--b2']).toBe('short');
        fixture.destroy();
      } finally {
        document.documentElement.style.removeProperty('--b1');
        document.documentElement.style.removeProperty('--b2');
      }
    });
    it('sends the theme tokens on load and re-sends on a theme change', () => {
      const fixture = createViewer();
      const frame = frameOf(fixture);
      const contentWindow = frame.contentWindow;
      if (contentWindow === null) throw new Error('frame has no content window');
      const postSpy = jest.spyOn(contentWindow, 'postMessage');
      frame.dispatchEvent(new Event('load'));
      fixture.detectChanges();
      const first = postSpy.mock.calls[0][0] as ArtifactThemeMessage;
      expect(first.type).toBe('theme');
      expect(first.mode).toBe('light');
      expect(first.nonce).toHaveLength(24);
      isDarkMode.set(true);
      fixture.detectChanges();
      expect(postSpy).toHaveBeenCalledTimes(2);
      const second = postSpy.mock.calls[1][0] as ArtifactThemeMessage;
      expect(second.mode).toBe('dark');
      expect(second.nonce).toBe(first.nonce);
    });
  });

  describe('full screen', () => {
    it('lets the frame fill the overlay and restores the reported height on exit', () => {
      const fixture = createViewer();
      const frame = loadedFrame(fixture);
      const button = fixture.nativeElement.querySelector('[data-testid="artifact-viewer-fullscreen-toggle"]') as HTMLButtonElement;
      button.click();
      fixture.detectChanges();
      expect(frame.style.height).toBe('');
      expect(frame.classList).toContain('flex-1');
      button.click();
      fixture.detectChanges();
      expect(frame.style.height).toBe(`${160}px`);
      expect(frame.classList).not.toContain('flex-1');
      fixture.destroy();
    });
    it('claims Escape in capture before an enclosing sheet sees it', () => {
      const fixture = createViewer();
      loadedFrame(fixture);
      const button = fixture.nativeElement.querySelector('[data-testid="artifact-viewer-fullscreen-toggle"]') as HTMLButtonElement;
      button.click();
      fixture.detectChanges();
      const parent = fixture.nativeElement as HTMLElement;
      const escaped = jest.fn();
      parent.addEventListener('keydown', escaped);
      button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      fixture.detectChanges();
      expect(escaped).not.toHaveBeenCalled();
      expect(parent.querySelector('[role="dialog"]')).toBeNull();
      fixture.destroy();
    });
    it('toggles a dialog overlay, closes on Escape and restores focus', () => {
      const fixture = createViewer();
      loadedFrame(fixture);
      const button = fixture.nativeElement.querySelector(
        '[data-testid="artifact-viewer-fullscreen-toggle"]',
      ) as HTMLButtonElement;
      const states: boolean[] = [];
      fixture.componentInstance.fullscreenChange.subscribe((value) =>
        states.push(value),
      );
      button.focus();
      button.click();
      fixture.detectChanges();
      const overlay = fixture.nativeElement.querySelector(
        '[data-testid="artifact-viewer"]',
      );
      expect(overlay.getAttribute('role')).toBe('dialog');
      expect(overlay.getAttribute('aria-modal')).toBe('true');
      expect(states).toEqual([true]);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      fixture.detectChanges();
      expect(states).toEqual([true, false]);
      expect(
        fixture.nativeElement
          .querySelector('[data-testid="artifact-viewer"]')
          .getAttribute('role'),
      ).toBeNull();
      expect(document.activeElement).toBe(button);
    });
  });
});
