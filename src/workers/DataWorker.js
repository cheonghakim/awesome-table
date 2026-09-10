/**
 * DataWorker - Web Worker에서 실행되는 무거운 계산 로직
 *
 * 이 파일은 Worker 컨텍스트와 메인 스레드 폴백 양쪽에서 사용됨.
 * Worker 메시지 프로토콜:
 * Request: { id, type, payload }
 * Response: { id, type, result?, error? }
 */

// ─── 핸들러 맵 ─────────────────────────────────────────────

export const DataWorkerHandlers = {

  /**
   * 정렬
   * payload: { rows: Object[], sortDefs: SortDef[] }
   */
  sort({ rows, sortDefs }) {
    if (!sortDefs || sortDefs.length === 0) return rows;
    return [...rows].sort((a, b) => {
      for (const def of sortDefs) {
        const result = compareValues(a[def.field], b[def.field], def);
        if (result !== 0) return result;
      }
      return 0;
    });
  },

  /**
   * 필터
   * payload: { rows: Object[], quickFilter: string, quickFilterFields: string[], columnFilters: Object }
   */
  filter({ rows, quickFilter, quickFilterFields = [], columnFilters = {} }) {
    let result = rows;

    if (quickFilter) {
      const text = quickFilter.toLowerCase().trim();
      result = result.filter((row) => {
        if (quickFilterFields.length > 0) {
          return quickFilterFields.some((f) => {
            const v = row[f];
            return v != null && String(v).toLowerCase().includes(text);
          });
        }
        return Object.values(row).some((v) => {
          if (v == null || typeof v === 'object') return false;
          return String(v).toLowerCase().includes(text);
        });
      });
    }

    const colEntries = Object.entries(columnFilters);
    if (colEntries.length > 0) {
      result = result.filter((row) => {
        return colEntries.every(([, filterDef]) => matchColumnFilter(row, filterDef));
      });
    }

    return result;
  },

  /**
   * 그룹 집계
   * payload: { rows: Object[], groupByFields: string[], aggregations: Object }
   */
  groupAggregate({ rows, groupByFields, aggregations = {} }) {
    const grouped = groupByFields.reduce((acc, field) => {
      const map = new Map();
      for (const row of rows) {
        const val = row[field] ?? '__null__';
        if (!map.has(val)) map.set(val, []);
        map.get(val).push(row);
      }
      return { field, map };
    }, rows);

    return calcGroupAggregations(rows, aggregations);
  },

  /**
   * 두 row 배열의 diff 계산
   * payload: { prevKeys: string[], nextKeys: string[], getKey: null }
   */
  rowDiff({ prevKeys, nextKeys }) {
    const prevSet = new Set(prevKeys);
    const nextSet = new Set(nextKeys);

    return {
      added: nextKeys.filter((k) => !prevSet.has(k)),
      removed: prevKeys.filter((k) => !nextSet.has(k)),
      unchanged: nextKeys.filter((k) => prevSet.has(k)),
    };
  },
};

// ─── 헬퍼 함수 ─────────────────────────────────────────────

function compareValues(a, b, def) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;

  let result = 0;
  const type = def.type === 'auto' ? detectType(a) : def.type;

  switch (type) {
    case 'number':
      result = Number(a) - Number(b);
      break;
    case 'date':
      result = new Date(a) - new Date(b);
      break;
    default:
      result = String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }

  return def.direction === 'asc' ? result : -result;
}

function detectType(value) {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string' && !isNaN(parseFloat(value)) && isFinite(value)) return 'number';
  return 'string';
}

function matchColumnFilter(row, filterDef) {
  const { type = 'text', value, operator = 'contains', field } = filterDef;
  const cellValue = row[field];
  if (cellValue == null) return false;

  switch (type) {
    case 'text': {
      const cell = String(cellValue).toLowerCase();
      const filter = String(value).toLowerCase();
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
    case 'number': {
      const num = Number(cellValue);
      switch (operator) {
        case 'equals': return num === Number(value);
        case 'notEquals': return num !== Number(value);
        case 'greaterThan': return num > Number(value);
        case 'greaterThanOrEqual': return num >= Number(value);
        case 'lessThan': return num < Number(value);
        case 'lessThanOrEqual': return num <= Number(value);
        case 'between':
          return Array.isArray(value) && num >= Number(value[0]) && num <= Number(value[1]);
        default: return true;
      }
    }
    case 'date': {
      const cellDate = new Date(cellValue);
      const filterDate = new Date(value);
      switch (operator) {
        case 'equals': return cellDate.toDateString() === filterDate.toDateString();
        case 'notEquals': return cellDate.toDateString() !== filterDate.toDateString();
        case 'before': return cellDate < filterDate;
        case 'after': return cellDate > filterDate;
        case 'between':
          return Array.isArray(value) && cellDate >= new Date(value[0]) && cellDate <= new Date(value[1]);
        default: return true;
      }
    }
    case 'select':
      return Array.isArray(value) ? value.includes(cellValue) : cellValue === value;
    default:
      return true;
  }
}

function calcGroupAggregations(rows, aggregations) {
  const result = {};
  for (const [field, aggTypes] of Object.entries(aggregations)) {
    const values = rows.map((r) => r[field]).filter((v) => v != null && !isNaN(Number(v)));
    for (const type of (Array.isArray(aggTypes) ? aggTypes : [aggTypes])) {
      const key = `__agg_${field}_${type}`;
      switch (type) {
        case 'count': result[key] = rows.length; break;
        case 'sum': result[key] = values.reduce((a, b) => a + Number(b), 0); break;
        case 'avg': result[key] = values.length ? values.reduce((a, b) => a + Number(b), 0) / values.length : null; break;
        case 'min': result[key] = values.length ? Math.min(...values.map(Number)) : null; break;
        case 'max': result[key] = values.length ? Math.max(...values.map(Number)) : null; break;
      }
    }
  }
  return result;
}

// ─── Worker 컨텍스트에서 실행될 때 메시지 리스너 등록 ─────

if (typeof self !== 'undefined' && typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.addEventListener('message', async (e) => {
    const { id, type, payload } = e.data;
    try {
      const handler = DataWorkerHandlers[type];
      if (!handler) throw new Error(`Unknown task type: "${type}"`);
      const result = await handler(payload);
      self.postMessage({ id, type, result });
    } catch (err) {
      self.postMessage({ id, type, error: err.message });
    }
  });
}
