export class PivotManager {
  constructor(options = {}) {
    this._enabled = false;
    this._rowFields = [];
    this._columnField = null;
    this._valueField = null;
    this._aggFunction = 'sum';
    this._onChanged = options.onChanged ?? null;
  }

  enable({ rowFields = [], columnField, valueField, aggFunction = 'sum' } = {}) {
    this._enabled = true;
    this._rowFields = rowFields;
    this._columnField = columnField;
    this._valueField = valueField;
    this._aggFunction = aggFunction;
    this._onChanged?.();
  }

  disable() {
    this._enabled = false;
    this._onChanged?.();
  }

  isEnabled() {
    return this._enabled;
  }

  getConfig() {
    return {
      enabled: this._enabled,
      rowFields: [...this._rowFields],
      columnField: this._columnField,
      valueField: this._valueField,
      aggFunction: this._aggFunction,
    };
  }

  /**
   * 피벗 변환: 원본 rows → { pivotRows, pivotColumnDefs }
   * @param {object[]} rows
   * @returns {{ pivotRows: object[], pivotColumnDefs: object[] }}
   */
  process(rows) {
    if (!this._enabled || !this._columnField || !this._valueField) {
      return { pivotRows: rows, pivotColumnDefs: null };
    }

    // 1. 고유 컬럼 값 수집
    const uniqueColValues = [...new Set(rows.map((r) => r[this._columnField]))].filter((v) => v != null).sort();

    // 2. 행 그룹 키 생성
    const groupKeyFn = (row) =>
      this._rowFields.length > 0
        ? this._rowFields.map((f) => `${f}:${row[f]}`).join('|')
        : '__all__';

    // 3. 집계 맵 구성: groupKey → colValue → values[]
    const groups = new Map();
    const groupMeta = new Map();

    for (const row of rows) {
      const gk = groupKeyFn(row);
      const cv = row[this._columnField];
      const raw = row[this._valueField];

      if (!groups.has(gk)) {
        groups.set(gk, new Map());
        const meta = {};
        for (const f of this._rowFields) meta[f] = row[f];
        groupMeta.set(gk, meta);
      }

      const colMap = groups.get(gk);
      if (!colMap.has(cv)) colMap.set(cv, []);
      // Keep the raw value here — 'count' needs to count non-null entries regardless of
      // whether they're numeric (e.g. counting text rows), not just the ones that survive
      // Number() coercion for sum/avg/min/max.
      if (raw != null) colMap.get(cv).push(raw);
    }

    // 4. 집계 함수 적용
    const agg = (rawValues) => {
      if (this._aggFunction === 'count') {
        return rawValues.length;
      }
      const values = rawValues.map(Number).filter((v) => !Number.isNaN(v));
      if (values.length === 0) return null;
      switch (this._aggFunction) {
        case 'sum': return values.reduce((a, b) => a + b, 0);
        case 'avg': return values.reduce((a, b) => a + b, 0) / values.length;
        case 'min': return Math.min(...values);
        case 'max': return Math.max(...values);
        default: return values.reduce((a, b) => a + b, 0);
      }
    };

    // 5. 피벗 행 생성
    let rowIdx = 0;
    const pivotRows = [];
    for (const [gk, colMap] of groups) {
      const meta = groupMeta.get(gk) ?? {};
      const pivotRow = { id: `pivot-${rowIdx++}`, ...meta };
      for (const cv of uniqueColValues) {
        const values = colMap.get(cv) ?? [];
        pivotRow[`_pivot_${cv}`] = agg(values);
      }
      pivotRows.push(pivotRow);
    }

    // 6. 동적 컬럼 정의 생성
    const rowColumnDefs = this._rowFields.map((f) => ({
      id: f,
      field: f,
      header: f,
      headerName: f,
      width: 120,
    }));

    const valueColumnDefs = uniqueColValues.map((cv) => ({
      id: `_pivot_${cv}`,
      field: `_pivot_${cv}`,
      header: String(cv),
      headerName: String(cv),
      type: 'number',
      align: 'right',
      width: 100,
      // formatter(value, row) 형식 — BodyRenderer가 (value, row)로 호출
      formatter: (v) => (v == null ? '' : typeof v === 'number' ? (v % 1 !== 0 ? v.toFixed(2) : v.toLocaleString()) : v),
    }));

    const pivotColumnDefs = [...rowColumnDefs, ...valueColumnDefs];

    return { pivotRows, pivotColumnDefs };
  }

  destroy() {
    this._enabled = false;
    this._onChanged = null;
  }
}
