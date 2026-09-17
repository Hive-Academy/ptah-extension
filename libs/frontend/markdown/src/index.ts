export { MarkdownBlockComponent } from './lib/markdown-block.component';
export { provideMarkdownRendering } from './lib/provide-markdown-rendering';
export type { MarkdownRenderingConfig } from './lib/provide-markdown-rendering';
export { getMarkedExtensions } from './lib/marked-extensions';
export {
  parseFileLinkHref,
  type MarkdownFileLinkTarget,
} from './lib/file-link-target';
export {
  MARKDOWN_FILE_LINK_HANDLER,
  MARKDOWN_FILE_LINKS_OPT_IN_ATTR,
  provideMarkdownFileLinks,
  type MarkdownFileLinkHandler,
} from './lib/markdown-file-links';
