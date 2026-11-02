## id=4438569978 libs/frontend/canvas/src/lib/canvas-detail/agent-dock-menu.component.ts:138


** Minor** · **Functional Correctness** · **Quick win**

**Fix the trigger label for one hidden agent and restore the waiting/failed summary.**

`triggerLabel` now returns `1 more agents` when exactly one agent is hidden. The removed code handled the singular form.

The removed code also reported the number of waiting and failed hidden agents. The planner now ranks `running` first through `menuRank`. A `waiting` agent that needs input can therefore be hidden behind five running agents. `pipClass` shows the waiting or failed state only by color. Assistive technology users now get no signal that a hidden agent needs them.

Restore the singular form and the waiting and failed counts in the label.


Proposed fix



```diff
--- "a/libs/frontend/canvas/src/lib/canvas-detail/agent-dock-menu.component.ts"
+++ "b/libs/frontend/canvas/src/lib/canvas-detail/agent-dock-menu.component.ts"
@@ -134,9 +134,15 @@
 
   protected readonly pile = computed(() => this.hidden().slice(0, 3));
 
   protected readonly triggerLabel = computed(() => {
-    return `${this.hidden().length} more agents`;
+    const hidden = this.hidden();
+    const parts = [`${hidden.length} more ${hidden.length === 1 ? 'agent' : 'agents'}`];
+    const waiting = hidden.filter((agent) => agent.status === 'waiting').length;
+    const failed = hidden.filter((agent) => agent.status === 'failed').length;
+    if (waiting > 0) parts.push(`${waiting} waiting, needs you`);
+    if (failed > 0) parts.push(`${failed} failed`);
+    return parts.join(', ');
   });
 
   protected readonly pipClass = computed(() => {
     const hidden = this.hidden();
```







 

## id=4438569992 libs/frontend/canvas/src/lib/canvas-detail/dock-overflow.ts:94


** Major** · **Functional Correctness** · **Quick win**

**Keep the selected agent visible when frozen keys do not include it.**

In the frozen branch, `frozen` contains only agents from `frozenKeys`. The `selected` guard at Line 94 therefore never fires when the selected agent is outside that list.

Trigger:
1. A keyboard user focuses the overflow trigger. `onDockFocusIn` freezes the visible keys before it checks the target role.
2. The user picks a hidden agent from the menu.
3. `choose` returns focus to the trigger, so focus stays in the dock and the frozen keys stay set.
4. The selected agent is not in `frozen`, so it stays in `hidden`.

Result: the selected chip is not rendered until focus leaves the dock. The lane panel's `aria-labelledby` points at the selected chip's tab id, so it then references a missing element. The old code kept `[...frozen, selected]`, so this is a regression. The change also conflicts with the PR goal that the selected agent stays reachable.

Add `selected` to the frozen list when it is missing and a slot exists.


Proposed fix



```diff
--- "a/libs/frontend/canvas/src/lib/canvas-detail/dock-overflow.ts"
+++ "b/libs/frontend/canvas/src/lib/canvas-detail/dock-overflow.ts"
@@ -85,10 +85,14 @@
   }
   let visible: SessionAgent[];
   if (frozenKeys) {
-    const frozen = [...new Set(frozenKeys)].flatMap((key) => {
+    const frozenAgents = [...new Set(frozenKeys)].flatMap((key) => {
       const agent = byKey.get(key);
       return agent ? [agent] : [];
     });
+    const frozen =
+      selected && slots > 0 && !frozenAgents.includes(selected)
+        ? [...frozenAgents, selected]
+        : frozenAgents;
     const kept = new Set();
     // Selection and keyboard focus take priority when a resize reduces slots.
     if (selected && frozen.includes(selected)) kept.add(selected.key);
```







Committable suggestion



>  **IMPORTANT**
> Review the replacement and indentation, then test before committing.

```suggestion
    const frozenAgents = [...new Set(frozenKeys)].flatMap((key) => {
      const agent = byKey.get(key);
      return agent ? [agent] : [];
    });
    const frozen =
      selected && slots > 0 && !frozenAgents.includes(selected)
        ? [...frozenAgents, selected]
        : frozenAgents;
    const kept = new Set();
    // Selection and keyboard focus take priority when a resize reduces slots.
    if (selected && frozen.includes(selected)) kept.add(selected.key);
```










 

