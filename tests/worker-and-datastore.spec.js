import { describe, expect, it } from 'vitest';
import { DataWorkerHandlers } from '../src/workers/DataWorker.js';
import { DataStore } from '../src/core/DataStore.js';
import { SortManager } from '../src/managers/SortManager.js';
import { FilterManager } from '../src/managers/FilterManager.js';

describe('worker field mismatch + DataStore rowKey patch', () => {
  it('worker filter reads filterDef.field, not the columnFilters map key (colId)', () => {
    const rows = [{ id: 1, label: 'irrelevant', name: 'Alice' }];
    // Column id is "label" but the filter targets the real data field "name".
    const result = DataWorkerHandlers.filter({
      rows,
      columnFilters: { label: { type: 'text', operator: 'contains', value: 'A', field: 'name' } },
    });
    expect(result).toHaveLength(1);
  });

  it('SortManager/FilterManager flag custom comparator/filter functions as unserializable', () => {
    const sortManager = new SortManager();
    sortManager.setSort({ field: 'x', comparator: () => 0 });
    expect(sortManager.hasUnserializableSort()).toBe(true);

    const filterManager = new FilterManager();
    filterManager.setColumnFilter('col', { type: 'custom', fn: () => true, value: 'x' });
    expect(filterManager.hasUnserializableFilter()).toBe(true);
  });

  it('patchRow keeps the key index in sync when the patch changes the rowKey field itself', () => {
    const store = new DataStore({ rowKey: 'id' });
    store.setData([{ id: 1, a: 'x' }]);

    store.patchRow('1', { id: 2 });

    expect(store.getByKey('2')).toMatchObject({ id: 2, a: 'x' });
    expect(store.getByKey('1')).toBeNull();
  });
});
