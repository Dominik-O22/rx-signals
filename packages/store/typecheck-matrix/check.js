// Type-checks consumer.ts against the emitted dist/*.d.ts on every TypeScript the package
// supports, with strictFunctionTypes on and off, without skipLibCheck. Run after `tsdown`.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { exit } from 'node:process';
import { error, log } from 'node:console';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const versions = ['5.5.4', '6.0', '7.0'];
const strictFunctionTypes = ['true', 'false'];

if (!existsSync(join(here, '..', 'dist', 'index.d.mts'))) {
  error('dist/index.d.mts is missing; build the package first');
  exit(1);
}

let failed = 0;
for (const version of versions) {
  for (const sft of strictFunctionTypes) {
    const label = `TypeScript ${version}, strictFunctionTypes ${sft}`;
    const result = spawnSync(
      'npx',
      [
        '-y',
        '-p',
        `typescript@${version}`,
        'tsc',
        '-p',
        join(here, 'tsconfig.json'),
        '--strictFunctionTypes',
        sft,
      ],
      { cwd: here, encoding: 'utf8' },
    );
    if (result.status === 0) {
      log(`ok   ${label}`);
    } else {
      failed += 1;
      log(`FAIL ${label}\n${result.stdout}${result.stderr}`);
    }
  }
}
exit(failed === 0 ? 0 : 1);
