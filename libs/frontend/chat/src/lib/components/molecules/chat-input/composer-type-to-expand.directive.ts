import {
  Directive,
  ElementRef,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import {
  SESSION_CONTEXT,
  SESSION_FOCUSED,
} from '../../../tokens/session-context.token';
import {
  isInTypingScope,
  isTypeToExpandKey,
  type ComposerTypingScope,
} from './composer-type-to-expand';

/**
 * Turns typing or pasting anywhere in the composer's chat view (or on the
 * session / tile wrapper that holds only this view) into an expand request
 * while the composer is folded. Put it on the composer root.
 *
 * The document listeners exist only while `ptahComposerTypeToExpand` is true
 * and are removed when it turns false or the host is destroyed. The keydown
 * listener never cancels the event: the owner moves focus to the textarea
 * synchronously and the browser's default action types the character there.
 */
@Directive({ selector: '[ptahComposerTypeToExpand]' })
export class ComposerTypeToExpandDirective {
  /** Listen only while true (the composer is folded). */
  readonly enabled = input(false, { alias: 'ptahComposerTypeToExpand' });

  /** A printable key was typed in scope; emitted inside the keydown. */
  readonly typeToExpand = output<KeyboardEvent>();
  /** A paste happened in scope; the owner decides what to insert. */
  readonly pasteToExpand = output<ClipboardEvent>();

  private readonly host: HTMLElement = inject(ElementRef<HTMLElement>)
    .nativeElement;
  private readonly document = inject(DOCUMENT);
  private readonly sessionContext = inject(SESSION_CONTEXT, {
    optional: true,
  });
  private readonly sessionFocused = inject(SESSION_FOCUSED, {
    optional: true,
  });

  constructor() {
    effect((onCleanup) => {
      if (!this.enabled()) return;
      const onKeydown = (event: KeyboardEvent): void => {
        if (isTypeToExpandKey(event, this.scope())) {
          this.typeToExpand.emit(event);
        }
      };
      const onPaste = (event: ClipboardEvent): void => {
        if (isInTypingScope(event.target, this.scope())) {
          this.pasteToExpand.emit(event);
        }
      };
      this.document.addEventListener('keydown', onKeydown);
      this.document.addEventListener('paste', onPaste);
      onCleanup(() => {
        this.document.removeEventListener('keydown', onKeydown);
        this.document.removeEventListener('paste', onPaste);
      });
    });
  }

  /**
   * The owning chat view (or the host when there is none). Keys typed with
   * nothing focused belong to the visible main panel, or to the focused
   * canvas tile, so a canvas of tiles never expands all at once.
   */
  private scope(): ComposerTypingScope {
    const visible = this.host.getClientRects().length > 0;
    return {
      view: this.host.closest('ptah-chat-view') ?? this.host,
      ownsDocumentFocus:
        visible &&
        (this.sessionContext ? (this.sessionFocused?.() ?? false) : true),
    };
  }
}
