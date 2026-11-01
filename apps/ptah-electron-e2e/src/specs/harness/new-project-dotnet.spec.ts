import { test, expect } from '../../support/fixtures';

test('New project intake offers a .NET platform and matching stack', async ({
  ui,
}) => {
  await ui.goto('onboarding');
  await ui.page.getByTestId('onboarding-path-link-new-project').click();
  const intake = ui.page.getByTestId('new-project-intake');
  await expect(intake).toBeVisible();
  await intake.getByRole('button', { name: '.NET', exact: true }).click();
  await expect(
    intake.getByRole('button', { name: /ASP.NET/i }).first(),
  ).toBeVisible();
  await intake.locator('#project-what').fill('A .NET scheduling service');
  await expect(intake.locator('#project-what')).toHaveValue(
    'A .NET scheduling service',
  );
});
