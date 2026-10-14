// Runs the rc23 Angular fixture app against the packages built from this checkout.
// Zero dependencies. Needs Node >= 22, npm, pnpm and a Chromium/Chrome binary (or CHROME_BIN).
//
//   node scripts/fixture-gate.mjs             alias mode (default)
//   node scripts/fixture-gate.mjs --migrate   codemod mode
//
// Alias mode: the app's `@rx-signals/store` dependency is replaced by the local store tarball
// under the old name, so the unchanged app (and angular-provider rc4) runs on the fork.
//
// Codemod mode: codemod/migrate-rx-signals.mjs migrates a copy of the app to v4, and the local
// store and angular tarballs are installed under their v4 names. This proves the codemod and the
// v4 packages together, the way the real app will be migrated.
//
// Either way the gate passes when the app type-checks, builds, passes its Karma specs, and its
// selftest report equals baseline-report.json, which was recorded on the published rc23.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const migrateMode = process.argv.includes('--migrate');
const repo = resolve(import.meta.dirname, '..');
const fixture = join(repo, 'fixtures', 'angular19-rc23');
const work = mkdtempSync(join(tmpdir(), 'rxs-fixture-'));
const app = join(work, 'app');
const tarballs = join(work, 'tarballs');

const run = (cmd, args, cwd, options = {}) => {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  return execFileSync(cmd, args, { cwd, stdio: 'inherit', ...options });
};

run('pnpm', ['build'], repo);
run('pnpm', ['-r', 'pack', '--pack-destination', tarballs], repo);
const tarball = name => {
  const file = readdirSync(tarballs).find(f => f.includes(`-${name}-`));
  if (!file)
    throw new Error(`no ${name} tarball in ${tarballs}: is packages/${name} in the workspace?`);
  return join(tarballs, file);
};

cpSync(fixture, app, {
  recursive: true,
  filter: source => !/[/\\](node_modules|dist|\.angular)$/.test(source),
});
run('npm', ['ci', '--no-audit', '--no-fund'], app);

if (migrateMode) {
  run('node', [join(repo, 'codemod', 'migrate-rx-signals.mjs'), app], repo);
  // The hand edits the codemod leaves, as MIGRATION.md describes them. Its file list is the
  // migration cost on the fixture. It stops applying when the codemod output changes.
  run('git', ['apply', join(repo, 'codemod', 'fixture-hand-edits.patch')], app);
  // The codemod wrote its own v4 names into package.json. They must be the workspace's names.
  const deps = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).dependencies;
  const local = ['store', 'angular'].map(dir => {
    const manifest = join(repo, 'packages', dir, 'package.json');
    if (!existsSync(manifest)) throw new Error(`--migrate needs the v4 package packages/${dir}`);
    const { name } = JSON.parse(readFileSync(manifest, 'utf8'));
    if (!(name in deps)) {
      throw new Error(
        `codemod did not add ${name}; reconcile the V4 table in codemod/migrate-rx-signals.mjs`,
      );
    }
    return `dependencies.${name}=file:${tarball(dir)}`;
  });
  run('npm', ['pkg', 'set', ...local], app);
  run('npm', ['install', '--no-audit', '--no-fund'], app);
  run('node', [join(repo, 'codemod', 'migrate-rx-signals.mjs'), app, '--check'], repo);
} else {
  run('npm', ['install', '--no-save', `@rx-signals/store@file:${tarball('store')}`], app);
}

run('npm', ['run', 'typecheck'], app);
run('npm', ['run', 'build'], app);
run('npx', ['ng', 'test', '--watch=false', '--browsers=ChromeHeadless'], app, {
  env: { ...process.env, CHROME_BIN: process.env.CHROME_BIN ?? findChrome() },
});

const report = execFileSync('node', ['scripts/selftest.mjs'], { cwd: app, encoding: 'utf8' });
writeFileSync(join(work, 'report.json'), report);
const baseline = readFileSync(join(fixture, 'baseline-report.json'), 'utf8');
if (report !== baseline) {
  console.error(
    `selftest report differs from baseline: diff ${join(fixture, 'baseline-report.json')} ${join(work, 'report.json')}`,
  );
  process.exit(1);
}
const mode = migrateMode ? 'codemod to v4' : 'rc23 app on the fork store';
console.log(
  `fixture gate passed (${mode}): typecheck, build, karma, selftest report identical to rc23`,
);

function findChrome() {
  for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    try {
      return execFileSync('which', [name], { encoding: 'utf8' }).trim();
    } catch {
      // try the next name
    }
  }
  throw new Error('no Chromium/Chrome on PATH; set CHROME_BIN');
}
