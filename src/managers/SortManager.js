/**
 * SortManager - 정렬 상태 및 비교 함수 관리
 *
 * 다중 컬럼 정렬 지원 (정렬 우선순위 배열)
 * Worker 위임 가능한 pure comparator 제공
 */
export class SortManager {
  /**
   * @param {Object} options
   * @param {Function} [options.onChanged]
   */
  constructor(options = {}) {
    this._onChanged = options.onChanged ?? (() => {});
    /** @type {SortDef[]} 정렬 정의 배열 (앞이 높은 우선순위) */
    this._sortDefs = [];
  }

  // ─── 정렬 설정 ─────────────────────────────────────────────

  /**
   * @param {SortDef|SortDef[]} defs
   * { field: string, direction: 'asc'|'desc', comparator?: Function }
   */
  setSort(defs) {
    const arr = Array.isArray(defs) ? defs : [defs];
    this._sortDefs = arr.map((d) => ({
      field: d.field,
      direction: d.direction ?? 'asc',
      comparator: d.comparator ?? null,
      type: d.type ?? 'auto', // 'string'|'number'|'date'|'auto'
    }));
    this._onChanged(this.getState());
  }

  /**
   * 단일 컬럼 정렬 토글 (asc → desc → 해제)
   * @param {string} field
   * @param {Object} [colDef] - comparator/type 정보
   */
  toggleSort(field, colDef = {}) {
    const existing = this._sortDefs.find((s) => s.field === field);

    if (!existing) {
      // 새 정렬 추가 (다중 정렬이 아닌 경우 기존 정렬 초기화)
      this._sortDefs = [{
        field,
        direction: 'asc',
        comparator: colDef.comparator ?? null,
        type: colDef.type ?? 'auto',
      }];
    } else if (existing.direction === 'asc') {
      existing.direction = 'desc';
    } else {
      // desc → 해제
      this._sortDefs = this._sortDefs.filter((s) => s.field !== field);
    }

    this._onChanged(this.getState());
  }

  /**
   * 다중 정렬 추가 (Ctrl+클릭)
   */
  addSort(field, colDef = {}) {
    const existing = this._sortDefs.find((s) => s.field === field);
    if (existing) {
      if (existing.direction === 'asc') existing.direction = 'desc';
      else this._sortDefs = this._sortDefs.filter((s) => s.field !== field);
    } else {
      this._sortDefs.push({
        field,
        direction: 'asc',
        comparator: colDef.comparator ?? null,
        type: colDef.type ?? 'auto',
      });
    }
    this._onChanged(this.getState());
  }

  clearSort() {
    this._sortDefs = [];
    this._onChanged(this.getState());
  }

  clearSortFor(colId) {
    this._sortDefs = this._sortDefs.filter((s) => s.field !== colId);
    this._onChanged(this.getState());
  }

  // ─── 정렬 실행 (메인 스레드 폴백) ─────────────────────────

  /**
   * @param {Object[]} rows
   * @returns {Object[]} 정렬된 새 배열 (원본 불변)
   */
  sort(rows) {
    if (this._sortDefs.length === 0) return rows;

    return [...rows].sort((a, b) => {
      for (const def of this._sortDefs) {
        const result = this._compare(a, b, def);
        if (result !== 0) return result;
      }
      return 0;
    });
  }

  _compare(a, b, def) {
    // 커스텀 comparator 우선
    if (def.comparator) {
      const result = def.comparator(a[def.field], b[def.field], a, b);
      return def.direction === 'asc' ? result : -result;
    }

    const valA = a[def.field];
    const valB = b[def.field];

    // null/undefined를 항상 마지막으로
    if (valA == null && valB == null) return 0;
    if (valA == null) return 1;
    if (valB == null) return -1;

    let result = 0;
    const type = def.type === 'auto' ? this._detectType(valA) : def.type;

    switch (type) {
      case 'number':
        result = valA - valB;
        break;
      case 'date':
        result = new Date(valA) - new Date(valB);
        break;
      case 'string':
      default:
        result = String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: 'base' });
    }

    return def.direction === 'asc' ? result : -result;
  }

  _detectType(value) {
    if (typeof value === 'number') return 'number';
    if (value instanceof Date) return 'date';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]*)?$/.test(value)) return 'date';
    return 'string';
  }

  // ─── 조회 ──────────────────────────────────────────────────

  hasSort() {
    return this._sortDefs.length > 0;
  }

  // 커스텀 comparator는 Worker로 직렬화할 수 없다 — 이게 있으면 Worker에 위임하지 말고
  // 메인 스레드에서 sort()를 직접 돌려야 한다 (Worker는 그냥 타입 기반 비교로
  // 다른 결과를 내면서도 에러 없이 조용히 성공한다).
  hasUnserializableSort() {
    return this._sortDefs.some((s) => typeof s.comparator === 'function');
  }

  getSortForField(field) {
    return this._sortDefs.find((s) => s.field === field) ?? null;
  }

  getState() {
    return {
      sortDefs: this._sortDefs.map((s) => ({
        field: s.field,
        direction: s.direction,
        type: s.type,
      })),
    };
  }

  /** Worker에 전달할 직렬화 가능한 정렬 정의 (함수 제외) */
  getSerializableDefs() {
    return this._sortDefs.map((s) => ({
      field: s.field,
      direction: s.direction,
      type: s.type,
      // comparator 함수는 Worker로 전달 불가 - Worker에서 타입 기반으로 처리
    }));
  }

  destroy() {
    this._sortDefs = [];
  }
}
