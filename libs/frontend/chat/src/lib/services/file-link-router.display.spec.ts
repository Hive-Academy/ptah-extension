import { displayKindForPath } from './file-link-router.service';

describe('display file routing', () => {
  it.each([
    ['notes.md', 'markdown-file'],
    ['notes.markdown', 'markdown-file'],
    ['photo.png', 'image-file'],
    ['photo.JPG', 'image-file'],
    ['photo.jpeg', 'image-file'],
    ['photo.gif', 'image-file'],
    ['photo.webp', 'image-file'],
    ['photo.bmp', 'image-file'],
    ['report.pdf', 'pdf-file'],
    ['source.ts', null],
    ['icon.svg', null],
  ])('maps %s to %s', (path, kind) => {
    expect(displayKindForPath(path)).toBe(kind);
  });
});
