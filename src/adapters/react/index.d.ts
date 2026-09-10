import { RefObject } from 'react';
import type { GridCore, GridOptions } from '../../index.js';

export interface UseZenithGridReturn {
  /** Attach to your container div: <div ref={containerRef} /> */
  containerRef: RefObject<HTMLDivElement>;
  /** The raw GridCore instance (null until mounted). */
  grid: GridCore | null;
  /** Stable ref accessor */
  getGrid: () => GridCore | null;
  /** True after the grid has mounted */
  isReady: boolean;
  /** Reactive selection + render summary */
  state: {
    selectedKeys: Set<string>;
    selectionCount: number;
    isAllSelected: boolean;
    isSomeSelected: boolean;
    renderInfo: any | null;
    paginationState: any | null;
  };

  // Convenience delegates
  refresh: (...args: any[]) => any;
  setRows: (...args: any[]) => any;
  appendRows: (...args: any[]) => any;
  updateRows: (...args: any[]) => any;
  patchRow: (...args: any[]) => any;
  upsertRows: (...args: any[]) => any;
  removeRows: (...args: any[]) => any;
  setColumns: (...args: any[]) => any;
  setQuickFilter: (...args: any[]) => any;
  setColumnFilter: (...args: any[]) => any;
  clearColumnFilter: (...args: any[]) => any;
  clearFilters: (...args: any[]) => any;
  sortBy: (...args: any[]) => any;
  clearSort: (...args: any[]) => any;
  setPage: (...args: any[]) => any;
  nextPage: (...args: any[]) => any;
  prevPage: (...args: any[]) => any;
  setPageSize: (...args: any[]) => any;
  usePlugin: (...args: any[]) => any;
  unusePlugin: (...args: any[]) => any;
  liveAddRows: (...args: any[]) => any;
  liveUpdateRows: (...args: any[]) => any;
  livePatchRow: (...args: any[]) => any;
  liveRemoveRows: (...args: any[]) => any;
  on: (...args: any[]) => any;
  getSelectedKeys: () => Set<string> | undefined;
  getSelectedRows: () => any[] | undefined;
  getColumnState: () => any;
  getPaginationState: () => any;
}

export function useZenithGrid(options?: GridOptions): UseZenithGridReturn;
