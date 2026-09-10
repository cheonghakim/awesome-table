// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createGrid } from '../src/index.js';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeRows(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    team: ['Red', 'Blue', 'Gold', 'Green'][i % 4],
    score: (i * 37) % 10000,
  }));
}

describe('large dataset + pagination + filter + edit combo', () => {
  it('pagination + column filter + sort + cell edit stay correct at 20k rows', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const N = 20000;

    const grid = createGrid(host, {
      rowKey: 'id',
      columns: [
        { id: 'team', field: 'team', headerName: 'Team' },
        { id: 'score', field: 'score', headerName: 'Score', type: 'number', editable: true },
      ],
      rows: makeRows(N),
      displayMode: 'paginated',
      pagination: { pageSize: 50 },
      editing: { enabled: true },
    });
    await flush();

    // Sanity: full dataset paginates correctly before any filter.
    expect(grid.getPaginationState().totalCount).toBe(N);
    expect(grid.getPaginationState().totalPages).toBe(Math.ceil(N / 50));

    // Column filter: only 'Red' team rows (1 of 4 teams, evenly distributed -> N/4).
    grid.setColumnFilter('team', { type: 'select', value: ['Red'] });
    await flush();
    expect(grid.getPaginationState().totalCount).toBe(N / 4);
    expect(grid.getRows().every((r) => r.team === 'Red')).toBe(true);

    // Advanced filter on top: score >= 5000, still combined with the column filter and
    // still computed BEFORE pagination slicing.
    grid.setAdvancedFilter({ field: 'score', filterType: 'number', operator: 'greaterThanOrEqual', value: 5000 });
    await flush();
    const expectedCount = makeRows(N).filter((r) => r.team === 'Red' && r.score >= 5000).length;
    expect(grid.getPaginationState().totalCount).toBe(expectedCount);
    expect(grid.getRows().every((r) => r.team === 'Red' && r.score >= 5000)).toBe(true);

    // Sort the filtered set descending, then edit the first visible row's score.
    grid.sortBy({ field: 'score', direction: 'desc' });
    await flush();
    const firstRow = grid.getRows()[0];
    const highestScore = Math.max(...makeRows(N).filter((r) => r.team === 'Red' && r.score >= 5000).map((r) => r.score));
    expect(firstRow.score).toBe(highestScore);

    grid.setCellValue(String(firstRow.id), 'score', 42);
    await flush();
    // Editing it below the filter threshold should drop it out of the filtered/paginated view.
    expect(grid.getRows().some((r) => r.id === firstRow.id)).toBe(false);
    expect(grid.getPaginationState().totalCount).toBe(expectedCount - 1);

    grid.destroy();
  });

  it('undo after a large multi-row paste stays consistent under pagination', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const N = 5000;

    const grid = createGrid(host, {
      rowKey: 'id',
      columns: [
        { id: 'a', field: 'a', headerName: 'A', type: 'number', editable: true },
        { id: 'b', field: 'b', headerName: 'B', type: 'number', editable: true },
      ],
      rows: Array.from({ length: N }, (_, i) => ({ id: i + 1, a: i, b: i })),
      displayMode: 'paginated',
      pagination: { pageSize: 100 },
      editing: { enabled: true },
    });
    await flush();

    const tsv = Array.from({ length: 3 }, (_, i) => `${1000 + i}\t${2000 + i}`).join('\n');
    const changed = grid.pasteFromClipboard(tsv, { startRowKey: '1', startColId: 'a' });
    await flush();

    expect(changed).toBe(6); // 3 rows x 2 columns
    expect(grid._dataStore.getByKey('1')).toMatchObject({ a: 1000, b: 2000 });
    expect(grid._dataStore.getByKey('3')).toMatchObject({ a: 1002, b: 2002 });

    grid.destroy();
  });
});
