export class TreeManager {
  constructor(options = {}) {
    this._treeMode = options.treeMode ?? 'children';
    this._childrenField = options.childrenField ?? 'children';
    this._parentIdField = options.parentIdField ?? 'parentId';
    this._hasChildrenField = options.hasChildrenField ?? 'hasChildren';
    this._onLoadChildren = options.onLoadChildren ?? null;
    this._onChanged = options.onChanged ?? (() => {});
    this._getRowKey = options.getRowKey ?? ((row, index) => String(row.id ?? index));
    this._enabled = false;

    this._expandedKeys = new Set();
    this._loadingKeys = new Set();
    this._childrenCache = new Map();
  }

  enable() {
    this._enabled = true;
  }

  disable() {
    this._enabled = false;
    this._expandedKeys.clear();
    this._loadingKeys.clear();
    this._childrenCache.clear();
  }

  isEnabled() {
    return this._enabled;
  }

  expand(rowKey) {
    this._expandedKeys.add(String(rowKey));
    this._onChanged({ action: 'expand', rowKey });
  }

  collapse(rowKey) {
    this._expandedKeys.delete(String(rowKey));
    this._onChanged({ action: 'collapse', rowKey });
  }

  toggle(rowKey) {
    if (this._expandedKeys.has(String(rowKey))) {
      this.collapse(rowKey);
    } else {
      this.expand(rowKey);
    }
  }

  // `rows` must be the RAW source rows (same shape passed to flatten()), not an
  // already-flattened list — a flattened list only contains rows under currently-expanded
  // ancestors, so collapsed branches would never get visited and expandAll() would need to
  // be called once per depth level to fully open a deep tree.
  expandAll(rows) {
    const roots = this._treeMode === 'parentId' ? this._buildTreeFromParentId(rows) : rows;
    this._collectAllParentKeys(roots, null);
    this._onChanged({ action: 'expandAll' });
  }

