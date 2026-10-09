import { analyzedWorkspaceRoot } from './prompt-enhancement.component';

describe('analyzedWorkspaceRoot', () => {
  it('is the workspace the analysis directory belongs to, whatever is active', () => {
    expect(
      analyzedWorkspaceRoot(
        '/ws/project-a/.ptah/analysis/acme',
        '/ws/project-b',
      ),
    ).toBe('/ws/project-a');
  });

  it('understands Windows separators and a trailing separator', () => {
    expect(
      analyzedWorkspaceRoot(
        String.raw`D:\repo\app\.ptah\analysis\acme\ `.trim(),
        null,
      ),
    ).toBe(String.raw`D:\repo\app`);
  });

  it('falls back to the active workspace, then to "."', () => {
    expect(analyzedWorkspaceRoot(undefined, '/ws/project-b')).toBe(
      '/ws/project-b',
    );
    expect(analyzedWorkspaceRoot('/somewhere/else', null)).toBe('.');
  });
});
