import { test } from './_harness/showcase-fixtures';
import { openConfigSurface } from './_harness/config-menu';

/** Onboarding Home tour. Navigation and spotlight only; no workflow is started. */
test('Setup tour — choose a path', async ({ page, director }) => {
  await openConfigSurface(page, director, 'onboarding');
  await page.getByTestId('onboarding-shell').waitFor({ state: 'visible' });
  await director.hold();

  const home = page.locator('ptah-onboarding-home');
  const analyze = page.getByTestId('onboarding-path-analyze');
  const newProject = page.getByTestId('onboarding-path-new-project');
  const teamBuilder = page.getByTestId('onboarding-path-team-builder');

  await director.say(0);
  await director.say(1, { target: home });
  await director.say(2);
  await director.say(3, { target: analyze });
  await director.say(4, { target: newProject });
  await director.say(5, { target: newProject });
  await director.say(6, { target: newProject });
  await director.say(7, { target: teamBuilder });
  await director.say(8, { target: home });
  await director.say(9, { target: home });
  await director.say(10, { target: home });
  await director.say(11, { target: home });
  await director.say(12, { breathMs: 950 });
});