  _collectAllParentKeys(rows, parentKey) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const key = this._getKey(row, parentKey != null ? `${parentKey}::${i}` : i);
      const rawChildren = this._treeMode === 'parentId'
        ? (row._treeChildren ?? [])
        : (this._childrenCache.get(key) ?? row[this._childrenField] ?? []);
      const hasChildren = rawChildren.length > 0 || row[this._hasChildrenField] === true;
      if (hasChildren) {
        this._expandedKeys.add(key);
        if (rawChildren.length > 0) {
          this._collectAllParentKeys(rawChildren, key);
        }
      }
    }
  }

  collapseAll() {
    this._expandedKeys.clear();
    this._onChanged({ action: 'collapseAll' });
  }

  isExpanded(rowKey) {
    return this._expandedKeys.has(String(rowKey));
  }

  isLoading(rowKey) {
    return this._loadingKeys.has(String(rowKey));
  }

  async loadChildren(rowKey, row) {
    if (!this._onLoadChildren || this._loadingKeys.has(rowKey) || this._childrenCache.has(rowKey)) {
      return;
    }

    this._loadingKeys.add(rowKey);
    this._onChanged({ action: 'loadingStart', rowKey });

    try {
      const children = await this._onLoadChildren(row);
      this._childrenCache.set(rowKey, children ?? []);
      this._loadingKeys.delete(rowKey);
      this._expandedKeys.add(rowKey);
      this._onChanged({ action: 'loadingComplete', rowKey, children });
    } catch (error) {
      this._loadingKeys.delete(rowKey);
      this._onChanged({ action: 'loadingError', rowKey, error: error.message });
      console.error(`[TreeManager] Failed to load children for "${rowKey}":`, error);
    }
  }

  flatten(rows) {
    if (!this._enabled) {
      return rows.map((row, index) => this._toFlatRow(row, this._getKey(row, index), null, 0, index));
    }

    if (this._treeMode === 'parentId') {
      const tree = this._buildTreeFromParentId(rows);
      return this._flattenTree(tree, null, 0);
    }

    const rootRows = rows.filter((row) => !row[this._parentIdField] || this._treeMode === 'children');
    return this._flattenTree(rootRows, null, 0);
  }

  _buildTreeFromParentId(rows) {
    const rowMap = new Map();
    const roots = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const key = String(this._getRowKey(row, i));
      rowMap.set(key, { ...row, _treeKey: key, _treeChildren: [] });
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const key = String(this._getRowKey(row, i));
      const parentId = row[this._parentIdField];
      const current = rowMap.get(key);
      if (parentId != null) {
        const parent = rowMap.get(String(parentId));
        if (parent) {
          parent._treeChildren.push(current);
        } else {
          roots.push(current);
        }
      } else {
        roots.push(current);
      }
    }

    return roots;
  }

  _flattenTree(rows, parentKey, depth) {
    const flat = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      // Scope the fallback index to this branch (parentKey::i) so that rows with no
      // natural id/rowKey don't collide with same-position siblings under a different parent.
      const key = this._getKey(row, parentKey != null ? `${parentKey}::${i}` : i);
      // Cache wins over the row's own children field: it's only ever populated by
      // loadChildren() with freshly-loaded data, and a lazy node's original row commonly
      // carries `children: []` (a defined empty array, so `??` alone would never fall
      // through to the cache).
      const rawChildren = this._treeMode === 'parentId'
        ? (row._treeChildren ?? [])
        : (this._childrenCache.get(key) ?? row[this._childrenField] ?? []);

      const hasChildren = rawChildren.length > 0 || row[this._hasChildrenField] === true;
      const isExpanded = this._expandedKeys.has(key);
      const isLoading = this._loadingKeys.has(key);

      const flatRow = this._toFlatRow(row, key, parentKey, depth, flat.length);
      flatRow._hasChildren = hasChildren;
      flatRow._isExpanded = isExpanded;
      flatRow._isLoading = isLoading;
      flatRow._isParent = hasChildren;
      flatRow._children = rawChildren;
      flatRow._descendantRowKeys = this._collectDescendantRowKeys(rawChildren, key);
      flat.push(flatRow);

      if (isExpanded && rawChildren.length > 0) {
        flat.push(...this._flattenTree(rawChildren, key, depth + 1));
      } else if (isLoading) {
        flat.push({
          _type: 'tree-loading',
          _rowKey: `__loading__${key}`,
          _depth: depth + 1,
          _parentKey: key,
        });
      }
    }

    return flat;
  }

  flattenAllForExport(rows) {
    if (!this._enabled) {
      return rows;
    }
    if (this._treeMode === 'parentId') {
      return rows;
    }
    return this._flattenTreeAllForExport(rows, null, 0);
  }

  _flattenTreeAllForExport(rows, parentKey, depth) {
    const flat = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const key = this._getKey(row, parentKey != null ? `${parentKey}::${i}` : i);
      const rawChildren = this._childrenCache.get(key) ?? row[this._childrenField] ?? [];
      const flatRow = this._toFlatRow(row, key, parentKey, depth, flat.length);
      flatRow._hasChildren = rawChildren.length > 0 || row[this._hasChildrenField] === true;
      flatRow._isExpanded = this._expandedKeys.has(key);
      flatRow._isParent = flatRow._hasChildren;
      flatRow._children = rawChildren;
      flatRow._descendantRowKeys = this._collectDescendantRowKeys(rawChildren, key);
      flat.push(flatRow);
      if (rawChildren.length > 0) {
        flat.push(...this._flattenTreeAllForExport(rawChildren, key, depth + 1));
      }
    }
    return flat;
  }

  _toFlatRow(row, key, parentKey, depth, flatIndex) {
    return {
      _type: 'tree-node',
      _flatIndex: flatIndex,
      _rowKey: key,
      _parentKey: parentKey,
      _depth: depth,
      _hasChildren: false,
      _isExpanded: false,
      _isParent: false,
      _children: row[this._childrenField] ?? null,
      _descendantRowKeys: [],
      ...row,
    };
  }

  _collectDescendantRowKeys(rows, basePath = null) {
    const keys = [];
    const visit = (items, path) => {
      for (let i = 0; i < (items ?? []).length; i++) {
        const item = items[i];
        const key = this._getKey(item, path != null ? `${path}::${i}` : i);
        keys.push(key);
        const children = this._treeMode === 'parentId'
          ? (item._treeChildren ?? [])
          : (this._childrenCache.get(key) ?? item[this._childrenField] ?? []);
        if (children.length > 0) {
          visit(children, key);
        }
      }
    };
    visit(rows, basePath);
    return keys;
  }

  _getKey(row, index) {
    return String(row._treeKey ?? this._getRowKey(row, index));
  }

  serializeState() {
    return {
      expandedKeys: [...this._expandedKeys],
    };
  }

  applySerializedState(state) {
    if (state.expandedKeys) {
      this._expandedKeys = new Set(state.expandedKeys);
    }
  }

  getState() {
    return {
      enabled: this._enabled,
      expandedKeys: new Set(this._expandedKeys),
      loadingKeys: new Set(this._loadingKeys),
    };
  }

  destroy() {
    this._expandedKeys.clear();
    this._loadingKeys.clear();
    this._childrenCache.clear();
  }
}
