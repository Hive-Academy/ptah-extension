// Specs must never write under the developer's real home folder. With 0057
// registered, a runner without an archiveRoot archives the skill pipeline to
// ~/.ptah/backups/skill-pipeline, so each spec file gets a temporary home.
// Jest gives the sandbox a copy of process.env, which the native
// os.homedir() never reads, so the function itself is replaced. A plain
// assignment (not jest.spyOn) survives jest.restoreAllMocks() in a spec.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const parent = path.join(os.tmpdir(), 'ptah-persistence-sqlite-jest');
fs.mkdirSync(parent, { recursive: true });
const home = fs.mkdtempSync(path.join(parent, 'home-'));
os.homedir = () => home;
