// Release helper for .github/workflows/release.yml. Zero dependencies.
//   node scripts/release.mjs check <tag>               every public package version must equal the tag (v1.2.3 -> 1.2.3)
//   node scripts/release.mjs publish <dir> <dist-tag>  npm publish each tarball in <dir>, skipping versions already on npm
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const run = (cmd, args) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

const isPublished = (name, version) => {
  try {
    return run('npm', ['view', `${name}@${version}`, 'version']).trim() === version;
  } catch {
    return false;
  }
};

const [command, ...args] = process.argv.slice(2);

if (command === 'check') {
  const version = args[0]?.replace(/^v/, '');
  const mismatches = readdirSync('packages')
    .map(dir => JSON.parse(readFileSync(join('packages', dir, 'package.json'), 'utf8')))
    .filter(pkg => !pkg.private && pkg.version !== version)
    .map(pkg => `${pkg.name} is ${pkg.version}`);
  if (!version || mismatches.length > 0) {
    console.error(`tag ${args[0]} does not match: ${mismatches.join(', ') || 'no tag given'}`);
    process.exit(1);
  }
  console.log(`all packages at ${version}`);
} else if (command === 'publish') {
  const [dir, distTag] = args;
  for (const file of readdirSync(dir).filter(f => f.endsWith('.tgz'))) {
    const tarball = join(dir, file);
    const { name, version } = JSON.parse(run('tar', ['-xzOf', tarball, 'package/package.json']));
    if (isPublished(name, version)) {
      console.log(`skip ${name}@${version}: already on npm`);
      continue;
    }
    // Provenance is automatic with trusted publishing; the flag also covers the token bootstrap.
    run('npm', ['publish', tarball, '--access', 'public', '--provenance', '--tag', distTag]);
    console.log(`published ${name}@${version} as ${distTag}`);
  }
} else {
  console.error('usage: release.mjs check <tag> | publish <dir> <dist-tag>');
  process.exit(1);
}
