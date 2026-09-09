import type { Locator, Page } from '@playwright/test';

export type SourceControlSection = 'Changed files' | 'Staged files';

/**
 * Resolve a source-control file button through the folder disclosures that own
 * it. File rows are intentionally absent from the accessibility tree while a
 * parent folder is collapsed, so callers must navigate the same controls a
 * user does before opening a diff.
 */
export async function sourceControlFileButton(
  page: Page,
  filePath: string,
  section: SourceControlSection = 'Changed files',
): Promise<Locator> {
  const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) {
    throw new Error(`Cannot resolve an empty source-control path: "${filePath}"`);
  }

  let list = page.getByRole('list', { name: section, exact: true });
  for (const folder of parts) {
    const toggle = list.getByRole('button', {
      name: `Toggle ${folder} folder`,
      exact: true,
    });
    await toggle.waitFor({ state: 'visible' });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
      await toggle.click();
    }
    list = toggle.locator('xpath=following-sibling::*[@role="list"][1]');
  }

  return list.getByRole('button', {
    name: `Open diff for ${fileName}`,
    exact: true,
  });
}
