// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createGrid } from '../src/index.js';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('formula cell survives undo', () => {
  it('A1=2, B1="=A1" -> edit B1 to 9 -> undo -> edit A1 to 5 -> B1 becomes 5', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const grid = createGrid(host, {
      rowKey: 'id',
      columns: [
        { id: 'a', field: 'a', headerName: 'A', type: 'number' },
        { id: 'b', field: 'b', headerName: 'B', type: 'number' },
      ],
      rows: [{ id: 1, a: 2, b: '=A1' }],
    });

    await flush();
    expect(grid._dataStore.getByKey('1').b).toBe(2);

    grid.setCellValue('1', 'b', 9);
    await flush();
    expect(grid._dataStore.getByKey('1').b).toBe(9);

    grid.undo();
    await flush();
    expect(grid._dataStore.getByKey('1').b).toBe(2);
    expect(grid._dataStore.getByKey('1')._formulas?.b).toBe('=A1');

    grid.setCellValue('1', 'a', 5);
    await flush();
    expect(grid._dataStore.getByKey('1').b).toBe(5);

    grid.destroy();
  });
});
