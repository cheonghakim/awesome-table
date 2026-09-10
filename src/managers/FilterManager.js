/**
 * FilterManager - 필터 상태 및 필터링 로직 관리
 *
 * 필터 타입:
 * - text: 텍스트 포함/시작/끝/정확히
 * - number: 범위 필터 (gt/lt/eq/between)
 * - date: 날짜 범위
 * - select: 특정 값들 중 포함 여부
 * - custom: 사용자 정의 함수
 *
 * 전역 검색(quickFilter)과 컬럼별 필터를 동시 지원.
 */
export class FilterManager {
  /**
   * @param {Object} options
   * @param {Function} [options.onChanged]
   */
  constructor(options = {}) {
    this._onChanged = options.onChanged ?? (() => {});

    /** @type {Map<string, FilterDef>} colId -> FilterDef */
    this._columnFilters = new Map();

    /** @type {string} 전역 검색어 */
    this._quickFilter = '';

    /** @type {string[]} 전역 검색 대상 필드들 */
    this._quickFilterFields = [];

    /** @type {Function|null} 커스텀 전역 필터 함수 */
    this._globalFilterFn = null;
  }

  // ─── 전역 검색 ─────────────────────────────────────────────

  setQuickFilter(text, fields = []) {
    this._quickFilter = String(text).toLowerCase().trim();
    this._quickFilterFields = fields;
    this._onChanged(this.getState());
  }

  clearQuickFilter() {
    this._quickFilter = '';
    this._onChanged(this.getState());
  }

  // ─── 컬럼 필터 ─────────────────────────────────────────────

  /**
   * @param {string} colId
   * @param {FilterDef} filterDef
   * { type: 'text'|'number'|'date'|'select'|'custom', value, operator?, fn? }
   */
  setColumnFilter(colId, filterDef) {
    const value = filterDef?.value;
    const isEmptyArray = Array.isArray(value) && value.length === 0;
    const isEmptyRange = Array.isArray(value) && value.length === 2 && value.every((entry) => entry === '' || entry == null);

    if (!filterDef || value === '' || value == null || isEmptyArray || isEmptyRange) {
      this._columnFilters.delete(colId);
    } else {
      this._columnFilters.set(colId, {
        type: filterDef.type ?? 'text',
        value: filterDef.value,
        operator: filterDef.operator ?? 'contains',
        fn: filterDef.fn ?? null,
        field: filterDef.field ?? colId,
      });
    }
    this._onChanged(this.getState());
  }

  clearColumnFilter(colId) {
    this._columnFilters.delete(colId);
    this._onChanged(this.getState());
  }

  clearAllFilters() {
    this._columnFilters.clear();
    this._quickFilter = '';
    this._onChanged(this.getState());
  }

  // ─── 필터링 실행 ───────────────────────────────────────────

  filter(rows) {
    let result = rows;

    // 전역 검색 적용
    if (this._quickFilter) {
      result = result.filter((row) => this._matchQuickFilter(row));
    }

    // 컬럼 필터 적용 (AND 조건)
    if (this._columnFilters.size > 0) {
      result = result.filter((row) => this._matchAllColumnFilters(row));
    }

    return result;
  }

  _matchQuickFilter(row) {
    const text = this._quickFilter;

    if (this._quickFilterFields.length > 0) {
      return this._quickFilterFields.some((field) => {
        const val = row[field];
        return val != null && String(val).toLowerCase().includes(text);
      });
    }

    // 필드 지정 없으면 모든 문자열 필드 검색
    return Object.values(row).some((val) => {
      if (val == null || typeof val === 'object') return false;
      return String(val).toLowerCase().includes(text);
    });
  }

  _matchAllColumnFilters(row) {
    for (const [, filterDef] of this._columnFilters) {
      if (!this._matchColumnFilter(row, filterDef)) return false;
    }
    return true;
  }

