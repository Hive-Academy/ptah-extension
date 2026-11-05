/* Prototype state renderer. Hash: #<state>&<dark|light> */
const ST = {
  online: ['s-online', 'Connected'],
  offline: ['s-offline', 'Offline'],
  recon: ['s-recon', 'Reconnecting'],
  skew: ['s-skew', 'Version mismatch'],
};
const status = (k, extra = '') =>
  `<span class="status ${ST[k][0]}"><span class="dot" aria-hidden="true"></span>${ST[k][1]}${extra}</span>`;

const machines = [
  ['Horus', 'horus', 'online', '2 running', 'ptah 0.1.70'],
  ['Anubis', 'anubis', 'recon', '1 running (last seen 12s ago)', 'ptah 0.1.70'],
  ['Chappie', 'chappie', 'skew', 'Not connected', 'ptah 0.1.60'],
  ['Gatsby-lab', 'gatsby-lab', 'offline', 'Last seen 3h ago', 'ptah 0.1.70'],
];
function machineList(active = 0, only) {
  const rows = (only || machines).map((m, i) => `
    <li class="mrow" tabindex="0" ${i === active ? 'aria-current="true"' : ''}>
      ${'<span></span>'}
      <span class="name">${m[0]} <span class="mono muted small">${m[1]}</span></span>
      ${status(m[2])}
      <span class="sub">${m[3]} &middot; ${m[4]}</span>
    </li>`).join('');
  return `<ul class="mlist" aria-label="Machines">${rows}</ul>`;
}
const side = (inner, head = 'Machines') => `
  <aside class="side" aria-label="Machines">
    <div class="side-head"><h2>${head}</h2>
      <button class="btn btn-xs btn-primary" type="button">Add machine</button></div>${inner}
    <p class="hint pad small">amun-PC (this machine) stays in <b>Chat</b>. Local sessions never depend on this list.</p>
  </aside>`;

const sessions = `
  <div class="wshead">~/work/ptah-extension</div>
  <div class="srow"><span class="status s-run"><span class="dot" aria-hidden="true"></span>Running</span><span class="t">Refactor RPC registry</span><span class="muted small mono prov">claude</span><span><button class="btn btn-xs" aria-label="Open session: Refactor RPC registry">Open</button></span></div>
  <div class="srow"><span class="status s-online"><span class="dot" aria-hidden="true"></span>Idle</span><span class="t">Write tests for pairing</span><span class="muted small mono prov">codex</span><span><button class="btn btn-xs" aria-label="Open session: Write tests for pairing">Open</button></span></div>
  <div class="srow"><span class="status s-skew"><span class="dot" aria-hidden="true"></span>Interrupted</span><span class="t">Migrate settings</span><span class="muted small mono prov">claude</span><span><button class="btn btn-xs" aria-label="Open session: Migrate settings">Open</button></span></div>
  <div class="wshead">~/work/notes</div>
  <div class="srow"><span class="status s-offline"><span class="dot" aria-hidden="true"></span>Idle</span><span class="t">Summarise sprint log</span><span class="muted small mono prov">claude</span><span><button class="btn btn-xs" aria-label="Open session: Summarise sprint log">Open</button></span></div>`;

const machineHeader = (name, st, right = '') => `
  <div class="session-head"><h2>${name}</h2>${status(st)}<span class="muted small">via SSH alias <code>${name.toLowerCase()}</code> &middot; ptah 0.1.70 &middot; protocol 3</span><span class="spacer"></span>${right}</div>`;

const live = (txt) => `<div class="sr-only" role="status" aria-live="polite">${txt}</div>`;

const S = {};

S.empty = {
  label: '1 Empty',
  html: () => `${side('<p class="pad muted small">No machines yet.</p>')}
  <main class="main"><div class="empty"><div class="inner">
    <h1>Control Ptah on your other machines</h1>
    <p class="muted">Add a machine by its SSH alias. Ptah reaches the worker through your existing SSH login, so nothing is opened on your network.</p>
    <button class="btn btn-primary" type="button">Add machine</button>
    <p class="hint">Needs Ptah installed and signed in on the worker. <a href="#readiness">What is checked?</a></p>
  </div></div></main>`,
};

