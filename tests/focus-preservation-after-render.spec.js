// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/index.js';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('BodyRenderer preserves focus across a full re-render', () => {
  beforeEach(() => {
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 800 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 600 });
    global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  });

  it('keeps focus inside the grid (not <body>) after a render triggered while a cell editor is focused', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = createGrid(host, {
      rowKey: 'id',
      editing: { enabled: true },
      columns: [{ id: 'score', field: 'score', headerName: 'Score', type: 'number', editable: true }],
      rows: [{ id: 1, score: 1 }, { id: 2, score: 2 }],
    });
    await flush();
    await flush();

    grid.beginCellEdit('1', 'score');
    const editorInput = host.querySelector('.ck-zenith-grid-cell-editing input');
    expect(editorInput).toBeTruthy();
    expect(document.activeElement).toBe(editorInput);

    // Simulate a render happening while the editor still has focus (this is the exact
    // race that used to blur the editor's <input>, get destroyed by innerHTML="", and
    // drop focus to <body> — silently breaking the grid's own keydown-bound shortcuts
    // like Ctrl+Z until the user clicked back into the grid).
    grid._bodyRenderer.render(grid._displayRows, grid._currentRangeBundle);

    expect(document.activeElement).not.toBe(document.body);
    expect(host.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.dataset.colId).toBe('score');
    expect(document.activeElement?.closest('[data-row-key]')?.dataset.rowKey).toBe('1');

    grid.destroy();
  });
});
