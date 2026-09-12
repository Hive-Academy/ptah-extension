import {
  DOCUMENT,
  DestroyRef,
  InjectionToken,
  inject,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
} from '@angular/core';
import {
  MARKDOWN_FILE_HREF_ATTR,
  parseFileLinkHref,
  type MarkdownFileLinkTarget,
} from './file-link-target';

/**
 * Opt-in marker for file-link capture.
 *
 * A click on a file link is intercepted only when an ANCESTOR OF THE
 * `<markdown>` HOST carries this attribute. The lookup starts at the host's
 * parent, so a marker inside rendered content, or on the host itself, never
 * opts a surface in. The permissive sanitizer also strips the attribute from
 * rendered content. Put it only on containers that render agent output, as an
 * Angular host binding.
 */
export const MARKDOWN_FILE_LINKS_OPT_IN_ATTR = 'data-ptah-file-links';

/** Receives a click on a file link inside an opted-in markdown surface. */
export interface MarkdownFileLinkHandler {
  handleMarkdownFileLink(
    target: MarkdownFileLinkTarget,
    anchor: HTMLAnchorElement,
  ): void | Promise<void>;
}

/**
 * Markdown-owned port for the file-link click handler. No default provider:
 * the composition root binds it.
 */
export const MARKDOWN_FILE_LINK_HANDLER =
  new InjectionToken<MarkdownFileLinkHandler>('MARKDOWN_FILE_LINK_HANDLER');

const MARKDOWN_HOST_SELECTOR = 'markdown, [markdown]';
const CODE_SELECTOR = 'pre, code';
const OPT_IN_SELECTOR = `[${MARKDOWN_FILE_LINKS_OPT_IN_ATTR}]`;
const LOG_PREFIX = '[MarkdownFileLinks]';

interface InstalledListener {
  holders: number;
  readonly remove: () => void;
}

/**
 * One listener pair per `Document`, however many injectors install it. The
 * first installer's handler serves every click; the listeners are removed when
 * the last installer is destroyed.
 */
const installedListeners = new WeakMap<Document, InstalledListener>();

/**
 * Installs one document-level capture listener for `click` and one for
 * `auxclick` that routes file links in opted-in markdown surfaces to
 * {@link MARKDOWN_FILE_LINK_HANDLER}.
 *
 * Delegation is at the document, not on rendered nodes, so a streaming
 * re-render that replaces the markdown HTML keeps interception without adding
 * listeners.
 */
export function provideMarkdownFileLinks(): EnvironmentProviders {
  return provideEnvironmentInitializer(() => {
    const release = installFileLinkListener(
      inject(DOCUMENT),
      inject(MARKDOWN_FILE_LINK_HANDLER),
    );
    inject(DestroyRef).onDestroy(release);
  });
}

function installFileLinkListener(
  document: Document,
  handler: MarkdownFileLinkHandler,
): () => void {
  let installed = installedListeners.get(document);
  if (!installed) {
    const listener = (event: MouseEvent): void =>
      interceptFileLinkActivation(event, handler);
    document.addEventListener('click', listener, true);
    document.addEventListener('auxclick', listener, true);
    installed = {
      holders: 0,
      remove: () => {
        document.removeEventListener('click', listener, true);
        document.removeEventListener('auxclick', listener, true);
        installedListeners.delete(document);
      },
    };
    installedListeners.set(document, installed);
  }

  const entry = installed;
  entry.holders += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    entry.holders -= 1;
    if (entry.holders === 0) entry.remove();
  };
}

function interceptFileLinkActivation(
  event: MouseEvent,
  handler: MarkdownFileLinkHandler,
): void {
  // 0 = primary (also keyboard Enter), 1 = middle. Right-click keeps its menu.
  if (event.button > 1) return;

  const anchor = anchorFrom(event.target);
  if (!anchor) return;

  const host = anchor.closest(MARKDOWN_HOST_SELECTOR);
  if (!host?.parentElement?.closest(OPT_IN_SELECTOR)) return;

  const codeAncestor = anchor.closest(CODE_SELECTOR);
  if (codeAncestor && host.contains(codeAncestor)) return;

  const target = parseFileLinkHref(
    anchor.getAttribute(MARKDOWN_FILE_HREF_ATTR) ?? anchor.getAttribute('href'),
  );
  if (!target) return;

  // Prevented before the handler runs, so a handler failure still never
  // navigates. Propagation is left alone.
  event.preventDefault();
  try {
    const pending = handler.handleMarkdownFileLink(target, anchor);
    if (pending instanceof Promise) void pending.catch(reportHandlerFailure);
  } catch (error: unknown) {
    reportHandlerFailure(error);
  }
}

function anchorFrom(target: EventTarget | null): HTMLAnchorElement | null {
  const node = target as Node | null;
  if (!node) return null;
  const element =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;
  return element?.closest('a') ?? null;
}

function reportHandlerFailure(error: unknown): void {
  console.error(`${LOG_PREFIX} File link handler failed`, error);
}
