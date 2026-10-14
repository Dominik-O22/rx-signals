import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/testing.ts'],
  format: ['esm', 'cjs'],
  target: 'es2022',
  dts: true,
  sourcemap: true,
  exports: true,
  publint: true,
  attw: { profile: 'node16' },
});
