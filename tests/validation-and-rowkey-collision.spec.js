// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createGrid } from '../src/index.js';
import { DataStore } from '../src/core/DataStore.js';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('rejected edits and rowKey collisions leave existing state untouched', () => {
  it('a validation-rejected edit does not delete the cell\'s existing formula', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const grid = createGrid(host, {
      rowKey: 'id',
      columns: [
        { id: 'a', field: 'a', headerName: 'A', type: 'number' },
        {
          id: 'b', field: 'b', headerName: 'B', type: 'number',
          validator: ({ value }) => (value < 0 ? 'Must be non-negative' : true),
        },
      ],
      rows: [{ id: 1, a: 2, b: '=A1' }],
    });
    await flush();
    expect(grid._dataStore.getByKey('1').b).toBe(2);

    const ok = grid.setCellValue('1', 'b', -5);
    await flush();

    expect(ok).toBe(false);
    expect(grid._dataStore.getByKey('1')._formulas?.b).toBe('=A1');

    // The formula must still be live: changing A1 should still recompute B1.
    grid.setCellValue('1', 'a', 9);
    await flush();
    expect(grid._dataStore.getByKey('1').b).toBe(9);

    grid.destroy();
  });

  it('DataStore.patchRow refuses to rename a row onto an already-existing rowKey', () => {
    const store = new DataStore({ rowKey: 'id' });
    store.setData([{ id: 1, a: 'x' }, { id: 2, a: 'y' }]);

    const ok = store.patchRow('1', { id: 2 });

    expect(ok).toBe(false);
    expect(store.getByKey('1')).toMatchObject({ id: 1, a: 'x' });
    expect(store.getByKey('2')).toMatchObject({ id: 2, a: 'y' });
  });

  it('GridCore.patchRow does not corrupt formula bookkeeping when the rename is rejected', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = createGrid(host, {
      rowKey: 'id',
      columns: [
        { id: 'a', field: 'a', headerName: 'A', type: 'number' },
        { id: 'b', field: 'b', headerName: 'B', type: 'number' },
      ],
      rows: [{ id: 1, a: 2, b: '=A1' }, { id: 2, a: 10, b: 20 }],
    });
    await flush();

    const ok = grid.patchRow('1', { id: 2 });
    await flush();

    expect(ok).toBe(false);
    expect(grid._dataStore.getByKey('1')._formulas?.b).toBe('=A1');
    // Still live after the rejected rename attempt.
    grid.setCellValue('1', 'a', 7);
    await flush();
    expect(grid._dataStore.getByKey('1').b).toBe(7);

    grid.destroy();
  });

  it('setCellValue propagates a rowKey-collision rejection instead of reporting success', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = createGrid(host, {
      rowKey: 'id',
      columns: [{ id: 'id', field: 'id', headerName: 'ID', type: 'number' }],
      rows: [{ id: 1 }, { id: 2 }],
    });
    await flush();

    const ok = grid.setCellValue('1', 'id', 2);
    await flush();

    expect(ok).toBe(false);
    expect(grid._dataStore.getByKey('1')).toMatchObject({ id: 1 });
    expect(grid._dataStore.getByKey('2')).toMatchObject({ id: 2 });
    // No phantom undo entry for the edit that never actually applied.
    expect(grid.canUndo()).toBe(false);

    grid.destroy();
  });
});
