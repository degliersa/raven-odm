import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  treeshake: true,
  target: 'node22',
  platform: 'node',
  clean: true,
  external: ['ravendb'],
})
