/**
 * Flattening for markdown rendered inside a tool-call body block
 * (`.tool-output-markdown`), shared by code-output and tool-input-display.
 *
 * The markdown code renderer (marked-extensions) wraps every fence in a
 * language header and, from 15 lines, a <details> with a "Collapse" summary,
 * inside a .code-block-container that the global stylesheet gives a 0.75em
 * margin and overflow: hidden. Inside a height-limited block those bars and
 * the margin took most of the box, so the first code row started inside the
 * fade and the block looked empty. They are hidden (the block's own row is the
 * one language label) and the wrappers flattened. The containment root the
 * pipe adds (.ptah-markdown-root) carries an inline overflow-x: auto, which
 * made it a second scroll container; its overflow is lifted here (its contain
 * and isolation stay), so the enclosing block is the only scroller.
 *
 * Light themes: the global Prism theme (prism-tomorrow, a dark theme) colours
 * tokens for a dark background, which left them at 1.3-2.2:1 on the light
 * block. Under the `data-theme-mode='light'` marker ThemeService sets on
 * <html> (every light theme, anubis-light included), tool-output tokens get a
 * GitHub-light-like palette, each at least 4.9:1 on white, #f2f2f2 and the
 * light base-300; plain code text and punctuation use base-content. Dark
 * themes keep the global Prism colours.
 */
export const TOOL_OUTPUT_MARKDOWN_STYLES = `
  :host ::ng-deep .tool-output-markdown {
    overflow-wrap: anywhere;
  }
  :host ::ng-deep .tool-output-markdown .ptah-markdown-root {
    overflow: visible !important;
  }
  :host ::ng-deep .tool-output-markdown .code-block-header,
  :host ::ng-deep .tool-output-markdown .code-block-toggle {
    display: none;
  }
  :host ::ng-deep .tool-output-markdown .code-block-container {
    margin: 0;
    border: 0;
    border-radius: 0;
    overflow: visible;
  }
  :host ::ng-deep .tool-output-markdown pre {
    margin: 0;
    padding: 0.5rem;
    border-radius: 0;
    background: transparent !important;
    overflow: visible;
  }
  :host ::ng-deep .tool-output-markdown pre,
  :host ::ng-deep .tool-output-markdown code {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  :host ::ng-deep .tool-output-markdown code {
    font-size: 11px;
    line-height: 1.4;
  }
  :host ::ng-deep .tool-output-markdown p {
    margin: 0.25rem 0;
    padding: 0 0.5rem;
    font-size: 11px;
  }
  :host ::ng-deep .tool-output-markdown table {
    table-layout: fixed;
    width: 100%;
  }
  :host-context([data-theme-mode='light'])
    ::ng-deep
    .tool-output-markdown
    :is(code[class*='language-'], pre[class*='language-'], .token.punctuation) {
    color: oklch(var(--bc));
  }
  :host-context([data-theme-mode='light'])
    ::ng-deep
    .tool-output-markdown
    :is(
      .token.comment,
      .token.block-comment,
      .token.prolog,
      .token.doctype,
      .token.cdata
    ) {
    color: #57606a;
  }
  :host-context([data-theme-mode='light'])
    ::ng-deep
    .tool-output-markdown
    :is(
      .token.property,
      .token.tag,
      .token.namespace,
      .token.boolean,
      .token.number,
      .token.constant,
      .token.symbol,
      .token.deleted
    ) {
    color: #0550ae;
  }
  :host-context([data-theme-mode='light'])
    ::ng-deep
    .tool-output-markdown
    :is(
      .token.selector,
      .token.attr-name,
      .token.string,
      .token.char,
      .token.builtin,
      .token.inserted
    ) {
    color: #0a3069;
  }
  :host-context([data-theme-mode='light'])
    ::ng-deep
    .tool-output-markdown
    :is(.token.operator, .token.entity, .token.url) {
    color: #116329;
  }
  :host-context([data-theme-mode='light'])
    ::ng-deep
    .tool-output-markdown
    :is(.token.atrule, .token.attr-value, .token.keyword) {
    color: #a40e26;
  }
  :host-context([data-theme-mode='light'])
    ::ng-deep
    .tool-output-markdown
    :is(.token.function, .token.function-name, .token.class-name) {
    color: #6639ba;
  }
  :host-context([data-theme-mode='light'])
    ::ng-deep
    .tool-output-markdown
    :is(.token.regex, .token.important, .token.variable) {
    color: #953800;
  }
`;
