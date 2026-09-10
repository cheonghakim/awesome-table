import { EventBus } from './EventBus.js';
import { DataStore } from './DataStore.js';
import { ViewModel } from './ViewModel.js';
import { WorkerBridge } from './WorkerBridge.js';
import { HeaderModel } from './HeaderModel.js';
import { ColumnRegistry } from './ColumnRegistry.js';
import { Pipeline } from './Pipeline.js';
import { SortManager } from '../managers/SortManager.js';
import { FilterManager } from '../managers/FilterManager.js';
import { SelectionManager } from '../managers/SelectionManager.js';
import { VirtualScrollManager } from '../managers/VirtualScrollManager.js';
import { GroupManager } from '../managers/GroupManager.js';
import { TreeManager } from '../managers/TreeManager.js';
import { PaginationManager } from '../managers/PaginationManager.js';
import { InfiniteScrollManager } from '../managers/InfiniteScrollManager.js';
import { LiveUpdateManager } from '../managers/LiveUpdateManager.js';
import { ColumnStateManager } from '../managers/ColumnStateManager.js';
import { PluginManager } from './PluginManager.js';
import { DOMRenderer } from '../renderer/DOMRenderer.js';
import { HeaderRenderer } from '../renderer/HeaderRenderer.js';
import { BodyRenderer } from '../renderer/BodyRenderer.js';
import { SettingsPanelRenderer } from '../renderer/SettingsPanelRenderer.js';
import { DEFAULT_LOCALE } from './defaultLocale.js';
import { createSelectEditor } from '../editors/SelectEditor.js';
import { createDateEditor } from '../editors/DateEditor.js';
import { createTextareaEditor } from '../editors/TextareaEditor.js';
import { RowDragManager } from '../managers/RowDragManager.js';
import { AggregateManager } from '../managers/AggregateManager.js';
import { RangeSelectionManager } from '../managers/RangeSelectionManager.js';
import { UndoRedoManager } from '../managers/UndoRedoManager.js';
import { AdvancedFilterManager } from '../managers/AdvancedFilterManager.js';
import { PivotManager } from '../managers/PivotManager.js';
import { StatusBarRenderer } from '../renderer/StatusBarRenderer.js';
import { FormulaManager } from '../managers/FormulaManager.js';