S.add = {
  label: '2 Add + pair',
  html: () => `${side(machineList(0, []) + '<p class="pad muted small">No machines yet.</p>')}
  <main class="main"><div class="pad" style="max-width:640px">
    <h2 style="font-size:16px;margin-bottom:4px">Add machine</h2>
    <p class="muted">Step 1 of 2: connect. Step 2: pair.</p>
    <form onsubmit="return false">
    <div class="field"><label for="alias">SSH alias</label>
      <input class="input mono" id="alias" value="horus" aria-describedby="aliasHint" list="aliases">
      <datalist id="aliases"><option value="horus"><option value="anubis"><option value="chappie"></datalist>
      <span class="hint" id="aliasHint">Hosts from your <code>~/.ssh/config</code>. Typing starts a suggestion list; you can type any alias.</span></div>
    <div class="panel" style="padding:16px 22px;margin-bottom:14px">
      <b>Pairing code</b>
      <p class="muted small" style="margin:4px 0 8px">On Horus, open the pairing window (desktop app: Settings, Remote access, or run the command below over SSH). The code is shown once and expires in 5 minutes.</p>
      <div class="cmd"><code>ptah worker pair</code><button class="btn btn-xs" type="button">Copy</button></div>
      <div class="field" style="margin-top:12px"><label for="c1">Enter the 8-character code</label>
        <div class="code-cells" role="group" aria-label="Pairing code, 8 characters">
          ${'K7QM4X2P'.split('').map((c, i) => `<input class="input mono" id="${i ? 'c' + (i + 1) : 'c1'}" maxlength="1" value="${c}" aria-label="Character ${i + 1}" inputmode="text" autocapitalize="characters">`).join('')}
        </div></div>
      <p class="hint">Over SSH, Ptah can read the code for you: <button class="btn btn-xs" type="button">Pair automatically via SSH</button></p>
    </div>
    <div style="display:flex;gap:8px"><button class="btn btn-primary" type="submit">Pair and connect</button><button class="btn" type="button">Cancel</button></div>
    </form></div></main>`,
};

S.pairfail = {
  label: '3 Pairing failed',
  html: () => `${side('<p class="pad muted small">No machines yet.</p>')}
  <main class="main"><div class="pad" style="max-width:640px">
    <h2 style="font-size:16px;margin-bottom:4px">Add machine</h2>
    <div class="banner err" role="alert"><span class="lbl">Pairing failed</span>
      <span>The code was not accepted. It may be wrong, expired or already used; Ptah cannot tell which. If the pairing window on Horus is still open, check the code and try again (2 attempts left). If it closed or expired, open a new one on Horus.</span></div>
    <div class="field"><label for="alias2">SSH alias</label><input class="input mono" id="alias2" value="horus"></div>
    <div class="field"><label for="d1">Pairing code</label>
      <div class="code-cells" role="group" aria-label="Pairing code, 8 characters">
        ${'K7QM4X2P'.split('').map((c, i) => `<input class="input mono bad" id="${i ? 'd' + (i + 1) : 'd1'}" maxlength="1" value="${c}" aria-label="Character ${i + 1}" aria-invalid="true">`).join('')}
      </div><span class="hint">Nothing was stored. No token exists for Horus on this machine.</span></div>
    <div style="display:flex;gap:8px"><button class="btn btn-primary" type="button">Try again</button><button class="btn" type="button">Cancel</button></div>
    <h3 style="margin-top:24px;font-size:13px">Other failures use the same pattern</h3>
    <ul class="small muted"><li><b>Cannot reach host.</b> SSH to <code>horus</code> failed: connection timed out. Check the alias and that the machine is on.</li>
    <li><b>Too many attempts.</b> The worker closed its pairing window. Open a new one on the worker.</li></ul>
  </div></main>${live('Pairing failed')}`,
};

