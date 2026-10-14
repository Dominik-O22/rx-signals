// Runs the rc23 Angular fixture app against the packages built from this checkout.
// Zero dependencies. Needs Node >= 22, npm, pnpm and a Chromium/Chrome binary (or CHROME_BIN).
//
//   node scripts/fixture-gate.mjs
//
// The app's `@rx-signals/store` dependency is replaced by the local store tarball under the
// old name, so the unchanged app (and angular-provider rc4) runs on the fork. The gate passes
// when the app type-checks, builds, passes its Karma specs, and its selftest report equals
// baseline-report.json, which was recorded on the published rc23.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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
const storeTarball = readdirSync(tarballs).find(file => file.includes('-store-'));
if (!storeTarball) throw new Error(`no store tarball in ${tarballs}`);

cpSync(fixture, app, {
  recursive: true,
  filter: source => !/[/\\](node_modules|dist|\.angular)$/.test(source),
});
run('npm', ['ci', '--no-audit', '--no-fund'], app);
run('npm', ['install', '--no-save', `@rx-signals/store@file:${join(tarballs, storeTarball)}`], app);

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
console.log('fixture gate passed: typecheck, build, karma, selftest report identical to rc23');

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
