/**
 * CodeMirror 6 setup for the spot editor.
 *
 * This module is the ONLY place that imports `@codemirror/*`, and
 * `SpotEditorComponent` reaches it through a dynamic `import()` only, so the
 * editor lands in its own lazy chunk and never in the webview's eager closure.
 * Each language's parser is a further lazy chunk, loaded through
 * `LanguageDescription.matchFilename` when a file of that language opens.
 */
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  HighlightStyle,
  LanguageDescription,
  defaultHighlightStyle,
  syntaxHighlighting,
} from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import {
  Compartment,
  EditorState,
  type Extension,
  type Text,
} from '@codemirror/state';
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';

export type LineSeparator = '\r\n' | '\n';

/**
 * The separator a document uses, chosen by majority. It is always set
 * explicitly on the state (A12): with an explicit `lineSeparator` CodeMirror
 * splits on that string only, so a stray separator of the other kind stays in
 * the line as text and the saved bytes match the loaded bytes exactly.
 */
export function detectLineSeparator(text: string): LineSeparator {
  let crlf = 0;
  let lf = 0;
  for (let index = text.indexOf('\n'); index !== -1; ) {
    if (index > 0 && text.endsWith('\r', index)) crlf++;
    else lf++;
    index = text.indexOf('\n', index + 1);
  }
  return crlf > lf ? '\r\n' : '\n';
}

export interface SpotEditorOptions {
  parent: HTMLElement;
  editable: boolean;
  dark: boolean;
  /** The buffer moved away from, or back to, the last loaded or saved text. */
  onModifiedChange: (modified: boolean) => void;
  /** Mod-S inside the editor. */
  onSaveRequest: () => void;
}

export interface SpotEditorHandle {
  /** Replace the document. Resets undo history and the saved baseline. */
  load(text: string, fileName: string, label: string): void;
  /** The document, joined with the separator it was loaded with. */
  text(): string;
  /** `savedText` (what reached disk) becomes the unmodified baseline. */
  markSaved(savedText: string): void;
  setEditable(editable: boolean): void;
  setDark(dark: boolean): void;
  /** Place the cursor at a 1-based line and column and centre it. */
  reveal(line: number, column: number): void;
  /** 1-based cursor position. */
  cursor(): { line: number; column: number };
  focus(): void;
  destroy(): void;
}

/**
 * `defaultHighlightStyle` is tuned for light backgrounds; its dark text
 * colours fail AA on `base-100` in dark themes. The dark style keeps every
 * tag rule and swaps each colour for a lighter one of the same hue.
 */
const DARK_COLOURS: Readonly<Record<string, string>> = {
  '#404740': '#a9b2a9',
  '#708': '#d595f2',
  '#219': '#94b4ff',
  '#164': '#7fdca0',
  '#a11': '#ff8f8f',
  '#e40': '#ffa36b',
  '#00f': '#82abff',
  '#30a': '#bca6ff',
  '#085': '#55d3ab',
  '#167': '#72cbd9',
  '#256': '#8cc3d7',
  '#00c': '#86acff',
  '#940': '#d8a75f',
  '#f00': '#ff7070',
};

let darkHighlightStyle: HighlightStyle | null = null;

function darkHighlight(): HighlightStyle {
  darkHighlightStyle ??= HighlightStyle.define(
    defaultHighlightStyle.specs.map((spec) =>
      typeof spec['color'] === 'string' && DARK_COLOURS[spec['color']]
        ? { ...spec, color: DARK_COLOURS[spec['color']] }
        : spec,
    ),
    { themeType: 'dark' },
  );
  return darkHighlightStyle;
}

