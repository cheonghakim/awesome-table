export class Pipeline {
  constructor(options = {}) {
    this._sortManager = options.sortManager;
    this._filterManager = options.filterManager;
    this._groupManager = options.groupManager ?? null;
    this._treeManager = options.treeManager ?? null;
    this._paginationManager = options.paginationManager ?? null;
    this._infiniteScrollManager = options.infiniteScrollManager ?? null;
    this._pluginManager = options.pluginManager ?? null;
    this._workerBridge = options.workerBridge ?? null;
    this._getRowKey = options.getRowKey ?? ((row, index) => String(row.id ?? index));
    this._displayMode = options.displayMode ?? 'client';
    this._advancedFilterManager = options.advancedFilterManager ?? null;
  }

  setAdvancedFilterManager(manager) {
    this._advancedFilterManager = manager;
  }

  async process(rows) {
    let current = [...rows];

    if (this._pluginManager) {
      current = this._pluginManager.runHook('beforeDataProcess', current);
    }

    if (this._filterManager?.hasFilter()) {
      current = await this._runFilter(current);
    }

    if (this._sortManager?.hasSort()) {
      current = await this._runSort(current);
    }

    this._lastBaseRows = [...current];
    return this._flattenAndPaginate(current);
  }

  // filter/sort를 건너뛰고 마지막 base rows에서 flatten+paginate만 재실행 (그룹/트리 토글 최적화)
  flattenFromLastBase() {
    if (!this._lastBaseRows) return null;
    return this._flattenAndPaginate([...this._lastBaseRows]);
  }

  // 마지막 필터/정렬 결과(flatten 이전, 원본 shape)를 그대로 반환한다.
  // 트리의 전체 펼치기처럼 현재 표시된 flat 목록이 아니라 원본 계층 구조를
  // 순회해야 하는 연산에 사용한다.
  getLastBaseRows() {
    return this._lastBaseRows ?? [];
  }

  _flattenAndPaginate(current) {
    let flatRows = current.map((row, index) => ({
      ...row,
      _type: 'data',
      _flatIndex: index,
      _rowKey: String(this._getRowKey(row, index)),
      _depth: 0,
    }));

    if (this._groupManager?.isEnabled()) {
      flatRows = this._groupManager.flatten(flatRows);
    } else if (this._treeManager?.isEnabled()) {
      flatRows = this._treeManager.flatten(current);
    }

    // 고급 필터는 flatten 이후, 페이지 분할 이전에 적용한다. flatten 이후여야
    // 그룹/트리 모드에서도 각 행(트리의 자손 노드 포함)을 개별적으로 평가할 수 있고
    // (flatten 이전에 적용하면 그룹/트리 모드에서는 최상위 행만 걸러지고 중첩된
    // children은 필터를 전혀 통과하지 않는다), 페이지 분할 이전이어야 totalCount와
    // 페이지 슬라이스가 필터링된 개수를 기준으로 계산된다.
    if (this._advancedFilterManager?.hasFilter()) {
      flatRows = flatRows.filter((row) =>
        row._type === 'group-header' || row._type === 'tree-loading' || this._advancedFilterManager.evaluate(row)
      );
    }

    flatRows = flatRows.map((row, index) => ({
      ...row,
      _flatIndex: index,
    }));

    const paginationState = this._paginationManager?.getState?.() ?? null;
    const paginationMode = this._paginationManager?.getMode?.() ?? 'client';
    const infiniteState = this._infiniteScrollManager?.getState?.() ?? null;
    const infiniteMode = this._infiniteScrollManager?.getMode?.() ?? 'client';

    let displayRows = flatRows;
    let totalCount = flatRows.length;

    if (this._displayMode === 'paginated' && this._paginationManager) {
      if (paginationMode === 'server') {
        totalCount = paginationState?.totalCount ?? flatRows.length;
        displayRows = flatRows;
      } else {
        totalCount = flatRows.length;
        this._paginationManager.setTotalCount(totalCount, { silent: true });
        const { start, end } = this._paginationManager.getSliceRange();
        displayRows = flatRows.slice(start, end);
      }
    } else if (this._displayMode === 'infinite' && this._infiniteScrollManager) {
      if (infiniteMode === 'server') {
        this._infiniteScrollManager.setLoadedCount(flatRows.length);
        if (infiniteState?.totalCount != null) {
          this._infiniteScrollManager.setTotalCount(infiniteState.totalCount);
          totalCount = infiniteState.totalCount;
        } else {
          totalCount = flatRows.length;
        }
        displayRows = flatRows;
      } else {
        const targetCount = infiniteState?.loadedCount > 0
          ? infiniteState.loadedCount
          : Math.min(flatRows.length, this._infiniteScrollManager.getInitialLoadSize());
        this._infiniteScrollManager.setLoadedCount(targetCount);
        this._infiniteScrollManager.setTotalCount(flatRows.length);
        displayRows = flatRows.slice(0, targetCount);
        totalCount = flatRows.length;
      }
    }

    const result = {
      flatRows,
      displayRows,
      totalCount,
    };

    if (this._pluginManager) {
      return this._pluginManager.runHook('afterDataProcess', result);
    }

    return result;
  }

  async _runFilter(rows) {
    // 커스텀 필터 함수는 Worker로 보낼 수 없다 — 보내면 함수는 조용히 사라지고
    // Worker가 'custom' 타입을 몰라서 전부 통과시켜버린다. 이 경우 아예 Worker를
    // 거치지 않고 메인 스레드에서 직접 돌린다.
    if (this._workerBridge?.isEnabled && !this._filterManager.hasUnserializableFilter()) {
      const payload = this._filterManager.getWorkerPayload();
      return this._workerBridge.request(
        'filter',
        { rows, ...payload },
        () => this._filterManager.filter(rows)
      );
    }
    return this._filterManager.filter(rows);
  }

  async _runSort(rows) {
    // 커스텀 comparator도 마찬가지 이유로 Worker를 건너뛴다.
    if (this._workerBridge?.isEnabled && !this._sortManager.hasUnserializableSort()) {
      const sortDefs = this._sortManager.getSerializableDefs();
      return this._workerBridge.request(
        'sort',
        { rows, sortDefs },
        () => this._sortManager.sort(rows)
      );
    }
    return this._sortManager.sort(rows);
  }
}
