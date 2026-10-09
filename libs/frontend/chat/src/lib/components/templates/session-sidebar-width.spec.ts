import {
  SESSION_SIDEBAR_DEFAULT_WIDTH,
  SESSION_SIDEBAR_FLOOR_WIDTH,
  SESSION_SIDEBAR_MAIN_MIN_WIDTH,
  SESSION_SIDEBAR_MAX_WIDTH,
  SESSION_SIDEBAR_MIN_WIDTH,
  SESSION_SIDEBAR_TAB_RESERVE,
  clampSessionSidebarWidth,
  nextChosenSessionSidebarWidth,
  parseStoredSessionSidebarWidth,
  sessionSidebarWidthCap,
  sessionSidebarWidthFromDividerDrag,
} from './session-sidebar-width';

const RESERVED = SESSION_SIDEBAR_TAB_RESERVE + SESSION_SIDEBAR_MAIN_MIN_WIDTH;

describe('sessionSidebarWidthCap', () => {
  it('applies only the max before the row is measured', () => {
    expect(sessionSidebarWidthCap(0)).toBe(SESSION_SIDEBAR_MAX_WIDTH);
  });

  it('leaves the main area its minimum when the row has room', () => {
    expect(sessionSidebarWidthCap(RESERVED + 300)).toBe(300);
    expect(sessionSidebarWidthCap(RESERVED + 1000)).toBe(
      SESSION_SIDEBAR_MAX_WIDTH,
    );
  });

  it('never drops below the pre-resizer width, so narrow shells lay out as before', () => {
    // Electron's 400 px app-shell minimum, and a narrow VS Code side panel.
    expect(sessionSidebarWidthCap(440)).toBe(SESSION_SIDEBAR_FLOOR_WIDTH);
    expect(sessionSidebarWidthCap(300)).toBe(SESSION_SIDEBAR_FLOOR_WIDTH);
  });
});

describe('clampSessionSidebarWidth', () => {
  it('clamps to the minimum and to the cap, in whole px', () => {
    expect(clampSessionSidebarWidth(120, 400)).toBe(SESSION_SIDEBAR_MIN_WIDTH);
    expect(clampSessionSidebarWidth(450, 400)).toBe(400);
    expect(clampSessionSidebarWidth(250.6, 400)).toBe(251);
  });
});

describe('sessionSidebarWidthFromDividerDrag', () => {
  it('adds the pointer delta to the sessions width, not the absolute pointer', () => {
    // Workspace chrome can sit at x=252. A pointer of 292 is +40px, so the
    // sessions pane goes from 272 to 312. It must not become 292 (that number
    // is the workspace divider's absolute X).
    expect(sessionSidebarWidthFromDividerDrag(272, 252, 292)).toBe(312);
    expect(sessionSidebarWidthFromDividerDrag(272, 252, 212)).toBe(232);
  });
});

describe('nextChosenSessionSidebarWidth', () => {
  it('keeps a wider choice when the cap turns the request into no change', () => {
    // Chosen 480, capped at 224: ArrowRight (+16) and an outward drag.
    expect(nextChosenSessionSidebarWidth(240, 480, 224)).toBe(480);
    expect(nextChosenSessionSidebarWidth(600, 480, 224)).toBe(480);
  });

  it('stores a request that changes the rendered width', () => {
    expect(nextChosenSessionSidebarWidth(208, 480, 224)).toBe(208);
    expect(nextChosenSessionSidebarWidth(300, 272, 400)).toBe(300);
    expect(nextChosenSessionSidebarWidth(600, 272, 400)).toBe(400);
  });
});

describe('parseStoredSessionSidebarWidth', () => {
  it('falls back to the default when missing or not a number', () => {
    expect(parseStoredSessionSidebarWidth(null)).toBe(
      SESSION_SIDEBAR_DEFAULT_WIDTH,
    );
    expect(parseStoredSessionSidebarWidth('wide')).toBe(
      SESSION_SIDEBAR_DEFAULT_WIDTH,
    );
  });

  it('keeps a stored width inside the bounds, ignoring the cap', () => {
    expect(parseStoredSessionSidebarWidth('360')).toBe(360);
    expect(parseStoredSessionSidebarWidth('9000')).toBe(
      SESSION_SIDEBAR_MAX_WIDTH,
    );
    expect(parseStoredSessionSidebarWidth('10')).toBe(
      SESSION_SIDEBAR_MIN_WIDTH,
    );
  });
});