/** Colours come from the active daisyUI theme, so light and dark both follow it. */
function themeExtension(dark: boolean): Extension {
  return [
    EditorView.theme(
      {
        '&': {
          height: '100%',
          fontSize: '12px',
          color: 'oklch(var(--bc))',
          backgroundColor: 'oklch(var(--b1))',
        },
        '&.cm-focused': {
          outline: '2px solid oklch(var(--p))',
          outlineOffset: '-2px',
        },
        '.cm-scroller': {
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
        },
        '.cm-content': { caretColor: 'oklch(var(--bc))' },
        '.cm-cursor, .cm-dropCursor': {
          borderLeftColor: 'oklch(var(--bc))',
        },
        '.cm-gutters': {
          backgroundColor: 'oklch(var(--b2))',
          color: 'oklch(var(--bc) / 0.75)',
          border: 'none',
        },
        '.cm-activeLine': { backgroundColor: 'oklch(var(--bc) / 0.07)' },
        '.cm-activeLineGutter': {
          backgroundColor: 'oklch(var(--bc) / 0.1)',
          color: 'oklch(var(--bc))',
        },
        '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
          { backgroundColor: 'oklch(var(--p) / 0.3)' },
      },
      { dark },
    ),
    syntaxHighlighting(dark ? darkHighlight() : defaultHighlightStyle),
  ];
}

function editableExtension(editable: boolean): Extension {
  return [EditorView.editable.of(editable), EditorState.readOnly.of(!editable)];
}

export function createSpotEditor(options: SpotEditorOptions): SpotEditorHandle {
  const editableSlot = new Compartment();
  const themeSlot = new Compartment();
  const languageSlot = new Compartment();
  let editable = options.editable;
  let dark = options.dark;
  let baseline: Text | null = null;
  let modified = false;
  /** Bumped per load so a slow language chunk never lands on a newer file. */
  let loadToken = 0;
  let destroyed = false;

  const setModified = (next: boolean): void => {
    if (next === modified) return;
    modified = next;
    options.onModifiedChange(next);
  };

  const view = new EditorView({ parent: options.parent });

  const stateFor = (
    text: string,
    separator: LineSeparator,
    label: string,
  ): EditorState =>
    EditorState.create({
      doc: text,
      extensions: [
        EditorState.lineSeparator.of(separator),
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        // Tab is deliberately left to the browser so keyboard users can leave
        // the editor; no `indentWithTab`.
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              options.onSaveRequest();
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.contentAttributes.of({ 'aria-label': label }),
        editableSlot.of(editableExtension(editable)),
        themeSlot.of(themeExtension(dark)),
        languageSlot.of([]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && baseline) {
            setModified(!update.state.doc.eq(baseline));
          }
        }),
      ],
    });

  return {
    load(text, fileName, label) {
      const token = ++loadToken;
      const state = stateFor(text, detectLineSeparator(text), label);
      view.setState(state);
      baseline = state.doc;
      setModified(false);
      const description = LanguageDescription.matchFilename(
        languages,
        fileName,
      );
      if (!description) return;
      description.load().then(
        (support) => {
          if (destroyed || token !== loadToken) return;
          view.dispatch({ effects: languageSlot.reconfigure(support) });
        },
        (error: unknown) => {
          // Highlighting is an enhancement: a language chunk that fails to
          // load leaves the file editable as plain text.
          console.warn('[SpotEditor] language failed to load', error);
        },
      );
    },
    text() {
      return view.state.sliceDoc();
    },
    markSaved(savedText) {
      // Typing may have continued while the save was in flight: the baseline
      // is what reached disk, not what the buffer holds now.
      baseline = view.state.toText(savedText);
      setModified(!view.state.doc.eq(baseline));
    },
    setEditable(next) {
      if (next === editable) return;
      editable = next;
      view.dispatch({
        effects: editableSlot.reconfigure(editableExtension(next)),
      });
    },
    setDark(next) {
      if (next === dark) return;
      dark = next;
      view.dispatch({ effects: themeSlot.reconfigure(themeExtension(next)) });
    },
    reveal(line, column) {
      const doc = view.state.doc;
      const target = doc.line(Math.min(Math.max(1, line), doc.lines));
      const position =
        target.from + Math.min(Math.max(0, column - 1), target.length);
      view.dispatch({
        selection: { anchor: position },
        effects: EditorView.scrollIntoView(position, { y: 'center' }),
      });
    },
    cursor() {
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      return { line: line.number, column: head - line.from + 1 };
    },
    focus() {
      view.focus();
    },
    destroy() {
      destroyed = true;
      view.destroy();
    },
  };
}