S.readiness = {
  label: '4 Readiness',
  html: () => `${side(machineList(0, [['Horus', 'horus', 'offline', 'Not ready', 'ptah 0.1.70']]))}
  <main class="main"><div class="pad" style="max-width:720px">
    <h2 style="font-size:16px">Horus: readiness check</h2>
    <div class="banner warn" role="status"><span class="lbl">Not ready</span><span>2 of 6 checks need your attention. Sessions cannot start on Horus until they pass.</span></div>
    <ol class="steps panel" style="margin:12px 20px">
      <li class="step pass"><span class="mark" aria-hidden="true">&#10003;</span><div><b>Pass</b> &middot; Worker service reachable<div class="muted small">Loopback 127.0.0.1:7421 over SSH</div></div></li>
      <li class="step pass"><span class="mark" aria-hidden="true">&#10003;</span><div><b>Pass</b> &middot; Versions compatible<div class="muted small">Ptah 0.1.70, protocol 3</div></div></li>
      <li class="step pass"><span class="mark" aria-hidden="true">&#10003;</span><div><b>Pass</b> &middot; Node 22.4<div class="muted small">Required: 20 or newer</div></div></li>
      <li class="step fail"><span class="mark" aria-hidden="true">&#10007;</span><div><b>Fail</b> &middot; Claude provider not signed in
        <div class="muted small">Sign in on Horus, then re-check.</div><div class="cmd"><code>claude login</code><button class="btn btn-xs">Copy</button></div></div></li>
      <li class="step warn"><span class="mark" aria-hidden="true">!</span><div><b>Warning</b> &middot; Codex CLI not installed
        <div class="muted small">Optional. Sessions with the Codex provider will be unavailable.</div><div class="cmd"><code>npm i -g @openai/codex</code><button class="btn btn-xs">Copy</button></div></div></li>
      <li class="step pass"><span class="mark" aria-hidden="true">&#10003;</span><div><b>Pass</b> &middot; Workspace folders readable<div class="muted small">2 workspaces found</div></div></li>
    </ol>
    <div style="padding:0 20px;display:flex;gap:8px"><button class="btn btn-primary" type="button">Check again</button><button class="btn" type="button">Copy report</button></div>
    <p class="hint pad small">The same list is printed by <code>ptah worker doctor</code> on the worker.</p>
  </div></main>`,
};

S.list = {
  label: '5 Machine list',
  html: () => `${side(machineList(0))}
  <main class="main">${machineHeader('Horus', 'online', '<button class="btn btn-primary">New session</button><button class="btn btn-danger">Remove machine</button>')}
    ${sessions}
    <p class="hint pad small">Anubis, Chappie and Gatsby-lab sessions appear when you select them. Phase 2: the left list shows every machine at once (as here).</p>
  </main>`,
};
S.listRecon = {
  label: '5b Reconnecting / skew',
  html: () => `${side(machineList(1))}
  <main class="main">${machineHeader('Anubis', 'recon', '<button class="btn">Retry now</button>')}
    <div class="banner warn" role="status"><span class="lbl">Reconnecting</span><span>Lost contact 12 s ago. Sessions on Anubis keep running; they are shown as <b>unknown</b>, not failed. Next attempt in 5 s.</span></div>
    ${sessions.replace(/s-run/g, 's-recon').replace('Running', 'Running (last known)')}
    <div class="banner err" role="alert" style="margin-top:20px"><span class="lbl">Chappie: version mismatch</span><span>This app speaks protocol 3 (Ptah 0.1.70). Chappie runs Ptah 0.1.60, protocol 2. Not connected. Update Chappie, then reconnect. <button class="btn btn-xs">Copy update command</button></span></div>
  </main>`,
};

const transcript = (extra = '', bare = false) => `
  <div class="tx" role="log" aria-label="Session transcript">
    ${bare ? '' : `<div class="msg user"><span class="who">You</span><div class="body-t">Refactor the RPC registry so every method is declared once.</div></div>
    <div class="msg"><span class="who">Claude on Horus</span><div>I will read the current registry first, then list every call site.</div></div>
    <div class="tool"><div class="hd"><span class="status s-online"><span class="dot" aria-hidden="true"></span>Done</span><b>Read</b><code class="mono small">rpc-host-profile.ts</code></div></div>`}
    ${extra}
  </div>`;

const sessionHead = (right = '') => `
  <div class="session-head"><h2>Refactor RPC registry</h2><span class="muted small">on <b>Horus</b> &middot; ~/work/ptah-extension</span>
    ${status('online')}<span class="spacer"></span>${right}</div>`;

S.stream = {
  label: '6 Session streaming',
  html: () => `${side(machineList(0))}
  <main class="main">${sessionHead('<button class="btn">Stop</button>')}
    ${transcript(`<div class="tool"><div class="hd"><span class="status s-run"><span class="dot" aria-hidden="true"></span>Running</span><b>Grep</b><code class="mono small">registerRpcSurface</code></div></div>
      <div class="msg"><span class="who">Claude on Horus</span><div>Found 14 call sites. Updating the host profile<span class="caret" aria-hidden="true"></span></div></div>`)}
    <div class="composer"><input class="input" aria-label="Message to Claude on Horus" placeholder="Message Claude on Horus (a turn is in progress)"><button class="btn btn-primary" disabled>Send</button></div>
  </main>${live('Claude is responding')}`,
};

