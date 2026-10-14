import { defineConfig } from 'tsdown';

// ESM only: Angular itself ships ESM only, so every consumer of this package can load ESM.
export default defineConfig({
  entry: 'src/index.ts',
  format: ['esm'],
  target: 'es2022',
  dts: true,
  sourcemap: true,
  exports: true,
  publint: true,
  attw: { profile: 'esm-only' },
});
