import { build } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

await build({
  configFile: false,
  build: {
    lib: {
      entry: resolve(__dirname, 'src/adapters/react/index.js'),
      name: 'ZenithGridReact',
      fileName: 'zenith-grid-react',
      formats: ['es', 'cjs'],
    },
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      external: ['react', 'react-dom'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
        },
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});

// src/adapters/react/index.d.ts imports from '../../index.js' (correct 2 levels up from
// its own location). dist/zenith-grid-react.d.ts sits only 1 level below the package
// root, so the relative import must be rewritten or it points outside the package.
const reactDts = readFileSync(resolve(__dirname, 'src/adapters/react/index.d.ts'), 'utf8')
  .replace(/(['"])\.\.\/\.\.\/index\.js\1/, '$1../index.js$1');
writeFileSync(resolve(__dirname, 'dist/zenith-grid-react.d.ts'), reactDts);

console.log('✓ React adapter built successfully');