## id=4438570004 libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts:230


** Major** · **Stability & Availability** · **Quick win**


 Supported by static analysis



Script executed:

```bash
#!/bin/bash
# Check what emits railState and whether any other path updates board railStates.
rg -nP -C3 'railState|onRailState|railStates' libs/frontend/canvas/src/lib/canvas-rail --glob '!*.spec.ts'
rg -nP -C3 'railShownKeys' libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts
```

Repository: Hive-Academy/ptah-extension

Length of output: 16721

---

Script executed:

```bash
set -o pipefail
printf '%s\n' '--- canvas-rail.component.ts template and state blocks ---'
nl -ba libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts | sed -n '180,360p'
printf '%s\n' '--- canvas-rail.component.ts visibility and grouping declarations ---'
nl -ba libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts | sed -n '450,700p'
printf '%s\n' '--- compact session card state and request bindings ---'
rg -n -P -C5 'CompactRailState|railState|state|needs|request' libs/frontend/canvas/src/lib/canvas-rail/compact-session-card.component.ts libs/frontend/canvas/src/lib/canvas-rail --glob '*compact*' --glob '!*.spec.ts' || true
printf '%s\n' '--- relevant component files ---'
rg --files libs/frontend/canvas/src/lib/canvas-rail | rg 'compact|card|rail.component.ts$' | sort
```

Repository: Hive-Academy/ptah-extension

Length of output: 17370

---

Script executed:

```bash
set -o pipefail
printf '%s\n' '--- CanvasRailCardComponent template and declarations ---'
nl -ba libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts | sed -n '1,260p'
printf '%s\n' '--- CanvasRailCardComponent state-related class block ---'
nl -ba libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts | sed -n '400,560p'
printf '%s\n' '--- CanvasRailBoardComponent state handler and snackbar suppression ---'
nl -ba libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts | sed -n '960,1020p'
rg -n -P -C5 'railState\.emit|output|CompactRailState' libs/frontend/canvas/src/lib --glob '*.ts' --glob '!*.spec.ts' | head -240
```

Repository: Hive-Academy/ptah-extension

Length of output: 41629

---

Script executed:

```bash
set -o pipefail
printf '%s\n' '--- CompactSessionCardComponent implementation ---'
rg -n -F --glob '*.ts' --glob '!*.spec.ts' 'class CompactSessionCardComponent' libs
printf '%s\n' '--- CompactSessionCardComponent rail-state declaration and emissions ---'
rg -n -P -C8 --glob '*.ts' --glob '!*.spec.ts' 'railState|CompactRailState' libs/chat libs/chat-ui libs 2>/dev/null | rg -C4 'CompactSessionCard|railState|CompactRailState' | head -260
printf '%s\n' '--- board state handler and suppression code ---'
nl -ba libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts | sed -n '980,1010p'
nl -ba libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts | sed -n '620,665p'
```

Repository: Hive-Academy/ptah-extension

Length of output: 32242

---

Script executed:

```bash
set -o pipefail
nl -ba libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts | sed -n '1,280p'
printf '%s\n' '--- all railState references in compact session component ---'
rg -n -P -C10 'railState|CompactRailState|state\s*=' libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts
```

Repository: Hive-Academy/ptah-extension

Length of output: 18754

---







**Keep Finished-session state updates active while the group is collapsed.**

When the expanded rail collapses Finished, line 230 destroys its cards. `railState` then stops updating for those sessions. A session that later becomes `running` or `needs` can remain classified as `done`, which leaves counts and grouping stale and keeps its inline request hidden.

`railShownKeys` also includes requests from omitted cards. Restrict it to rendered IDs:


Suggested fix



```diff
 private readonly railShownKeys = computed(() => this.surfaceActive() && !this.collapsed()
-    ? new Set(this.orderedTiles().flatMap(tile => this.needsFor(tile).slice(0, 1))
+    ? new Set(this.orderedTiles()
+      .filter(tile => this.visibleIds().includes(tile.tabId))
+      .flatMap(tile => this.needsFor(tile).slice(0, 1))
       .filter(item => this.actionableInline(item)).map(item => item.key))
     : new Set());
```





