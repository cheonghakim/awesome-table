import type { DefineComponent, ShallowRef, Ref } from 'vue';
import type {
  GridOptions,
  GridCore,
  GridRow,
  GridKey,
  ColumnDef,
  ColumnFilterDef,
  PinnedPosition,
  GridPlugin,
  AdvancedFilterNode,
  PivotConfig,
} from '../../index.js';

// ── ZenithGrid component ───────────────────────────────────────────────────────

export interface ZenithGridProps<Row = GridRow> extends GridOptions<Row> {}

export interface ZenithGridExposed<Row = GridRow> {
  grid: ShallowRef<GridCore<Row> | null>;

  // Data
  refresh(): Promise<void>;
  setRows(rows: Row[]): void;
  appendRows(rows: Row[] | Row): void;
  updateRows(rows: Row[] | Row): void;
  patchRow(key: GridKey, patch: Partial<Row>): void;
  upsertRows(rows: Row[] | Row): void;
  removeRows(keys: GridKey[] | GridKey): void;

  // Columns
  setColumns(columns: ColumnDef<Row>[]): void;
  setColumnWidth(colId: string, width: number): void;
  setColumnVisible(colId: string, visible: boolean): void;
  setColumnPinned(colId: string, pin: PinnedPosition): void;
  moveColumn(colId: string, toIndex: number, options?: { restrictToGroup?: boolean }): void;
  autoSizeColumn(colId: string): void;
  autoSizeAllColumns(): void;

  // Filter
  setQuickFilter(text: string, fields?: string[]): void;
  setColumnFilter(colId: string, filterDef: ColumnFilterDef): void;
  clearColumnFilter(colId: string): void;
  clearFilters(): void;
  setAdvancedFilter(filterTree: AdvancedFilterNode): void;
  clearAdvancedFilter(): void;

  // Sort
  sortBy(defs: any[]): void;
  clearSort(): void;

  // Grouping
  enableGrouping(groupByFields: string[], options?: Record<string, any>): void;
  disableGrouping(): void;
  isGroupingEnabled(): boolean;
  toggleGroup(groupKey: string): void;

  // Tree
  enableTree(options?: any): void;
  disableTree(): void;
  isTreeEnabled(): boolean;
  toggleTreeRow(rowKey: GridKey): void;
  expandAllTree(): void;
  collapseAllTree(): void;

  // Pagination
  setPage(page: number): void;
  nextPage(): void;
  prevPage(): void;
  setPageSize(size: number): void;

  // Selection
  toggleSelectAll(): void;
  setRowSelected(rowKey: GridKey, selected: boolean, options?: Record<string, any>): void;
  getSelectedKeys(): Set<string>;
  getSelectedRows(): Row[];
  getSelectionState(): any;

  // Live updates
  liveAddRows(rows: Row[] | Row): void;
  liveUpdateRows(rows: Row[] | Row): void;
  livePatchRow(key: GridKey, patch: Partial<Row>): void;
  liveUpsertRows(rows: Row[] | Row): void;
  liveRemoveRows(keys: GridKey[] | GridKey): void;
  pauseLiveUpdates(): void;
  resumeLiveUpdates(): void;

  // Editing
  beginCellEdit(rowKey: GridKey, colId: string, options?: { cell?: HTMLElement }): boolean;
  setCellValue(rowKey: GridKey, colId: string, rawValue: any): boolean;

  // Undo/Redo
  undo(): any;
  redo(): any;
  canUndo(): boolean;
  canRedo(): boolean;

  // Row features
  moveRow(fromRowKey: GridKey, toRowKey: GridKey): void;
  setPinnedTopRows(rows: GridRow[]): void;
  setPinnedBottomRows(rows: GridRow[]): void;
  toggleDetail(rowKey: GridKey): void;
  isDetailExpanded(rowKey: GridKey): boolean;

  // Aggregate
  setColumnAggregate(colId: string, aggType: 'sum' | 'avg' | 'count' | 'min' | 'max' | null): void;
  clearColumnAggregate(colId: string): void;
  getAggregateResult(): Record<string, { value: any; type: string }>;

  // Range selection
  clearRangeSelection(): void;
  copyRangeToClipboard(): void;

  // Pivot
  enablePivot(config: PivotConfig): void;
  disablePivot(): void;
  isPivotEnabled(): boolean;

  // Export
  exportCsv(options?: any): string;
  downloadCsv(options?: any): string;
  downloadExcel(options?: any): string;
  downloadXlsx?(options?: any): Promise<any>;

  // Misc
  printGrid(): void;
  setLocale(locale: Record<string, any>): void;
  usePlugin(plugin: GridPlugin, options?: Record<string, any>): void;
  unusePlugin(pluginName: string): void;
  on(eventName: string, handler: (...args: any[]) => any): () => void;

  // State
  getColumnState(): any;
  getPaginationState(): any;
  getFilterState(): any;
  getGroupingState(): any;
  getTreeState(): any;
  getRows(): Row[];
  getFlatRows(): Row[];
  getAllLeafColumns(): any[];
  getVisibleLeafColumns(): any[];

  destroy(): void;
}

export declare const ZenithGrid: DefineComponent<ZenithGridProps, ZenithGridExposed>;

// ── useZenithGrid composable ───────────────────────────────────────────────────

export interface UseZenithGridState {
  selectedKeys: Set<string>;
  selectionCount: number;
  isAllSelected: boolean;
  isSomeSelected: boolean;
  renderInfo: any;
  paginationState: any;
}

export interface UseZenithGridReturn<Row = GridRow> extends ZenithGridExposed<Row> {
  isReady: Ref<boolean>;
  state: UseZenithGridState;
  init(overrideOptions?: GridOptions<Row>): GridCore<Row> | null;
}

export declare function useZenithGrid<Row = GridRow>(
  containerRef: Ref<HTMLElement | null>,
  options?: GridOptions<Row>,
): UseZenithGridReturn<Row>;
