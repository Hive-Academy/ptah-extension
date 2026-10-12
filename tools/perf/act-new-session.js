// Open a fresh named session through the New Session dialog.
// Usage as a module: await require('./act-new-session')(page, 'name')
module.exports = async (page, name) => {
  await page.getByRole('button', { name: 'New Session' }).first().click();
  const input = page.getByPlaceholder('Enter session name (optional)');
  await input.waitFor({ timeout: 5000 });
  await input.fill(name);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page
    .locator('ptah-canvas-tile')
    .filter({ hasText: name })
    .first()
    .waitFor({ timeout: 10000 });
};