function escapeCssSelector(value) {
  if (typeof CSS !== 'undefined' && CSS.escape) {
    return CSS.escape(value);
  }
  return String(value).replace(/([!"#$%&'()*+,.\\/:;<=>?@\\[\\]^\`{|}~])/g, '\\\\$1');
}

export class GridCore {
  constructor(container, options = {}) {
    if (!(container instanceof HTMLElement)) {
      throw new Error('[GridCore] A valid container element is required.');
    }

    this._container = container;
    this._options = options;
    this._events = new EventBus();
    this._renderVersion = 0;
    this._destroyed = false;
    this._displayMode = options.displayMode ?? 'client';
    this._rowMeasureFrame = null;
    this._serverPageRequestId = 0;
    this._serverInfiniteRequestId = 0;
    this._suspendDataStoreRefresh = false;
    this._pendingDataStoreRefresh = false;
    this._pendingLiveViewportAdjustment = null;
    this._locale = this._mergeLocale(DEFAULT_LOCALE, options.locale ?? {});
    this._activeCellColIndex = 0;
    this._handleKeydown = this._handleKeydown.bind(this);
    this._validationErrors = new Map();

    this._getRowKey = this._createRowKeyGetter(options.rowKey);
    this._pluginManager = new PluginManager(this);
    this._availablePlugins = this._normalizeAvailablePlugins(
      options.availablePlugins ?? options.plugins ?? []
    );

    this._columns = new ColumnRegistry(options.columns ?? [], options.columnState ?? {});
    // Pivot mode overwrites this._columns with dynamically-generated pivot columns
    // (refresh()'s pivot block, below) via a direct ColumnRegistry call that bypasses
    // the public setColumns() wrapper — so this snapshot only tracks genuine user column
    // sets and lets disablePivot() restore the pre-pivot columns.
    this._preservedColumnDefs = options.columns ?? [];
    this._columnStateManager = options.tableId
      ? new ColumnStateManager(options.tableId, options.columnStatePersistence ?? {})
      : null;
    this._headerModel = new HeaderModel(this._columns.getModel());
    this._viewModel = new ViewModel({
      rowHeight: options.rowHeight ?? 36,
      overscanTop: options.overscanTop ?? 4,
      overscanBottom: options.overscanBottom ?? 6,
      horizontalOverscan: options.horizontalOverscan ?? 1,
      variableRowHeight: options.variableRowHeight ?? false,
    });

    this._sortManager = new SortManager({
      onChanged: () => {
        this._emitStateChanged('sort');
        if (this._reloadActiveRemoteData()) {
          return;
        }
        void this.refresh();
      },
    });

    this._filterManager = new FilterManager({
      onChanged: () => {
        this._emitStateChanged('filter');
        if (this._reloadActiveRemoteData()) {
          return;
        }
        void this.refresh();
      },
    });

    this._selectionManager = new SelectionManager({
      mode: options.selectionMode ?? 'multiple',
      isSelectable: options.isRowSelectable ?? (() => true),
      onChanged: (payload) => {
        this._events.emit('selection-change', payload);
        options.onSelectionChange?.(payload);
      },
    });

    this._groupManager = new GroupManager({
      onChanged: () => {
        this._emitStateChanged('group');
        this._refreshFlatten();
      },
    });

    this._treeManager = new TreeManager({
      ...(options.tree ?? {}),
      getRowKey: this._getRowKey,
      onChanged: () => {
        this._emitStateChanged('tree');
        this._refreshFlatten();
      },
    });
    if (options.tree) {
      this._treeManager.enable();
    }
    this._treeLeafSpacerVisible = Boolean(options.tree?.showLeafSpacer);

    this._paginationManager = new PaginationManager({
      ...(options.pagination ?? {}),
      onPageChange: async (payload) => {
        await options.pagination?.onPageChange?.(payload);
        if (this._paginationManager.getMode() === 'server') {
          await this._loadServerPage(payload.page, payload.pageSize);
        }
      },
      onChanged: () => {
        this._emitStateChanged('pagination');
        void this.refresh();
      },
    });

    this._infiniteScrollManager = new InfiniteScrollManager({
      ...(options.infiniteScroll ?? {}),
      onLoadMore: async (payload) => options.infiniteScroll?.onLoadMore?.({
        ...payload,
        filters: this._filterManager.getWorkerPayload(),
        sort: this._sortManager.getState().sortDefs,
        displayMode: this._displayMode,
      }),
      onChanged: (payload) => {
        if (payload?.action === 'loadingStart' && this._displayMode === 'infinite') {
          this._dom.showInfiniteLoader();
        }
        if (payload?.action === 'loadingComplete' && Array.isArray(payload.rows)) {
          const addedCount = this._dataStore.appendRows(payload.rows);
          this._infiniteScrollManager.onRowsAppended(addedCount);
          this._dom.hideInfiniteLoader();
        } else if (payload?.action === 'loadingError') {
          this._dom.hideInfiniteLoader();
          const message = this.getLocaleText('grid.error.moreRowsFailed', 'Failed to load rows.');
          this._dom.showError(
            message,
            {
              content: this._renderOverlayState('error', { message, error: payload.error }),
              actionLabel: this.getLocaleText('grid.error.retry', 'Retry'),
              onAction: () => {
                void this._infiniteScrollManager.loadMore();
              },
            }
          );
        }
        this._emitStateChanged('infinite-scroll');
        void this.refresh();
      },
    });

    const workerEnabled = Boolean(options.worker?.enabled);
    this._workerBridge = new WorkerBridge({
      enabled: workerEnabled,
      workerUrl: options.worker?.url,
      timeout: options.worker?.timeout ?? 10000,
    });

    this._formulaManager = new FormulaManager(this);

    this._pipeline = new Pipeline({
      sortManager: this._sortManager,
      filterManager: this._filterManager,
      groupManager: this._groupManager,
      treeManager: this._treeManager,
      paginationManager: this._paginationManager,
      infiniteScrollManager: this._infiniteScrollManager,
      pluginManager: this._pluginManager,
      workerBridge: this._workerBridge,
      getRowKey: this._getRowKey,
      displayMode: this._displayMode,
    });

    this._liveUpdateManager = new LiveUpdateManager({
      ...(options.liveUpdates ?? {}),
      onBatchReady: (batch) => {
        this._applyLiveBatch(batch);
      },
      onNewDataNotification: (count) => {
        if (count > 0) {
          this._dom.showLiveBanner(
            this.getLocaleText(
              'grid.live.waiting',
              '{count} new rows are waiting. Click to review.',
              { count }
            ),
            () => {
              this._liveUpdateManager.clearPendingCount();
              this._dom.hideLiveBanner();
              void this.refresh();
            }
          );
        } else {
          this._dom.hideLiveBanner();
        }
      },
    });

    this._rowDragManager = new RowDragManager({
      onRowDragStart: (payload) => this._events.emit('row-drag-start', payload),
      onRowDragEnd: (payload) => this._events.emit('row-drag-end', payload),
      onRowDrop: ({ fromRowKey, toRowKey }) => this._handleRowDragDrop({ fromRowKey, toRowKey }),
    });

    this._aggregateManager = new AggregateManager({
      onChanged: () => void this.refresh(),
    });

    this._rangeSelectionManager = new RangeSelectionManager({
      onChanged: () => {
        this._events.emit('range-selection-change', this._rangeSelectionManager.getState());
        // 전체 재렌더 대신 CSS 클래스만 토글 (성능)
        this._bodyRenderer?.updateRangeHighlight(
          this._rangeSelectionManager,
          this._columns?.getVisibleLeafColumns?.()?.map((c) => c.def) ?? []
        );
      },
    });

    this._undoRedoManager = new UndoRedoManager({
      maxHistory: options.undoRedoMaxHistory ?? 100,
    });

    this._advancedFilterManager = new AdvancedFilterManager({
      onChanged: () => {
        this._emitStateChanged('advanced-filter');
        if (this._reloadActiveRemoteData()) return;
        void this.refresh();
      },
    });
    this._pipeline.setAdvancedFilterManager(this._advancedFilterManager);

    this._pivotManager = new PivotManager({
      onChanged: () => {
        void this.refresh();
      },
    });

    this._expandedDetailKeys = new Set();
    this._masterDetailRenderer = options.masterDetail?.detailRenderer ?? null;
    this._masterDetailRowHeight = options.masterDetail?.detailRowHeight ?? 200;

    this._handlePaste = this._handlePaste.bind(this);
    this._handleGlobalMouseUp = () => this._rangeSelectionManager.endSelection();
    this._dom = new DOMRenderer(container, options);
    this._dom.build();
    this._dom.getRoot()?.addEventListener('keydown', this._handleKeydown);
    this._dom.getRoot()?.addEventListener('paste', this._handlePaste);
    document.addEventListener('mouseup', this._handleGlobalMouseUp);
    this._settingsPanel = new SettingsPanelRenderer(this._dom, this, {
      quickFilterFields: options.sidePanel?.quickFilterFields ?? [],
      defaultTab: options.sidePanel?.defaultTab ?? 'columns',
      defaultOpen: options.sidePanel?.defaultOpen ?? false,
    });
    if (options.sidePanel?.enabled !== false) {
      this._settingsPanel.mount();
    }

    const statusBarEnabled = options.statusBar?.enabled ?? false;
    this._statusBarRenderer = statusBarEnabled
      ? new StatusBarRenderer(this._dom, {
          getLocaleText: (key, fallback, params) => this.getLocaleText(key, fallback, params),
          getColumnLabel: (colId) => {
            const def = this._columns.getDef(colId);
            return def?.headerName ?? def?.header ?? colId;
          },
        })
      : null;
    this._statusBarRenderer?.mount();

    this._headerRenderer = new HeaderRenderer(
      this._dom,
      this._headerModel,
      this._columns.getModel(),
      {
        sortManager: this._sortManager,
        onSortClick: ({ field, def, multiSort }) => {
          if (multiSort) {
            this._sortManager.addSort(field, def);
          } else {
            this._sortManager.toggleSort(field, def);
          }
        },
        onColumnDrop: ({ fromColId, toColId }) => {
          const leafColumns = this._columns.getAllLeafColumns();
          const targetIndex = leafColumns.findIndex((column) => column.def.id === toColId);
          if (targetIndex === -1) return;
          this.moveColumn(fromColId, targetIndex, { restrictToGroup: true });
        },
        onColumnResize: ({ colId, width, commit }) => {
          this._applyColumnResize(colId, width, { commit });
        },
        getColumnFilter: (colId) => this._filterManager.getColumnFilter(colId),
        onColumnFilterChange: (colId, filterDef) => {
          this.setColumnFilter(colId, filterDef);
        },
        onColumnFilterClear: (colId) => {
          this.clearColumnFilter(colId);
        },
        getColumnFilterChoices: (colId) => this.getColumnFilterChoices(colId),
        getLocaleText: (key, fallback, params) => this.getLocaleText(key, fallback, params),
        rowHeight: options.rowHeight ?? 40,
        rowNumbers: options.rowNumbers ?? false,
        rowNumberWidth: options.rowNumberWidth ?? 44,
        filterRowEnabled: options.filterRow?.enabled ?? false,
        fillHandle: options.fillHandle ?? false,
        onFillHandleStart: ({ row, def, value }) => this._startFillHandle(row, def, value),
        selectionEnabled: options.selectable !== false,
        selectionColumnWidth: this._masterDetailRenderer ? 68 : 44,
        isAllSelected: () => this._selectionManager.isAllSelected(this._displayRows),
        isSomeSelected: () => this._selectionManager.isSomeSelected(this._displayRows),
        onToggleSelectAll: () => {
          this.toggleSelectAll();
        },
        onClearSort: (colId) => {
          this._sortManager.clearSortFor(colId);
        },
        onAutoSizeColumn: (colId) => this.autoSizeColumn(colId),
        onAutoSizeAllColumns: () => this.autoSizeAllColumns(),
        onColumnPin: (colId, pin) => this.setColumnPinned(colId, pin),
        onColumnVisibilityChange: (colId, visible) => this.setColumnVisible(colId, visible),
      }
    );

    this._bodyRenderer = new BodyRenderer(
      this._dom,
      this._columns.getModel(),
      this._viewModel,
      {
        selectionManager: this._selectionManager,
        selectionEnabled: options.selectable !== false,
        isPivotEnabled: () => this._pivotManager.isEnabled(),
        selectionColumnWidth: this._masterDetailRenderer ? 68 : 44,
        onRowClick: ({ row, event }) => {
          if (options.selectable !== false && this._selectionManager.isSelectableRow(row)) {
            if (event.shiftKey) {
              this._selectionManager.shiftSelect(row._rowKey);
            } else {
              this._selectionManager.toggleRow(row._rowKey);
            }
            this._refreshSelection();
          }

          this._events.emit('row-click', { row, event });
          options.onRowClick?.({ row, event });
        },
        onCellClick: (payload) => {
          this._events.emit('cell-click', payload);
          options.onCellClick?.(payload);
        },
        onCellDoubleClick: (payload) => {
          this._events.emit('cell-dblclick', payload);
          options.onCellDoubleClick?.(payload);
          this.beginCellEdit(payload.row._rowKey, payload.colId, { cell: payload.cell });
        },
        onRowContextMenu: ({ row, event }) => {
          this._events.emit('row-contextmenu', { row, event });
          options.onRowContextMenu?.({ row, event });
        },
        onCellContextMenu: (payload) => {
          this._events.emit('cell-contextmenu', payload);
          options.onCellContextMenu?.(payload);
        },
        onGroupToggle: ({ groupKey, row }) => {
          this._groupManager.toggleGroup(groupKey);
          this._events.emit('group-toggle', { groupKey, row });
        },
        onTreeToggle: ({ rowKey, row }) => {
          if (row._hasChildren && row._isExpanded) {
            this._treeManager.collapse(rowKey);
          } else if (row._hasChildren) {
            const rawChildren = row[this._treeManager._childrenField] ?? [];
            if (rawChildren.length === 0 && row[this._treeManager._hasChildrenField]) {
              void this._treeManager.loadChildren(rowKey, row);
            }
            this._treeManager.expand(rowKey);
          }
          this._events.emit('tree-toggle', { rowKey, row });
        },
        onRowSelectionToggle: ({ row, checked }) => {
          this.setRowSelected(row._rowKey, checked, { includeDescendants: true });
        },
        onRowMeasured: ({ flatIndex, height }) => {
          const changed = this._viewModel.setRowHeightAt(flatIndex, height);
          if (changed) {
            this._scheduleViewportRender();
          }
        },
        getRowHeight: options.getRowHeight ?? null,
        isRowSelectable: (row) => this._selectionManager.isSelectableRow(row),
        getRowClassName: options.getRowClassName ?? null,
        getRowStyle: options.getRowStyle ?? null,
        hooks: {
          beforeRowRender: (ctx) => {
            options.hooks?.beforeRowRender?.(ctx);
            this._pluginManager.callHook('beforeRowRender', ctx);
          },
          afterRowRender: (ctx) => {
            options.hooks?.afterRowRender?.(ctx);
            this._pluginManager.callHook('afterRowRender', ctx);
          },
          beforeCellRender: (ctx) => {
            options.hooks?.beforeCellRender?.(ctx);
            this._pluginManager.callHook('beforeCellRender', ctx);
          },
          afterCellRender: (ctx) => {
            options.hooks?.afterCellRender?.(ctx);
            this._pluginManager.callHook('afterCellRender', ctx);
          },
        },
        shouldAnimateRow: (rowKey) => this._liveUpdateManager.shouldAnimateRow(rowKey),
        getRowAnimationDuration: () => this._liveUpdateManager.getRowAnimationDuration(),
        getLocaleText: (key, fallback, params) => this.getLocaleText(key, fallback, params),
        getCellValidationError: (rowKey, colId) => this.getCellValidationError(rowKey, colId),
        rowNumbers: options.rowNumbers ?? false,
        rowNumberWidth: options.rowNumberWidth ?? 44,
        rowDragging: options.rowDragging ?? false,
        onRowDragDrop: ({ fromRowKey, toRowKey }) => this._handleRowDragDrop({ fromRowKey, toRowKey }),
        onRowDragStart: ({ rowKey }) => this._rowDragManager.handleDragStart(rowKey),
        onRowDragEnd: () => this._rowDragManager.handleDragEnd(),
        getRangeSelectionManager: () => this._rangeSelectionManager,
        isTreeLeafSpacerVisible: () => this._treeLeafSpacerVisible,
        getAllLeafColumnDefs: () => this._columns.getVisibleLeafColumns().map((c) => c.def),
        isMasterDetailEnabled: this._masterDetailRenderer
          ? () => !this._pivotManager.isEnabled()
          : null,
        getMasterDetailPanel: this._masterDetailRenderer
          ? (row) => {
              if (this._pivotManager.isEnabled()) return null;
              try { return this._masterDetailRenderer(row, this); } catch { return null; }
            }
          : null,
        onMasterDetailToggle: this._masterDetailRenderer
          ? (rowKey) => {
              if (!this._pivotManager.isEnabled()) this.toggleDetail(rowKey);
            }
          : null,
      }
    );

    this._virtualScrollManager = new VirtualScrollManager(this._viewModel, {
      onScrollChanged: async () => {
        if (this._displayMode === 'infinite') {
          await this._infiniteScrollManager.maybeLoadMore(this._viewModel);
        }
      },
      onRangeChanged: (range) => {
        this._currentRangeBundle = range;
        if (this._displayRows) {
          this._headerRenderer.render(range);
          this._bodyRenderer.render(this._displayRows, range);
        }
      },
    });

    this._virtualScrollManager.mount(
      this._dom.getBodyViewport(),
      this._dom.getHeaderCenterViewport()
    );

    // NOTE: DataStore gets the raw `options.rowKey`, not `this._getRowKey` below — if it's a
    // function, DataStore.getRowKey() calls it as (row) while Pipeline/TreeManager call the
    // same function as (row, index). See the note in DataStore.getRowKey().
    this._dataStore = new DataStore({
      rowKey: options.rowKey ?? 'id',
      onChanged: () => {
        if (this._suspendDataStoreRefresh) {
          this._pendingDataStoreRefresh = true;
          return;
        }
        void this.refresh();
      },
    });

    this._displayRows = [];
    this._flatRows = [];
    this._pinnedTopRows = Array.isArray(options.pinnedTopRows) ? options.pinnedTopRows : [];
    this._pinnedBottomRows = Array.isArray(options.pinnedBottomRows) ? options.pinnedBottomRows : [];
    this._currentRangeBundle = {
      vertical: this._viewModel.getVerticalRange(),
      horizontal: this._viewModel.getHorizontalRange(),
    };

    if (Array.isArray(options.rows)) {
      this.setRows(options.rows);
    } else {
      void this.refresh();
    }

    if (Array.isArray(options.plugins)) {
      for (const pluginEntry of options.plugins) {
        if (pluginEntry?.plugin) {
          this.usePlugin(pluginEntry.plugin, pluginEntry.options ?? {});
        } else if (pluginEntry) {
          this.usePlugin(pluginEntry, {});
        }
      }
    }

    void this._restoreColumnState();
    void this._initializeRemoteData();

    this._handleBeforePrint = this._handleBeforePrint.bind(this);
    this._handleAfterPrint = this._handleAfterPrint.bind(this);
    window.addEventListener('beforeprint', this._handleBeforePrint);
    window.addEventListener('afterprint', this._handleAfterPrint);
  }

  async refresh() {
    if (this._destroyed) return;

    // Calculate flex column widths before rendering
    this._calculateFlexColumnWidths();

    if (this._formulaManager) {
      this._formulaManager.evaluateAll();
    }

    const version = ++this._renderVersion;
    let result;
    try {
      result = await this._pipeline.process(this._dataStore.getAll());
    } catch (error) {
      console.error('[GridCore] Pipeline processing failed:', error);
      if (!this._destroyed && version === this._renderVersion) {
        const message = this.getLocaleText('grid.error.processFailed', 'Failed to process data.');
        this._dom.showError(
          message,
          {
            content: this._renderOverlayState('error', { message, error }),
            actionLabel: this.getLocaleText('grid.error.retry', 'Retry'),
            onAction: () => {
              void this.refresh();
            },
          }
        );
        this._dom.hideInfiniteLoader();
      }
      return;
    }
    if (this._destroyed || version !== this._renderVersion) return;

    // 고급 필터는 Pipeline.process() 안에서 페이지 분할 이전에 이미 적용됐다
    // (totalCount/페이지 상태가 필터링된 개수를 기준으로 계산되도록).

    // Pivot 모드
    if (this._pivotManager.isEnabled()) {
      const { pivotRows, pivotColumnDefs } = this._pivotManager.process(result.displayRows);
      if (pivotColumnDefs) {
        result.displayRows = pivotRows;
        result.flatRows = pivotRows;
        this._columns.setColumns(pivotColumnDefs, false);
        this._headerModel.rebuild();
        this._syncColumnWidths();
      }
    }

    // 그룹 행 집계 계산 (런타임 API 또는 컬럼 def aggregate 속성 중 하나라도 있으면 실행)
    const allLeafCols = this._columns.getAllLeafColumns().map((c) => c.def);
    const hasAnyAggregate = this._aggregateManager.hasAny()
      || allLeafCols.some((def) => def.aggregate != null);
    if (hasAnyAggregate) {
      // flatRows (전체, 페이지 분할 이전) 기준으로 순회해야 한다 — displayRows는 현재
      // 페이지로 잘린 슬라이스라, 그 안에서만 인접 leaf 행을 찾으면 그룹이 여러 페이지에
      // 걸쳐 있을 때 합계가 현재 페이지 몫만 반영된다. group-header row 객체는 flatRows와
      // displayRows가 같은 참조를 공유하므로 여기서 채운 _aggregates가 그대로 화면에 반영된다.
      for (let i = 0; i < result.flatRows.length; i++) {
        const row = result.flatRows[i];
        if (row._type !== 'group-header') continue;
        const groupDepth = row._groupDepth ?? 0;
        // 직계 leaf 행 + 하위 그룹의 leaf 행 모두 수집
        const leafChildren = [];
        for (let j = i + 1; j < result.flatRows.length; j++) {
          const next = result.flatRows[j];
          if (next._type === 'group-header' && (next._groupDepth ?? 0) <= groupDepth) break;
          if (next._type !== 'group-header' && next._type !== 'tree-loading' && next._type !== 'detail') {
            leafChildren.push(next);
          }
        }
        if (leafChildren.length > 0) {
          row._aggregates = this._aggregateManager.compute(leafChildren, allLeafCols);
        }
      }
    }

    // Master-Detail 행 주입 (Pivot 모드에서는 비활성)
    if (this._masterDetailRenderer && !this._pivotManager.isEnabled()) {
      const injected = [];
      for (const row of result.displayRows) {
        const expanded = this._expandedDetailKeys.has(String(row._rowKey));
        if (row._type !== 'group-header' && row._type !== 'tree-loading' && row._type !== 'detail') {
          row._detailExpanded = expanded;
        }
        injected.push(row);
        if (expanded) {
          injected.push({
            _type: 'detail',
            _masterRowKey: row._rowKey,
            _masterRow: row,
            _rowKey: `__detail__${row._rowKey}`,
            _rowHeight: this._masterDetailRowHeight,
          });
        }
      }
      result.displayRows = injected;
    }

    this._flatRows = result.flatRows;
    this._displayRows = result.displayRows;
    this._selectionManager.setCurrentRows(result.displayRows);
    this._viewModel.setTotalCount(result.displayRows.length);
    this._headerModel.rebuild();
    this._syncColumnWidths();
    this._currentRangeBundle = {
      vertical: this._viewModel.getVerticalRange(),
      horizontal: this._viewModel.getHorizontalRange(),
    };

    this._pluginManager.callHook('beforeRender', result);
    this._headerRenderer.render(this._currentRangeBundle);
    this._headerRenderer.updateSortIndicators();
    this._renderFooter();
    this._dom.setAccessibilityMeta({
      rowCount: result.totalCount ?? result.displayRows.length,
      colCount: this._columns.getVisibleLeafColumns().length + (this._options.selectable === false ? 0 : 1),
    });

    if (this._statusBarRenderer) {
      const allLeafCols = this._columns.getAllLeafColumns().map((c) => c.def);
      const aggResult = this._aggregateManager.compute(result.displayRows, allLeafCols);
      const selectedCount = this._selectionManager.getSelectedCount();
      this._statusBarRenderer.render({
        totalCount: this._dataStore.getAll().length,
        displayCount: result.displayRows.filter(
          (r) => r._type !== 'group-header' && r._type !== 'tree-loading' && r._type !== 'detail'
        ).length,
        selectedCount,
        aggregateResult: aggResult,
      });
    }

    this._bodyRenderer.renderPinnedRows(this._pinnedTopRows, 'top');
    this._bodyRenderer.renderPinnedRows(this._pinnedBottomRows, 'bottom');

    if (result.displayRows.length === 0) {
      this._bodyRenderer.clear();
      const message = this._options.emptyMessage ?? this.getLocaleText('grid.empty.noRows', 'No rows available.');
      this._dom.showEmpty(message, {
        content: this._renderOverlayState('empty', { message }),
      });
      this._dom.hideInfiniteLoader();
    } else {
      this._dom.hideOverlay();
      if (!(this._displayMode === 'infinite' && this._infiniteScrollManager.getState().loading)) {
        this._dom.hideInfiniteLoader();
      }
      this._bodyRenderer.render(result.displayRows, this._currentRangeBundle);
    }

    this._applyPendingLiveViewportAdjustment();

    this._events.emit('render', {
      rows: result.displayRows,
      flatRows: result.flatRows,
      totalCount: result.totalCount,
      visibleCount: result.displayRows.filter(
        (r) => r._type !== 'group-header' && r._type !== 'tree-loading' && r._type !== 'detail'
      ).length,
      displayMode: this._displayMode,
    });
    this._pluginManager.callHook('afterRender', result);
    this._settingsPanel?.render();
    this._applyPendingCellFlash();
  }

  setRows(rows) {
    this._invalidateMeasuredRows();
    // A full dataset replacement invalidates undo/redo history: it's keyed by rowKey
    // only, so a stale action from the previous dataset could silently apply onto an
    // unrelated row that happens to reuse the same key in the new dataset.
    this._undoRedoManager.clear();
    const normalizedRows = Array.isArray(rows) ? rows : [];
    for (const row of normalizedRows) {
      if (row._formulas) delete row._formulas;
      for (const field of Object.keys(row)) {
        if (field.startsWith('_')) continue;
        const val = row[field];
        if (typeof val === 'string' && val.startsWith('=')) {
          row._formulas = row._formulas || {};
          row._formulas[field] = val;
        }
      }
    }
    this._dataStore.setData(normalizedRows);
  }

  setData(rows) {
    this.setRows(rows);
  }

  appendRows(rows) {
    const normalizedRows = Array.isArray(rows) ? rows : [rows];
    for (const row of normalizedRows) {
      if (row._formulas) delete row._formulas;
      for (const field of Object.keys(row)) {
        if (field.startsWith('_')) continue;
        const val = row[field];
        if (typeof val === 'string' && val.startsWith('=')) {
          row._formulas = row._formulas || {};
          row._formulas[field] = val;
        }
      }
    }
    this._dataStore.appendRows(normalizedRows);
  }

  updateRows(rows) {
    const normalizedRows = Array.isArray(rows) ? rows : [rows];
    for (const row of normalizedRows) {
      const existing = this._dataStore.getByKey(this._dataStore.getRowKey(row));
      const formulas = { ...(existing?._formulas || {}) };
      for (const field of Object.keys(row)) {
        if (field.startsWith('_')) continue;
        const val = row[field];
        if (typeof val === 'string' && val.startsWith('=')) {
          formulas[field] = val;
        } else {
          delete formulas[field];
        }
      }
      if (Object.keys(formulas).length > 0) {
        row._formulas = formulas;
      } else {
        delete row._formulas;
      }
    }
    this._dataStore.updateRows(normalizedRows);
  }

  patchRow(key, patch) {
    const existing = this._dataStore.getByKey(key);
    if (!existing) {
      return this._dataStore.patchRow(key, patch);
    }

    // `_formulas` must be updated on `existing` BEFORE calling DataStore.patchRow: that
    // call's onChanged synchronously triggers refresh() -> FormulaManager.evaluateAll(),
    // which only recomputes fields listed in `_formulas` at that exact moment. Setting it
    // afterward would miss that pass and leave the raw formula string in the cell instead
    // of its computed value.
    const previousFormulas = existing._formulas;
    const formulas = { ...(previousFormulas || {}) };
    for (const [field, val] of Object.entries(patch)) {
      if (field.startsWith('_')) continue;
      if (typeof val === 'string' && val.startsWith('=')) {
        formulas[field] = val;
      } else {
        delete formulas[field];
      }
    }
    if (Object.keys(formulas).length > 0) {
      existing._formulas = formulas;
    } else {
      delete existing._formulas;
    }

    const succeeded = this._dataStore.patchRow(key, patch);
    if (!succeeded) {
      // The underlying patch was rejected (e.g. it would rename this row onto another
      // row's rowKey) — this row's data never changed, so undo the bookkeeping mutation
      // above rather than leaving it corrupted.
      if (previousFormulas) {
        existing._formulas = previousFormulas;
      } else {
        delete existing._formulas;
      }
      return false;
    }
    return true;
  }

  upsertRows(rows) {
    const normalizedRows = Array.isArray(rows) ? rows : [rows];
    for (const row of normalizedRows) {
      const key = this._dataStore.getRowKey(row);
      if (this._dataStore.has(key)) {
        const existing = this._dataStore.getByKey(key);
        const formulas = { ...(existing?._formulas || {}) };
        for (const field of Object.keys(row)) {
          if (field.startsWith('_')) continue;
          const val = row[field];
          if (typeof val === 'string' && val.startsWith('=')) {
            formulas[field] = val;
          } else {
            delete formulas[field];
          }
        }
        if (Object.keys(formulas).length > 0) {
          row._formulas = formulas;
        } else {
          delete row._formulas;
        }
      } else {
        if (row._formulas) delete row._formulas;
        for (const field of Object.keys(row)) {
          if (field.startsWith('_')) continue;
          const val = row[field];
          if (typeof val === 'string' && val.startsWith('=')) {
            row._formulas = row._formulas || {};
            row._formulas[field] = val;
          }
        }
      }
    }
    this._dataStore.upsertRows(normalizedRows);
  }

  removeRows(keys) {
    this._dataStore.removeRows(Array.isArray(keys) ? keys : [keys]);
  }

  setColumns(columns) {
    this._preservedColumnDefs = columns;
    this._columns.setColumns(columns, true);
    this._headerModel.rebuild();
    this._invalidateMeasuredRows();
    this._syncColumnWidths();
    void this.saveColumnState();
    void this.refresh();
  }

  setQuickFilter(text, fields = []) {
    this._filterManager.setQuickFilter(text, fields);
  }

  setColumnFilter(colId, filterDef) {
    this._filterManager.setColumnFilter(colId, filterDef);
  }

  clearColumnFilter(colId) {
    this._filterManager.clearColumnFilter(colId);
  }

  clearFilters() {
    this._filterManager.clearAllFilters();
  }

  enableGrouping(groupByFields, options = {}) {
    if (this._treeManager.isEnabled()) {
      this._treeManager.disable();
    }
    this._invalidateMeasuredRows();
    this._groupManager.enable(groupByFields, options);
  }

  toggleGroup(groupKey) {
    this._groupManager.toggleGroup(groupKey);
  }

  disableGrouping() {
    this._invalidateMeasuredRows();
    this._groupManager.disable();
  }

  isGroupingEnabled() {
    return this._groupManager.isEnabled();
  }

  enableTree(options = {}) {
    if (this._groupManager.isEnabled()) {
      this._groupManager.disable();
    }
    Object.assign(this._treeManager, {
      _treeMode: options.treeMode ?? this._treeManager._treeMode,
      _childrenField: options.childrenField ?? this._treeManager._childrenField,
      _parentIdField: options.parentIdField ?? this._treeManager._parentIdField,
      _hasChildrenField: options.hasChildrenField ?? this._treeManager._hasChildrenField,
      _onLoadChildren: options.onLoadChildren ?? this._treeManager._onLoadChildren,
    });
    this._invalidateMeasuredRows();
    this._treeManager.enable();
    void this.refresh();
  }

  disableTree() {
    this._invalidateMeasuredRows();
    this._treeManager.disable();
    void this.refresh();
  }

  isTreeEnabled() {
    return this._treeManager.isEnabled();
  }

  toggleTreeRow(rowKey) {
    this._treeManager.toggle(rowKey);
  }

  expandAllTree() {
    this._treeManager.expandAll(this._pipeline.getLastBaseRows());
  }

  collapseAllTree() {
    this._treeManager.collapseAll();
  }

  isTreeLeafSpacerVisible() {
    return this._treeLeafSpacerVisible;
  }

  setTreeLeafSpacerVisible(visible) {
    this._treeLeafSpacerVisible = Boolean(visible);
    void this.refresh();
  }

  sortBy(defs) {
    this._sortManager.setSort(defs);
  }

  clearSort() {
    this._sortManager.clearSort();
  }

  toggleSelectAll() {
    const keys = this._displayRows.flatMap((row) => this._collectSelectionKeysForRow(row));
    const selectedKeys = this._selectionManager.getSelectedKeys();
    const allSelected = keys.length > 0 && keys.every((key) => selectedKeys.has(String(key)));

    if (allSelected) {
      this._selectionManager.clearSelection();
    } else {
      this._selectionManager.setRowsSelected(keys, true, 'selectAll');
    }
    this._refreshSelection();
  }

  setRowSelected(rowKey, selected, options = {}) {
    const row = this._flatRows.find((item) => item._rowKey === String(rowKey));
    const keys = row ? this._collectSelectionKeysForRow(row, options) : [String(rowKey)];
    this._selectionManager.setRowsSelected(keys, selected, selected ? 'select' : 'deselect');
    this._refreshSelection();
  }

  on(eventName, handler, options) {
    return this._events.on(eventName, handler, options);
  }

  getSelectedKeys() {
    return this._selectionManager.getSelectedKeys();
  }

  getSelectedRows() {
    return this._selectionManager.getSelectedRows();
  }

  getSelectionState() {
    return this._selectionManager.getState();
  }

  getDisplayMode() {
    return this._displayMode;
  }

  getPaginationState() {
    return this._paginationManager.getState();
  }

  getInfiniteScrollState() {
    return this._infiniteScrollManager.getState();
  }

  isVariableRowHeight() {
    return this._viewModel.isVariableRowHeight();
  }

  getColumnState() {
    return this._columns.serializeState();
  }

  getAllLeafColumns() {
    return this._columns.getAllLeafColumns().map((column) => ({
      def: { ...column.def },
      state: { ...column.state },
    }));
  }

  getVisibleLeafColumns() {
    return this._columns.getVisibleLeafColumns().map((column) => ({
      def: { ...column.def },
      state: { ...column.state },
    }));
  }

  getFilterState() {
    return this._filterManager.getState();
  }

  // ─── Undo/Redo API ────────────────────────────────────────
  undo() {
    return this._undoRedoManager.undo((rowKey, colId, value) => {
      this._applyUndoRedoValue(rowKey, colId, value);
    });
  }

  redo() {
    return this._undoRedoManager.redo((rowKey, colId, value) => {
      this._applyUndoRedoValue(rowKey, colId, value);
    });
  }

  _handlePaste(event) {
    if (this._destroyed) return;
    const target = event.target;
    // 에디터 입력 중이면 기본 붙여넣기 허용
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;

    const text = event.clipboardData?.getData('text/plain');
    if (!text) return;

    if (this._rangeSelectionManager.hasRange()) {
      event.preventDefault();
      const { start } = this._rangeSelectionManager.getState();
      if (start) {
        this.pasteFromClipboard(text, { startRowKey: start.rowKey, startColId: start.colId });
      }
    }
  }

  _applyUndoRedoValue(rowKey, colId, value) {
    const row = this._dataStore.getByKey(rowKey);
    const column = this._columns.getDef(colId);
    if (!row || !column) return;
    const isFormula = typeof value === 'string' && value.startsWith('=');
    const parsed = isFormula ? value : this._parseCellValue(value, row, column);
    // this.patchRow (not _dataStore.patchRow) so `_formulas` bookkeeping stays in
    // sync when undo/redo restores a formula string.
    // patchRow → DataStore.onChanged → refresh() 자동 호출
    this.patchRow(rowKey, { [column.field]: parsed });
    this._events.emit('cell-value-change', { rowKey, colId, field: column.field, value: parsed, row });
  }

  canUndo() { return this._undoRedoManager.canUndo(); }
  canRedo() { return this._undoRedoManager.canRedo(); }

  // ─── Advanced Filter API ──────────────────────────────────
  setAdvancedFilter(filterTree) {
    this._advancedFilterManager.setFilter(filterTree);
  }

  clearAdvancedFilter() {
    this._advancedFilterManager.clearFilter();
  }

  // ─── Pivot API ────────────────────────────────────────────
  enablePivot(config) {
    this._pivotManager.enable(config);
  }

  disablePivot() {
    this._pivotManager.disable();
    this._columns.setColumns(this._preservedColumnDefs, false);
    this._headerModel.rebuild();
    this._invalidateMeasuredRows();
    this._syncColumnWidths();
    void this.saveColumnState();
    void this.refresh();
  }

  isPivotEnabled() {
    return this._pivotManager.isEnabled();
  }

  getPivotConfig() {
    return this._pivotManager.getConfig();
  }

  // ─── Master-Detail API ────────────────────────────────────
  toggleDetail(rowKey) {
    const key = String(rowKey);
    if (this._expandedDetailKeys.has(key)) {
      this._expandedDetailKeys.delete(key);
    } else {
      this._expandedDetailKeys.add(key);
    }
    void this.refresh();
    this._events.emit('detail-toggle', { rowKey: key, expanded: this._expandedDetailKeys.has(key) });
  }

  isDetailExpanded(rowKey) {
    return this._expandedDetailKeys.has(String(rowKey));
  }

  // ─── Row Drag API ─────────────────────────────────────────
  moveRow(fromRowKey, toRowKey) {
    this._handleRowDragDrop({ fromRowKey, toRowKey });
  }

  // ─── Aggregate API ────────────────────────────────────────
  setColumnAggregate(colId, aggType) {
    this._aggregateManager.setColumnAgg(colId, aggType);
  }

  clearColumnAggregate(colId) {
    this._aggregateManager.setColumnAgg(colId, null);
  }

  getAggregateResult() {
    const allLeafCols = this._columns.getAllLeafColumns().map((c) => c.def);
    return this._aggregateManager.compute(this._displayRows, allLeafCols);
  }

  // ─── Row Pinning API ──────────────────────────────────────
  setPinnedTopRows(rows) {
    this._pinnedTopRows = Array.isArray(rows) ? rows : [];
    void this.refresh();
  }

  setPinnedBottomRows(rows) {
    this._pinnedBottomRows = Array.isArray(rows) ? rows : [];
    void this.refresh();
  }

  // ─── Range Selection API ─────────────────────────────────
  clearRangeSelection() {
    this._rangeSelectionManager.clearRange();
  }

  copyRangeToClipboard() {
    const allLeafCols = this._columns.getVisibleLeafColumns().map((c) => c.def);
    this._rangeSelectionManager.copyToClipboard(this._displayRows, allLeafCols);
  }

  getRangeSelectionState() {
    return this._rangeSelectionManager.getState();
  }

  // ─── Print API ───────────────────────────────────────────
  printGrid() {
    window.print();
  }

  _handleBeforePrint() {
    if (this._destroyed) return;
    const { totalHeight } = this._viewModel.getVerticalRange();
    const { totalWidth } = this._viewModel.getHorizontalRange();
    const centerColumns = this._columns.getColumnsByPin().center;

    const fullBundle = {
      vertical: {
        startIndex: 0,
        endIndex: this._displayRows.length - 1,
        offsetY: 0,
        totalHeight,
      },
      horizontal: {
        startColIndex: 0,
        endColIndex: Math.max(0, centerColumns.length - 1),
        offsetX: 0,
        totalWidth,
      },
    };

    this._headerRenderer.render(fullBundle);
    this._bodyRenderer.render(this._displayRows, fullBundle);
  }

  _handleAfterPrint() {
    if (this._destroyed) return;
    this._headerRenderer.render(this._currentRangeBundle);
    this._bodyRenderer.render(this._displayRows, this._currentRangeBundle);
  }

  getColumnFilterChoices(colId) {
    const def = this._columns.getDef(colId);
    if (!def) {
      return [];
    }

    const configured = def.filterOptions ?? def._raw?.filterOptions;
    if (Array.isArray(configured) && configured.length > 0) {
      return configured.map((option) => (
        option && typeof option === 'object' && 'value' in option
          ? {
            value: option.value,
            label: option.label ?? String(option.value),
          }
          : {
            value: option,
            label: String(option),
          }
      ));
    }

    const values = new Map();
    for (const row of this._dataStore.getAll()) {
      const value = row?.[def.field];
      if (value == null) {
        continue;
      }

      const key = typeof value === 'object' ? JSON.stringify(value) : String(value);
      if (!values.has(key)) {
        values.set(key, {
          value,
          label: String(value),
        });
      }
    }

    return [...values.values()];
  }

  getGroupingState() {
    return this._groupManager.getState();
  }

  getTreeState() {
    return this._treeManager.getState();
  }

  getRows() {
    return [...this._displayRows];
  }

  getFlatRows() {
    return [...this._flatRows];
  }

  usePlugin(plugin, options = {}) {
    this._pluginManager.use(plugin, options);
    void this.refresh();
  }

  unusePlugin(pluginName) {
    this._pluginManager.unuse(pluginName);
    void this.refresh();
  }

  hasPlugin(pluginName) {
    return this._pluginManager.has(pluginName);
  }

  getInstalledPlugins() {
    return this._pluginManager.getInstalledNames();
  }

  getAvailablePlugins() {
    return this._availablePlugins.map((entry) => ({ ...entry }));
  }

  setVariableRowHeight(enabled) {
    this._viewModel.setVariableRowHeight(Boolean(enabled));
    this._invalidateMeasuredRows();
    void this.refresh();
  }

  setPaginationMode(mode) {
    const prevMode = this._paginationManager.getMode();
    this._paginationManager.setMode(mode);
    if (this._displayMode === 'paginated' && mode === 'server') {
      if (prevMode !== 'server') {
        this._paginationManager.reset();
      }
      void this._loadServerPage(this._paginationManager.getState().page, this._paginationManager.getState().pageSize);
      return;
    }
    void this.refresh();
  }

  setInfiniteScrollMode(mode) {
    this._infiniteScrollManager.setMode(mode);
    if (this._displayMode === 'infinite' && mode === 'server') {
      void this._loadInitialInfiniteRows();
      return;
    }
    void this.refresh();
  }

  setDisplayMode(mode) {
    const modeChanged = this._displayMode !== mode;
    if (mode === 'paginated') {
      this._infiniteScrollManager.reset();
    }
    if (mode === 'infinite') {
      this._paginationManager.reset();
    }
    this._displayMode = mode;
    this._pipeline._displayMode = mode;
    this._invalidateMeasuredRows();
    if (modeChanged && mode === 'paginated' && this._paginationManager.getMode() === 'server') {
      void this._loadServerPage(this._paginationManager.getState().page, this._paginationManager.getState().pageSize);
      return;
    }
    if (modeChanged && mode === 'infinite' && this._infiniteScrollManager.getMode() === 'server') {
      void this._loadInitialInfiniteRows();
      return;
    }
    void this.refresh();
  }

  setPage(page) {
    this._displayMode = 'paginated';
    this._pipeline._displayMode = 'paginated';
    this._paginationManager.setPage(page);
  }

  nextPage() {
    this.setDisplayMode('paginated');
    this._paginationManager.nextPage();
  }

  prevPage() {
    this.setDisplayMode('paginated');
    this._paginationManager.prevPage();
  }

  setPageSize(size) {
    this.setDisplayMode('paginated');
    this._paginationManager.setPageSize(size);
  }

  enableInfiniteScroll() {
    this.setDisplayMode('infinite');
  }

  disableInfiniteScroll() {
    this.setDisplayMode('client');
  }

  loadMoreInfinite() {
    return this._infiniteScrollManager.loadMore();
  }

  liveAddRows(rows) {
    this._liveUpdateManager.enable();
    this._liveUpdateManager.addRows(Array.isArray(rows) ? rows : [rows]);
  }

  liveUpdateRows(rows) {
    this._liveUpdateManager.enable();
    this._liveUpdateManager.updateRows(Array.isArray(rows) ? rows : [rows]);
  }

  livePatchRow(key, patch) {
    this._liveUpdateManager.enable();
    this._liveUpdateManager.patchRow(key, patch);
  }

  liveUpsertRows(rows) {
    this._liveUpdateManager.enable();
    this._liveUpdateManager.upsertRows(Array.isArray(rows) ? rows : [rows]);
  }

  liveRemoveRows(keys) {
    this._liveUpdateManager.enable();
    const list = Array.isArray(keys) ? keys : [keys];
    list.forEach((key) => this._liveUpdateManager.removeRow(key));
  }

  pauseLiveUpdates() {
    this._liveUpdateManager.pause();
  }

  resumeLiveUpdates() {
    this._liveUpdateManager.resume();
  }

  setLiveRowAnimationEnabled(enabled) {
    const normalized = Boolean(enabled);
    this._options.liveUpdates = {
      ...(this._options.liveUpdates ?? {}),
      rowAnimationEnabled: normalized,
    };
    this._liveUpdateManager.setRowAnimationEnabled(normalized);
    void this.refresh();
  }

  isLiveRowAnimationEnabled() {
    return this._liveUpdateManager.isRowAnimationEnabled();
  }

  setLocale(locale = {}) {
    this._locale = this._mergeLocale(DEFAULT_LOCALE, locale);
    this._settingsPanel?.render();
    this._renderFooter();
    void this.refresh();
  }

  beginCellEdit(rowKey, colId, options = {}) {
    const column = this._columns.getDef(colId);
    const row = this._dataStore.getByKey(rowKey);
    if (!column || !row || !this._isCellEditable(row, column)) {
      return false;
    }

    const cell = options.cell instanceof HTMLElement
      ? options.cell
      : this._container.querySelector(`.ck-zenith-grid-row[data-row-key="${String(rowKey)}"] .ck-zenith-grid-cell[data-col-id="${colId}"]`);
    if (!(cell instanceof HTMLElement)) {
      return false;
    }

    const previous = row._formulas?.[column.field] ?? row[column.field];
    const editor = this._createCellEditor(row, column, previous);
    cell.classList.add('ck-zenith-grid-cell-editing');
    delete cell.dataset.committed;
    cell.innerHTML = '';
    cell.appendChild(editor);
    editor.focus();
    editor.select?.();

    // Enter/Tab also commit via the bubbled keydown reaching _handleKeydown ->
    // commitCellEdit(), and a Tab/Enter-driven focus change fires this editor's own
    // blur handler too — without this shared per-cell flag, a single confirm can push
    // 2-3 duplicate entries onto the undo stack for one edit.
    const finish = (commit) => {
      if (!cell.isConnected || cell.dataset.committed === 'true') return;
      if (commit) {
        cell.dataset.committed = 'true';
        this.setCellValue(rowKey, colId, editor.value);
      } else {
        void this.refresh();
      }
    };

    editor.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });
    editor.addEventListener('blur', () => finish(true), { once: true });
    return true;
  }

  _startFillHandle(sourceRow, def, sourceValue) {
    const colId = def.id;
    const sourceRowKey = String(sourceRow._rowKey);
    let fillTarget = null;

    const onMouseEnter = (event) => {
      const target = event.target?.closest('[data-row-key]');
      if (target) fillTarget = target.dataset.rowKey;
    };

    const onMouseUp = () => {
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('mouseenter', onMouseEnter, true);
      this._container.classList.remove('ck-zenith-grid-filling');

      if (!fillTarget || fillTarget === sourceRowKey) return;

      const flatRows = this._displayRows.filter(
        (r) => r._type !== 'group-header' && r._type !== 'tree-loading' && r._type !== 'detail'
      );
      const sourceIdx = flatRows.findIndex((r) => String(r._rowKey) === sourceRowKey);
      const targetIdx = flatRows.findIndex((r) => String(r._rowKey) === String(fillTarget));
      if (sourceIdx === -1 || targetIdx === -1) return;

      const minIdx = Math.min(sourceIdx, targetIdx);
      const maxIdx = Math.max(sourceIdx, targetIdx);
      for (let i = minIdx; i <= maxIdx; i++) {
        const r = flatRows[i];
        if (String(r._rowKey) !== sourceRowKey) {
          this.setCellValue(r._rowKey, colId, sourceValue);
        }
      }
    };

    this._container.classList.add('ck-zenith-grid-filling');
    document.addEventListener('mouseup', onMouseUp, { once: true });
    document.addEventListener('mouseenter', onMouseEnter, true);
  }

  cancelCellEdit() {
    const editing = this._container.querySelector('.ck-zenith-grid-cell-editing');
    if (!editing) return;
    editing.classList.remove('ck-zenith-grid-cell-editing');
    void this.refresh();
  }

  commitCellEdit(rowKey, colId, value) {
    const editing = this._container.querySelector('.ck-zenith-grid-cell-editing');
    if (!editing || editing.dataset.committed === 'true') return;
    editing.dataset.committed = 'true';
    editing.classList.remove('ck-zenith-grid-cell-editing');
    this.setCellValue(rowKey, colId, value);
  }

  get _activeEditorRowKey() {
    return this._container?.querySelector('.ck-zenith-grid-cell-editing')
      ? this._container.querySelector('.ck-zenith-grid-cell-editing')?.closest('[data-row-key]')?.dataset.rowKey ?? null
      : null;
  }

  setCellValue(rowKey, colId, rawValue) {
    const column = this._columns.getDef(colId);
    const row = this._dataStore.getByKey(rowKey);
    if (!column || !row) {
      return false;
    }

    const field = column.field;
    // What undo should restore: the formula string if this cell was formula-driven
    // before this edit, otherwise its current plain value.
    const restoreValue = row._formulas?.[field] ?? row[field];
    const isFormula = typeof rawValue === 'string' && rawValue.startsWith('=');

    const value = isFormula ? rawValue : this._parseCellValue(rawValue, row, column);
    const error = isFormula ? null : this._validateCellValue(value, row, column);
    const errorKey = this._getValidationKey(rowKey, colId);
    if (error) {
      this._validationErrors.set(errorKey, error);
      this._emitStateChanged('validation');
      void this.refresh();
      return false;
    }

    this._validationErrors.delete(errorKey);
    const previousValue = row[field];
    // patchRow() owns `_formulas` bookkeeping based on the patched value itself (a string
    // starting with '=' records a formula, anything else clears one), and it can reject the
    // patch outright (e.g. a rowKey collision) — so `_formulas` must not be touched here
    // directly, and undo history should only be recorded once the edit actually applied.
    const succeeded = this.patchRow(rowKey, { [field]: value });
    if (!succeeded) return false;

    this._undoRedoManager.push({ rowKey: String(rowKey), colId, oldValue: restoreValue, newValue: value });
    this._events.emit('cell-value-change', {
      rowKey: String(rowKey),
      colId,
      field,
      value,
      previousValue,
      row,
    });
    this._emitStateChanged('edit');
    return true;
  }

  _handleRowDragDrop({ fromRowKey, toRowKey }) {
    const rows = [...this._dataStore.getAll()];
    const fromIndex = rows.findIndex(r => String(this._getRowKey(r)) === String(fromRowKey));
    const toIndex = rows.findIndex(r => String(this._getRowKey(r)) === String(toRowKey));
    
    if (fromIndex >= 0 && toIndex >= 0) {
      const [movedRow] = rows.splice(fromIndex, 1);
      rows.splice(toIndex, 0, movedRow);
      this._dataStore.setData(rows);
      void this.refresh();
      this._events.emit('row-reorder', { fromRowKey, toRowKey, rows });
    }
  }

  validateRows(rows = this._dataStore.getAll()) {
    this._validationErrors.clear();
    const columns = this._columns.getAllLeafColumns().map((column) => column.def);
    rows.forEach((row) => {
      const rowKey = this._dataStore.getRowKey(row);
      columns.forEach((column) => {
        const error = this._validateCellValue(row[column.field], row, column);
        if (error) {
          this._validationErrors.set(this._getValidationKey(rowKey, column.id), error);
        }
      });
    });
    void this.refresh();
    return this.getValidationErrors();
  }

  getValidationErrors() {
    return [...this._validationErrors.entries()].map(([key, message]) => {
      const [rowKey, colId] = key.split('::');
      return { rowKey, colId, message };
    });
  }

  getCellValidationError(rowKey, colId) {
    return this._validationErrors.get(this._getValidationKey(rowKey, colId)) ?? null;
  }

  exportCsv(options = {}) {
    const delimiter = options.delimiter ?? ',';
    const includeHeaders = options.includeHeaders !== false;
    const columns = this._resolveExportColumns(options);
    const rows = this._resolveCsvRows(options);
    const lines = [];

    if (includeHeaders) {
      const groupHeaderRow = this._buildCsvGroupHeaderRow(columns, delimiter);
      if (groupHeaderRow !== null) {
        lines.push(groupHeaderRow);
      }
      lines.push(columns.map((column) => this._escapeCsvValue(column.def.headerName ?? column.def.header ?? column.def.id, delimiter)).join(delimiter));
    }

    rows.forEach((row) => {
      lines.push(columns.map(({ def }) => {
        const value = row?.[def.field];
        return this._escapeCsvValue(value, delimiter);
      }).join(delimiter));
    });

    const csv = lines.join('\n');
    this._pluginManager.callHook('afterCsvExport', {
      csv,
      rows,
      columns,
      options,
    });
    return csv;
  }

  downloadCsv(options = {}) {
    const csv = this.exportCsv({ scope: 'complete', ...options });
    if (typeof document === 'undefined' || typeof Blob === 'undefined' || typeof URL?.createObjectURL !== 'function') {
      return csv;
    }

    const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = options.fileName ?? 'zenith-grid-export.csv';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return csv;
  }

  exportExcel(options = {}) {
    const columns = this._resolveExportColumns(options);
    const rows = this._resolveCsvRows(options);
    const tableRows = [];
    if (options.includeHeaders !== false) {
      const multiHeaders = this._buildExcelHeaderRows(columns);
      if (multiHeaders) {
        for (const cells of multiHeaders) {
          const cellHtml = cells.map(({ text, colspan, rowspan }) => {
            const attrs = [
              colspan > 1 ? `colspan="${colspan}"` : '',
              rowspan > 1 ? `rowspan="${rowspan}"` : '',
            ].filter(Boolean).join(' ');
            return `<th${attrs ? ` ${attrs}` : ''}>${this._escapeHtml(text)}</th>`;
          }).join('');
          tableRows.push(`<tr>${cellHtml}</tr>`);
        }
      } else {
        tableRows.push(`<tr>${columns.map((col) => `<th>${this._escapeHtml(col.def.headerName ?? col.def.header ?? col.def.id)}</th>`).join('')}</tr>`);
      }
    }
    rows.forEach((row) => {
      tableRows.push(`<tr>${columns.map(({ def }) => `<td>${this._escapeHtml(row?.[def.field] ?? '')}</td>`).join('')}</tr>`);
    });
    return `<!doctype html><html><head><meta charset="utf-8"></head><body><table>${tableRows.join('')}</table></body></html>`;
  }

  downloadExcel(options = {}) {
    const content = this.exportExcel({ scope: 'complete', ...options });
    if (typeof document === 'undefined' || typeof Blob === 'undefined' || typeof URL?.createObjectURL !== 'function') {
      return content;
    }
    // BOM(﻿)을 앞에 추가해 Excel이 UTF-8로 읽도록 강제 (€ 등 특수문자 깨짐 방지)
    const blob = new Blob(['﻿', content], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = options.fileName ?? 'zenith-grid-export.xls';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return content;
  }

  copySelectionToClipboard(options = {}) {
    const text = this.exportCsv({
      delimiter: '\t',
      includeHeaders: options.includeHeaders ?? false,
      onlySelected: options.onlySelected ?? true,
      scope: options.scope ?? 'displayed',
      columns: options.columns,
    });
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text);
    }
    return text;
  }

  pasteFromClipboard(text, options = {}) {
    const rows = this._parseDelimitedRows(text, options.delimiter ?? '\t');
    if (rows.length === 0) {
      return 0;
    }

    const columns = this._resolvePasteColumns(options, rows);
    const targetRows = this._resolvePasteTargetRows(options);
    let changed = 0;

    rows.forEach((values, rowOffset) => {
      const row = targetRows[rowOffset];
      if (!row) return;
      const rowKey = row._rowKey ?? this._dataStore.getRowKey(row);
      values.forEach((value, colOffset) => {
        const column = columns[colOffset];
        if (!column) return;
        if (!this._isCellEditable(row, column.def)) return;
        if (this.setCellValue(rowKey, column.def.id, value)) {
          changed += 1;
        }
      });
    });

    return changed;
  }

  // 명시적 columns 목록이 주어지면 그대로 사용하고(export/programmatic 용도와 동일 계약 유지),
  // 아니면 startColId부터 붙여넣을 데이터의 최대 열 수만큼 화면에 보이는 컬럼을 순서대로 잡는다.
  _resolvePasteColumns(options, rows) {
    if (Array.isArray(options.columns) && options.columns.length > 0) {
      return this._resolveCsvColumns({ columns: options.columns });
    }
    const visible = this._columns.getVisibleLeafColumns();
    const startIndex = options.startColId
      ? Math.max(0, visible.findIndex((column) => column.def.id === options.startColId))
      : 0;
    const maxCols = rows.reduce((max, values) => Math.max(max, values.length), 1);
    return visible.slice(startIndex, startIndex + maxCols);
  }

  async benchmarkLiveUpdates(options = {}) {
    const rowsPerSecond = Math.max(1, options.rowsPerSecond ?? 100);
    const durationMs = Math.max(100, options.durationMs ?? 1000);
    const batchSize = Math.max(1, options.batchSize ?? Math.min(rowsPerSecond, 100));
    const start = performance.now?.() ?? Date.now();
    let generated = 0;

    while (((performance.now?.() ?? Date.now()) - start) < durationMs) {
      const batch = [];
      for (let index = 0; index < batchSize; index += 1) {
        generated += 1;
        batch.push({
          id: `benchmark-${start}-${generated}`,
          name: `Benchmark ${generated}`,
          value: generated,
        });
      }
      this.liveUpsertRows(batch);
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.round((batchSize / rowsPerSecond) * 1000))));
    }

    await this.refresh();
    const elapsedMs = (performance.now?.() ?? Date.now()) - start;
    return {
      generated,
      elapsedMs,
      rowsPerSecond: Math.round((generated / Math.max(1, elapsedMs)) * 1000),
    };
  }

  getLocaleText(key, fallback, params = {}) {
    const value = key.split('.').reduce((current, part) => current?.[part], this._locale);
    const template = typeof value === 'string' ? value : fallback;
    return String(template).replace(/\{(\w+)\}/g, (_, token) => String(params[token] ?? `{${token}}`));
  }

  async saveColumnState() {
    if (!this._columnStateManager) return;
    await this._columnStateManager.save(this._columns.serializeState());
  }

  async loadColumnState() {
    await this._restoreColumnState();
  }

  async clearColumnState() {
    if (!this._columnStateManager) return;
    await this._columnStateManager.clear();
  }

  setColumnWidth(colId, width) {
    this._columns.setWidth(colId, width);
    this._invalidateMeasuredRows();
    this._syncColumnWidths();
    void this.saveColumnState();
    void this.refresh();
  }

  autoSizeColumn(colId) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    let cellFont = '14px sans-serif';
    let headerFont = 'bold 14px sans-serif';
    
    const cellEl = this._container.querySelector('.ck-zenith-grid-cell');
    if (cellEl) {
      cellFont = window.getComputedStyle(cellEl).font || cellFont;
    }
    const headerEl = this._container.querySelector('.ck-zenith-grid-header-cell');
    if (headerEl) {
      headerFont = window.getComputedStyle(headerEl).font || headerFont;
    }

    const nextWidth = this._calculateColumnAutoSize(colId, ctx, cellFont, headerFont);
    if (nextWidth !== null) {
      this._applyColumnResize(colId, nextWidth, { commit: true });
    }
  }

  autoSizeAllColumns() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    let cellFont = '14px sans-serif';
    let headerFont = 'bold 14px sans-serif';
    
    const cellEl = this._container.querySelector('.ck-zenith-grid-cell');
    if (cellEl) {
      cellFont = window.getComputedStyle(cellEl).font || cellFont;
    }
    const headerEl = this._container.querySelector('.ck-zenith-grid-header-cell');
    if (headerEl) {
      headerFont = window.getComputedStyle(headerEl).font || headerFont;
    }

    const leafCols = this._columns.getVisibleLeafColumns();
    let anyUpdated = false;
    for (const col of leafCols) {
      const colId = col.def.id;
      const nextWidth = this._calculateColumnAutoSize(colId, ctx, cellFont, headerFont);
      if (nextWidth !== null) {
        const updated = this._columns.setWidth(colId, nextWidth);
        if (updated) anyUpdated = true;
      }
    }

    if (anyUpdated) {
      this._invalidateMeasuredRows();
      this._syncColumnWidths();
      this._headerModel.rebuild();
      this._headerRenderer.render(this._currentRangeBundle);
      this._headerRenderer.updateSortIndicators();
      if (this._displayRows.length > 0) {
        this._bodyRenderer.render(this._displayRows, this._currentRangeBundle);
      }
      void this.saveColumnState();
      this._emitStateChanged('column-resize');
      this._settingsPanel?.render();
    }
  }

  _calculateColumnAutoSize(colId, ctx, cellFont, headerFont) {
    const column = this._columns.getDef(colId);
    if (!column) return null;

    let maxWidth = 50;

    // 1. 헤더 텍스트 너비 측정 (정렬 아이콘 및 여백 고려하여 36px 가산)
    ctx.font = headerFont;
    const headerText = column.headerName ?? column.header ?? '';
    const headerWidth = ctx.measureText(headerText).width + 36;
    maxWidth = Math.max(maxWidth, headerWidth);

    // 2. 셀 텍스트 너비 측정 (여백 고려하여 24px 가산)
    ctx.font = cellFont;
    const rows = this._dataStore.getAll();
    for (const row of rows) {
      const val = row[column.field];
      let formattedText = '';
      if (typeof column.formatter === 'function') {
        formattedText = String(column.formatter({ value: val, row, def: column }) ?? '');
      } else {
        formattedText = val == null ? '' : String(val);
      }
      const cellWidth = ctx.measureText(formattedText).width + 24;
      maxWidth = Math.max(maxWidth, cellWidth);
    }

    return maxWidth;
  }

  setColumnVisible(colId, visible) {
    this._columns.setVisible(colId, visible);
    this._invalidateMeasuredRows();
    void this.saveColumnState();
    void this.refresh();
  }

  setColumnPinned(colId, pin) {
    this._columns.setPinned(colId, pin);
    this._invalidateMeasuredRows();
    void this.saveColumnState();
    void this.refresh();
  }

  moveColumn(colId, toIndex, options = { restrictToGroup: true }) {
    this._columns.moveColumn(colId, toIndex, options);
    this._invalidateMeasuredRows();
    void this.saveColumnState();
    void this.refresh();
  }

  // ─── Flex 컬럼 너비 계산 ───────────────────────────────────

  /**
   * Flex 컬럼의 너비를 현재 그리드 너비에 맞춰 계산
   * @private
   */
  _calculateFlexColumnWidths() {
    const containerWidth = this._container?.clientWidth ?? 0;
    if (containerWidth === 0) return;

    // 핀 고정된 컬럼의 너비를 제외한 center 영역 너비 계산
    const pinnedWidths = this._columns.getPinnedWidths();
    const centerAvailableWidth = containerWidth - pinnedWidths.leftWidth - pinnedWidths.rightWidth;

    // Center 컬럼들의 flex 계산
    const centerColumns = this._columns.getColumnsByPin().center;
    const centerColIds = centerColumns.map((c) => c.def.id);
    this._columns.getModel().calculateFlexWidths(centerAvailableWidth, centerColIds);

    // Left/Right pinned 컬럼도 각각 계산 (필요시)
    // 현재는 center만 지원
  }

  destroy() {
    this._destroyed = true;
    if (this._rowMeasureFrame) {
      cancelAnimationFrame(this._rowMeasureFrame);
      this._rowMeasureFrame = null;
    }
    this._dom.getRoot()?.removeEventListener('keydown', this._handleKeydown);
    this._dom.getRoot()?.removeEventListener('paste', this._handlePaste);
    document.removeEventListener('mouseup', this._handleGlobalMouseUp);
    void this.saveColumnState();
    this._virtualScrollManager.destroy();
    this._bodyRenderer.destroy();
    this._headerRenderer.destroy();
    this._dom.destroy();
    this._dataStore.destroy();
    this._selectionManager.destroy();
    this._filterManager.destroy();
    this._sortManager.destroy();
    this._groupManager.destroy();
    this._treeManager.destroy();
    this._paginationManager.destroy();
    this._infiniteScrollManager.destroy();
    this._liveUpdateManager.destroy();
    this._columnStateManager?.destroy();
    this._workerBridge.destroy();
    this._pluginManager.callHook('onDestroy', this);
    this._pluginManager.destroy();
    this._settingsPanel?.destroy();
    this._rowDragManager.destroy();
    this._aggregateManager.destroy();
    this._rangeSelectionManager.destroy();
    this._undoRedoManager.destroy();
    this._advancedFilterManager.destroy();
    this._pivotManager.destroy();
    this._statusBarRenderer?.destroy();
    this._columns.destroy();
    this._headerModel.destroy();
    this._viewModel.destroy();
    this._events.destroy();

    window.removeEventListener('beforeprint', this._handleBeforePrint);
    window.removeEventListener('afterprint', this._handleAfterPrint);
  }

  _syncColumnWidths() {
    const pinnedWidths = this._columns.getPinnedWidths();
    const selectionWidth = (this._options.selectable === false || this._pivotManager.isEnabled()) ? 0
      : (this._masterDetailRenderer ? 68 : 44);
    this._dom.updateColumnWidths({
      leftWidth: pinnedWidths.leftWidth + selectionWidth,
      centerWidth: pinnedWidths.centerWidth,
      rightWidth: pinnedWidths.rightWidth,
    });
    const centerWidths = this._columns.getColumnsByPin().center.map((column) => column.state.width ?? 0);
    this._viewModel.setColumnWidths(centerWidths);
  }

  _emitStateChanged(type) {
    this._events.emit('state-change', { type });
  }

  _applyLiveBatch(batch) {
    const maxRows = this._options.liveUpdates?.maxRows ?? 1000;
    const viewportAdjustment = this._captureLiveViewportAdjustment(batch, maxRows);

    this._suspendDataStoreRefresh = true;
    this._pendingDataStoreRefresh = false;

    if (batch.added.length > 0) {
      for (const row of batch.added) {
        if (row._formulas) delete row._formulas;
        for (const field of Object.keys(row)) {
          if (field.startsWith('_')) continue;
          const val = row[field];
          if (typeof val === 'string' && val.startsWith('=')) {
            row._formulas = row._formulas || {};
            row._formulas[field] = val;
          }
        }
      }
      this._dataStore.appendRows(batch.added);
    }
    if (batch.updated.length > 0) {
      for (const row of batch.updated) {
        const rowKey = String(row.id ?? row._rowKey ?? '');
        if (rowKey) this._liveUpdateManager.registerCellFlash(rowKey, Object.keys(row));

        const existing = this._dataStore.getByKey(this._dataStore.getRowKey(row));
        const formulas = { ...(existing?._formulas || {}) };
        for (const field of Object.keys(row)) {
          if (field.startsWith('_')) continue;
          const val = row[field];
          if (typeof val === 'string' && val.startsWith('=')) {
            formulas[field] = val;
          } else {
            delete formulas[field];
          }
        }
        if (Object.keys(formulas).length > 0) {
          row._formulas = formulas;
        } else {
          delete row._formulas;
        }
      }
      this._dataStore.updateRows(batch.updated);
    }
    if (batch.patched.length > 0) {
      for (const { key, patch } of batch.patched) {
        this._liveUpdateManager.registerCellFlash(key, Object.keys(patch));

        const existing = this._dataStore.getByKey(key);
        if (existing) {
          const formulas = { ...(existing._formulas || {}) };
          for (const [field, val] of Object.entries(patch)) {
            if (field.startsWith('_')) continue;
            if (typeof val === 'string' && val.startsWith('=')) {
              formulas[field] = val;
            } else {
              delete formulas[field];
            }
          }
          if (Object.keys(formulas).length > 0) {
            existing._formulas = formulas;
          } else {
            delete existing._formulas;
          }
        }
      }
      this._dataStore.patchRows(batch.patched);
    }
    if (batch.upserted.length > 0) {
      for (const row of batch.upserted) {
        const rowKey = String(row.id ?? row._rowKey ?? '');
        if (rowKey) this._liveUpdateManager.registerCellFlash(rowKey, Object.keys(row));

        const key = this._dataStore.getRowKey(row);
        if (this._dataStore.has(key)) {
          const existing = this._dataStore.getByKey(key);
          const formulas = { ...(existing?._formulas || {}) };
          for (const field of Object.keys(row)) {
            if (field.startsWith('_')) continue;
            const val = row[field];
            if (typeof val === 'string' && val.startsWith('=')) {
              formulas[field] = val;
            } else {
              delete formulas[field];
            }
          }
          if (Object.keys(formulas).length > 0) {
            row._formulas = formulas;
          } else {
            delete row._formulas;
          }
        } else {
          if (row._formulas) delete row._formulas;
          for (const field of Object.keys(row)) {
            if (field.startsWith('_')) continue;
            const val = row[field];
            if (typeof val === 'string' && val.startsWith('=')) {
              row._formulas = row._formulas || {};
              row._formulas[field] = val;
            }
          }
        }
      }
      this._dataStore.upsertRows(batch.upserted);
    }
    if (batch.removed.length > 0) {
      this._dataStore.removeRows(batch.removed);
    }

    if (maxRows > 0) {
      this._dataStore.trimToMax(maxRows);
    }

    this._suspendDataStoreRefresh = false;
    if (viewportAdjustment) {
      this._pendingLiveViewportAdjustment = viewportAdjustment;
    }

    const newCount = batch.added.length + batch.upserted.length;
    if (this._displayMode === 'paginated' && this._paginationManager.getState().page > 0 && newCount > 0) {
      this._liveUpdateManager.notifyNewData(newCount);
    }

    if (this._pendingDataStoreRefresh) {
      this._pendingDataStoreRefresh = false;
      void this.refresh();
    }
  }

  setLiveMaxRows(n) {
    this._options.liveUpdates = { ...(this._options.liveUpdates ?? {}), maxRows: n };
  }

  async _restoreColumnState() {
    if (!this._columnStateManager) return;
    const state = await this._columnStateManager.load();
    if (!state) return;
    this._columns.applySerializedState(state);
    this._headerModel.rebuild();
    this._syncColumnWidths();
    await this.refresh();
  }

  _renderFooter() {
    if (this._displayMode !== 'paginated') {
      this._dom.setFooterContent(null);
      return;
    }

    const state = this._paginationManager.getState();
    const footer = document.createElement('div');
    footer.className = 'ck-zenith-grid-footer-bar';

    const summary = document.createElement('div');
    summary.className = 'ck-zenith-grid-footer-summary';
    summary.textContent = this.getLocaleText(
      'grid.pagination.summary',
      '{startRow}-{endRow} of {totalCount}',
      state
    );

    const controls = document.createElement('div');
    controls.className = 'ck-zenith-grid-footer-controls';

    const buttons = [
      { label: this.getLocaleText('grid.pagination.first', 'First'), disabled: state.isFirst, onClick: () => this._paginationManager.firstPage() },
      { label: this.getLocaleText('grid.pagination.prev', 'Prev'), disabled: state.isFirst, onClick: () => this._paginationManager.prevPage() },
      {
        label: this.getLocaleText(
          'grid.pagination.page',
          'Page {page} / {totalPages}',
          { page: state.page + 1, totalPages: state.totalPages }
        ),
        disabled: true,
        onClick: null,
      },
      { label: this.getLocaleText('grid.pagination.next', 'Next'), disabled: state.isLast, onClick: () => this._paginationManager.nextPage() },
      { label: this.getLocaleText('grid.pagination.last', 'Last'), disabled: state.isLast, onClick: () => this._paginationManager.lastPage() },
    ];

    buttons.forEach((config) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ck-zenith-grid-footer-button';
      button.textContent = config.label;
      button.disabled = config.disabled;
      if (config.onClick) {
        button.addEventListener('click', config.onClick);
      }
      controls.appendChild(button);
    });

    footer.appendChild(summary);
    footer.appendChild(controls);
    this._dom.setFooterContent(footer);
  }

  async _initializeRemoteData() {
    if (this._paginationManager.getMode() === 'server' && this._displayMode === 'paginated') {
      await this._loadServerPage(this._paginationManager.getState().page, this._paginationManager.getState().pageSize);
    }

    if (this._infiniteScrollManager.getMode() === 'server' && this._displayMode === 'infinite') {
      await this._loadInitialInfiniteRows();
    }
  }

  async _loadServerPage(page, pageSize) {
    const fetchPage = this._options.pagination?.fetchPage;
    if (typeof fetchPage !== 'function') return;

    const requestId = ++this._serverPageRequestId;
    this._dom.showLoading(this.getLocaleText('grid.loading.page', 'Loading page data...'), {
      showSkeleton: true,
      content: this._renderOverlayState('loading', {
        message: this.getLocaleText('grid.loading.page', 'Loading page data...'),
      }),
    });
    try {
      const result = await fetchPage({
        page,
        pageSize,
        filters: this._filterManager.getWorkerPayload(),
        sort: this._sortManager.getState().sortDefs,
        displayMode: this._displayMode,
      });
      if (requestId !== this._serverPageRequestId || this._destroyed) {
        return;
      }
      this._invalidateMeasuredRows();
      this._paginationManager.setTotalCount(result.totalCount ?? 0, { silent: true });
      this._dataStore.setData(result.rows ?? []);
    } catch (error) {
      if (requestId !== this._serverPageRequestId || this._destroyed) {
        return;
      }
      console.error('[GridCore] Failed to load server page:', error);
      const message = this.getLocaleText('grid.error.pageLoadFailed', 'Failed to load page data.');
      this._dom.showError(
        message,
        {
          content: this._renderOverlayState('error', { message, error }),
          actionLabel: this.getLocaleText('grid.error.retry', 'Retry'),
          onAction: () => {
            void this._loadServerPage(page, pageSize);
          },
        }
      );
    }
  }

  async _loadInitialInfiniteRows() {
    const loadMore = this._options.infiniteScroll?.onLoadMore;
    if (typeof loadMore !== 'function') return;

    this._serverInfiniteRequestId += 1;
    this._invalidateMeasuredRows();
    this._dataStore.setData([]);
    this._infiniteScrollManager.reset();
    this._dom.showLoading(this.getLocaleText('grid.loading.moreRows', 'Loading more rows...'), {
      showSkeleton: true,
      content: this._renderOverlayState('loading', {
        message: this.getLocaleText('grid.loading.moreRows', 'Loading more rows...'),
      }),
    });
    try {
      await this._infiniteScrollManager.loadMore();
    } catch (error) {
      console.error('[GridCore] Failed to initialize infinite rows:', error);
      const message = this.getLocaleText('grid.error.moreRowsFailed', 'Failed to load rows.');
      this._dom.showError(
        message,
        {
          content: this._renderOverlayState('error', { message, error }),
          actionLabel: this.getLocaleText('grid.error.retry', 'Retry'),
          onAction: () => {
            void this._loadInitialInfiniteRows();
          },
        }
      );
    }
  }

  _mergeLocale(base, overrides) {
    if (!overrides || typeof overrides !== 'object') {
      return structuredClone(base);
    }

    const merge = (left, right) => {
      const result = { ...left };
      for (const [key, value] of Object.entries(right)) {
        if (
          value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          left?.[key] &&
          typeof left[key] === 'object' &&
          !Array.isArray(left[key])
        ) {
          result[key] = merge(left[key], value);
        } else {
          result[key] = value;
        }
      }
      return result;
    };

    return merge(base, overrides);
  }

  _reloadActiveRemoteData() {
    if (this._displayMode === 'paginated' && this._paginationManager.getMode() === 'server') {
      void this._loadServerPage(this._paginationManager.getState().page, this._paginationManager.getState().pageSize);
      return true;
    }

    if (this._displayMode === 'infinite' && this._infiniteScrollManager.getMode() === 'server') {
      void this._loadInitialInfiniteRows();
      return true;
    }

    return false;
  }

  _invalidateMeasuredRows() {
    this._viewModel.clearMeasuredRowHeights();
    this._currentRangeBundle = {
      vertical: this._viewModel.getVerticalRange(),
      horizontal: this._viewModel.getHorizontalRange(),
    };
  }

  _scheduleViewportRender() {
    if (this._rowMeasureFrame || this._destroyed) {
      return;
    }
    this._rowMeasureFrame = requestAnimationFrame(() => {
      this._rowMeasureFrame = null;
      if (this._destroyed || !this._displayRows) {
        return;
      }
      this._currentRangeBundle = {
        vertical: this._viewModel.getVerticalRange(),
        horizontal: this._viewModel.getHorizontalRange(),
      };
      this._headerRenderer.render(this._currentRangeBundle);
      this._headerRenderer.updateSortIndicators();
      this._bodyRenderer.render(this._displayRows, this._currentRangeBundle);
    });
  }

  _applyColumnResize(colId, width, options = {}) {
    const updated = this._columns.setWidth(colId, width);
    if (!updated) {
      return;
    }

    this._invalidateMeasuredRows();
    this._syncColumnWidths();
    this._headerModel.rebuild();
    this._headerRenderer.render(this._currentRangeBundle);
    this._headerRenderer.updateSortIndicators();

    if (this._displayRows.length > 0) {
      this._bodyRenderer.render(this._displayRows, this._currentRangeBundle);
    }

    if (options.commit) {
      void this.saveColumnState();
      this._emitStateChanged('column-resize');
    }
    this._settingsPanel?.render();
  }

  _normalizeAvailablePlugins(entries) {
    return entries
      .map((entry) => {
        if (!entry) return null;
        if (entry.plugin) {
          return {
            name: entry.plugin.name,
            label: entry.label ?? entry.plugin.label ?? entry.plugin.name,
            description: entry.description ?? entry.plugin.description ?? entry.plugin.name,
            plugin: entry.plugin,
            options: entry.options ?? {},
          };
        }
        return {
          name: entry.name,
          label: entry.label ?? entry.name,
          description: entry.description ?? entry.name,
          plugin: entry,
          options: {},
        };
      })
      .filter(Boolean);
  }

  _collectSelectionKeysForRow(row, options = {}) {
    if (!row) {
      return [];
    }

    const includeDescendants = options.includeDescendants !== false;
    const keys = row._type === 'group-header' ? [] : [row._rowKey];

    if (includeDescendants && Array.isArray(row._descendantRowKeys) && row._descendantRowKeys.length > 0) {
      keys.push(...row._descendantRowKeys);
    }

    return [...new Set(keys)];
  }

  // 선택 상태만 변경 시: 파이프라인 재실행 없이 헤더/바디만 재렌더링
  // Re-render the header and body when only selection state changed.
  _refreshSelection() {
    if (this._destroyed || !this._displayRows) return;
    ++this._renderVersion;
    this._headerRenderer.render(this._currentRangeBundle);
    this._bodyRenderer.render(this._displayRows, this._currentRangeBundle);
  }

  // 그룹/트리 토글 시: filter/sort를 건너뛰고 flatten+paginate만 재실행
  _refreshFlatten() {
    if (this._destroyed) return;

    const result = this._pipeline.flattenFromLastBase();
    if (!result) {
      void this.refresh();
      return;
    }

    ++this._renderVersion;
    this._flatRows = result.flatRows;
    this._displayRows = result.displayRows;
    this._selectionManager.setCurrentRows(result.displayRows);
    this._viewModel.setTotalCount(result.displayRows.length);
    this._headerModel.rebuild();
    this._syncColumnWidths();
    this._currentRangeBundle = {
      vertical: this._viewModel.getVerticalRange(),
      horizontal: this._viewModel.getHorizontalRange(),
    };

    this._pluginManager.callHook('beforeRender', result);
    this._headerRenderer.render(this._currentRangeBundle);
    this._headerRenderer.updateSortIndicators();
    this._renderFooter();
    this._dom.setAccessibilityMeta({
      rowCount: result.totalCount ?? result.displayRows.length,
      colCount: this._columns.getVisibleLeafColumns().length + (this._options.selectable === false ? 0 : 1),
    });

    if (result.displayRows.length === 0) {
      this._bodyRenderer.clear();
      const message = this._options.emptyMessage ?? this.getLocaleText('grid.empty.noRows', 'No rows available.');
      this._dom.showEmpty(message, {
        content: this._renderOverlayState('empty', { message }),
      });
    } else {
      this._dom.hideOverlay();
      this._bodyRenderer.render(result.displayRows, this._currentRangeBundle);
    }

    this._events.emit('render', {
      rows: result.displayRows,
      flatRows: result.flatRows,
      totalCount: result.totalCount,
      visibleCount: result.displayRows.filter(
        (r) => r._type !== 'group-header' && r._type !== 'tree-loading' && r._type !== 'detail'
      ).length,
      displayMode: this._displayMode,
    });
    this._pluginManager.callHook('afterRender', result);
    this._settingsPanel?.render();
    this._applyPendingCellFlash();
  }

  _applyPendingCellFlash() {
    const flashMap = this._liveUpdateManager.getAndClearFlashCells();
    if (flashMap.size === 0) return;

    const colModel = this._columns.getVisibleLeafColumns();
    const fieldToColId = new Map(colModel.map(({ def }) => [def.field, def.id]));

    for (const [rowKey, fields] of flashMap) {
      for (const field of fields) {
        const colId = fieldToColId.get(field) ?? field;
        const cell = this._container.querySelector(
          `[data-row-key="${escapeCssSelector(String(rowKey))}"] [data-col-id="${escapeCssSelector(colId)}"]`
        );
        if (cell instanceof HTMLElement) {
          cell.classList.remove('ck-zenith-grid-cell-flash');
          void cell.offsetWidth;
          cell.classList.add('ck-zenith-grid-cell-flash');
          setTimeout(() => cell.classList.remove('ck-zenith-grid-cell-flash'), 600);
        }
      }
    }
  }

  _applyPendingLiveViewportAdjustment() {
    const pending = this._pendingLiveViewportAdjustment;
    if (!pending) {
      return;
    }

    this._pendingLiveViewportAdjustment = null;

    if (pending.type === 'preserve') {
      this._virtualScrollManager.setScrollTop(pending.scrollTop);
      return;
    }

    if (pending.type === 'bottom') {
      this._virtualScrollManager.scrollToBottom({ behavior: 'auto' });
    }
  }

  _captureLiveViewportAdjustment(batch, maxRows) {
    const liveOptions = this._options.liveUpdates ?? {};
    const autoScrollEnabled = liveOptions.autoScroll ?? false;
    const autoScrollThreshold = liveOptions.autoScrollThreshold ?? 100;
    const wasNearBottom = this._viewModel.isAtBottom(autoScrollThreshold);
    const isUserScrolling = this._virtualScrollManager.isUserScrolling();

    if (isUserScrolling) {
      return null;
    }

    if (autoScrollEnabled && wasNearBottom) {
      return { type: 'bottom' };
    }

    if (maxRows <= 0) {
      return null;
    }

    const trimmedCount = this._estimateTrimmedRowCount(batch, maxRows);
    if (trimmedCount <= 0) {
      return null;
    }

    const trimmedHeight = this._viewModel.getHeightBeforeIndex(trimmedCount);
    return {
      type: 'preserve',
      scrollTop: Math.max(0, this._viewModel.getScrollTop() - trimmedHeight),
    };
  }

  _estimateTrimmedRowCount(batch, maxRows) {
    const existingKeys = new Set(this._dataStore.getAll().map((row) => this._dataStore.getRowKey(row)));
    let projectedSize = this._dataStore.size;

    for (const key of batch.removed) {
      const normalized = String(key);
      if (existingKeys.delete(normalized)) {
        projectedSize -= 1;
      }
    }

    for (const row of batch.added) {
      const key = this._dataStore.getRowKey(row);
      if (!existingKeys.has(key)) {
        existingKeys.add(key);
        projectedSize += 1;
      }
    }

    for (const row of batch.upserted) {
      const key = this._dataStore.getRowKey(row);
      if (!existingKeys.has(key)) {
        existingKeys.add(key);
        projectedSize += 1;
      }
    }

    return Math.max(0, projectedSize - maxRows);
  }

  _createRowKeyGetter(rowKey) {
    if (typeof rowKey === 'function') {
      return rowKey;
    }

    const field = rowKey ?? 'id';
    return (row, index) => {
      const value = row?.[field];
      return value == null ? String(index) : String(value);
    };
  }

  _renderOverlayState(kind, context = {}) {
    const rendererMap = {
      loading: this._options.renderLoadingState,
      empty: this._options.renderEmptyState,
      error: this._options.renderErrorState,
    };
    const renderer = rendererMap[kind];
    if (typeof renderer !== 'function') {
      return null;
    }
    try {
      return renderer({
        kind,
        ...context,
      });
    } catch (error) {
      console.error(`[GridCore] Failed to render ${kind} overlay:`, error);
      return null;
    }
  }

  _handleKeydown(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !this._container.contains(target)) {
      return;
    }

    const key = event.key;
    const ctrl = event.ctrlKey || event.metaKey;

    // Undo/Redo — 에디터 입력 중에는 브라우저 기본 동작 허용
    const isEditorFocused = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
    if (!isEditorFocused) {
      if (ctrl && key === 'z' && !event.shiftKey) {
        event.preventDefault();
        this.undo();
        return;
      }
      if (ctrl && (key === 'y' || (key === 'z' && event.shiftKey))) {
        event.preventDefault();
        this.redo();
        return;
      }
    }

    const focusable = target.closest('[data-grid-focusable]');
    if (!(focusable instanceof HTMLElement)) {
      return;
    }

    // 범위 선택 복사 (Ctrl+C)
    if (ctrl && key === 'c' && !isEditorFocused && this._rangeSelectionManager.hasRange()) {
      event.preventDefault();
      this.copyRangeToClipboard();
      return;
    }

    // Escape: 편집 취소 또는 범위 선택 해제
    if (key === 'Escape') {
      if (this._activeEditorRowKey != null) {
        event.preventDefault();
        this.cancelCellEdit();
        return;
      }
      if (this._rangeSelectionManager.hasRange()) {
        event.preventDefault();
        this._rangeSelectionManager.clearRange();
        return;
      }
    }

    const kind = focusable.dataset.gridFocusable;

    // F2: 셀 편집 진입
    if (key === 'F2' && kind === 'cell' && !isEditorFocused) {
      event.preventDefault();
      const rowKey = focusable.closest('[data-row-key]')?.dataset.rowKey;
      const colId = focusable.dataset.colId;
      if (rowKey && colId) this.beginCellEdit(rowKey, colId, { cell: focusable });
      return;
    }

    // Enter: 셀 편집 확정 후 아래 이동 / 포커스된 셀에서 편집 진입
    if (key === 'Enter') {
      if (isEditorFocused) {
        event.preventDefault();
        const rowKey = target.closest('[data-row-key]')?.dataset.rowKey;
        const colId = target.dataset.colId ?? target.closest('[data-col-id]')?.dataset.colId;
        if (rowKey && colId) {
          this.commitCellEdit(rowKey, colId, target.value);
          const cell = this._container.querySelector(`[data-row-key="${escapeCssSelector(rowKey)}"] [data-grid-focusable="cell"][data-col-id="${escapeCssSelector(colId)}"]`);
          if (cell instanceof HTMLElement) {
            cell.focus();
            this._moveCellFocus(cell, 'ArrowDown', event);
          }
        }
        return;
      }
      if (kind === 'cell') {
        event.preventDefault();
        const rowKey = focusable.closest('[data-row-key]')?.dataset.rowKey;
        const colId = focusable.dataset.colId;
        if (rowKey && colId) this.beginCellEdit(rowKey, colId, { cell: focusable });
        return;
      }
    }

    // Tab: 다음/이전 셀 이동 (편집 확정 포함)
    if (key === 'Tab') {
      if (isEditorFocused) {
        event.preventDefault();
        const rowKey = target.closest('[data-row-key]')?.dataset.rowKey;
        const colId = target.dataset.colId ?? target.closest('[data-col-id]')?.dataset.colId;
        if (rowKey && colId) this.commitCellEdit(rowKey, colId, target.value);
      }
      if (kind === 'cell') {
        event.preventDefault();
        this._moveCellFocusTab(focusable, event.shiftKey);
        return;
      }
    }

    if (isEditorFocused) {
      return;
    }

    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) {
      return;
    }

    if (kind === 'header') {
      this._moveHeaderFocus(focusable, key, event);
      return;
    }

    if (kind === 'cell') {
      this._moveCellFocus(focusable, key, event);
    }
  }

  _moveCellFocusTab(current, backwards) {
    const rowIndex = Number(current.dataset.rowIndex ?? 0);
    const colIndex = Number(current.dataset.colIndex ?? 0);
    const totalCols = this._columns.getVisibleLeafColumns().length
      + (this._options.selectable === false ? 0 : 1);

    let nextRow = rowIndex;
    let nextCol = backwards ? colIndex - 1 : colIndex + 1;

    if (nextCol >= totalCols) { nextCol = 0; nextRow += 1; }
    if (nextCol < 0) { nextCol = totalCols - 1; nextRow -= 1; }

    const next = this._container.querySelector(
      `[data-grid-focusable="cell"][data-row-index="${nextRow}"][data-col-index="${nextCol}"]`
    );
    if (next instanceof HTMLElement) next.focus();
  }

  _moveHeaderFocus(current, key, event) {
    const currentCol = Number(current.dataset.colIndex ?? 0);
    const headerButtons = [...this._container.querySelectorAll('[data-grid-focusable="header"]')];
    if (headerButtons.length === 0) {
      return;
    }

    let nextCol = currentCol;
    if (key === 'ArrowRight') nextCol += 1;
    if (key === 'ArrowLeft') nextCol -= 1;
    if (key === 'Home') nextCol = 0;
    if (key === 'End') nextCol = headerButtons.length - 1;
    if (key === 'ArrowDown') {
      const firstCell = this._container.querySelector(`[data-grid-focusable="cell"][data-col-index="${currentCol}"]`);
      if (firstCell instanceof HTMLElement) {
        event.preventDefault();
        firstCell.focus();
      }
      return;
    }

    const next = headerButtons.find((element) => Number(element.dataset.colIndex ?? -1) === nextCol);
    if (next instanceof HTMLElement) {
      event.preventDefault();
      next.focus();
    }
  }

  _moveCellFocus(current, key, event) {
    const rowIndex = Number(current.dataset.rowIndex ?? 0);
    const colIndex = Number(current.dataset.colIndex ?? 0);
    let nextRow = rowIndex;
    let nextCol = colIndex;

    if (key === 'ArrowUp') nextRow -= 1;
    if (key === 'ArrowDown') nextRow += 1;
    if (key === 'ArrowLeft') nextCol -= 1;
    if (key === 'ArrowRight') nextCol += 1;
    if (key === 'Home') nextCol = 0;
    if (key === 'End') {
      nextCol = this._columns.getVisibleLeafColumns().length + (this._options.selectable === false ? -1 : 0);
    }

    if (key === 'ArrowUp' && nextRow < 0) {
      const headerTarget = this._container.querySelector(`[data-grid-focusable="header"][data-col-index="${colIndex}"]`);
      if (headerTarget instanceof HTMLElement) {
        event.preventDefault();
        headerTarget.focus();
      }
      return;
    }

    const next = this._container.querySelector(
      `[data-grid-focusable="cell"][data-row-index="${nextRow}"][data-col-index="${nextCol}"]`
    );
    if (next instanceof HTMLElement) {
      event.preventDefault();
      next.focus();
    }
  }

  _resolveCsvColumns(options = {}) {
    const requested = Array.isArray(options.columns) && options.columns.length > 0
      ? new Set(options.columns.map(String))
      : null;
    const source = options.includeHidden === true
      ? this._columns.getAllLeafColumns()
      : this._columns.getVisibleLeafColumns();

    return requested
      ? source.filter((column) => requested.has(column.def.id))
      : source;
  }

  _resolveCsvRows(options = {}) {
    if (options.onlySelected === true) {
      const selected = this._selectionManager.getSelectedKeys();
      return this.getFlatRows().filter((row) => this._isExportableRow(row) && selected.has(String(row._rowKey)));
    }

    const scope = options.scope ?? 'displayed';
    if (scope === 'all') {
      return this._dataStore.getAll();
    }
    if (scope === 'flat') {
      return this.getFlatRows().filter((row) => this._isExportableRow(row));
    }
    if (scope === 'complete') {
      if (this._treeManager.isEnabled()) {
        return this._treeManager.flattenAllForExport(this._dataStore.getAll())
          .filter((row) => this._isExportableRow(row));
      }
      if (this._groupManager.isEnabled()) {
        return this._dataStore.getAll();
      }
      return this.getFlatRows().filter((row) => this._isExportableRow(row));
    }
    return this.getRows().filter((row) => this._isExportableRow(row));
  }

  _resolveExportColumns(options = {}) {
    const columns = this._resolveCsvColumns(options);
    const scope = options.scope ?? 'displayed';
    if (
      scope !== 'all' &&
      this._treeManager.isEnabled() &&
      this._treeManager._treeMode === 'children'
    ) {
      const keyField = typeof this._dataStore._rowKeyField === 'string'
        ? this._dataStore._rowKeyField
        : 'key';
      const parentCol = {
        def: {
          id: '__parent_key',
          field: '_parentKey',
          headerName: `Parent ${keyField}`,
          header: `Parent ${keyField}`,
        },
      };
      return [parentCol, ...columns];
    }
    return columns;
  }

  _resolvePasteTargetRows(options = {}) {
    if (options.startRowKey != null) {
      const flatRows = this.getFlatRows().filter((row) => this._isExportableRow(row));
      const startIndex = flatRows.findIndex((row) => String(row._rowKey) === String(options.startRowKey));
      return startIndex >= 0 ? flatRows.slice(startIndex) : [];
    }

    const selected = this._selectionManager.getSelectedKeys();
    if (selected.size > 0) {
      return this.getFlatRows().filter((row) => this._isExportableRow(row) && selected.has(String(row._rowKey)));
    }

    return this.getRows().filter((row) => this._isExportableRow(row));
  }

  _isExportableRow(row) {
    return row && row._type !== 'group-header' && row._type !== 'tree-loading' && row._type !== 'detail';
  }

  _parseDelimitedRows(text, delimiter) {
    return String(text ?? '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => line.split(delimiter));
  }

  _isCellEditable(row, column) {
    const rowKeyField = typeof this._options.rowKey === 'function' ? null : (this._options.rowKey ?? 'id');
    if (rowKeyField && (column.field === rowKeyField || column.id === rowKeyField)) {
      return false;
    }
    if (column.sparkline || column.echart) {
      return false;
    }
    // Block editing on columns with custom renderer unless explicitly configured as editable
    if (column.renderer && column.editable !== true && typeof column.editable !== 'function') {
      return false;
    }
    if (column.editable === false) {
      return false;
    }
    const editing = this._options.editing;
    if (editing?.enabled === false) {
      return false;
    }
    if (typeof column.editable === 'function') {
      return column.editable({ row, def: column }) !== false;
    }
    return column.editable === true || editing?.enabled === true;
  }

  _createCellEditor(row, column, value) {
    if (typeof column.editor === 'function') {
      const custom = column.editor({ row, def: column, value });
      if (custom instanceof HTMLElement) {
        return custom;
      }
    }

    if (column.editor === 'select') {
      return createSelectEditor({ row, def: column, value });
    }
    if (column.editor === 'date') {
      return createDateEditor({ row, def: column, value });
    }
    if (column.editor === 'textarea') {
      return createTextareaEditor({ row, def: column, value });
    }

    const input = document.createElement('input');
    input.className = 'ck-zenith-grid-cell-editor';
    input.type = 'text';
    input.value = value == null ? '' : String(value);
    return input;
  }

  _parseCellValue(rawValue, row, column) {
    if (typeof column.parser === 'function') {
      return column.parser({ value: rawValue, row, def: column });
    }
    if (column.type === 'number') {
      const parsed = Number(rawValue);
      return Number.isNaN(parsed) ? rawValue : parsed;
    }
    return rawValue;
  }

  _validateCellValue(value, row, column) {
    if (typeof column.validator !== 'function') {
      return null;
    }
    const result = column.validator({ value, row, def: column });
    if (result === true || result == null) {
      return null;
    }
    return typeof result === 'string' ? result : 'Invalid value';
  }

  _getValidationKey(rowKey, colId) {
    return `${String(rowKey)}::${String(colId)}`;
  }

  _escapeCsvValue(value, delimiter) {
    if (value == null) {
      return '';
    }
    const normalized = typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : JSON.stringify(value);
    if (normalized.includes('"') || normalized.includes('\n') || normalized.includes('\r') || normalized.includes(delimiter)) {
      return `"${normalized.replace(/"/g, '""')}"`;
    }
    return normalized;
  }

  _buildExcelHeaderRows(leafColumns) {
    const hasGroups = leafColumns.some((col) => col.def.parentId != null);
    if (!hasGroups) return null;

    const defsMap = new Map(
      this._columns.getModel().getAllDefs().map((def) => [def.id, def])
    );

    const maxDepth = leafColumns.reduce((max, col) => Math.max(max, col.def.depth), 0);

    const getAncestorAtDepth = (def, targetDepth) => {
      if (def.depth === targetDepth) return def.id;
      if (def.depth < targetDepth) return null;
      let current = def;
      while (current && current.depth > targetDepth) {
        current = defsMap.get(current.parentId);
      }
      return current?.depth === targetDepth ? current.id : null;
    };

    const headerRows = [];
    for (let depth = 0; depth <= maxDepth; depth++) {
      const cells = [];
      let i = 0;
      while (i < leafColumns.length) {
        const col = leafColumns[i];
        const ancestorId = getAncestorAtDepth(col.def, depth);
        if (ancestorId === null) { i++; continue; }

        const ancestorDef = defsMap.get(ancestorId);
        if (ancestorDef.isGroup) {
          let colspan = 0;
          let j = i;
          while (j < leafColumns.length && getAncestorAtDepth(leafColumns[j].def, depth) === ancestorId) {
            colspan++;
            j++;
          }
          cells.push({ text: ancestorDef.headerName, colspan, rowspan: 1 });
          i = j;
        } else {
          cells.push({ text: ancestorDef.headerName, colspan: 1, rowspan: maxDepth - depth + 1 });
          i++;
        }
      }
      headerRows.push(cells);
    }
    return headerRows;
  }

  _buildCsvGroupHeaderRow(leafColumns, delimiter) {
    const hasGroups = leafColumns.some((col) => col.def.parentId != null);
    if (!hasGroups) return null;

    const defsMap = new Map(
      this._columns.getModel().getAllDefs().map((def) => [def.id, def])
    );

    const cells = leafColumns.map((col) => {
      if (!col.def.parentId) return '';
      const parentDef = defsMap.get(col.def.parentId);
      if (!parentDef) return '';
      const siblings = leafColumns.filter((c) => c.def.parentId === col.def.parentId);
      return siblings[0]?.def.id === col.def.id ? (parentDef.headerName ?? '') : '';
    });

    return cells.map((v) => this._escapeCsvValue(v, delimiter)).join(delimiter);
  }

  _escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