  _matchColumnFilter(row, filterDef) {
    const { type, value, operator, fn, field } = filterDef;
    const cellValue = row[field];

    // 커스텀 필터 함수
    if (type === 'custom' && fn) {
      return fn(cellValue, row, filterDef);
    }

    if (cellValue == null) return false;

    switch (type) {
      case 'text':
        return this._matchText(String(cellValue), String(value), operator);
      case 'number':
        return this._matchNumber(Number(cellValue), value, operator);
      case 'date':
        return this._matchDate(new Date(cellValue), value, operator);
      case 'select':
      case 'set':
        return this._matchSelect(cellValue, value);
      default:
        return this._matchText(String(cellValue), String(value), operator);
    }
  }

  _matchText(cellStr, filterStr, operator) {
    const cell = cellStr.toLowerCase();
    const filter = filterStr.toLowerCase();

    switch (operator) {
      case 'contains': return cell.includes(filter);
      case 'startsWith': return cell.startsWith(filter);
      case 'endsWith': return cell.endsWith(filter);
      case 'equals': return cell === filter;
      case 'notEquals': return cell !== filter;
      case 'notContains': return !cell.includes(filter);
      default: return cell.includes(filter);
    }
  }

  _matchNumber(cellNum, value, operator) {
    switch (operator) {
      case 'equals': return cellNum === Number(value);
      case 'notEquals': return cellNum !== Number(value);
      case 'greaterThan': return cellNum > Number(value);
      case 'greaterThanOrEqual': return cellNum >= Number(value);
      case 'lessThan': return cellNum < Number(value);
      case 'lessThanOrEqual': return cellNum <= Number(value);
      case 'between':
        if (!Array.isArray(value) || value.length !== 2) return false;
        return cellNum >= Number(value[0]) && cellNum <= Number(value[1]);
      default: return true;
    }
  }

  _matchDate(cellDate, value, operator) {
    const filterDate = new Date(value);
    switch (operator) {
      case 'equals': return cellDate.toDateString() === filterDate.toDateString();
      case 'notEquals': return cellDate.toDateString() !== filterDate.toDateString();
      case 'before': return cellDate < filterDate;
      case 'after': return cellDate > filterDate;
      case 'between':
        if (!Array.isArray(value) || value.length !== 2) return false;
        return cellDate >= new Date(value[0]) && cellDate <= new Date(value[1]);
      default: return true;
    }
  }

  _matchSelect(cellValue, filterValues) {
    if (!Array.isArray(filterValues)) {
      return cellValue == filterValues || String(cellValue) === String(filterValues);
    }
    return filterValues.some((v) => v == cellValue || String(v) === String(cellValue));
  }

  // ─── 조회 ──────────────────────────────────────────────────

  hasFilter() {
    return this._quickFilter.length > 0 || this._columnFilters.size > 0;
  }

  // 커스텀 필터 함수는 Worker로 직렬화할 수 없다 — 이게 있으면 Worker에 위임하지 말고
  // 메인 스레드에서 filter()를 직접 돌려야 한다 (Worker는 'custom' 타입을 모르는 채
  // 조용히 통과시켜버려서 다른 결과를 낸다).
  hasUnserializableFilter() {
    return [...this._columnFilters.values()].some((def) => def.type === 'custom' && typeof def.fn === 'function');
  }

  getColumnFilter(colId) {
    return this._columnFilters.get(colId) ?? null;
  }

  getState() {
    return {
      quickFilter: this._quickFilter,
      columnFilters: Object.fromEntries(
        [...this._columnFilters.entries()].map(([k, v]) => [k, { ...v, fn: undefined }])
      ),
    };
  }

  getQuickFilterFields() {
    return [...this._quickFilterFields];
  }

  getColumnFilters() {
    return new Map(this._columnFilters);
  }

  getWorkerPayload() {
    return {
      quickFilter: this._quickFilter,
      quickFilterFields: [...this._quickFilterFields],
      columnFilters: Object.fromEntries(
        [...this._columnFilters.entries()].map(([key, value]) => [key, { ...value, fn: undefined }])
      ),
    };
  }

  destroy() {
    this._columnFilters.clear();
    this._quickFilter = '';
  }
}
