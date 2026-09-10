/**
 * DataStore - Raw 데이터 CRUD 및 rowKey 인덱싱
 *
 * 책임:
 * - 원본 데이터 보관 (불변 원칙 - 원본 객체 직접 수정 금지)
 * - rowKey 기반 빠른 조회 (O(1))
 * - CRUD 연산 (add/update/patch/remove/upsert)
 * - 변경 추적 (changedKeys Set)
 *
 * 중요: DataStore는 정렬/필터를 모름. 순수한 데이터 저장소.
 */
export class DataStore {
  /**
   * @param {Object} options
   * @param {string|Function} options.rowKey - 행의 고유키 필드명 또는 (row)=>key 함수
   * @param {Function} options.onChanged - 변경 발생 시 콜백
   */
  constructor(options = {}) {
    this._rowKeyField = options.rowKey ?? 'id';
    this._onChanged = options.onChanged ?? (() => {});

    /** @type {Object[]} 순서가 보장된 원본 row 배열 */
    this._rows = [];
    /** @type {Map<string, number>} rowKey -> index in _rows */
    this._indexMap = new Map();
    /** @type {Set<string>} 마지막 배치 이후 변경된 rowKey들 */
    this._changedKeys = new Set();
    /** @type {Set<string>} 마지막 배치에서 추가된 rowKey들 */
    this._addedKeys = new Set();
    /** @type {Set<string>} 마지막 배치에서 제거된 rowKey들 */
    this._removedKeys = new Set();
  }

  // ─── 키 추출 ──────────────────────────────────────────────

  getRowKey(row) {
    if (typeof this._rowKeyField === 'function') {
      // NOTE: called with only `row` here, unlike Pipeline/TreeManager which call the same
      // user function as `(row, index)`. A custom rowKey function that relies on `index`
      // will see it as undefined in this call, so it can resolve to a different key here
      // than in Pipeline/TreeManager — pre-existing inconsistency, not fixed yet.
      return String(this._rowKeyField(row));
    }
    const key = row[this._rowKeyField];
    if (key === undefined || key === null) {
      throw new Error(
        `[DataStore] rowKey field "${this._rowKeyField}" is missing or null on row: ${JSON.stringify(row)}`
      );
    }
    return String(key);
  }

  // ─── 조회 ──────────────────────────────────────────────────

  getAll() {
    return this._rows;
  }

  getByKey(key) {
    const idx = this._indexMap.get(String(key));
    return idx !== undefined ? this._rows[idx] : null;
  }

  has(key) {
    return this._indexMap.has(String(key));
  }

  get size() {
    return this._rows.length;
  }

  // ─── 전체 교체 ─────────────────────────────────────────────

  setData(rows) {
    this._rows = [];
    this._indexMap.clear();
    this._changedKeys.clear();
    this._addedKeys.clear();
    this._removedKeys.clear();

    for (let i = 0; i < rows.length; i++) {
      const key = this.getRowKey(rows[i]);
      if (this._indexMap.has(key)) {
        console.warn(`[DataStore] Duplicate rowKey "${key}" detected. Last occurrence will be used.`);
      }
      this._rows.push(rows[i]);
      this._indexMap.set(key, i);
    }

    this._onChanged({ type: 'setData', affectedKeys: null });
  }

  // ─── 추가 ──────────────────────────────────────────────────

  appendRows(rows) {
    const added = [];
    for (const row of rows) {
      const key = this.getRowKey(row);
      if (this._indexMap.has(key)) {
        console.warn(`[DataStore] appendRows: rowKey "${key}" already exists. Use upsertRow instead.`);
        continue;
      }
      this._indexMap.set(key, this._rows.length);
      this._rows.push(row);
      this._addedKeys.add(key);
      added.push(key);
    }
    if (added.length > 0) {
      this._onChanged({ type: 'append', affectedKeys: added });
    }
    return added.length;
  }

  prependRows(rows) {
    const added = [];
    const newRows = [];
    for (const row of rows) {
      const key = this.getRowKey(row);
      if (this._indexMap.has(key)) {
        console.warn(`[DataStore] prependRows: rowKey "${key}" already exists.`);
        continue;
      }
      newRows.push(row);
      this._addedKeys.add(key);
      added.push(key);
    }
    if (added.length > 0) {
      this._rows = [...newRows, ...this._rows];
      this._rebuildIndex();
      this._onChanged({ type: 'prepend', affectedKeys: added });
    }
  }

  // ─── 수정 ──────────────────────────────────────────────────

  /**
   * 전체 row 교체 (rowKey는 동일해야 함)
   */
  updateRow(row) {
    const key = this.getRowKey(row);
    const idx = this._indexMap.get(key);
    if (idx === undefined) {
      console.warn(`[DataStore] updateRow: rowKey "${key}" not found.`);
      return false;
    }
    this._rows[idx] = row;
    this._changedKeys.add(key);
    this._onChanged({ type: 'update', affectedKeys: [key] });
    return true;
  }

  updateRows(rows) {
    const affectedKeys = [];
    for (const row of rows) {
      const key = this.getRowKey(row);
      const idx = this._indexMap.get(key);
      if (idx === undefined) continue;
      this._rows[idx] = row;
      this._changedKeys.add(key);
      affectedKeys.push(key);
    }
    if (affectedKeys.length > 0) {
      this._onChanged({ type: 'update', affectedKeys });
    }
  }

