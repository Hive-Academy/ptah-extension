# W test failures (verify run 2026-11-02, before fix lane)

## log 10084197632843467874
  ● CodexAppServerProcess › keeps concurrent and following requests alive after an invalid thread/list result

    expect(jest.fn()).toHaveBeenCalledWith(...expected)

    - Expected
    + Received

      "Codex response result rejected",
      Object {
    -   "issues": Array [
    -     Object {
    -       "code": "invalid_type",
    -       "path": Array [
    -         "data",
    -       ],
    -     },
    -   ],
    +   "issues": "[{\"path\":[\"data\"],\"code\":\"invalid_type\"}]",
        "method": "thread/list",
      },

    Number of calls: 1

      711 |     });
      712 |     expect(logger.warn).toHaveBeenCalledTimes(1);
    > 713 |     expect(logger.warn).toHaveBeenCalledWith('Codex response result rejected', {
          |                         ^
      714 |       method: 'thread/list',
      715 |       issues: [{ path: ['data'], code: 'invalid_type' }],
      716 |     });


  ● CodexAppServerProcess › keeps concurrent and following requests alive after an invalid thread/list result

    Codex process closed

      617 |     this.bufferedNotifications.length = 0;
      618 |     this.unknownNotificationMethods.clear();
    > 619 |     const error = this.failure ?? new Error('Codex process closed');
          |                                   ^
      620 |     for (const entry of this.pending.values()) {
      621 |       clearTimeout(entry.timer);
      622 |       entry.reject(error);


 FAIL   codex-runtime  src/lib/codex-context.spec.ts
  ● native child event admission › routes buffered child frames without settling the root and prunes the child

    ZodError: [
      {
        "expected": "number",
        "code": "invalid_type",
        "path": [
          "startedAtMs"
        ],
        "message": "Invalid input: expected number, received undefined"
      }
    ]

      410 |       this.resetCompactWatchdog();
      411 |     if (frame.method === 'item/started') {
    > 412 |       const parsed = codexNotificationSchemas['item/started'].parse(
          |                                                               ^
      413 |         frame.params,
      414 |       );
      415 |       if (


A worker process has failed to exit gracefully and has been force exited. This is likely caused by tests leaking due to improper teardown. Try running with --detectOpenHandles to find leaks. Active timers can also cause this, ensure that .unref() was called on them.
## log 3274654003095684710
  ● PluginLoaderService — capability layers › explicit ancestor policy › deduplicates canonical and same-root aliases for policy and fingerprint

    EPERM: operation not permitted, symlink 'C:\Users\abdal\AppData\Local\Temp\ptah-policy-a-cDTqK3' -> 'C:\Users\abdal\AppData\Local\Temp\ptah-policy-b-G0JVhy\alias'

      322 |       const a = tempDir('ptah-policy-a-');
      323 |       const alias = path.join(b, 'alias');
    > 324 |       fs.symlinkSync(a, alias, 'dir');
          |          ^
      325 |       const { storage, stores } = scopedStores([b, a]);
      326 |       stores
      327 |         .get(a)


 FAIL   agent-sdk  src/lib/helpers/plugin-loader.service.session-notice.spec.ts (34.53 s)
  ● PluginLoaderService.getSessionPluginNotice › recognizes a symlinked alias of the project root in the lineage

    EPERM: operation not permitted, symlink 'C:\Users\abdal\AppData\Local\Temp\ptah-session-notice-uTAuIo\project' -> 'C:\Users\abdal\AppData\Local\Temp\ptah-session-notice-uTAuIo\project-alias'

      218 |     const h = setup();
      219 |     const alias = path.join(h.base, 'project-alias');
    > 220 |     fs.symlinkSync(h.project, alias, 'dir');
          |        ^
      221 |     h.setConfig(h.child, config({ enabledPluginIds: ['pluginA'] }));
      222 |     expect(h.service.getSessionPluginNotice(h.child, [alias], h.project)).toEqual({
      223 |       sessionRoot: h.child,


 FAIL   agent-sdk  src/lib/codex-app-server/codex-history-projector.spec.ts
  ● projectCodexHistory › replays the live spawn, child completion and finished wait contract

    expect(received).toEqual(expected) // deep equality

    - Expected  -  2
    + Received  + 58

    @@ -1,20 +1,76 @@
      Array [
        Object {
    +     "parent": undefined,
    +     "role": "assistant",
    +     "type": "message_start",
    +   },
    +   Object {
    +     "id": "spawn",
    +     "input": Object {
    +       "description": "Inspect parser",
    +       "prompt": "Inspect parser",
    +       "subagent_type": "codex",
    +     },
    +     "name": "Task",
    +     "parent": undefined,
    +     "task": true,
    +     "type": "tool_start",
    +   },
    +   Object {
    +     "agentId": "child",
    +     "agentType": "codex",
    +     "description": "Inspect parser",
    +     "id": "spawn",
    +     "parent": "spawn",
    +     "prompt": "Inspect parser",
    +     "type": "agent_start",
    +   },
    +   Object {
          "parent": "spawn",
          "role": "assistant",
          "type": "message_start",
    +   },
    +   Object {
    +     "parent": "spawn",
    +     "text": "Found it",
    +     "type": "text_delta",
        },
        Object {
          "parent": "spawn",
          "reason": "completed",
          "type": "message_complete",
        },
        Object {
    +     "error": false,
    +     "id": "spawn",
    +     "output": "Found it",
    +     "parent": undefined,
    +     "type": "tool_result",
    +   },
    +   Object {
    +     "id": "wait-1",
    +     "input": Object {
    +       "receiverThreadIds": Array [
    +         "child",
    +       ],
    +     },
    +     "name": "wait",
          "parent": undefined,
    -     "role": "assistant",
    -     "type": "message_start",
    +     "task": false,
    +     "type": "tool_start",
    +   },
    +   Object {
    +     "error": false,
    +     "id": "wait-1",
    +     "output": Object {
    +       "receiverThreadIds": Array [
    +         "child",
    +       ],
    +     },
    +     "parent": undefined,
    +     "type": "tool_result",
        },
        Object {
          "parent": undefined,
          "reason": "completed",
          "type": "message_complete",

      226 |       }
      227 |     });
    > 228 |     expect(contract(history)).toEqual(contract(live));
          |                               ^
      229 |     const waits = history.filter((event) => (event.eventType === 'tool_start' || event.eventType === 'tool_result') && event.toolCallId === 'wait-1');
      230 |     expect(waits.map((event) => event.eventType)).toEqual(['tool_start', 'tool_result']);
      231 |   });


 FAIL   agent-sdk  src/lib/helpers/sdk-query-runner.service.spec.ts
  ● SdkQueryRunner › runOneShot — one-shot auth override (input.auth) › leaves the ambient token in place when there is no override

    AuthRequiredError: Codex chat requires a host with the native Codex runtime.

      27 |     },
      28 |   ) {
    > 29 |     super(message, details?.cause ? { cause: details.cause } : undefined);
         |     ^
      30 |     this.name = 'AuthRequiredError';
      31 |     this.providerId = details?.providerId ?? null;
      32 |     this.recoveryHint = details?.recoveryHint ?? null;



## log 1680660326656726010
  ● TASK_2026_408 Batch 9 — SDK/CLI/proxy integration (mocked upstream only) › S1 Skill: real SDK/CLI calls the Skill tool with args forwarded, real CodexTranslationProxy relays to the (mocked) upstream, final result is success

    EPERM, Permission denied: \\?\C:\Users\abdal\AppData\Local\Temp\ptah-sdk-int-r06mpb\scenario-RvEL8A '\\?\C:\Users\abdal\AppData\Local\Temp\ptah-sdk-int-r06mpb\scenario-RvEL8A'

      175 | function removeTree(dir: string): void {
      176 |   // Windows can briefly hold handles of a just-exited process tree.
    > 177 |   rmSync(dir, {
          |         ^
      178 |     recursive: true,
      179 |     force: true,
      180 |     maxRetries: 10,


  ● TASK_2026_408 Batch 9 — SDK/CLI/proxy integration (mocked upstream only) › S2 slash command: /fixture-cmd hello world is expanded by the real CLI before it reaches the (mocked) upstream

    EPERM, Permission denied: \\?\C:\Users\abdal\AppData\Local\Temp\ptah-sdk-int-r06mpb\scenario-DYFzMd '\\?\C:\Users\abdal\AppData\Local\Temp\ptah-sdk-int-r06mpb\scenario-DYFzMd'

      175 | function removeTree(dir: string): void {
      176 |   // Windows can briefly hold handles of a just-exited process tree.
    > 177 |   rmSync(dir, {
          |         ^
      178 |     recursive: true,
      179 |     force: true,
      180 |     maxRetries: 10,


  ● TASK_2026_408 Batch 9 — SDK/CLI/proxy integration (mocked upstream only) › S3 unknown slash command: /no-such-cmd x — pins the OBSERVED behaviour (Assumption A3), never a silent expansion

    EPERM, Permission denied: \\?\C:\Users\abdal\AppData\Local\Temp\ptah-sdk-int-r06mpb\scenario-xKPTkQ '\\?\C:\Users\abdal\AppData\Local\Temp\ptah-sdk-int-r06mpb\scenario-xKPTkQ'

      175 | function removeTree(dir: string): void {
      176 |   // Windows can briefly hold handles of a just-exited process tree.
    > 177 |   rmSync(dir, {
          |         ^
      178 |     recursive: true,
      179 |     force: true,
      180 |     maxRetries: 10,


  ● TASK_2026_408 Batch 9 — SDK/CLI/proxy integration (mocked upstream only) › S4 unknown tool: a hallucinated tool call is rejected by the real CLI with "No such tool available", disclosed to the (mocked) upstream

    EPERM, Permission denied: \\?\C:\Users\abdal\AppData\Local\Temp\ptah-sdk-int-r06mpb\scenario-vFeC9Q '\\?\C:\Users\abdal\AppData\Local\Temp\ptah-sdk-int-r06mpb\scenario-vFeC9Q'

      175 | function removeTree(dir: string): void {
      176 |   // Windows can briefly hold handles of a just-exited process tree.
    > 177 |   rmSync(dir, {
          |         ^
      178 |     recursive: true,
      179 |     force: true,
      180 |     maxRetries: 10,


  ● TASK_2026_408 Batch 9 — SDK/CLI/proxy integration (mocked upstream only) › S5 long MCP name round-trips: upstream sees only the alias, handler receives the args, replay reuses the alias, image tool result becomes input_image for Codex

    EPERM, Permission denied: \\?\C:\Users\abdal\AppData\Local\Temp\ptah-sdk-int-r06mpb\scenario-F8GEV3 '\\?\C:\Users\abdal\AppData\Local\Temp\ptah-sdk-int-r06mpb\scenario-F8GEV3'

      175 | function removeTree(dir: string): void {
      176 |   // Windows can briefly hold handles of a just-exited process tree.
    > 177 |   rmSync(dir, {
          |         ^
      178 |     recursive: true,
      179 |     force: true,
      180 |     maxRetries: 10,


A worker process has failed to exit gracefully and has been force exited. This is likely caused by tests leaking due to improper teardown. Try running with --detectOpenHandles to find leaks. Active timers can also cause this, ensure that .unref() was called on them.
## log 9529666247086514918
  ● ChatSessionService — the session's own folder (MP-3) › chat:continue › restores the provable immediate lineage when a child folder is resolved

    expect(jest.fn()).toHaveBeenCalledWith(...expected)

    Expected: "11111111-1111-4111-8111-111111111111", ObjectContaining {"pluginConfigAncestorRoots": ["C:\\Users\\abdal\\AppData\\Local\\Temp\\ptah-session-policy-N7b9UV/b"], "projectPath": "C:\\Users\\abdal\\AppData\\Local\\Temp\\ptah-session-policy-N7b9UV/b/child"}
    Received: "11111111-1111-4111-8111-111111111111", {"effort": undefined, "enhancedPromptsContent": undefined, "mcpServerRunning": false, "model": "default", "pluginConfigAncestorRoots": ["C:\\Users\\abdal\\AppData\\Local\\Temp\\ptah-session-policy-N7b9UV\\b"], "projectPath": "C:\\Users\\abdal\\AppData\\Local\\Temp\\ptah-session-policy-N7b9UV/b/child", "prompt": "continue", "providerProfile": undefined, "tabId": "22222222-2222-4222-8222-222222222222", "thinking": undefined, "workflowsDisabled": false}

    Number of calls: 1

      357 |         tabId: TAB_ID,
      358 |       });
    > 359 |       expect(h.resumeSession).toHaveBeenCalledWith(
          |                               ^
      360 |         SESSION_ID,
      361 |         expect.objectContaining({
      362 |           projectPath: child,


 FAIL   rpc-handlers  src/lib/chat/session/chat-session-agent-child.spec.ts
  ● ChatSessionService — SDK launch identity (TASK_2026_584) › startAgentChildSession › deduplicates an ancestor by physical identity

    EPERM: operation not permitted, symlink 'C:\Users\abdal\AppData\Local\Temp\ptah-session-policy-JiHGtX\my-repo\parent' -> 'C:\Users\abdal\AppData\Local\Temp\ptah-session-policy-JiHGtX\my-repo\parent-alias'

      382 |     it('deduplicates an ancestor by physical identity', async () => {
      383 |       const alias = join(ROOT, 'parent-alias');
    > 384 |       symlinkSync(join(ROOT, 'parent'), alias, 'dir');
          |                  ^
      385 |       const h = makeHarness({
      386 |         metadata: {
      387 |           workspaceId: ROOT,


  ● ChatSessionService — SDK launch identity (TASK_2026_584) › startAgentChildSession › captures the authoritative source root and saved ancestors in order

    expect(received).toEqual(expected) // deep equality

    - Expected  - 2
    + Received  + 2

      Array [
    -   "C:\\Users\\abdal\\AppData\\Local\\Temp\\ptah-session-policy-JiHGtX/my-repo",
    -   "C:\\Users\\abdal\\AppData\\Local\\Temp\\ptah-session-policy-JiHGtX/my-repo/parent",
    +   "C:\\Users\\abdal\\AppData\\Local\\Temp\\ptah-session-policy-JiHGtX\\my-repo",
    +   "C:\\Users\\abdal\\AppData\\Local\\Temp\\ptah-session-policy-JiHGtX\\my-repo\\parent",
      ]

      428 |       );
      429 |       expect(result.success).toBe(true);
    > 430 |       expect(startConfig(h)['pluginConfigAncestorRoots']).toEqual([
          |                                                           ^
      431 |         ROOT,
      432 |         `${TEST_ROOT}/my-repo/parent`,
      433 |       ]);


  ● ChatSessionService — SDK launch identity (TASK_2026_584) › startAgentChildSession › uses only the validated immediate root without a source

    expect(received).toEqual(expected) // deep equality

    - Expected  - 1
    + Received  + 1

      Array [
    -   "C:\\Users\\abdal\\AppData\\Local\\Temp\\ptah-session-policy-JiHGtX/my-repo",
    +   "C:\\Users\\abdal\\AppData\\Local\\Temp\\ptah-session-policy-JiHGtX\\my-repo",
      ]

      471 |       const h = makeHarness();
      472 |       await h.service.startAgentChildSession(childParams());
    > 473 |       expect(startConfig(h)['pluginConfigAncestorRoots']).toEqual([ROOT]);
          |                                                           ^
      474 |     });
      475 |
      476 |     it('uses the live pre-bind source chain for a nested child', async () => {


  ● ChatSessionService — SDK launch identity (TASK_2026_584) › startAgentChildSession › uses the live pre-bind source chain for a nested child

    expect(received).toEqual(expected) // deep equality

    - Expected  - 2
    + Received  + 2

      Array [
    -   "C:\\Users\\abdal\\AppData\\Local\\Temp\\ptah-session-policy-JiHGtX/my-repo/.ptah/worktrees/child-1",
    -   "C:\\Users\\abdal\\AppData\\Local\\Temp\\ptah-session-policy-JiHGtX/my-repo",
    +   "C:\\Users\\abdal\\AppData\\Local\\Temp\\ptah-session-policy-JiHGtX\\my-repo\\.ptah\\worktrees\\child-1",
    +   "C:\\Users\\abdal\\AppData\\Local\\Temp\\ptah-session-policy-JiHGtX\\my-repo",
      ]

      487 |       expect(
      488 |         h.startChatSession.mock.calls[1][0].pluginConfigAncestorRoots,
    > 489 |       ).toEqual([WORKTREE, ROOT]);
          |         ^
      490 |     });
      491 |     it('passes workspaceId = root, projectPath = worktree and the parent permission level', async () => {
      492 |       const h = makeHarness();


  ● ChatSessionService — SDK launch identity (TASK_2026_584) › preserves a source chain on a same-root handoff

    expect(received).toEqual(expected) // deep equality

    - Expected  - 1
    + Received  + 1

      Array [
    -   "C:\\Users\\abdal\\AppData\\Local\\Temp\\ptah-session-policy-JiHGtX/my-repo",
    +   "C:\\Users\\abdal\\AppData\\Local\\Temp\\ptah-session-policy-JiHGtX\\my-repo",
      ]

      694 |     );
      695 |     expect(result.success).toBe(true);
    > 696 |     expect(startConfig(h)['pluginConfigAncestorRoots']).toEqual([ROOT]);
          |                                                         ^
      697 |   });
      698 |
      699 |   describe('startHandoffSession (TASK_2026_655)', () => {


 FAIL   rpc-handlers  src/lib/chat/session/session-folder.spec.ts
  ● resolveSessionFolder › rejects symlink escape from a registered folder

    EPERM: operation not permitted, symlink 'C:\Users\abdal\AppData\Local\Temp\ptah-folder-xcNydv\outside' -> 'C:\Users\abdal\AppData\Local\Temp\ptah-folder-xcNydv\project\escape'

      86 |   it('rejects symlink escape from a registered folder', async () => {
      87 |     const link = join(project, 'escape');
    > 88 |     await symlink(outside, link, 'dir');
         |     ^
      89 |     await expect(
      90 |       resolve({ workspaceId: project, workingDirectory: link }),
      91 |     ).rejects.toMatchObject({ errorCode: 'SESSION_FOLDER_UNAVAILABLE' });


  ● resolveSessionFolder › resolves physical aliases for identity checks

    EPERM: operation not permitted, symlink 'C:\Users\abdal\AppData\Local\Temp\ptah-folder-o8F1h1\project\child' -> 'C:\Users\abdal\AppData\Local\Temp\ptah-folder-o8F1h1\project\alias'

      93 |   it('resolves physical aliases for identity checks', async () => {
      94 |     const alias = join(project, 'alias');
    > 95 |     await symlink(child, alias, 'dir');
         |     ^
      96 |     await expect(
      97 |       validateSessionPolicyRoot(alias, provider(), platformInfo()),
      98 |     ).resolves.toBe(child);


  ● resolveSessionFolder › rejects a physically unreadable directory despite an authorized parent

    expect(received).rejects.toMatchObject()

    Received promise resolved instead of rejected
    Resolved to value: "C:\\Users\\abdal\\AppData\\Local\\Temp\\ptah-folder-VFV569\\project\\child"

      122 |     await chmod(child, 0o000);
      123 |     try {
    > 124 |       await expect(
          |             ^
      125 |         resolve({ workspaceId: project, workingDirectory: child }),
      126 |       ).rejects.toMatchObject({ errorCode: 'SESSION_FOLDER_UNAVAILABLE' });
      127 |     } finally {


  ● resolveSessionFolder › rejects a dangling symlink filesystem error

    EPERM: operation not permitted, symlink 'C:\Users\abdal\AppData\Local\Temp\ptah-folder-jNKkhf\missing' -> 'C:\Users\abdal\AppData\Local\Temp\ptah-folder-jNKkhf\project\broken'

      131 |   it('rejects a dangling symlink filesystem error', async () => {
      132 |     const broken = join(project, 'broken');
    > 133 |     await symlink(join(base, 'missing'), broken, 'dir');
          |     ^
      134 |     await expect(
      135 |       resolve({ workspaceId: project, workingDirectory: broken }),
      136 |     ).rejects.toMatchObject({ errorCode: 'SESSION_FOLDER_UNAVAILABLE' });


 FAIL   rpc-handlers  src/lib/handlers/plugin-rpc.handlers.session-notice.spec.ts (37.999 s)
  ● plugins:get-config session notice › returns a notice from the session folder and ancestors

    expect(jest.fn()).toHaveBeenCalledWith(...expected)

    - Expected
    + Received

      "/tmp/ptah-plugin-notice-project/child",
      ["/tmp/ptah-plugin-notice-project"],
    - "/tmp/ptah-plugin-notice-project",
    + "D:\\tmp\\ptah-plugin-notice-project",

    Number of calls: 1

      127 |       sessionNotice: NOTICE,
      128 |     });
    > 129 |     expect(h.loader.getSessionPluginNotice).toHaveBeenCalledWith(
          |                                             ^
      130 |       FOLDER,
      131 |       [ROOT],
      132 |       ROOT,


 FAIL   rpc-handlers  src/lib/chat/session/chat-session-resume-activate.spec.ts
  ● ChatSessionService — resumeSession activate:true (TS-04) › passes stored lineage ["C:\\Users\\abdal\\AppData\\Local\\Temp\\ptah-session-policy-fLrxSd/my-repo/ancestor"] to activation

    expect(jest.fn()).toHaveBeenCalledWith(...expected)

    Expected: "11111111-1111-4111-8111-111111111111", ObjectContaining {"pluginConfigAncestorRoots": ["C:\\Users\\abdal\\AppData\\Local\\Temp\\ptah-session-policy-fLrxSd/my-repo/ancestor"]}
    Received: "11111111-1111-4111-8111-111111111111", {"effort": undefined, "enhancedPromptsContent": undefined, "mcpServerRunning": false, "model": "default", "pluginConfigAncestorRoots": ["C:\\Users\\abdal\\AppData\\Local\\Temp\\ptah-session-policy-fLrxSd\\my-repo\\ancestor"], "projectPath": "C:\\Users\\abdal\\AppData\\Local\\Temp\\ptah-session-policy-fLrxSd/my-repo", "prompt": "", "providerProfile": undefined, "tabId": "22222222-2222-4222-8222-222222222222", "thinking": undefined, "workflowsDisabled": false}

    Number of calls: 1

      272 |       });
      273 |       expect(result.activated).toBe(true);
    > 274 |       expect(resumeSession).toHaveBeenCalledWith(
          |                             ^
      275 |         SESSION_ID,
      276 |         expect.objectContaining({ pluginConfigAncestorRoots: expected }),
      277 |       );


  ● ChatSessionService — resumeSession activate:true (TS-04) › recovers one provable legacy parent and upgrades only after activation

    expect(jest.fn()).toHaveBeenCalledWith(...expected)

    Expected: "11111111-1111-4111-8111-111111111111", ObjectContaining {"pluginConfigAncestorRoots": ["C:\\Users\\abdal\\AppData\\Local\\Temp\\ptah-session-policy-fLrxSd/my-repo"]}
    Received: "11111111-1111-4111-8111-111111111111", {"effort": undefined, "enhancedPromptsContent": undefined, "mcpServerRunning": false, "model": "default", "pluginConfigAncestorRoots": ["C:\\Users\\abdal\\AppData\\Local\\Temp\\ptah-session-policy-fLrxSd\\my-repo"], "projectPath": "C:\\Users\\abdal\\AppData\\Local\\Temp\\ptah-session-policy-fLrxSd/my-repo/child", "prompt": "", "providerProfile": undefined, "tabId": "22222222-2222-4222-8222-222222222222", "thinking": undefined, "workflowsDisabled": false}

    Number of calls: 1

      334 |     });
      335 |     expect(result.activated).toBe(true);
    > 336 |     expect(resumeSession).toHaveBeenCalledWith(
          |                           ^
      337 |       SESSION_ID,
      338 |       expect.objectContaining({ pluginConfigAncestorRoots: [OPEN_FOLDER] }),
      339 |     );


 FAIL   rpc-handlers  src/lib/chat/session/chat-session-policy-roots.spec.ts
  ● readSessionPolicyRoots › returns physical folder and validated stored ancestors

    expect(received).toEqual(expected) // deep equality

    - Expected  - 2
    + Received  + 2

      Object {
        "ancestorRoots": Array [
    -     "C:\\Users\\abdal\\AppData\\Local\\Temp\\ptah-session-policy-X3whC2/b",
    +     "C:\\Users\\abdal\\AppData\\Local\\Temp\\ptah-session-policy-X3whC2\\b",
        ],
