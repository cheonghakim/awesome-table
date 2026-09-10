// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/index.js';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('flex column widths account for the open side panel', () => {
  beforeEach(() => {
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
    global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  });

  it('sizes flex columns against the body viewport, not the full root width', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const grid = createGrid(host, {
      rowKey: 'id',
      selectable: false,
      columns: [{ id: 'name', field: 'name', headerName: 'Name', flex: 1 }],
      rows: [{ id: 1, name: 'Alice' }],
      sidePanel: { enabled: true, defaultOpen: true },
    });
    await flush();
    await flush();

    // createGrid() applies the .ck-zenith-grid-root class to the container element
    // itself (host), not to a child wrapper.
    const root = host;
    const bodyViewport = host.querySelector('.ck-zenith-grid-body-viewport');
    Object.defineProperty(root, 'clientWidth', { configurable: true, value: 1000 });
    Object.defineProperty(bodyViewport, 'clientWidth', { configurable: true, value: 960 }); // 1000 - 40px rail

    grid._calculateFlexColumnWidths();

    const width = grid.getAllLeafColumns().find((c) => c.def.id === 'name').state.width;
    expect(width).toBe(960);

    grid.destroy();
  });

  it('also subtracts the row-selection checkbox column, which is not part of ColumnRegistry', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const grid = createGrid(host, {
      rowKey: 'id',
      // selectable defaults to true, which renders a 44px checkbox column that
      // ColumnRegistry (and therefore getPinnedWidths()) doesn't know about.
      columns: [{ id: 'name', field: 'name', headerName: 'Name', flex: 1 }],
      rows: [{ id: 1, name: 'Alice' }],
    });
    await flush();
    await flush();

    const bodyViewport = host.querySelector('.ck-zenith-grid-body-viewport');
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 1000 });
    Object.defineProperty(bodyViewport, 'clientWidth', { configurable: true, value: 1000 });

    grid._calculateFlexColumnWidths();

    const width = grid.getAllLeafColumns().find((c) => c.def.id === 'name').state.width;
    expect(width).toBe(956); // 1000 - 44px selection column

    grid.destroy();
  });
});
