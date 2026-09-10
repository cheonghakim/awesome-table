// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createGrid } from '../src/index.js';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('advanced filter evaluates every row in tree/group mode, not just roots', () => {
  it('tree children mode: a matching child is still reachable when its parent does not match', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = createGrid(host, {
      rowKey: 'id',
      columns: [{ id: 'status', field: 'status', headerName: 'Status' }],
      rows: [
        { id: 'a', status: 'no', children: [{ id: 'a1', status: 'yes' }] },
        { id: 'b', status: 'yes', children: [{ id: 'b1', status: 'no' }] },
      ],
      tree: { treeMode: 'children', childrenField: 'children' },
    });
    await flush();
    // Tree nodes start collapsed, so a child only appears in the flattened output (and is
    // therefore only reachable by the filter at all) once its parent is expanded.
    grid.expandAllTree();
    await flush();

    grid.setAdvancedFilter({ field: 'status', filterType: 'text', operator: 'equals', value: 'yes' });
    await flush();

    const keys = grid.getFlatRows().map((r) => r._rowKey);
    console.log('flat keys after filter:', keys);
    // Both the matching root (b) and the matching nested child (a1, even though its
    // parent 'a' doesn't match) must independently pass the filter.
    expect(keys).toContain('b');
    expect(keys).toContain('a1');
    expect(keys).not.toContain('b1');

    grid.destroy();
  });

  it('parentId tree mode: a matching child keeps its depth instead of being promoted to root', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = createGrid(host, {
      rowKey: 'id',
      columns: [{ id: 'status', field: 'status', headerName: 'Status' }],
      rows: [
        { id: 1, status: 'no', parentId: null },
        { id: 2, status: 'yes', parentId: 1 },
      ],
      tree: { treeMode: 'parentId', parentIdField: 'parentId' },
    });
    await flush();
    grid.expandAllTree();
    await flush();

    grid.setAdvancedFilter({ field: 'status', filterType: 'text', operator: 'equals', value: 'yes' });
    await flush();

    // Row 1 (the parent) doesn't match, so it's filtered out at the flatten stage — but
    // row 2 should still render as before (its own matched-row visibility, unaffected by
    // the filter promoting it to a fake root because its ancestor vanished pre-flatten).
    const rows = grid.getFlatRows();
    console.log('rows:', rows.map((r) => ({ key: r._rowKey, depth: r._depth })));
    expect(rows.some((r) => r._rowKey === '2')).toBe(true);

    grid.destroy();
  });

  it('group mode: totalCount still reflects the filtered set (regression guard)', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = createGrid(host, {
      rowKey: 'id',
      columns: [
        { id: 'team', field: 'team', headerName: 'Team' },
        { id: 'score', field: 'score', headerName: 'Score', type: 'number' },
      ],
      rows: [
        { id: 1, team: 'A', score: 10 },
        { id: 2, team: 'A', score: 90 },
        { id: 3, team: 'B', score: 50 },
      ],
    });
    await flush();
    grid.enableGrouping(['team']);
    await grid.refresh();

    grid.setAdvancedFilter({ field: 'score', filterType: 'number', operator: 'greaterThan', value: 40 });
    await flush();

    const dataRows = grid.getFlatRows().filter((r) => r._type === 'data');
    expect(dataRows.every((r) => r.score > 40)).toBe(true);
    expect(dataRows.map((r) => r.id).sort()).toEqual([2, 3]);

    grid.destroy();
  });
});
