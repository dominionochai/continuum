import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

// The SDK's Node build never wires up the on-device (Chrome) adapter, so tests load its browser build.
const browserBuild = fileURLToPath(new URL('./node_modules/@firebase/ai/dist/esm/index.esm.js', import.meta.url));

export default defineConfig({
  resolve: { alias: { '@firebase/ai': browserBuild } },
  test: { exclude: [...configDefaults.exclude, 'prototype/**'], server: { deps: { inline: [/@firebase/] } } },
});