S.approval = {
  label: '7 Approval pending',
  html: () => `${side(machineList(0))}
  <main class="main">${sessionHead()}
    ${transcript()}
    <div class="approval" role="group" aria-labelledby="ap1">
      <div class="title" id="ap1"><span class="badge badge-attn">Waiting for you</span> Horus wants to run a command</div>
      <dl class="kv"><dt>Machine</dt><dd><b>Horus</b></dd><dt>Session</dt><dd>Refactor RPC registry</dd><dt>Tool</dt><dd><b>Bash</b></dd><dt>Arguments</dt><dd><code class="mono">npm run verify -- -p ptah-electron</code></dd><dt>If unanswered</dt><dd>Stays pending, like a local request.</dd></dl>
      <div class="actions"><button class="btn btn-primary" type="button">Allow once</button><button class="btn" type="button">Deny</button><span class="hint">The session stays paused until someone answers.</span></div>
    </div>
  </main>${live('Approval needed for Bash on Horus')}`,
};
S.approvalLost = {
  label: '7b Answered elsewhere (Phase 2)',
  html: () => `${side(machineList(0))}
  <main class="main">${sessionHead('<span class="chip">Phase 2: 2 viewers</span>')}
    ${transcript()}
    <div class="approval done" role="group" aria-labelledby="ap2">
      <div class="title" id="ap2"><span class="badge">Phase 2 example</span> <span class="badge">Already answered</span> Bash on Horus</div>
      <p class="small" style="margin:6px 0 0">Allowed once from <b>the keyboard on Horus</b> at 14:02:11. Your answer was not applied; the session continues.</p>
      <dl class="kv"><dt>Arguments</dt><dd><code class="mono">npm run verify -- -p ptah-electron</code></dd></dl>
    </div>
    <div class="tx"><div class="tool"><div class="hd"><span class="status s-run"><span class="dot" aria-hidden="true"></span>Running</span><b>Bash</b><code class="mono small">npm run verify ...</code></div></div></div>
  </main>${live('Already answered on Horus; your answer was not applied')}`,
};
S.approvalDenied = {
  label: '7c Not permitted (Phase 1)',
  html: () => `${side(machineList(0))}
  <main class="main">${sessionHead()}${transcript()}
    <div class="approval" role="group" aria-labelledby="ap3">
      <div class="title" id="ap3"><span class="badge badge-attn">Waiting</span> Bash on Horus</div>
      <div class="banner err" role="alert" style="margin:8px 0 0"><span class="lbl">Not allowed</span><span>This request could not be answered from this app. The session was not found, or this machine's access on Horus does not include it. Check the access list on Horus (<code>ptah worker grants</code>), or answer at Horus.</span></div>
      <div class="actions"><button class="btn" disabled>Allow once</button><button class="btn" disabled>Deny</button></div>
    </div></main>`,
};

S.replay = {
  label: '8 Reconnect + replay',
  html: () => `${side(machineList(0))}
  <main class="main">${sessionHead('<span class="chip">Caught up</span>')}
    <div class="banner ok" role="status"><span class="lbl">Reconnected</span><span>Replayed 37 events from #1204 to #1241 while the link was down. No gaps, duplicates removed.</span></div>
    ${transcript(`
      <div class="divider">Connection lost 14:07:02</div>
      <div class="replayed"><span class="badge">Replayed</span> <div class="tool" style="margin-top:6px"><div class="hd"><span class="status s-online"><span class="dot" aria-hidden="true"></span>Done</span><b>Edit</b><code class="mono small">rpc-host-profile.ts</code></div></div></div>
      <div class="replayed"><span class="badge">Replayed</span> <div class="msg" style="margin-top:6px"><span class="who">Claude on Horus</span><div>Updated 14 call sites. Running the type check.</div></div></div>
      <div class="divider">Reconnected 14:07:19 &middot; live</div>
      <div class="msg"><span class="who">Claude on Horus</span><div>Type check passed.</div></div>`)}
    <p class="hint pad small">Snapshot fallback (Phase 2): if the log is too old, the banner reads "Restored from snapshot" and the transcript is replaced in place.</p>
  </main>${live('Reconnected, 37 events replayed')}`,
};

