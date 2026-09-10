// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createGrid } from '../src/index.js';
import { PivotManager } from '../src/managers/PivotManager.js';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('pivot, aggregate, master-detail export', () => {
  it('pivot count aggregation counts text values, not just numeric ones', () => {
    const pivot = new PivotManager();
    pivot.enable({ rowFields: ['team'], columnField: 'region', valueField: 'name', aggFunction: 'count' });
    const { pivotRows } = pivot.process([
      { team: 'A', region: 'X', name: 'Alice' },
      { team: 'A', region: 'X', name: 'Bob' },
    ]);
    expect(pivotRows[0]._pivot_X).toBe(2);
  });

  it('disablePivot restores the original columns', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const columns = [
      { id: 'team', field: 'team', headerName: 'Team' },
      { id: 'region', field: 'region', headerName: 'Region' },
      { id: 'score', field: 'score', headerName: 'Score', type: 'number' },
    ];
    const grid = createGrid(host, {
      rowKey: 'id',
      columns,
      rows: [
        { id: 1, team: 'A', region: 'X', score: 10 },
        { id: 2, team: 'A', region: 'Y', score: 20 },
      ],
    });
    await flush();

    grid.enablePivot({ rowFields: ['team'], columnField: 'region', valueField: 'score', aggFunction: 'sum' });
    await flush();
    expect(grid.getAllLeafColumns().map((c) => c.def.id)).not.toEqual(['team', 'region', 'score']);

    grid.disablePivot();
    await flush();
    expect(grid.getAllLeafColumns().map((c) => c.def.id)).toEqual(['team', 'region', 'score']);
    const row = grid.getRows().find((r) => r.id === 2);
    expect(row.region).toBe('Y');

    grid.destroy();
  });

  it('group aggregate sums the whole group, not just the current page', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = createGrid(host, {
      rowKey: 'id',
      columns: [
        { id: 'team', field: 'team', headerName: 'Team' },
        { id: 'score', field: 'score', headerName: 'Score', type: 'number', aggregate: 'sum' },
      ],
      rows: [
        { id: 1, team: 'A', score: 10 },
        { id: 2, team: 'A', score: 20 },
        { id: 3, team: 'A', score: 30 },
      ],
      displayMode: 'paginated',
      pagination: { pageSize: 2 },
    });
    await flush();
    grid.enableGrouping(['team']);
    await grid.refresh();
    await flush();

    const groupHeader = grid.getFlatRows().find((r) => r._type === 'group-header');
    expect(groupHeader).toBeTruthy();
    expect(groupHeader._aggregates?.score?.value).toBe(60);

    grid.destroy();
  });

  it('master-detail expanded rows are excluded from CSV export', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = createGrid(host, {
      rowKey: 'id',
      columns: [{ id: 'a', field: 'a', headerName: 'A' }],
      rows: [{ id: 1, a: 'A' }, { id: 2, a: 'B' }],
      masterDetail: { detailRenderer: () => document.createElement('div') },
    });
    await flush();

    grid.toggleDetail('1');
    await flush();

    const rows = grid._resolveCsvRows({});
    console.log('csv rows types:', rows.map((r) => r._type ?? 'data'));
    expect(rows.every((r) => r._type !== 'detail')).toBe(true);
    expect(rows.length).toBe(2);

    grid.destroy();
  });
});
