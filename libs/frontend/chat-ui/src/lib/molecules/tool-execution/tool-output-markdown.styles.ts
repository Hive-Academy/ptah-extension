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
`;
