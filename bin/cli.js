#!/usr/bin/env node
'use strict';

// vulpine — installer.
//
//   npx vulpine
//   npx vulpine --uninstall
//
// This installer downloads nothing: npx has already fetched the package, so
// chrome/ and user.js sit right next to this file. All that is left is picking
// the profile and copying.

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MARKER = '.vulpine';
const BEGIN_TAG = '// >>> vulpine';
const END_TAG = '// <<< vulpine';

const c = {
  head: (s) => `\x1b[36m${s}\x1b[0m`,
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[90m${s}\x1b[0m`,
};

const head = (s) => console.log(`\n${c.head(s)}`);
const step = (s) => console.log(`  ${s}`);

class UserError extends Error {}

// --- options ----------------------------------------------------------------

function parseArgs(argv) {
  const opts = { all: false, uninstall: false, force: false, link: false, profile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') opts.all = true;
    else if (a === '--uninstall') opts.uninstall = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--link') opts.link = true;
    else if (a === '--profile') {
      opts.profile = argv[++i];
      if (!opts.profile) throw new UserError('--profile expects a path.');
    } else if (a === '-h' || a === '--help') opts.help = true;
    else throw new UserError(`Unknown option: ${a}`);
  }
  return opts;
}

const HELP = `
vulpine — a compact Firefox theme, everything on a single row.

  npx vulpine [options]

  --all              install into every profile found, no question asked
  --profile <path>   target one specific profile
  --uninstall        remove the theme and the prefs it set
  --force            don't stop when the browser is still running
  --link             symlink chrome/ instead of copying it, from a clone
`;

// --- profile roots -----------------------------------------------------------

// Every Firefox-derived distribution keeps its own profile root, and on Linux
// Flatpak and Snap move it again into their sandbox. All of them use the same
// profiles.ini format.
function profileRoots() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return [
      ['Firefox', path.join(appdata, 'Mozilla', 'Firefox')],
      ['LibreWolf', path.join(appdata, 'librewolf')],
      ['Waterfox', path.join(appdata, 'Waterfox')],
      ['Floorp', path.join(appdata, 'Floorp')],
      ['Zen', path.join(appdata, 'zen')],
      ['Mullvad', path.join(appdata, 'Mullvad', 'MullvadBrowser')],
    ];
  }
  if (process.platform === 'darwin') {
    const app = path.join(home, 'Library', 'Application Support');
    return [
      ['Firefox', path.join(app, 'Firefox')],
      ['LibreWolf', path.join(app, 'LibreWolf')],
      ['Waterfox', path.join(app, 'Waterfox')],
      ['Floorp', path.join(app, 'Floorp')],
      ['Zen', path.join(app, 'zen')],
      ['Mullvad', path.join(app, 'MullvadBrowser')],
    ];
  }
  return [
    ['Firefox', path.join(home, '.mozilla', 'firefox')],
    ['Firefox (Flatpak)', path.join(home, '.var', 'app', 'org.mozilla.firefox', '.mozilla', 'firefox')],
    ['Firefox (Snap)', path.join(home, 'snap', 'firefox', 'common', '.mozilla', 'firefox')],
    ['LibreWolf', path.join(home, '.librewolf')],
    ['LibreWolf (Flatpak)', path.join(home, '.var', 'app', 'io.gitlab.librewolf-community', '.librewolf')],
    ['Waterfox', path.join(home, '.waterfox')],
    ['Floorp', path.join(home, '.floorp')],
    ['Floorp (Flatpak)', path.join(home, '.var', 'app', 'one.ablaze.floorp', '.floorp')],
    ['Zen', path.join(home, '.zen')],
    ['Zen (Flatpak)', path.join(home, '.var', 'app', 'app.zen_browser.zen', '.zen')],
    ['Mullvad', path.join(home, '.mullvad-browser')],
  ];
}

function readIni(file) {
  const data = new Map();
  let section = null;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) {
      section = sec[1];
      data.set(section, new Map());
      continue;
    }
    if (!section) continue;
    const eq = line.indexOf('=');
    if (eq > 0) data.get(section).set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  return data;
}

function getProfiles(dist, root) {
  const ini = readIni(path.join(root, 'profiles.ini'));
  const found = [];

  for (const [key, s] of ini) {
    if (!/^Profile\d+$/.test(key) || !s.has('Path')) continue;
    const raw = s.get('Path');
    const dir = s.get('IsRelative') === '0' ? raw : path.join(root, raw.replace(/\//g, path.sep));
    found.push({
      dist,
      name: s.get('Name') || path.basename(dir),
      dir,
      raw,
      iniDefault: s.get('Default') === '1',
      installDefault: false,
    });
  }

  // One [InstallHASH] section per browser installation, whose Default= names
  // the profile THAT installation opens. This is the reliable source: when the
  // release channel and Nightly share profiles.ini, the Default=1 of a
  // [ProfileN] only ever names the release, never the channel actually
  // launched. Older versions kept these sections in installs.ini.
  const sources = [ini];
  const installsIni = path.join(root, 'installs.ini');
  if (fs.existsSync(installsIni)) sources.push(readIni(installsIni));

  const norm = (p) => p.replace(/\\/g, '/');
  for (const src of sources) {
    for (const [key, s] of src) {
      if (!/^Install/.test(key) || !s.has('Default')) continue;
      const target = norm(s.get('Default'));
      for (const p of found) if (norm(p.raw) === target) p.installDefault = true;
    }
  }

  return found;
}

function getCandidates() {
  const all = [];
  for (const [dist, root] of profileRoots()) {
    if (!fs.existsSync(path.join(root, 'profiles.ini'))) continue;
    const profiles = getProfiles(dist, root).filter((p) => fs.existsSync(p.dir));
    if (!profiles.length) continue;
    let preferred = profiles.filter((p) => p.installDefault);
    if (!preferred.length) preferred = profiles.filter((p) => p.iniDefault);
    if (!preferred.length) preferred = profiles;
    all.push(...preferred);
  }
  return all;
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function selectProfiles(opts) {
  if (opts.profile) {
    if (!fs.existsSync(opts.profile)) throw new UserError(`No such profile: ${opts.profile}`);
    const dir = path.resolve(opts.profile);
    return [{ dist: 'manual', name: path.basename(dir), dir }];
  }

  const candidates = getCandidates();
  if (!candidates.length) {
    throw new UserError(
      'No profile found. Open about:support > Profile Directory, then run again with --profile <path>.'
    );
  }
  if (opts.all || candidates.length === 1) return candidates;

  if (!process.stdin.isTTY) {
    throw new UserError(
      'Several profiles found and no terminal to choose from. Run again with --all or --profile <path>.'
    );
  }

  head('Several default profiles found:');
  candidates.forEach((p, i) => {
    console.log(`  [${i}] ${p.dist} / ${p.name}`);
    console.log(`      ${c.dim(p.dir)}`);
  });
  console.log('  [a] all of them');

  const answer = await ask('Choice: ');
  if (answer === 'a') return candidates;
  const index = Number(answer);
  if (!Number.isInteger(index) || index < 0 || index >= candidates.length) {
    throw new UserError(`Invalid choice: ${answer}`);
  }
  return [candidates[index]];
}

// --- running browser ---------------------------------------------------------

// Firefox rewrites prefs.js on quit: installing while it runs can lose prefs,
// and the copied chrome would not be read.
function runningBrowsers() {
  const names = ['firefox', 'firefox-bin', 'firefox-esr', 'librewolf', 'waterfox', 'floorp', 'zen', 'mullvadbrowser'];
  const found = [];
  if (process.platform === 'win32') {
    let out = '';
    try {
      out = execFileSync('tasklist', ['/fo', 'csv', '/nh'], { encoding: 'utf8' });
    } catch {
      return [];
    }
    for (const n of names) if (out.toLowerCase().includes(`"${n}.exe"`)) found.push(n);
  } else {
    for (const n of names) {
      try {
        execFileSync('pgrep', ['-x', n], { stdio: 'ignore' });
        found.push(n);
      } catch {
        /* not running, or no pgrep */
      }
    }
  }
  return found;
}

function assertBrowserClosed(opts) {
  const running = runningBrowsers();
  if (!running.length) return;
  const list = running.join(', ');
  if (opts.force) {
    console.log(c.warn(`Warning: ${list} is still running, the result will only be right after a restart.`));
    return;
  }
  throw new UserError(
    `${list} is still running. Quit the browser completely (not just the window), or run again with --force.`
  );
}

// --- user.js ------------------------------------------------------------------

function stripBlock(text) {
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\r?\\n?${escape(BEGIN_TAG)}[\\s\\S]*?${escape(END_TAG)}\\r?\\n?`, 'g');
  return text.replace(re, '\n');
}

// The prefs are appended as a tagged block rather than overwriting the file: an
// existing user.js locks prefs its owner cares about. The block also makes
// reinstalling idempotent and uninstalling clean.
function mergeUserJs(profileDir) {
  const target = path.join(profileDir, 'user.js');
  const prefs = fs.readFileSync(path.join(ROOT, 'user.js'), 'utf8').trim();
  const existing = fs.existsSync(target) ? stripBlock(fs.readFileSync(target, 'utf8')).trim() : '';
  const block = `${BEGIN_TAG}\n${prefs}\n${END_TAG}\n`;
  fs.writeFileSync(target, existing ? `${existing}\n\n${block}` : block, 'utf8');
  step('user.js: vulpine block written.');
}

function clearUserJs(profileDir) {
  const target = path.join(profileDir, 'user.js');
  if (!fs.existsSync(target)) return;
  const rest = stripBlock(fs.readFileSync(target, 'utf8')).trim();
  if (rest) {
    fs.writeFileSync(target, `${rest}\n`, 'utf8');
    step('user.js: block removed, the rest of the file kept.');
  } else {
    fs.unlinkSync(target);
    step('user.js deleted (it held nothing but our block).');
  }
}

// --- chrome -------------------------------------------------------------------

// A link must never be removed recursively: that would wipe the contents of the
// repo it points at, not the link.
function removeChrome(target) {
  if (fs.lstatSync(target).isSymbolicLink()) {
    try {
      fs.unlinkSync(target);
    } catch {
      fs.rmdirSync(target); // Windows junctions come off with rmdir
    }
    return;
  }
  fs.rmSync(target, { recursive: true, force: true });
}

function stamp() {
  const p = (n) => String(n).padStart(2, '0');
  const d = new Date();
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function installTheme(profileDir, opts) {
  const chrome = path.join(profileDir, 'chrome');
  const marker = path.join(profileDir, MARKER);

  if (fs.existsSync(chrome) || isLink(chrome)) {
    if (fs.existsSync(marker)) {
      removeChrome(chrome);
      step('Previous install replaced.');
    } else {
      const backup = `${chrome}.backup-${stamp()}`;
      fs.renameSync(chrome, backup);
      step(`Existing chrome/ backed up: ${backup}`);
    }
  }

  const source = path.join(ROOT, 'chrome');
  if (opts.link) {
    // 'junction' rather than 'dir' on Windows: a symbolic link there needs
    // administrator rights, a junction does not.
    fs.symlinkSync(source, chrome, process.platform === 'win32' ? 'junction' : 'dir');
    step(`Link: ${chrome} -> ${source}`);
  } else {
    fs.cpSync(source, chrome, { recursive: true });
    step('chrome/ copied into the profile.');
  }

  fs.writeFileSync(
    marker,
    `mode=${opts.link ? 'link' : 'copy'}\nsource=${ROOT}\ndate=${new Date().toISOString()}\n`,
    'utf8'
  );
  mergeUserJs(profileDir);
}

function isLink(target) {
  try {
    return fs.lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
}

function uninstallTheme(profileDir) {
  const chrome = path.join(profileDir, 'chrome');
  const marker = path.join(profileDir, MARKER);

  if (!fs.existsSync(marker)) {
    step(`No ${MARKER} marker here: chrome/ left alone, it didn't come from this installer.`);
  } else if (fs.existsSync(chrome) || isLink(chrome)) {
    removeChrome(chrome);
    step('chrome/ removed.');
  }
  if (fs.existsSync(marker)) fs.unlinkSync(marker);
  clearUserJs(profileDir);

  for (const entry of fs.readdirSync(profileDir)) {
    if (entry.startsWith('chrome.backup-')) {
      step(`Backup to restore if you need it: ${path.join(profileDir, entry)}`);
    }
  }
}

// --- main ---------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }

  // --link points at the package folder. Under npx that is a cache npm can
  // purge at any time: the theme would break with no message.
  if (opts.link && !fs.existsSync(path.join(ROOT, '.git'))) {
    throw new UserError(
      '--link needs a clone of the repo: under npx the link would point into the npm cache. Clone the repo, then run node bin/cli.js --link.'
    );
  }

  head('vulpine');
  assertBrowserClosed(opts);
  const targets = await selectProfiles(opts);

  for (const t of targets) {
    head(`${opts.uninstall ? 'Uninstalling' : 'Installing'}: ${t.dist} / ${t.name}`);
    step(t.dir);
    if (opts.uninstall) uninstallTheme(t.dir);
    else installTheme(t.dir, opts);
  }

  console.log(
    `\n${c.ok(
      opts.uninstall
        ? 'Done. Restart the browser completely.'
        : 'Done. Restart the browser completely (not just the window).'
    )}`
  );
}

main().catch((err) => {
  if (err instanceof UserError) {
    console.error(`\n\x1b[31m${err.message}\x1b[0m`);
    process.exit(1);
  }
  throw err;
});
