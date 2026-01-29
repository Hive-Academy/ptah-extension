/**
 * Custom Marked v17 extensions for rich markdown rendering.
 *
 * 1. Callout Cards — transforms GitHub-style `> [!NOTE]` blockquotes into styled cards
 * 2. Code Block Header — adds language badge header to all code blocks, collapses 15+ line blocks
 * 3. Decorative Dividers — gold gradient hr with centered diamond ornament
 * 4. Enhanced Headings — gold dot for H1/H2, left-border accent for H3
 * 5. Step List — ordered lists rendered as step cards with numbered circles
 */
import { type MarkedExtension, type Tokens } from 'marked';

/* ==========================================================================
   Extension 1: Callout Cards (existing — unchanged)
   ========================================================================== */

/** Callout type metadata — titles only; icon is a CSS-styled dot that inherits the accent color */
const CALLOUT_TYPES: Record<string, { title: string }> = {
  NOTE: { title: 'Note' },
  TIP: { title: 'Tip' },
  WARNING: { title: 'Warning' },
  IMPORTANT: { title: 'Important' },
  CAUTION: { title: 'Caution' },
};

const CALLOUT_REGEX = /^\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]\s*/i;

/**
 * Callout Cards Extension
 *
 * Detects `> [!TYPE]` blockquotes and renders them as styled callout cards.
 * Uses walkTokens to tag blockquote tokens, then a custom renderer to wrap them.
 */
function createCalloutExtension(): MarkedExtension {
  return {
    walkTokens(token: Tokens.Generic) {
      if (token.type !== 'blockquote') return;

      const bq = token as Tokens.Blockquote;
      // Look at the first paragraph token inside the blockquote
      const firstChild = bq.tokens?.[0];
      if (!firstChild || firstChild.type !== 'paragraph') return;

      const para = firstChild as Tokens.Paragraph;
      const rawText = para.raw || para.text || '';
      const match = rawText.match(CALLOUT_REGEX);
      if (!match) return;

      const calloutType = match[1].toUpperCase();
      // Tag the blockquote token so the renderer can detect it
      (bq as unknown as Record<string, unknown>)['calloutType'] = calloutType;

      // Strip the [!TYPE] prefix from the paragraph text
      const prefix = match[0];
      if (para.raw) {
        para.raw = para.raw.replace(prefix, '');
      }
      if (para.text) {
        para.text = para.text.replace(prefix, '');
      }
      // Also strip from inline tokens if present
      if (para.tokens && para.tokens.length > 0) {
        const first = para.tokens[0];
        if (first.type === 'text' && 'text' in first) {
          (first as Tokens.Text).text = (first as Tokens.Text).text.replace(
            prefix,
            ''
          );
          if ('raw' in first) {
            (first as Tokens.Text).raw = (first as Tokens.Text).raw.replace(
              prefix,
              ''
            );
          }
        }
      }
    },
    renderer: {
      blockquote(this: unknown, token: Tokens.Blockquote): string | false {
        const calloutType = (token as unknown as Record<string, unknown>)[
          'calloutType'
        ] as string | undefined;
        if (!calloutType) return false; // Fall back to default renderer

        const meta = CALLOUT_TYPES[calloutType];
        if (!meta) return false;

        const typeLower = calloutType.toLowerCase();
        // Use the built-in parser to render inner content
        const body = (
          this as { parser: { parse: (tokens: Tokens.Generic[]) => string } }
        ).parser.parse(token.tokens);

        return `<div class="callout callout-${typeLower}">
  <div class="callout-header">
    <span class="callout-dot"></span>
    <span class="callout-title">${meta.title}</span>
  </div>
  <div class="callout-body">${body}</div>
</div>\n`;
      },
    },
  };
}

/* ==========================================================================
   Extension 2: Code Block Language Badge Header
   ========================================================================== */

/** Line count threshold for collapsing code blocks */
const COLLAPSE_LINE_THRESHOLD = 15;

/** Display-friendly language names (~30 entries) */
const LANG_DISPLAY_NAMES: Record<string, string> = {
  ts: 'TypeScript',
  typescript: 'TypeScript',
  js: 'JavaScript',
  javascript: 'JavaScript',
  jsx: 'JSX',
  tsx: 'TSX',
  py: 'Python',
  python: 'Python',
  rb: 'Ruby',
  ruby: 'Ruby',
  rs: 'Rust',
  rust: 'Rust',
  go: 'Go',
  java: 'Java',
  kt: 'Kotlin',
  kotlin: 'Kotlin',
  swift: 'Swift',
  cs: 'C#',
  csharp: 'C#',
  cpp: 'C++',
  c: 'C',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  sass: 'SASS',
  less: 'LESS',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  xml: 'XML',
  sql: 'SQL',
  sh: 'Shell',
  bash: 'Bash',
  zsh: 'Zsh',
  powershell: 'PowerShell',
  ps1: 'PowerShell',
  dockerfile: 'Dockerfile',
  docker: 'Docker',
  graphql: 'GraphQL',
  gql: 'GraphQL',
  md: 'Markdown',
  markdown: 'Markdown',
  toml: 'TOML',
  ini: 'INI',
  diff: 'Diff',
  php: 'PHP',
  lua: 'Lua',
  r: 'R',
  dart: 'Dart',
  scala: 'Scala',
  elixir: 'Elixir',
  ex: 'Elixir',
  clojure: 'Clojure',
  clj: 'Clojure',
  haskell: 'Haskell',
  hs: 'Haskell',
  vim: 'Vim',
  plaintext: 'Plain Text',
  text: 'Plain Text',
  txt: 'Plain Text',
};

