import { test, expect } from '../../support/fixtures';

test.describe('New project onboarding', () => {
  test('Home opens the intake and requires a brief', async ({ ui }) => {
    await ui.goto('onboarding');
    await ui.page.getByTestId('onboarding-path-link-new-project').click();
    await expect(ui.page.getByTestId('new-project-intake')).toBeVisible();
    await ui.page.getByRole('button', { name: 'Continue' }).click();
    await expect(
      ui.page.getByTestId('new-project-intake').getByRole('alert'),
    ).toContainText('What are you building is required.');
  });

  test('submits the new intake and opens the proposal workspace', async ({
    ui,
  }) => {
    await ui.mockRpc({
      'harness:start-new-project': {
        success: true,
        seedPrompt: 'Plan a scheduling tool.',
        plugins: {
          enabledBundled: [],
          missingExternal: [],
          availableSkillIds: [],
        },
      },
      'chat:start': { success: true },
    });
    await ui.goto('onboarding');
    await ui.page.getByTestId('onboarding-path-link-new-project').click();
    await ui.page
      .locator('#project-what')
      .fill('A scheduling tool for clinics');
    await ui.page.getByRole('button', { name: 'Continue' }).click();

    const call = await ui.waitForObservedCall('harness:start-new-project');
    expect(call.params).toEqual(
      expect.objectContaining({
        intake: expect.objectContaining({
          what: 'A scheduling tool for clinics',
          platform: 'node-ts',
          stack: 'recommend',
        }),
      }),
    );
    await expect(ui.page.getByTestId('proposal-workspace')).toBeVisible();
  });

  test('submits the .NET platform and stack in the wire payload', async ({
    ui,
  }) => {
    await ui.mockRpc({
      'harness:start-new-project': {
        success: true,
        seedPrompt: 'Plan it',
        plugins: {
          enabledBundled: [],
          missingExternal: [],
          availableSkillIds: [],
        },
      },
      'chat:start': { success: true },
    });
    await ui.goto('onboarding');
    await ui.page.getByTestId('onboarding-path-link-new-project').click();
    const intake = ui.page.getByTestId('new-project-intake');
    await intake.locator('#project-what').fill('A clinic portal');
    await intake
      .getByRole('group', { name: 'Platform' })
      .getByRole('button', { name: '.NET' })
      .click();
    await intake
      .getByRole('group', { name: 'Stack' })
      .getByRole('button', { name: 'ASP.NET Core API only' })
      .click();
    await intake.getByRole('button', { name: 'Continue' }).click();
    const call = await ui.waitForObservedCall('harness:start-new-project');
    expect(call.params).toEqual(
      expect.objectContaining({
        intake: expect.objectContaining({
          platform: 'dotnet',
          stack: 'aspnetcore-api',
        }),
      }),
    );
    await expect(ui.page.getByTestId('proposal-workspace')).toBeVisible();
  });

  test('requires free text when Other stack is chosen', async ({ ui }) => {
    await ui.goto('onboarding');
    await ui.page.getByTestId('onboarding-path-link-new-project').click();
    const intake = ui.page.getByTestId('new-project-intake');
    await intake.locator('#project-what').fill('An inventory tracker');
    await intake
      .getByRole('group', { name: 'Stack' })
      .getByRole('button', { name: 'Other' })
      .click();
    await intake.getByRole('button', { name: 'Continue' }).click();
    await expect(intake.getByRole('alert')).toContainText('Enter your stack.');
    await intake.locator('#project-stack-other').fill('Ruby on Rails');
    await expect(intake.locator('#project-stack-other-error')).toHaveCount(0);
  });

  // Proposal URLs are not persisted (no identity validator); after a reload
  // Home offers to resume the draft instead (TASK_2026_ONBOARDING B4b).
  test('reload offers to resume the proposal from Home', async ({ ui }) => {
    await ui.mockRpc({
      'harness:start-new-project': {
        success: true,
        seedPrompt: 'Plan it',
        plugins: {
          enabledBundled: [],
          missingExternal: [],
          availableSkillIds: [],
        },
      },
      'chat:start': { success: true },
    });
    await ui.goto('onboarding');
    await ui.page.getByTestId('onboarding-path-link-new-project').click();
    await ui.page.locator('#project-what').fill('A telehealth portal');
    await ui.page.getByRole('button', { name: 'Continue' }).click();
    await expect(ui.page.getByTestId('proposal-workspace')).toBeVisible();
    await ui.prepare();
    await ui.goto('onboarding');
    await ui.page
      .getByTestId('onboarding-resume-banners')
      .getByText('Continue new project')
      .locator('..')
      .locator('..')
      .getByRole('button', { name: 'Resume' })
      .click();
    await expect(ui.page.getByTestId('proposal-workspace')).toBeVisible();
  });

  test('continues the same draft after a direct view switch', async ({
    ui,
  }) => {
    await ui.mockRpc({
      'harness:start-new-project': {
        success: true,
        seedPrompt: 'Plan it',
        plugins: {
          enabledBundled: [],
          missingExternal: [],
          availableSkillIds: [],
        },
      },
      'chat:start': { success: true },
    });
    await ui.goto('onboarding');
    await ui.page.getByTestId('onboarding-path-link-new-project').click();
    await ui.page.locator('#project-what').fill('A clinic portal');
    await ui.page.getByRole('button', { name: 'Continue' }).click();
    await expect(ui.page.getByTestId('proposal-workspace')).toBeVisible();
    await ui.goto('chat');
    await ui.goto('onboarding');
    await ui.page
      .getByTestId('onboarding-resume-banners')
      .getByText('Continue new project')
      .locator('..')
      .locator('..')
      .getByRole('button', { name: 'Resume' })
      .click();
    await expect(ui.page.getByTestId('proposal-workspace')).toBeVisible();
    expect(await ui.getObservedCalls('chat:start')).toHaveLength(1);
  });

  test('foreign-session question does not take the proposal panel (TASK_2026_317)', async ({
    ui,
  }) => {
    await ui.goto('canvas');
    await ui.page.getByTestId('canvas-hero-new-session').click();
    await ui.page.getByRole('button', { name: 'Create', exact: true }).click();
    const foreignTab = await ui.page
      .locator('ptah-canvas-rail [data-rail-card]')
      .first()
      .getAttribute('data-tab-id');
    if (!foreignTab) throw new Error('Canvas tab has no data-tab-id');
    const foreignSession = 'f6b7f477-d8ad-4a43-bb8f-e53547b08e22';
    await ui.pushEvent({
      type: 'chat:chunk',
      payload: {
        tabId: foreignTab,
        sessionId: foreignSession,
        surfaceMode: false,
        event: {
          id: 'foreign-start',
          eventType: 'message_start',
          timestamp: Date.now(),
          sessionId: foreignSession,
          messageId: 'foreign-message',
          role: 'assistant',
        },
      },
    });
    await ui.pushEvent({
      type: 'session:id-resolved',
      payload: { tabId: foreignTab, realSessionId: foreignSession },
    });
    await ui.mockRpc({
      'harness:start-new-project': {
        success: true,
        seedPrompt: 'Plan it',
        plugins: {
          enabledBundled: [],
          missingExternal: [],
          availableSkillIds: [],
        },
      },
      'chat:start': { success: true },
    });
    await ui.goto('onboarding');
    await ui.page.getByTestId('onboarding-path-link-new-project').click();
    await ui.page.locator('#project-what').fill('A clinic portal');
    await ui.page.getByRole('button', { name: 'Continue' }).click();
    await expect(ui.page.getByTestId('proposal-workspace')).toBeVisible();
    await ui.pushEvent({
      type: 'ask-user-question:request',
      payload: {
        id: '5b6a7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d',
        toolName: 'AskUserQuestion',
        questions: [
          {
            question: 'Unrelated session question',
            header: 'Other',
            options: [
              { label: 'A', description: 'first' },
              { label: 'B', description: 'second' },
            ],
            multiSelect: false,
          },
        ],
        toolUseId: 'foreign-question',
        timestamp: Date.now(),
        timeoutAt: 0,
        sessionId: foreignSession,
        tabId: foreignTab,
        surfaceMode: false,
      },
    });
    await expect(ui.page.getByTestId('proposal-workspace')).not.toContainText(
      'Unrelated session question',
    );
    await ui.goto('chat');
    await ui.page
      .locator(`ptah-canvas-rail [data-rail-card][data-tab-id="${foreignTab}"]`)
      .click();
    await expect(
      ui.page.locator(
        `ptah-chat-view:has(ptah-chat-transcript[data-tab-id="${foreignTab}"]) ptah-question-card`,
      ),
    ).toBeVisible();
  });
});
