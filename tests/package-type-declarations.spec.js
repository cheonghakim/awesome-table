import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(__dirname, '..');

describe('package type declarations and exports', () => {
  it('adapter source .d.ts files import from a path that resolves to src/index.js', () => {
    for (const file of [
      'src/adapters/react/index.d.ts',
      'src/adapters/vue2/index.d.ts',
      'src/adapters/vue3/index.d.ts',
    ]) {
      const content = readFileSync(resolve(root, file), 'utf8');
      const match = content.match(/from ['"](\.\.\/\.\.\/index\.js)['"]/);
      expect(match, `${file} should import from '../../index.js'`).toBeTruthy();
      const resolved = resolve(dirname(resolve(root, file)), match[1]);
      expect(resolved).toBe(resolve(root, 'src/index.js'));
    }
  });

  it('adapter source .d.ts files reference GridCore, not the nonexistent GridInstance', () => {
    for (const file of ['src/adapters/react/index.d.ts', 'src/adapters/vue2/index.d.ts']) {
      const content = readFileSync(resolve(root, file), 'utf8');
      expect(content).not.toMatch(/GridInstance/);
      expect(content).toMatch(/GridCore/);
    }
  });

  it('build scripts rewrite the adapter .d.ts import path for its dist/ location', () => {
    for (const file of ['build-react.js', 'build-vue2.js', 'build-vue3.js']) {
      const content = readFileSync(resolve(root, file), 'utf8');
      expect(content).toMatch(/\.\.\/index\.js/);
      expect(content).not.toMatch(/copyFileSync/);
    }
  });

  it('root index.d.ts declares createFormulaPlugin and not the nonexistent useZenithGridReact', () => {
    const content = readFileSync(resolve(root, 'index.d.ts'), 'utf8');
    expect(content).toMatch(/export declare function createFormulaPlugin/);
    expect(content).not.toMatch(/useZenithGridReact/);
  });

  it('src/index.js actually runtime-exports everything root index.d.ts declares as a factory function', () => {
    const runtime = readFileSync(resolve(root, 'src/index.js'), 'utf8');
    expect(runtime).toMatch(/createFormulaPlugin/);
  });

  it('package.json exposes the echarts plugin via a subpath (with types) and includes it in files', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    expect(pkg.exports['./plugins/echarts'].default).toBe('./src/plugins/echartsPlugin.js');
    expect(pkg.exports['./plugins/echarts'].types).toBe('./src/plugins/echartsPlugin.d.ts');
    expect(pkg.files.some((f) => f.includes('echartsPlugin.js'))).toBe(true);
    expect(pkg.files.some((f) => f.includes('echartsPlugin.d.ts'))).toBe(true);
  });

  it('the echarts plugin subpath has a matching .d.ts with a real declaration', () => {
    const content = readFileSync(resolve(root, 'src/plugins/echartsPlugin.d.ts'), 'utf8');
    expect(content).toMatch(/export declare function createEchartsPlugin/);
  });

  it('adapter .d.ts files do not misuse the non-generic GridPlugin type, and Vue2 methods satisfy MethodOptions', () => {
    const vue3 = readFileSync(resolve(root, 'src/adapters/vue3/index.d.ts'), 'utf8');
    expect(vue3).not.toMatch(/GridPlugin<Row>/);
    const vue2 = readFileSync(resolve(root, 'src/adapters/vue2/index.d.ts'), 'utf8');
    expect(vue2).toMatch(/\[key: string\]: any/);
  });

  it('root index.d.ts has no duplicate onRowContextMenu declaration', () => {
    const content = readFileSync(resolve(root, 'index.d.ts'), 'utf8');
    const count = (content.match(/onRowContextMenu\?:/g) || []).length;
    expect(count).toBe(1);
  });
});
