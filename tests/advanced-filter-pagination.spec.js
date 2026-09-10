// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createGrid } from '../src/index.js';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('advanced filter applies before pagination', () => {
  it('id 1..30, pageSize 10, filter id>20 -> page 1 shows the 10 matches, totalCount=10', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const rows = Array.from({ length: 30 }, (_, i) => ({ id: i + 1 }));
    const grid = createGrid(host, {
      rowKey: 'id',
      columns: [{ id: 'id', field: 'id', headerName: 'ID', type: 'number' }],
      rows,
      displayMode: 'paginated',
      pagination: { pageSize: 10 },
    });

    await flush();

    grid.setAdvancedFilter({ field: 'id', filterType: 'number', operator: 'greaterThan', value: 20 });
    await flush();

    const shown = grid.getRows().map((r) => r.id);
    const paginationState = grid.getPaginationState();
    console.log('shown:', shown, 'pagination:', paginationState);

    expect(shown.length).toBe(10);
    expect(shown.every((id) => id > 20)).toBe(true);
    expect(paginationState.totalCount).toBe(10);
    expect(paginationState.totalPages).toBe(1);

    grid.destroy();
  });
});