Also keep the state producer mounted while Finished is collapsed, or move the equivalent state subscription to a component that remains mounted. Otherwise the stale state can suppress the permission snackbar for a request that is not visible in the rail.




 

## id=4438570010 libs/frontend/chat-ui/src/lib/molecules/vitals/progress-ring.component.ts:130


** Minor** · **Functional Correctness** · **Quick win**

**Separate the indeterminate pulse from “checking”.**

When `ReadinessRingComponent` is checking, it passes empty center text and the subtext “checking”. The new pulse and that subtext occupy the center of the ring, so they overlap. Move the pulse above the subtext, or move the subtext below the pulse, in indeterminate mode. ([raw.githubusercontent.com](https://raw.githubusercontent.com/Hive-Academy/ptah-extension/14f2cfd2ca9e5d88ddf1f3aae5b909b226aab5a2/libs/frontend/chat-ui/src/lib/molecules/vitals/progress-ring.component.ts))




 

## id=4438570016 libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-session-actions.component.html:32


** Minor** · **Functional Correctness** · **Quick win**


 Supported by static analysis



Script executed:

```bash
cat libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-session-actions.component.html
sed -n '65,115p' libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-session-actions.component.ts
```

Repository: Hive-Academy/ptah-extension

Length of output: 6661

---

Script executed:

```bash
set -o pipefail
printf '%s\n' '--- component outline ---'
ast-grep outline libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-session-actions.component.ts --view expanded || true
printf '%s\n' '--- component source ---'
nl -ba libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-session-actions.component.ts
printf '%s\n' '--- focused references/tests ---'
rg -n -F --glob '*.{ts,html,spec.ts}' -e 'inspector-session-actions' -e 'onMenuKeydown' -e 'toggleMore' -e 'data-inspector-menu-action' -e 'aria-haspopup="menu"' libs/frontend/chat || test "$?" -eq 1
```

Repository: Hive-Academy/ptah-extension

Length of output: 13298

---







**Complete the `role="menu"` keyboard and dismissal behavior.**

Opening the menu leaves focus on the trigger. Native `button` elements can still receive focus with `Tab`, but `onMenuKeydown()` does not implement `ArrowUp`, `ArrowDown`, `Home`, or `End` navigation. The menu also has no outside-click or focus-loss dismissal, so it can remain open after focus moves away. Implement the menu interaction pattern, or remove `role="menu"`, `role="menuitem"`, and the menu-specific `aria-haspopup` semantics.




 

## id=4438570034 libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-session-actions.component.html:65


** Minor** · **Functional Correctness** · **Quick win**


 Supported by static analysis



Script executed:

```bash
sed -n '60,82p' libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-session-actions.component.html
sed -n '165,200p' libs/frontend/canvas/src/lib/canvas-rail/canvas-inspector-dock.component.ts
rg -n 'focusTrap|cdkTrapFocus|inert|onSheetKeydown|renameOpen' libs/frontend/chat/src/lib/components/organisms/session-inspector libs/frontend/canvas/src/lib/canvas-rail/canvas-inspector-dock.component.ts
```

Repository: Hive-Academy/ptah-extension

Length of output: 4946

---

Script executed:

```bash
nl -ba libs/frontend/chat/src/lib/components/organisms/session-inspector/session-inspector.component.html | sed -n '130,195p'
printf '\n--- inspector actions component ---\n'
nl -ba libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-session-actions.component.ts | sed -n '1,175p'
printf '\n--- dock focus management ---\n'
nl -ba libs/frontend/canvas/src/lib/canvas-rail/canvas-inspector-dock.component.ts | sed -n '1,55p;210,255p;380,440p'
```

Repository: Hive-Academy/ptah-extension

Length of output: 17859

---

Script executed:

```bash
printf '%s\n' '--- session inspector header ---'
nl -ba libs/frontend/chat/src/lib/components/organisms/session-inspector/session-inspector.component.html | sed -n '1,145p'
printf '%s\n' '--- dock class and escape binding ---'
rg -n -F -- '@HostListener' libs/frontend/canvas/src/lib/canvas-rail/canvas-inspector-dock.component.ts
nl -ba libs/frontend/canvas/src/lib/canvas-rail/canvas-inspector-dock.component.ts | sed -n '85,145p;345,410p'
```

Repository: Hive-Academy/ptah-extension

Length of output: 12109

---







**Contain focus within the custom rename dialog.**

The rename form has no local focus containment. The surrounding sheet handler excludes controls inside this nested dialog from its tab list, but it still includes inspector controls behind the rename backdrop. Tab can move focus behind the dialog. The form-local Escape handler then no longer receives Escape and cannot cancel the rename.

Add a focus trap to the rename form, or replace it with a native `` opened with `showModal()`. Keep the existing initial-focus and focus-restoration behavior.




 

## id=4438570040 libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-session-actions.component.ts:94


** Minor** · **Functional Correctness** · **Quick win**


 Supported by static analysis



Script executed:

```bash
#!/bin/bash
rg -n -B2 -A14 'onSheetKeydown' libs/frontend/canvas/src/lib/canvas-rail/canvas-inspector-dock.component.ts
```

Repository: Hive-Academy/ptah-extension

Length of output: 2612

---

Script executed:

```bash
nl -ba libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-session-actions.component.ts | sed -n '1,180p'
```

Repository: Hive-Academy/ptah-extension

Length of output: 7809

---

Script executed:

```bash
nl -ba libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-session-actions.component.html | sed -n '1,240p'
```

Repository: Hive-Academy/ptah-extension

Length of output: 5617

---

Script executed:

```bash
nl -ba libs/frontend/canvas/src/lib/canvas-rail/canvas-inspector-dock.component.ts | sed -n '160,260p;390,440p'
```

Repository: Hive-Academy/ptah-extension

Length of output: 7566

---







**Stop Escape from bubbling after a menu or dialog consumes it.**

`onMenuKeydown` runs on both the More button and menu. Escape on an open menu currently calls `closeMore()` but then bubbles to the containing ``, whose `keydown.escape` handler closes the dock. Escape in the rename dialog has the same problem. Do not consume Escape on a closed More button.


Suggested fix



```diff
--- a/libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-session-actions.component.ts
+++ b/libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-session-actions.component.ts
@@ -87,8 +87,9 @@
 
   protected onMenuKeydown(event: KeyboardEvent): void {
-    if (event.key === 'Escape') {
+    if (event.key === 'Escape' && this.moreOpen()) {
       event.preventDefault();
+      event.stopPropagation();
       this.closeMore();
     }
   }
--- a/libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-session-actions.component.html
+++ b/libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-session-actions.component.html
@@ -62,7 +62,7 @@
 @if (renameOpen()) {
   
     
+      (submit)="$event.preventDefault(); saveRename()" (keydown.escape)="$event.preventDefault(); $event.stopPropagation(); cancelRename()">
```









Committable suggestion



>  **IMPORTANT**
> Review the replacement and indentation, then test before committing.

```suggestion
  protected onMenuKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.moreOpen()) {
      event.preventDefault();
      event.stopPropagation();
      this.closeMore();
    }
  }
```










 

## id=4438570051 libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-session-actions.component.ts:122


** Minor** · **Functional Correctness** · **Quick win**


 Supported by static analysis



Script executed:

```bash
sed -n '110,130p' libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-session-actions.component.ts
sed -n '60,82p' libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-session-actions.component.html
```

Repository: Hive-Academy/ptah-extension

Length of output: 2054

---







**Focus the rename input after Angular renders it.**

`startRename()` sets `renameOpen` to `true` and then queues the focus call with `queueMicrotask`. The `#renameField` input exists only inside the `@if (renameOpen())` block. The microtask can run before Angular renders that block, so `renameField()` can return `undefined` and focus stays on the trigger. The form's `(keydown.escape)` handler is on the `` element, so Escape pressed while focus is on the trigger does not reach it. The rename still works with the mouse or after focus moves into the dialog. The impact is limited to keyboard and assistive-technology users.

Use `afterNextRender` so the focus call runs after the render completes. Keep `focus()` in the callback.


Suggested fix



```diff
   ChangeDetectionStrategy,
   Component,
   DestroyRef,
   ElementRef,
+  Injector,
   afterNextRender,
@@
   private readonly logger = inject(LoggingService);
+  private readonly injector = inject(Injector);
@@
-    queueMicrotask(() => this.renameField()?.nativeElement.focus());
+    afterNextRender(
+      () => this.renameField()?.nativeElement.focus(),
+      { injector: this.injector },
+    );
```








 

