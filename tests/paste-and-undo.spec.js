// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createGrid } from '../src/index.js';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('paste and undo/redo', () => {
  it('paste does not overwrite a read-only cell', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = createGrid(host, {
      rowKey: 'id',
      editing: { enabled: false },
      columns: [
        { id: 'a', field: 'a', headerName: 'A' },
        { id: 'locked', field: 'locked', headerName: 'Locked', editable: false },
      ],
      rows: [{ id: 1, a: 'x', locked: 'original' }],
    });
    await flush();

    const changed = grid.pasteFromClipboard('changed', { startRowKey: '1', startColId: 'locked' });
    await flush();

    expect(changed).toBe(0);
    expect(grid._dataStore.getByKey('1').locked).toBe('original');
    grid.destroy();
  });

  it('pasting a 2x2 TSV block fills both columns', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = createGrid(host, {
      rowKey: 'id',
      editing: { enabled: true },
      columns: [
        { id: 'a', field: 'a', headerName: 'A', type: 'number' },
        { id: 'b', field: 'b', headerName: 'B', type: 'number' },
      ],
      rows: [{ id: 1, a: 1, b: 2 }, { id: 2, a: 3, b: 4 }],
    });
    await flush();

    grid.pasteFromClipboard('10\t20\n30\t40', { startRowKey: '1', startColId: 'a' });
    await flush();

    expect(grid._dataStore.getByKey('1')).toMatchObject({ a: 10, b: 20 });
    expect(grid._dataStore.getByKey('2')).toMatchObject({ a: 30, b: 40 });
    grid.destroy();
  });

  it('confirming an edit with Enter pushes exactly one undo entry', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 800 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 600 });
    global.ResizeObserver = global.ResizeObserver ?? class { observe() {} unobserve() {} disconnect() {} };
    globalThis.requestAnimationFrame = globalThis.requestAnimationFrame ?? ((cb) => setTimeout(cb, 0));

    const grid = createGrid(host, {
      rowKey: 'id',
      editing: { enabled: true },
      columns: [{ id: 'score', field: 'score', headerName: 'Score', type: 'number', editable: true }],
      rows: [{ id: 1, score: 1 }],
    });
    await flush();
    await flush();

    grid.beginCellEdit('1', 'score');
    const editorInput = host.querySelector('.ck-zenith-grid-cell-editing input');
    expect(editorInput).toBeTruthy();
    editorInput.value = '9';
    editorInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();

    expect(grid._dataStore.getByKey('1').score).toBe(9);
    grid.undo();
    await flush();
    expect(grid._dataStore.getByKey('1').score).toBe(1);

    grid.destroy();
  });

  it('undo does not survive a full setRows() dataset replacement', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = createGrid(host, {
      rowKey: 'id',
      columns: [
        { id: 'a', field: 'a', headerName: 'A', type: 'number' },
        { id: 'b', field: 'b', headerName: 'B', type: 'number' },
      ],
      rows: [{ id: 1, a: 1, b: 1 }],
    });
    await flush();

    grid.setCellValue('1', 'a', 10);
    await flush();

    grid.setRows([{ id: 1, a: 999, b: 999 }]);
    await flush();

    grid.undo();
    await flush();

    expect(grid._dataStore.getByKey('1')).toMatchObject({ a: 999, b: 999 });
    grid.destroy();
  });
});
