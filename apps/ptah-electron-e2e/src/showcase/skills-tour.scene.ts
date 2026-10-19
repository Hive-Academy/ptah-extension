import { test } from './_harness/showcase-fixtures';
import type { Director } from './_harness/director';
import type { Locator, Page } from '@playwright/test';
import { openConfigSurface } from './_harness/config-menu';

/**
 * Visual tour of the Skills Library and its pause and telemetry controls.
 * The existing voiceover script describes retired pipeline views, so this
 * scene uses captions and visual holds until that script can be updated.
 * All steps are read-only; switches and Library actions are never clicked.
 */
async function goToSkills(page: Page, director: Director): Promise<Locator> {
  await openConfigSurface(page, director, 'thoth');
  const skillsTab = page.locator('#thoth-tab-skills');
  await skillsTab.waitFor({ state: 'visible' });
  await director.click(skillsTab);

  const panel = page.locator('#thoth-panel-skills');
  await panel.waitFor({ state: 'visible' });
  return panel;
}

async function spotlightIfVisible(
  director: Director,
  target: Locator,
  durationMs = 1600,
): Promise<void> {
  if (await target.isVisible().catch(() => false)) {
    await director.spotlight(target, durationMs);
  }
}

test('P1.3 — Skills Library (deep dive)', async ({ page, director }) => {
  const panel = await goToSkills(page, director);
  const skillsSection = panel.locator('[data-testid="thoth-section-skills"]');
  await director.caption('Manage skills, agents and commands in the Library.');
  await spotlightIfVisible(director, skillsSection);

  // Show both controls without changing the user's saved preferences.
  await director.caption('Pause Skills from the switch at the top of this tab.');
  await spotlightIfVisible(
    director,
    panel.locator('[data-testid="skills-pause-switch"]'),
  );
  await director.caption('Skill telemetry has its own switch.');
  await spotlightIfVisible(
    director,
    panel.locator('[data-testid="skills-telemetry-switch"]'),
  );

  const library = panel.locator('[data-testid="clones-view"]');
  if (await library.isVisible().catch(() => false)) {
    await director.caption('Browse your saved Library entries below.');
    await director.spotlight(library, 1700);
    await director.scrollThrough(library, { steps: 4, dwellMs: 600 });

    const firstEntry = library.locator('[data-testid="clones-row"]').first();
    if (await firstEntry.isVisible().catch(() => false)) {
      await director.caption('Each saved entry has its own Library card.');
      await director.hover(firstEntry, 700);
      await director.spotlight(firstEntry, 1500);
    } else {
      await director.caption('Your Library entries will appear here.');
      await spotlightIfVisible(
        director,
        library.locator('[data-testid="clones-empty"]'),
      );
    }
  }

  await director.hold(1000);
  await director.caption();
});