const watchBody = (o) => `${side(machineList(0))}
  <main class="main">${sessionHead(o.head)}
    ${o.banner}
    ${transcript(o.tx || `<div class="msg"><span class="who">Claude on Horus</span><div>Updating the host profile. The next command needs permission.</div></div>
      <div class="divider">Saved up to 14:02:11. Newer activity is not shown.</div>`, !!o.tx)}
    ${o.noReq ? '' : `<div class="approval" role="group" aria-labelledby="ap9" tabindex="0">
      <div class="title" id="ap9"><span class="badge badge-attn">Waiting at Horus</span> Horus is waiting for an answer</div>
      <dl class="kv"><dt>Machine</dt><dd><b>Horus</b></dd><dt>Tool</dt><dd><b>Bash</b></dd><dt>Arguments</dt><dd><code class="mono">npm run verify -- -p ptah-electron</code></dd></dl>
      <p style="margin:10px 0 0">Answer this request at Horus. It cannot be answered from this app.</p>
    </div>`}
    <div class="composer"><input class="input" style="border-style:dashed;cursor:not-allowed" aria-label="Message to Claude on Horus" aria-describedby="own9" placeholder="${o.ph || 'Sending is unavailable: driven from Horus'}" disabled><button class="btn btn-disabled-quiet" disabled aria-describedby="why9">Send</button><span class="sr-only" id="own9">${o.desc || 'Someone at Horus is driving this session. Sending is unavailable until they are done.'}</span></div>
    <p class="hint pad small">${o.note}</p>
  </main>${live(o.live)}`;

const watchHead = (chip) => `<button class="btn btn-ghost" type="button">Refresh</button><span class="chip">${chip}</span><button class="btn btn-disabled-quiet" disabled aria-describedby="why9">Stop</button>`;

S.owner = {
  label: '9 Watch only',
  html: () => watchBody({
    head: watchHead('&#128274; Driver: Horus keyboard'),
    banner: `<div class="banner info" role="status" id="why9"><span class="lbl">Watch only</span><span><b>Horus keyboard</b> is driving this session. You can read what was saved so far. Sending, stopping and answering requests are unavailable until they are done.<br><span class="small" style="color:var(--bcm)">Last saved 14:02:11. Press Refresh to check again.</span><details><summary>Who has it? (local lock only)</summary><dl class="kv"><dt>Kind</dt><dd>Ptah desktop app</dd><dt>Machine</dt><dd>Horus</dd><dt>Process</dt><dd><code class="mono">4182</code></dd><dt>Since</dt><dd>13:58</dd></dl></details></span></div>`,
    note: 'Remote clients get only the label (drivenBy), so this disclosure is absent there. Reverse case: on Horus\'s own Ptah the banner reads "Watch only. Driven remotely by amun-PC." No take-over control in Phase 1 (1.5).',
    live: 'This session is driven by Horus. Watch only.',
  }),
};

S.ownerHung = {
  label: '9b Holder not responding',
  html: () => watchBody({
    head: watchHead('&#128274; Driver: another Ptah process (not responding)'),
    banner: `<div class="banner warn" role="status" id="why9"><span class="lbl">Watch only</span><span>Another Ptah process holds this session and is not answering. It may be busy or paused. The session stays locked until that process finishes or is closed.<br><b>Close or stop that process on Horus.</b><br><span class="small" style="color:var(--bcm)">If it has already ended its session, <code class="mono">ptah worker locks release &lt;session id&gt;</code> on Horus frees the lock. It refuses with <code class="mono">in-use</code> while that process still has a live session; then the only fix is to close or recover that process.</span></span></div>`,
    note: 'The app never calls the lock stale and never offers to release it: liveness is not inferred from time (W10).',
    live: 'Another Ptah process holds this session and is not responding. Watch only.',
  }),
};

