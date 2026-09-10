import { build } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

await build({
  configFile: false,
  build: {
    lib: {
      entry: resolve(__dirname, 'src/adapters/vue2/index.js'),
      name: 'ZenithGridVue2',
      fileName: 'zenith-grid-vue2',
      formats: ['es', 'umd'],
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

// src/adapters/vue2/index.d.ts imports from '../../index.js' (correct 2 levels up from
// its own location). dist/zenith-grid-vue2.d.ts sits only 1 level below the package
// root, so the relative import must be rewritten or it points outside the package.
const vue2Dts = readFileSync(resolve(__dirname, 'src/adapters/vue2/index.d.ts'), 'utf8')
  .replace(/(['"])\.\.\/\.\.\/index\.js\1/, '$1../index.js$1');
writeFileSync(resolve(__dirname, 'dist/zenith-grid-vue2.d.ts'), vue2Dts);

console.log('✓ Vue2 adapter built successfully');