/**
 * Code Block Header Extension
 *
 * Replaces the old collapsible-only code extension.
 * Every fenced code block gets a header bar with language badge.
 * Long blocks (15+ lines) also get a <details> collapse wrapper.
 */
function createCodeBlockHeaderExtension(): MarkedExtension {
  return {
    renderer: {
      code(this: unknown, token: Tokens.Code): string | false {
        const text = token.text || '';
        const lang = token.lang || '';
        const lineCount = text.split('\n').length;
        const escapedCode = escapeHtml(text);

        const displayLang = lang
          ? LANG_DISPLAY_NAMES[lang.toLowerCase()] || lang
          : '';
        const langBadge = displayLang
          ? `<span class="code-lang-badge">${escapeHtml(displayLang)}</span>`
          : '';
        const lineCountLabel =
          lineCount >= COLLAPSE_LINE_THRESHOLD
            ? `<span class="code-line-count">${lineCount} lines</span>`
            : '';

        const header = `<div class="code-block-header">${langBadge}${lineCountLabel}</div>`;
        const codeBlock = `<pre><code class="language-${escapeHtml(
          lang
        )}">${escapedCode}</code></pre>`;

        if (lineCount >= COLLAPSE_LINE_THRESHOLD) {
          return `<div class="code-block-container">
  ${header}
  <details class="code-block-collapsible" open>
    <summary class="code-block-toggle">Collapse</summary>
    ${codeBlock}
  </details>
</div>\n`;
        }

        return `<div class="code-block-container">
  ${header}
  ${codeBlock}
</div>\n`;
      },
    },
  };
}

/* ==========================================================================
   Extension 3: Decorative Dividers
   ========================================================================== */

/**
 * Decorative Divider Extension
 *
 * Overrides the `hr` renderer to produce a gold gradient line
 * with a centered diamond ornament.
 */
function createDecorativeDividerExtension(): MarkedExtension {
  return {
    renderer: {
      hr(): string {
        return `<div class="prose-divider" role="separator">
  <span class="prose-divider-ornament"></span>
</div>\n`;
      },
    },
  };
}

/* ==========================================================================
   Extension 4: Enhanced Headings
   ========================================================================== */

/**
 * Enhanced Headings Extension
 *
 * - H1, H2: Get a small gold dot before the text
 * - H3: Gets a left-border accent
 * - H4-H6: Fall through to default renderer
 */
function createEnhancedHeadingsExtension(): MarkedExtension {
  return {
    renderer: {
      heading(this: unknown, token: Tokens.Heading): string | false {
        const depth = token.depth;
        const text = (
          this as {
            parser: { parseInline: (tokens: Tokens.Generic[]) => string };
          }
        ).parser.parseInline(token.tokens);

        if (depth === 1 || depth === 2) {
          return `<h${depth} class="prose-heading-accented"><span class="prose-heading-dot"></span>${text}</h${depth}>\n`;
        }

        if (depth === 3) {
          return `<h3 class="prose-heading-bordered">${text}</h3>\n`;
        }

        // H4-H6: fall through to default renderer
        return false;
      },
    },
  };
}

/* ==========================================================================
   Extension 5: List Cards (Ordered + Unordered Lists)
   ========================================================================== */

/**
 * List Card Extension
 *
 * Wraps both ordered and unordered lists in a bordered card container.
 * Keeps default browser numbering/bullets — the card is purely a wrapper.
 * Nested lists inside cards are NOT re-wrapped.
 */
function createListCardExtension(): MarkedExtension {
  return {
    renderer: {
      list(this: unknown, token: Tokens.List): string | false {
        const body = (token.items as Tokens.ListItem[])
          .map((item) => {
            const content = (
              this as {
                parser: { parse: (tokens: Tokens.Generic[]) => string };
              }
            ).parser.parse(item.tokens);
            return `<li>${content}</li>`;
          })
          .join('\n');

        if (token.ordered) {
          const startAttr = token.start !== 1 ? ` start="${token.start}"` : '';
          return `<div class="prose-list-card"><ol${startAttr}>\n${body}\n</ol></div>\n`;
        }

        return `<div class="prose-list-card"><ul>\n${body}\n</ul></div>\n`;
      },
    },
  };
}

/* ==========================================================================
   Utilities
   ========================================================================== */

/** Simple HTML escaping for code content */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ==========================================================================
   Public API
   ========================================================================== */

/**
 * Returns all custom marked extensions for the Ptah webview.
 */
export function getMarkedExtensions(): MarkedExtension[] {
  return [
    createCalloutExtension(),
    createCodeBlockHeaderExtension(),
    createDecorativeDividerExtension(),
    createEnhancedHeadingsExtension(),
    createListCardExtension(),
  ];
}
