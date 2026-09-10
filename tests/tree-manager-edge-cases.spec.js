// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createGrid } from '../src/index.js';
import { TreeManager } from '../src/managers/TreeManager.js';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('tree lazy loading + expandAll', () => {
  it('lazy-loaded children show up even when the row already had children: []', async () => {
    const tree = new TreeManager({ onLoadChildren: async () => [{ id: 'child' }] });
    tree.enable();
    const root = { id: 'root', hasChildren: true, children: [] };

    await tree.loadChildren('root', root);
    const keys = tree.flatten([root]).map((r) => r.id);
    console.log('flatten keys after loadChildren:', keys);
    expect(keys).toContain('child');
  });

  it('expandAllTree expands a 3-level deep tree in one call', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const grid = createGrid(host, {
      rowKey: 'id',
      columns: [{ id: 'name', field: 'name', headerName: 'Name', width: 180 }],
      rows: [
        { id: 'a', name: 'A', children: [
          { id: 'b', name: 'B', children: [
            { id: 'c', name: 'C' },
          ] },
        ] },
      ],
      tree: { treeMode: 'children', childrenField: 'children' },
    });

    await flush();
    await flush();

    grid.expandAllTree();
    await flush();

    const keys = grid.getFlatRows().map((r) => r._rowKey);
    console.log('keys after expandAllTree:', keys);
    expect(keys).toContain('a');
    expect(keys).toContain('b');
    expect(keys).toContain('c');

    grid.destroy();
  });
});

describe('tree leaf spacer visibility', () => {
  function buildGrid(host, treeOptions = {}) {
    return createGrid(host, {
      rowKey: 'id',
      columns: [{ id: 'name', field: 'name', headerName: 'Name', width: 180 }],
      rows: [
        { id: 'a', name: 'A', children: [{ id: 'b', name: 'B' }] },
        { id: 'leaf', name: 'Leaf' },
      ],
      tree: { treeMode: 'children', childrenField: 'children', ...treeOptions },
    });
  }

  it('hides the leaf placeholder box by default', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = buildGrid(host);

    await flush();
    await flush();

    expect(grid.isTreeLeafSpacerVisible()).toBe(false);
    const spacer = host.querySelector('.ck-zenith-grid-row-toggle-spacer');
    expect(spacer).not.toBeNull();
    expect(spacer.classList.contains('ck-zenith-grid-row-toggle-spacer-visible')).toBe(false);

    grid.destroy();
  });

  it('setTreeLeafSpacerVisible(true) shows the placeholder box', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = buildGrid(host);

    await flush();
    await flush();

    grid.setTreeLeafSpacerVisible(true);
    await flush();
    await flush();

    expect(grid.isTreeLeafSpacerVisible()).toBe(true);
    const spacer = host.querySelector('.ck-zenith-grid-row-toggle-spacer');
    expect(spacer.classList.contains('ck-zenith-grid-row-toggle-spacer-visible')).toBe(true);

    grid.destroy();
  });

  it('honors tree.showLeafSpacer: true at construction time', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = buildGrid(host, { showLeafSpacer: true });

    await flush();
    await flush();

    expect(grid.isTreeLeafSpacerVisible()).toBe(true);

    grid.destroy();
  });
});
