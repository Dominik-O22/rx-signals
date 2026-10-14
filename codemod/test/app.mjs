// Builds a throwaway app with rc23 stubs and the repo's TypeScript, then runs the codemod on it.
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from '../migrate-rx-signals.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoTypeScript = join(here, '..', '..', 'node_modules', 'typescript');

const PACKAGE_JSON = `{
  "name": "app",
  "dependencies": {
    "@angular/core": "19.2.17",
    "@rx-signals/angular-provider": "3.0.0-rc4",
    "@rx-signals/store": "3.0.0-rc23",
    "rxjs": "7.8.1"
  }
}
`;

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    strict: true,
    target: 'es2022',
    module: 'esnext',
    moduleResolution: 'bundler',
    lib: ['es2022'],
    types: [],
    experimentalDecorators: true,
    skipLibCheck: true,
    noEmit: true,
  },
  include: ['src/**/*.ts'],
});

/** Writes `files` ({ 'src/a.ts': '...' }) into a new app. Returns its directory. */
export function createApp(files) {
  const app = mkdtempSync(join(tmpdir(), 'rxs-codemod-test-'));
  writeFileSync(join(app, 'package.json'), PACKAGE_JSON);
  writeFileSync(join(app, 'tsconfig.json'), TSCONFIG);
  mkdirSync(join(app, 'node_modules', '@rx-signals', 'store'), { recursive: true });
  mkdirSync(join(app, 'node_modules', '@rx-signals', 'angular-provider'), { recursive: true });
  symlinkSync(repoTypeScript, join(app, 'node_modules', 'typescript'), 'dir');
  for (const [name, stub] of [
    ['store', 'store.d.ts'],
    ['angular-provider', 'angular-provider.d.ts'],
  ]) {
    const dir = join(app, 'node_modules', '@rx-signals', name);
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: `@rx-signals/${name}`, types: 'index.d.ts' }),
    );
    cpSync(join(here, 'rc23', stub), join(dir, 'index.d.ts'));
  }
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(app, path)), { recursive: true });
    writeFileSync(join(app, path), text);
  }
  return app;
}

/**
 * Migrates `files` and returns the migrated text of each file, the codemod's result, and the
 * result of a second run (which must change nothing).
 */
export function migrateFiles(files, options = {}) {
  const app = createApp(files);
  try {
    const result = migrate({ appDir: app, projects: ['tsconfig.json'], ...options });
    const output = Object.fromEntries(
      Object.keys(files).map(path => [path, readFileSync(join(app, path), 'utf8')]),
    );
    const packageJson = readFileSync(join(app, 'package.json'), 'utf8');
    const second = options.dry ? undefined : migrate({ appDir: app, projects: ['tsconfig.json'] });
    return { output, result, second, packageJson };
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
}

/** Migrates one file `src/a.ts` and returns its new text. Asserts the second run changes nothing. */
export function migrateSource(source) {
  const { output, second } = migrateFiles({ 'src/a.ts': source });
  if (second.files.length > 0) throw new Error(`second run changed:\n${second.files[0].after}`);
  return output['src/a.ts'];
}