  /**
   * 일부 필드만 업데이트 (shallow merge)
   */
  patchRow(key, patch) {
    const strKey = String(key);
    const idx = this._indexMap.get(strKey);
    if (idx === undefined) {
      console.warn(`[DataStore] patchRow: rowKey "${strKey}" not found.`);
      return false;
    }
    const updated = { ...this._rows[idx], ...patch };
    // patch가 rowKey 필드 자체를 바꾸는 경우, 그 새 키가 이미 다른 행이 쓰고 있는지
    // 먼저 확인한다 — 확인 없이 진행하면 두 행이 같은 키를 갖게 되어 인덱스가
    // 한쪽을 덮어쓰고 그 행은 getByKey로 더 이상 찾을 수 없게 된다.
    const newKey = this.getRowKey(updated);
    if (newKey !== strKey && this._indexMap.has(newKey)) {
      console.warn(`[DataStore] patchRow: cannot change rowKey "${strKey}" to "${newKey}" — that key is already used by another row.`);
      return false;
    }
    this._rows[idx] = updated;
    if (newKey !== strKey) {
      this._indexMap.delete(strKey);
      this._indexMap.set(newKey, idx);
    }
    // Only the row's CURRENT key belongs in _changedKeys — if it was renamed, the old key
    // no longer resolves via getByKey(), so leaving it here would hand callers a dangling key.
    this._changedKeys.add(newKey);
    this._onChanged({ type: 'patch', affectedKeys: newKey === strKey ? [strKey] : [strKey, newKey] });
    return true;
  }

  patchRows(patches) {
    // patches: Array<{key, patch}> 또는 Map<key, patch>
    const entries = Array.isArray(patches)
      ? patches
      : [...patches.entries()].map(([key, patch]) => ({ key, patch }));

    const affectedKeys = [];
    for (const { key, patch } of entries) {
      const strKey = String(key);
      const idx = this._indexMap.get(strKey);
      if (idx === undefined) continue;
      const updated = { ...this._rows[idx], ...patch };
      const newKey = this.getRowKey(updated);
      if (newKey !== strKey && this._indexMap.has(newKey)) {
        console.warn(`[DataStore] patchRows: cannot change rowKey "${strKey}" to "${newKey}" — that key is already used by another row.`);
        continue;
      }
      this._rows[idx] = updated;
      if (newKey !== strKey) {
        this._indexMap.delete(strKey);
        this._indexMap.set(newKey, idx);
      }
      this._changedKeys.add(newKey);
      affectedKeys.push(strKey);
      if (newKey !== strKey) {
        affectedKeys.push(newKey);
      }
    }
    if (affectedKeys.length > 0) {
      this._onChanged({ type: 'patch', affectedKeys });
    }
  }

  // ─── Upsert ────────────────────────────────────────────────

  upsertRow(row) {
    const key = this.getRowKey(row);
    if (this._indexMap.has(key)) {
      this.updateRow(row);
    } else {
      this.appendRows([row]);
    }
  }

  upsertRows(rows) {
    const toUpdate = [];
    const toAppend = [];
    for (const row of rows) {
      const key = this.getRowKey(row);
      if (this._indexMap.has(key)) {
        toUpdate.push(row);
      } else {
        toAppend.push(row);
      }
    }
    if (toUpdate.length > 0) this.updateRows(toUpdate);
    if (toAppend.length > 0) this.appendRows(toAppend);
  }

  // ─── 삭제 ──────────────────────────────────────────────────

  removeRow(key) {
    const strKey = String(key);
    const idx = this._indexMap.get(strKey);
    if (idx === undefined) return false;

    this._rows.splice(idx, 1);
    this._indexMap.delete(strKey);
    this._removedKeys.add(strKey);
    // 삭제 후 인덱스 재구축 (splice로 뒤 항목 인덱스 변경됨)
    this._rebuildIndex();
    this._onChanged({ type: 'remove', affectedKeys: [strKey] });
    return true;
  }

  // 오래된 행(앞쪽)을 잘라내어 cap 이하로 유지 — live 모드 maxRows 용
  trimToMax(cap) {
    const excess = this._rows.length - cap;
    if (excess <= 0) return;

    const removed = this._rows.splice(0, excess);
    for (const row of removed) {
      const key = this.getRowKey(row);
      this._indexMap.delete(key);
      this._removedKeys.add(key);
    }
    this._rebuildIndex();
    this._onChanged({ type: 'trim', affectedKeys: null });
  }

  removeRows(keys) {
    const strKeys = keys.map(String);
    const keysSet = new Set(strKeys);
    const removed = [];

    this._rows = this._rows.filter((row) => {
      const key = this.getRowKey(row);
      if (keysSet.has(key)) {
        removed.push(key);
        this._removedKeys.add(key);
        return false;
      }
      return true;
    });

    if (removed.length > 0) {
      this._rebuildIndex();
      this._onChanged({ type: 'remove', affectedKeys: removed });
    }
  }

  // ─── 변경 추적 ─────────────────────────────────────────────

  getChangedKeys() {
    return new Set(this._changedKeys);
  }

  getAddedKeys() {
    return new Set(this._addedKeys);
  }

  getRemovedKeys() {
    return new Set(this._removedKeys);
  }

  clearChangeTracking() {
    this._changedKeys.clear();
    this._addedKeys.clear();
    this._removedKeys.clear();
  }

  // ─── 내부 ──────────────────────────────────────────────────

  _rebuildIndex() {
    this._indexMap.clear();
    for (let i = 0; i < this._rows.length; i++) {
      const key = this.getRowKey(this._rows[i]);
      this._indexMap.set(key, i);
    }
  }

  destroy() {
    this._rows = [];
    this._indexMap.clear();
    this._changedKeys.clear();
    this._addedKeys.clear();
    this._removedKeys.clear();
  }
}
