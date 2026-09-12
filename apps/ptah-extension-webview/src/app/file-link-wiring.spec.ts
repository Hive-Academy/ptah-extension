/**
 * Composition-root gate for the agent file-link path (TASK_2026_413, 8c-2.5).
 *
 * Two independent entry points — the tool-call `FilePathLinkComponent` /
 * tasks board (`FILE_LINK_OPENER`) and the markdown document listener
 * (`MARKDOWN_FILE_LINK_HANDLER`) — must land on ONE router. If a future edit
 * turns either binding into `useClass`, both still resolve and every unit spec
 * still passes, but the two instances hold separate git-ui module caches and a
 * link could resolve its workspace differently depending on where it was
 * clicked. The identity assertion below is what catches that.
 *
 * It also pins that `provideMarkdownFileLinks()` installs exactly one capture
 * listener pair, because the listener is document-level and a duplicate would
 * route every click twice.
 *
 * The spec wires the SAME provider expressions `app.config.ts` uses, imported
 * through the SAME specifiers, rather than bootstrapping the whole app.
 */
import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FILE_LINK_OPENER, VSCodeService } from '@ptah-extension/core';
import {
  FileLinkRouterService,
  provideModelRefreshControl,
} from '@ptah-extension/chat';
import {
  MARKDOWN_FILE_LINK_HANDLER,
  provideMarkdownFileLinks,
} from '@ptah-extension/markdown';

describe('file-link composition wiring', () => {
  let addEventListener: jest.SpyInstance;

  beforeEach(() => {
    TestBed.resetTestingModule();
    addEventListener = jest.spyOn(document, 'addEventListener');
    TestBed.configureTestingModule({
      providers: [
        {
          provide: VSCodeService,
          useValue: {
            isElectron: false,
            config: () => ({ workspaceRoot: '' }),
          },
        },
        // `FileLinkRouterService` reaches `TabManagerService`, which injects
        // the inverted-dependency `MODEL_REFRESH_CONTROL` token. `app.config.ts`
        // binds it with this exact helper, so the spec uses the same one —
        // same precedent as `thoth-message-routing.spec.ts`.
        provideModelRefreshControl(),
        // Verbatim from `app.config.ts`.
        { provide: FILE_LINK_OPENER, useExisting: FileLinkRouterService },
        {
          provide: MARKDOWN_FILE_LINK_HANDLER,
          useExisting: FileLinkRouterService,
        },
        provideMarkdownFileLinks(),
      ],
    });
  });

  afterEach(() => {
    addEventListener.mockRestore();
  });

  it('resolves both ports to the SAME router instance', () => {
    const opener = TestBed.inject(FILE_LINK_OPENER);
    const handler = TestBed.inject(MARKDOWN_FILE_LINK_HANDLER);

    expect(opener).toBeInstanceOf(FileLinkRouterService);
    expect(handler).toBe(opener);
  });

  it('installs exactly one capture listener per event type', () => {
    // The environment initializer runs on first injection from this injector.
    TestBed.inject(DOCUMENT);
    TestBed.inject(FILE_LINK_OPENER);

    const captureCalls = (type: string) =>
      addEventListener.mock.calls.filter(
        ([name, , capture]) => name === type && capture === true,
      );

    expect(captureCalls('click')).toHaveLength(1);
    expect(captureCalls('auxclick')).toHaveLength(1);
  });
});
