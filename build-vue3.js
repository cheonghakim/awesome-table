import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

await build({
  configFile: false,
  plugins: [vue()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/adapters/vue3/index.js'),
      name: 'ZenithGridVue',
      fileName: 'zenith-grid-vue',
      formats: ['es'],
    },
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      external: ['vue'],
      output: {
        globals: { vue: 'Vue' },
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});

// src/adapters/vue3/index.d.ts imports from '../../index.js' (correct 2 levels up from
// its own location). dist/zenith-grid-vue.d.ts sits only 1 level below the package
// root, so the relative import must be rewritten or it points outside the package.
const vue3Dts = readFileSync(resolve(__dirname, 'src/adapters/vue3/index.d.ts'), 'utf8')
  .replace(/(['"])\.\.\/\.\.\/index\.js\1/, '$1../index.js$1');
writeFileSync(resolve(__dirname, 'dist/zenith-grid-vue.d.ts'), vue3Dts);

console.log('✓ Vue3 adapter built successfully');
