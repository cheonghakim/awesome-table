import { useRef, useEffect, useState, useCallback } from 'react';
import { createGrid } from '../../index.js';

/**
 * useZenithGrid - React hook for ZenithGrid
 *
 * Usage:
 *   const { containerRef, grid, state } = useZenithGrid({ columns, rows });
 *   return <div ref={containerRef} style={{ height: 400 }} />;
 *
 * @param {import('../../index.js').GridOptions} [options]
 */
export function useZenithGrid(options = {}) {
  const containerRef = useRef(null);
  const gridRef = useRef(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [isReady, setIsReady] = useState(false);
  const [state, setState] = useState({
    selectedKeys: new Set(),
    selectionCount: 0,
    isAllSelected: false,
    isSomeSelected: false,
    renderInfo: null,
    paginationState: null,
  });

  useEffect(() => {
    if (!containerRef.current) return;

    const grid = createGrid(containerRef.current, optionsRef.current);
    gridRef.current = grid;

    grid.on('selection-change', () => {
      // selection-change's own payload doesn't carry allSelected/someSelected (they need
      // scope-row context only SelectionManager has) — getSelectionState() is authoritative.
      const sel = grid.getSelectionState();
      setState((prev) => ({
        ...prev,
        selectedKeys: sel.selectedKeys,
        selectionCount: sel.selectedCount,
        isAllSelected: sel.allSelected,
        isSomeSelected: sel.someSelected,
      }));
    });

    grid.on('render', (p) => {
      setState((prev) => ({
        ...prev,
        renderInfo: p,
      }));
    });

    // 'render' doesn't carry pagination state — refresh it explicitly whenever pagination
    // actually changes, plus once up front so it isn't stuck at null before the first change.
    grid.on('state-change', ({ type }) => {
      if (type !== 'pagination') return;
      setState((prev) => ({ ...prev, paginationState: grid.getPaginationState() }));
    });
    setState((prev) => ({ ...prev, paginationState: grid.getPaginationState() }));

    setIsReady(true);

    return () => {
      grid.destroy();
      gridRef.current = null;
      setIsReady(false);
    };
  }, []); // intentionally empty — grid is created once; use imperative API for updates

  const getGrid = useCallback(() => gridRef.current, []);

  return {
    /** Attach to your container div: <div ref={containerRef} /> */
    containerRef,
    /** The raw GridCore instance (null until mounted). */
    grid: gridRef.current,
    getGrid,
    isReady,
    /** Reactive selection + render summary. */
    state,

    // ── Convenience delegates ─────────────────────────────────────────
    refresh:           (...a) => gridRef.current?.refresh(...a),
    setRows:           (...a) => gridRef.current?.setRows(...a),
    appendRows:        (...a) => gridRef.current?.appendRows(...a),
    updateRows:        (...a) => gridRef.current?.updateRows(...a),
    patchRow:          (...a) => gridRef.current?.patchRow(...a),
    upsertRows:        (...a) => gridRef.current?.upsertRows(...a),
    removeRows:        (...a) => gridRef.current?.removeRows(...a),
    setColumns:        (...a) => gridRef.current?.setColumns(...a),
    setQuickFilter:    (...a) => gridRef.current?.setQuickFilter(...a),
    setColumnFilter:   (...a) => gridRef.current?.setColumnFilter(...a),
    clearColumnFilter: (...a) => gridRef.current?.clearColumnFilter(...a),
    clearFilters:      (...a) => gridRef.current?.clearFilters(...a),
    sortBy:            (...a) => gridRef.current?.sortBy(...a),
    clearSort:         (...a) => gridRef.current?.clearSort(...a),
    setPage:           (...a) => gridRef.current?.setPage(...a),
    nextPage:          (...a) => gridRef.current?.nextPage(...a),
    prevPage:          (...a) => gridRef.current?.prevPage(...a),
    setPageSize:       (...a) => gridRef.current?.setPageSize(...a),
    usePlugin:         (...a) => gridRef.current?.usePlugin(...a),
    unusePlugin:       (...a) => gridRef.current?.unusePlugin(...a),
    liveAddRows:       (...a) => gridRef.current?.liveAddRows(...a),
    liveUpdateRows:    (...a) => gridRef.current?.liveUpdateRows(...a),
    livePatchRow:      (...a) => gridRef.current?.livePatchRow(...a),
    liveRemoveRows:    (...a) => gridRef.current?.liveRemoveRows(...a),
    on:                (...a) => gridRef.current?.on(...a),
    getSelectedKeys:    ()   => gridRef.current?.getSelectedKeys(),
    getSelectedRows:    ()   => gridRef.current?.getSelectedRows(),
    getColumnState:     ()   => gridRef.current?.getColumnState(),
    getPaginationState: ()   => gridRef.current?.getPaginationState(),
  };
}