S.ownerUnavail = {
  label: '9c Lock unavailable',
  html: () => watchBody({
    head: watchHead('&#9888; Not available'),
    banner: `<div class="banner err" role="alert" id="why9"><span class="lbl">Cannot check who has this session</span><span>This machine could not confirm that no one else is using this session, so it will not start or send anything. Try again, and if it keeps happening check the Ptah log on Horus.<br><code class="mono small">DRIVER_LOCK_UNAVAILABLE &middot; ref 7f3a9c</code></span></div>`,
    tx: `<p class="hint pad">No saved history is available because the session could not be checked.</p>`,
    noReq: true,
    ph: 'Sending is unavailable',
    desc: 'This app could not check who has this session. Sending is unavailable.',
    note: 'Remote variant, first attach: fixed copy and log ref only, no history, no request block, no owner text. On the worker\'s own Ptah the banner shows the verbatim cause and fix and the code SESSION_DRIVER_LOCK_UNAVAILABLE.',
    live: 'Cannot check who has this session.',
  }),
};

S.ownerFree = {
  label: '9d Lock freed',
  html: () => `${side(machineList(0))}
  <main class="main">${sessionHead('<button class="btn btn-ghost" type="button">Refresh</button><span class="chip">Idle</span><button class="btn" type="button">Stop</button>')}
    <div class="banner ok" role="status"><span class="lbl">Available</span><span>Horus finished. You can send messages again.</span></div>
    ${transcript(`<div class="msg"><span class="who">Claude on Horus</span><div>Updated the host profile. Type check passed.</div></div>`)}
    <div class="composer"><input class="input" aria-label="Message to Claude on Horus" placeholder="Message Claude on Horus"><button class="btn btn-primary">Send</button></div>
    <p class="hint pad small">Focus is not moved. If another process wins the lock first, Send is refused and the view returns to 9 with the new holder.</p>
  </main>${live('Horus finished. You can send messages again.')}`,
};

// No local workspace folders: the shell hides the usual tab strip; Machines stays reachable.
S.nofolders = {
  label: '10 No local folder',
  minimal: true, active: false,
  html: () => `<main class="main"><div class="empty"><div class="inner">
    <h1>Open a folder to start local work</h1>
    <p class="muted">Machines is available without a local folder: your paired machines and their sessions are one click away.</p>
    <button class="btn btn-primary" type="button">Open folder</button>
    <button class="btn" type="button">Machines (1 connected)</button>
  </div></div></main>`,
};
S.nofoldersList = {
  label: '10b No folder: Machines',
  minimal: true, active: true,
  html: () => `${side(machineList(0))}
  <main class="main">${machineHeader('Horus', 'online', '<button class="btn btn-primary">New session</button><button class="btn btn-danger">Remove machine</button>')}
    ${sessions}
    <p class="hint pad small">With no local folder, the navbar shows only Machines; Chat, Voice, Apps, Tasks, Analytics and Setup hub return when a folder opens.</p>
  </main>`,
};

const order = Object.keys(S);
const bar = document.getElementById('stateLinks');
bar.innerHTML = order.map((k) => `<a href="#${k}" data-k="${k}">${S[k].label}</a>`).join('');
function render() {
  const parts = location.hash.slice(1).split('&');
  const key = S[parts[0]] ? parts[0] : 'list';
  const light = parts.includes('light');
  document.documentElement.dataset.theme = light ? 'ptah-glass-light' : 'ptah-glass';
  document.getElementById('themeBtn').textContent = 'Theme: ' + (light ? 'light' : 'dark');
  document.getElementById('body').innerHTML = S[key].html();
  const min = !!S[key].minimal;
  document.querySelectorAll('.tabs .tab:not(#machinesTab)').forEach((t) => (t.hidden = min));
  const mt = document.getElementById('machinesTab');
  const act = S[key].active !== false;
  mt.classList.toggle('tab-active', act);
  mt.setAttribute('aria-selected', String(act));
  const tabs = document.querySelector('.tabs');
  tabs.scrollLeft = 0;
  tabs.scrollLeft = Math.max(0, mt.offsetLeft - (tabs.clientWidth - mt.offsetWidth) / 2); // active tab scrolled into view
  tabs.tabIndex = -1;
  document.getElementById('navAttn').hidden = ['empty', 'add', 'pairfail', 'readiness', 'nofolders'].includes(key);
  bar.querySelectorAll('a').forEach((a) => { a.setAttribute('aria-current', a.dataset.k === key ? 'true' : 'false'); a.href = '#' + a.dataset.k + (light ? '&light' : ''); });
}
document.getElementById('themeBtn').onclick = () => {
  const parts = location.hash.slice(1).split('&');
  location.hash = parts[0] + (parts.includes('light') ? '' : '&light');
};
window.addEventListener('hashchange', render);
render();
