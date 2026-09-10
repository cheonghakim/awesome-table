import { createSvgIcon } from "./IconFactory.js";

function escapeAttrValue(value) {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value);
  return String(value).replace(/([!"#$%&'()*+,.\\/:;<=>?@[\]^`{|}~])/g, "\\$1");
}

export class BodyRenderer {
  constructor(domRenderer, columnModel, viewModel, options = {}) {
    this._dom = domRenderer;
    this._columnModel = columnModel;
    this._viewModel = viewModel;
    this._options = options;
    this._currentRows = [];
    this._lastRenderAt = 0;
  }

  render(displayRows, rangeBundle) {
    this._currentRows = displayRows;

    const verticalRange =
      rangeBundle?.vertical ??
      rangeBundle ??
      this._viewModel.getVerticalRange();
    const horizontalRange =
      rangeBundle?.horizontal ?? this._viewModel.getHorizontalRange();
    const startIndex = Math.max(0, verticalRange.startIndex);
    const endIndex = Math.min(displayRows.length - 1, verticalRange.endIndex);
    const rowHeight = this._viewModel.getRowHeight();
    const visibleRowCount = Math.max(0, endIndex - startIndex + 1);
    const renderedHeight = this._viewModel.isVariableRowHeight()
      ? 0
      : visibleRowCount * rowHeight;
    const topHeight = verticalRange.offsetY;
    const bottomHeight = Math.max(
      0,
      verticalRange.totalHeight - topHeight - renderedHeight,
    );

    this._dom.updateVirtualSpace({
      topHeight,
      bottomHeight,
      totalHeight: verticalRange.totalHeight,
    });

    const container = this._dom.getRowsContainer();
    const now = performance.now?.() ?? Date.now();
    container.style.position = "relative";
    const previousRows = Array.from(container.querySelectorAll(".ck-zenith-grid-row")).map(
      (element) => ({
        key: element.dataset.rowKey,
        top: element.offsetTop,
        width: element.offsetWidth,
        height: element.offsetHeight,
        element,
      }),
    );
    const previousByKey = new Map(
      previousRows.map((entry) => [entry.key, entry]),
    );

    // render() always tears down and rebuilds every row/cell element, which drops focus
    // to <body> if the focused cell (or its active cell editor) was inside this container.
    // This can happen mid-edit too: committing via Enter triggers this same async render
    // before the cell editor's own DOM is torn down, so the focused element at that point
    // is the <input> editor itself, not the cell wrapper div. A keyboard shortcut like
    // Ctrl+Z is bound on the grid root, so once focus falls outside it (down to <body>),
    // the shortcut silently stops reaching the grid until the user clicks back in.
    // Capture which cell had (or contained) focus so it can be re-focused after rebuild.
    const activeElement = document.activeElement;
    let focusToRestore = null;
    if (activeElement instanceof HTMLElement && container.contains(activeElement)) {
      const focusableCell = activeElement.closest('[data-grid-focusable="cell"]');
      if (focusableCell instanceof HTMLElement) {
        // The row-selection checkbox cell is focusable too but carries no data-col-id
        // (there's only one per row), so it needs its own class-based selector instead.
        focusToRestore = focusableCell.classList.contains('ck-zenith-grid-selection-cell')
          ? { rowKey: focusableCell.closest('[data-row-key]')?.dataset.rowKey, selectionCell: true }
          : { rowKey: focusableCell.closest('[data-row-key]')?.dataset.rowKey, colId: focusableCell.dataset.colId };
      }
    }

    container.innerHTML = "";

    const visibleColumns = this._columnModel.getVisibleLeafColumns();
    const pinnedGroups = this._columnModel.getColumnsByPin();
    const stickyMeta = this._buildStickyMeta(pinnedGroups);
    const centerSlice = this._sliceColumnsByRange(
      pinnedGroups.center,
      horizontalRange,
    );
    const totalWidth = visibleColumns.reduce(
      (sum, column) => sum + (column.state.width ?? 0),
      0,
    );
    const spannedCells = new Set();

    for (let index = startIndex; index <= endIndex; index += 1) {
      const row = displayRows[index];
      if (!row) continue;

      const rowElement = document.createElement("div");
      rowElement.className = "ck-zenith-grid-row";
      rowElement.dataset.rowKey = row._rowKey;
      rowElement.dataset.rowIndex = String(index - startIndex);
      rowElement.setAttribute("role", "row");
      rowElement.setAttribute("aria-rowindex", String(index + 1));
      this._applyClassNames(rowElement, this._options.getRowClassName?.(row));
      this._applyInlineStyles(rowElement, this._options.getRowStyle?.(row));

      if (
        this._options.rowDragging &&
        row._type !== "group-header" &&
        row._type !== "tree-loading"
      ) {
        rowElement.addEventListener("dragover", (event) => {
          const draggingRow = container.querySelector(".ck-zenith-grid-row-dragging");
          if (draggingRow && draggingRow !== rowElement) {
            event.preventDefault();
            rowElement.classList.add("ck-zenith-grid-row-drag-over");
          }
        });
        rowElement.addEventListener("dragleave", () => {
          rowElement.classList.remove("ck-zenith-grid-row-drag-over");
        });
        rowElement.addEventListener("drop", (event) => {
          event.preventDefault();
          rowElement.classList.remove("ck-zenith-grid-row-drag-over");
          const fromRowKey = event.dataTransfer?.getData("text/plain");
          const toRowKey = row._rowKey;
          if (fromRowKey && fromRowKey !== toRowKey) {
            this._options.onRowDragDrop?.({ fromRowKey, toRowKey });
          }
        });
      }

      const explicitHeight =
        this._options.getRowHeight?.(row) ?? row._rowHeight ?? null;
      if (this._viewModel.isVariableRowHeight()) {
        rowElement.classList.add("ck-zenith-grid-row-variable");
        if (explicitHeight != null) {
          rowElement.style.minHeight = `${explicitHeight}px`;
        }
      } else {
        rowElement.style.height = `${rowHeight}px`;
      }

      if (index % 2 === 1) {
        rowElement.classList.add("ck-zenith-grid-row-odd");
      }

      if (this._options.selectionManager?.isSelected?.(row._rowKey)) {
        rowElement.classList.add("ck-zenith-grid-row-selected");
      }

      this._options.hooks?.beforeRowRender?.({
        row,
        rowElement,
        rowIndex: index,
      });

      rowElement.addEventListener("click", (event) => {
        this._options.onRowClick?.({ row, event });
      });
      rowElement.addEventListener("contextmenu", (event) => {
        this._options.onRowContextMenu?.({ row, event });
      });

      if (row._type === "detail") {
        rowElement.classList.add("ck-zenith-grid-row-detail");
        rowElement.style.height = `${row._rowHeight ?? 200}px`;
        rowElement.style.minHeight = `${row._rowHeight ?? 200}px`;
        const panel = this._options.getMasterDetailPanel?.(
          row._masterRow,
          row._masterRowKey,
        );
        if (panel instanceof HTMLElement) {
          rowElement.appendChild(panel);
        } else if (panel != null) {
          rowElement.innerHTML = String(panel);
        }
      } else if (row._type === "group-header") {
        rowElement.classList.add("ck-zenith-grid-row-group");
        rowElement.appendChild(this._createGroupCell(row, totalWidth));
      } else if (row._type === "tree-loading") {
        rowElement.classList.add("ck-zenith-grid-row-tree-loading");
        rowElement.appendChild(this._createLoadingCell(totalWidth));
      } else {
        if (row._type === "tree-node") {
          rowElement.classList.add("ck-zenith-grid-row-tree");
        }

        let colIndex = 0;
        if (this._options.rowNumbers) {
          rowElement.appendChild(
            this._createRowNumberCell(index + 1, index - startIndex),
          );
          colIndex += 1;
        }
        if (this._options.selectionEnabled && !this._options.isPivotEnabled?.()) {
          rowElement.appendChild(
            this._createSelectionCell(row, index - startIndex, colIndex),
          );
          colIndex += 1;
        }

        for (const { def, state } of pinnedGroups.left) {
          const leafColIndex = visibleColumns.findIndex(
            (c) => c.def.id === def.id,
          );
          const cell = this._createDataCell(
            row,
            def,
            state,
            stickyMeta.get(def.id),
            index - startIndex,
            colIndex,
            index,
            leafColIndex,
            visibleColumns,
            spannedCells,
            displayRows,
          );
          if (cell) rowElement.appendChild(cell);
          colIndex += 1;
        }

        if (centerSlice.leadingSpacer > 0) {
          rowElement.appendChild(this._createSpacer(centerSlice.leadingSpacer));
        }

        for (const { def, state } of centerSlice.columns) {
          const leafColIndex = visibleColumns.findIndex(
            (c) => c.def.id === def.id,
          );
          const cell = this._createDataCell(
            row,
            def,
            state,
            null,
            index - startIndex,
            colIndex,
            index,
            leafColIndex,
            visibleColumns,
            spannedCells,
            displayRows,
          );
          if (cell) rowElement.appendChild(cell);
          colIndex += 1;
        }

        if (centerSlice.trailingSpacer > 0) {
          rowElement.appendChild(
            this._createSpacer(centerSlice.trailingSpacer),
          );
        }

        for (const { def, state } of pinnedGroups.right) {
          const leafColIndex = visibleColumns.findIndex(
            (c) => c.def.id === def.id,
          );
          const cell = this._createDataCell(
            row,
            def,
            state,
            stickyMeta.get(def.id),
            index - startIndex,
            colIndex,
            index,
            leafColIndex,
            visibleColumns,
            spannedCells,
            displayRows,
          );
          if (cell) rowElement.appendChild(cell);
          colIndex += 1;
        }
      }

      container.appendChild(rowElement);
      this._options.hooks?.afterRowRender?.({
        row,
        rowElement,
        rowIndex: index,
      });

      if (this._viewModel.isVariableRowHeight()) {
        requestAnimationFrame(() => {
          const measuredHeight = Math.ceil(
            rowElement.getBoundingClientRect().height,
          );
          if (measuredHeight > 0) {
            this._options.onRowMeasured?.({
              row,
              flatIndex: index,
              height: measuredHeight,
            });
          }
        });
      }
    }

    const nextRows = Array.from(container.querySelectorAll(".ck-zenith-grid-row")).map(
      (element) => ({
        key: element.dataset.rowKey,
        top: element.offsetTop,
        element,
      }),
    );
    const addedRows = nextRows.filter((entry) => !previousByKey.has(entry.key));
    const removedRows = previousRows.filter(
      (entry) => entry.key && !nextRows.some((row) => row.key === entry.key),
    );
    const allowDecorativeAnimations = this._shouldRunDecorativeAnimations({
      addedCount: addedRows.length,
      removedCount: removedRows.length,
      now,
    });

    nextRows.forEach((entry) => {
      const previous = previousByKey.get(entry.key);
      if (!previous) {
        if (
          allowDecorativeAnimations &&
          typeof entry.element.animate === "function"
        ) {
          entry.element.animate(
            [
              { opacity: 0, transform: "translateX(18px)" },
              { opacity: 1, transform: "translateX(0)" },
            ],
            {
              duration: Math.min(
                this._options.getRowAnimationDuration?.() ?? 260,
                320,
              ),
              easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            },
          );
        }
        return;
      }

      const deltaY = previous.top - entry.top;
      if (deltaY === 0 || !allowDecorativeAnimations) {
        return;
      }

      if (typeof entry.element.animate === "function") {
        entry.element.animate(
          [
            { transform: `translateY(${deltaY}px)` },
            { transform: "translateY(0)" },
          ],
          {
            duration: 180,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          },
        );
      }
    });

    removedRows.forEach((entry) => {
      const ghost = entry.element.cloneNode(true);
      ghost.classList.add("ck-zenith-grid-row-exit-ghost");
      ghost.style.position = "absolute";
      ghost.style.left = "0";
      ghost.style.top = `${entry.top}px`;
      ghost.style.width = `${entry.width}px`;
      ghost.style.height = `${entry.height}px`;
      ghost.style.pointerEvents = "none";
      container.appendChild(ghost);

      if (allowDecorativeAnimations && typeof ghost.animate === "function") {
        const animation = ghost.animate(
          [
            { opacity: 1, transform: "translateX(0) scale(1)" },
            { opacity: 0, transform: "translateX(-22px) scale(0.98)" },
          ],
          {
            duration: 180,
            easing: "ease-out",
            fill: "forwards",
          },
        );
        animation.addEventListener("finish", () => ghost.remove(), {
          once: true,
        });
      } else {
        ghost.remove();
      }
    });

    if (focusToRestore?.rowKey != null && focusToRestore?.selectionCell) {
      const newCell = container.querySelector(
        `[data-row-key="${escapeAttrValue(focusToRestore.rowKey)}"] [data-grid-focusable="cell"].ck-zenith-grid-selection-cell`,
      );
      if (newCell instanceof HTMLElement) newCell.focus();
    } else if (focusToRestore?.rowKey != null && focusToRestore?.colId != null) {
      const newCell = container.querySelector(
        `[data-row-key="${escapeAttrValue(focusToRestore.rowKey)}"] [data-grid-focusable="cell"][data-col-id="${escapeAttrValue(focusToRestore.colId)}"]`,
      );
      if (newCell instanceof HTMLElement) newCell.focus();
    }

    this._lastRenderAt = now;
  }

  _createRowNumberCell(rowNumber, rowIndex) {
    const width = this._options.rowNumberWidth ?? 44;
    const cell = document.createElement("div");
    cell.className = "ck-zenith-grid-cell ck-zenith-grid-row-number-cell";
    cell.setAttribute("role", "rowheader");
    cell.style.width = `${width}px`;
    cell.style.minWidth = `${width}px`;
    cell.style.position = "sticky";
    cell.style.left = "0px";
    cell.style.zIndex = "2";
    cell.dataset.rowIndex = String(rowIndex);
    cell.textContent = String(rowNumber);
    return cell;
  }

  _createSelectionCell(row, rowIndex, colIndex) {
    const masterDetailActive = this._options.isMasterDetailEnabled
      ? this._options.isMasterDetailEnabled()
      : Boolean(this._options.onMasterDetailToggle);
    const hasMasterDetail = Boolean(
      masterDetailActive &&
      this._options.onMasterDetailToggle &&
      row._type !== "group-header" &&
      row._type !== "tree-loading" &&
      row._type !== "detail",
    );
    // selectionColumnWidth는 GridCore에서 master-detail 여부에 따라 이미 조정됨 (44 or 68)
    const width = this._options.selectionColumnWidth ?? 44;

    const cell = document.createElement("div");
    cell.className = "ck-zenith-grid-cell ck-zenith-grid-selection-cell ck-zenith-grid-cell-pinned";
    cell.setAttribute("role", "gridcell");
    cell.style.width = `${width}px`;
    cell.style.minWidth = `${width}px`;
    cell.style.left = "0px";
    cell.style.zIndex = "5";
    cell.setAttribute("aria-colindex", String(colIndex + 1));
    cell.dataset.gridFocusable = "cell";
    cell.dataset.rowIndex = String(rowIndex);
    cell.dataset.colIndex = String(colIndex);
    cell.tabIndex = 0;

    // Master-Detail 토글 버튼 (selection cell 안에 배치 → sticky 레이어 충돌 없음)
    if (hasMasterDetail) {
      const detailBtn = document.createElement("button");
      detailBtn.type = "button";
      detailBtn.className = "ck-zenith-grid-master-detail-toggle";
      detailBtn.setAttribute("aria-label", "Toggle row detail");
      detailBtn.setAttribute(
        "aria-expanded",
        String(Boolean(row._detailExpanded)),
      );
      detailBtn.appendChild(
        createSvgIcon(row._detailExpanded ? "chevronDown" : "chevronRight", 18),
      );
      detailBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        this._options.onMasterDetailToggle(row._rowKey);
      });
      cell.appendChild(detailBtn);
    }

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "ck-zenith-grid-selection-checkbox";
    checkbox.setAttribute("aria-label", `Select row ${row._rowKey}`);
    checkbox.checked =
      this._options.selectionManager?.isRowChecked?.(row) ?? false;
    checkbox.indeterminate =
      this._options.selectionManager?.isRowIndeterminate?.(row) ?? false;
    checkbox.disabled = this._options.isRowSelectable?.(row) === false;
    checkbox.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    checkbox.addEventListener("change", () => {
      this._options.onRowSelectionToggle?.({ row, checked: checkbox.checked });
    });

    cell.appendChild(checkbox);
    return cell;
  }

  _sliceColumnsByRange(columns, horizontalRange) {
    if (!columns.length) {
      return { columns: [], leadingSpacer: 0, trailingSpacer: 0 };
    }

    const start = Math.max(0, horizontalRange?.startColIndex ?? 0);
    const end = Math.min(
      columns.length - 1,
      horizontalRange?.endColIndex ?? columns.length - 1,
    );

    return {
      columns: columns.slice(start, end + 1),
      leadingSpacer: columns
        .slice(0, start)
        .reduce((sum, column) => sum + (column.state.width ?? 0), 0),
      trailingSpacer: columns
        .slice(end + 1)
        .reduce((sum, column) => sum + (column.state.width ?? 0), 0),
    };
  }

  _buildStickyMeta(groups) {
    const stickyMeta = new Map();
    const selectionOffset = (this._options.selectionEnabled && !this._options.isPivotEnabled?.())
      ? (this._options.selectionColumnWidth ?? 44)
      : 0;

    let leftOffset = selectionOffset;
    for (const { def, state } of groups.left) {
      stickyMeta.set(def.id, { left: leftOffset, zIndex: 4 });
      leftOffset += state.width ?? 0;
    }

    let rightOffset = 0;
    for (let index = groups.right.length - 1; index >= 0; index -= 1) {
      const { def, state } = groups.right[index];
      stickyMeta.set(def.id, { right: rightOffset, zIndex: 4 });
      rightOffset += state.width ?? 0;
    }

    return stickyMeta;
  }

  _createSpacer(width) {
    const spacer = document.createElement("div");
    spacer.className = "ck-zenith-grid-col-spacer";
    spacer.style.width = `${width}px`;
    spacer.style.minWidth = `${width}px`;
    return spacer;
  }

  _createGroupCell(row, totalWidth) {
    const cell = document.createElement("div");
    cell.className = "ck-zenith-grid-cell ck-zenith-grid-group-cell";
    cell.style.width = `${totalWidth}px`;
    cell.style.minWidth = `${totalWidth}px`;
    cell.style.paddingLeft = `${12 + (row._groupDepth ?? 0) * 18}px`;

    const badge = document.createElement("span");
    badge.className = "ck-zenith-grid-row-kind-badge ck-zenith-grid-row-kind-group";
    badge.textContent = this._getLocaleText("grid.badges.group", "GROUP");

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "ck-zenith-grid-row-toggle";
    toggle.appendChild(
      this._createIcon(row._isExpanded ? "chevronDown" : "chevronRight"),
    );
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      this._options.onGroupToggle?.({ groupKey: row._groupKey, row });
    });

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "ck-zenith-grid-selection-checkbox";
    checkbox.checked =
      this._options.selectionManager?.isRowChecked?.(row) ?? false;
    checkbox.indeterminate =
      this._options.selectionManager?.isRowIndeterminate?.(row) ?? false;
    checkbox.addEventListener("click", (event) => event.stopPropagation());
    checkbox.addEventListener("change", () => {
      this._options.onRowSelectionToggle?.({ row, checked: checkbox.checked });
    });

    const label = document.createElement("span");
    label.className = "ck-zenith-grid-group-label";
    label.textContent = `${row._groupField}: ${row._groupValue ?? "Empty"} (${row._childCount ?? 0})`;

    cell.appendChild(badge);
    cell.appendChild(checkbox);
    cell.appendChild(toggle);
    cell.appendChild(label);

    // 그룹 행 집계 표시
    if (row._aggregates && Object.keys(row._aggregates).length > 0) {
      const aggWrap = document.createElement("span");
      aggWrap.className = "ck-zenith-grid-group-aggregates";
      for (const [, { value, type }] of Object.entries(row._aggregates)) {
        const chip = document.createElement("span");
        chip.className = "ck-zenith-grid-group-agg-chip";
        const formatted =
          typeof value === "number"
            ? value % 1 !== 0
              ? value.toFixed(2)
              : value.toLocaleString()
            : value;
        chip.textContent = `${type.charAt(0).toUpperCase() + type.slice(1)}: ${formatted}`;
        aggWrap.appendChild(chip);
      }
      cell.appendChild(aggWrap);
    }

    return cell;
  }

  _createLoadingCell(totalWidth) {
    const cell = document.createElement("div");
    cell.className = "ck-zenith-grid-cell ck-zenith-grid-loading-cell";
    cell.style.width = `${totalWidth}px`;
    cell.style.minWidth = `${totalWidth}px`;
    cell.textContent = this._getLocaleText(
      "grid.loading.childRows",
      "Loading child rows...",
    );
    return cell;
  }

  _createDataCell(
    row,
    def,
    state,
    stickyStyle = null,
    rowIndex = 0,
    colIndex = 0,
    absoluteRowIndex = 0,
    leafColIndex = 0,
    allVisibleCols = [],
    spannedCells = null,
    displayRows = [],
  ) {
    // 1. 셀 병합(Spanning) 여부 체크하여 생략 처리
    if (spannedCells) {
      const cellKey = `${absoluteRowIndex}::${def.id}`;
      if (spannedCells.has(cellKey)) {
        return null;
      }
    }

    const cell = document.createElement("div");
    cell.className = "ck-zenith-grid-cell";
    cell.dataset.colId = def.id;
    cell.dataset.gridFocusable = "cell";
    cell.dataset.rowIndex = String(rowIndex);
    cell.dataset.colIndex = String(colIndex);
    cell.setAttribute("role", "gridcell");
    cell.setAttribute("aria-colindex", String(colIndex + 1));
    cell.tabIndex = 0;
    cell.style.textAlign = def.align ?? "left";

    // 2. rowSpan / colSpan 계산 및 spannedCells 캐시 갱신
    const value = row[def.field];

    let rowSpan = 1;
    if (typeof def.rowSpan === "function") {
      rowSpan = def.rowSpan({ row, def, value });
    } else if (def.rowSpan) {
      rowSpan = def.rowSpan;
    }

    let colSpan = 1;
    if (typeof def.colSpan === "function") {
      colSpan = def.colSpan({ row, def, value });
    } else if (def.colSpan) {
      colSpan = def.colSpan;
    }

    if (spannedCells && (rowSpan > 1 || colSpan > 1)) {
      for (let r = 0; r < rowSpan; r++) {
        for (let c = 0; c < colSpan; c++) {
          if (r === 0 && c === 0) continue;
          const targetCol = allVisibleCols[leafColIndex + c];
          if (targetCol) {
            spannedCells.add(`${absoluteRowIndex + r}::${targetCol.def.id}`);
          }
        }
      }
    }

    // 3. colSpan 크기 계산
    let cellWidth = state.width;
    if (colSpan > 1) {
      for (let c = 1; c < colSpan; c++) {
        const nextCol = allVisibleCols[leafColIndex + c];
        if (nextCol) {
          cellWidth += nextCol.state.width ?? 0;
        }
      }
    }
    cell.style.width = `${cellWidth}px`;
    cell.style.minWidth = `${cellWidth}px`;

    // 4. rowSpan 크기 계산
    const rowHeight = this._viewModel.getRowHeight();
    let cellHeight = rowHeight;
    if (rowSpan > 1) {
      if (this._viewModel.isVariableRowHeight()) {
        cellHeight = 0;
        for (let r = 0; r < rowSpan; r++) {
          const targetRow = displayRows[absoluteRowIndex + r];
          cellHeight +=
            this._options.getRowHeight?.(targetRow) ??
            targetRow?._rowHeight ??
            rowHeight;
        }
      } else {
        cellHeight = rowHeight * rowSpan;
      }
      cell.style.height = `${cellHeight}px`;
      cell.style.minHeight = `${cellHeight}px`;
      cell.style.zIndex = "2";
    }

    if (stickyStyle) {
      cell.classList.add("ck-zenith-grid-cell-pinned");
      if (stickyStyle.left != null) cell.style.left = `${stickyStyle.left}px`;
      if (stickyStyle.right != null)
        cell.style.right = `${stickyStyle.right}px`;
      cell.style.zIndex = String(stickyStyle.zIndex + (rowSpan > 1 ? 1 : 0));
    }

    // 5. 로우 드래그 핸들 추가 (def.rowDrag가 true인 경우)
    if (
      def.rowDrag &&
      row._type !== "group-header" &&
      row._type !== "tree-loading"
    ) {
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "ck-zenith-grid-row-drag-handle";
      handle.draggable = true;
      handle.style.cursor = "grab";
      handle.style.marginRight = "8px";
      handle.style.display = "inline-flex";
      handle.style.alignItems = "center";
      handle.style.border = "none";
      handle.style.background = "none";
      handle.style.padding = "0";
      handle.style.color = "var(--ck-zenith-grid-text-muted, #64748b)";
      handle.appendChild(createSvgIcon("dragVertical", 14));

      handle.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData("text/plain", row._rowKey);
        const rowEl = handle.closest(".ck-zenith-grid-row");
        rowEl?.classList.add("ck-zenith-grid-row-dragging");
        this._options.onRowDragStart?.({ rowKey: row._rowKey });
      });

      handle.addEventListener("dragend", () => {
        const rowEl = handle.closest(".ck-zenith-grid-row");
        rowEl?.classList.remove("ck-zenith-grid-row-dragging");
        const container = handle.closest(".ck-zenith-grid-rows-container");
        container
          ?.querySelectorAll(".ck-zenith-grid-row-drag-over")
          .forEach((el) => el.classList.remove("ck-zenith-grid-row-drag-over"));
        this._options.onRowDragEnd?.();
      });

      cell.appendChild(handle);
    }

    // 조건부 서식 (Conditional Formatting)
    if (typeof def.conditionalFormat === "function") {
      const fmt = def.conditionalFormat(value, row);
      if (fmt) {
        if (fmt.class) {
          const classes = Array.isArray(fmt.class) ? fmt.class : [fmt.class];
          classes.forEach((cls) => cls && cell.classList.add(cls));
        }
        if (fmt.style && typeof fmt.style === "object") {
          Object.entries(fmt.style).forEach(([prop, val]) => {
            if (val != null) cell.style[prop] = String(val);
          });
        }
      }
    }

    const validationError = this._options.getCellValidationError?.(
      row._rowKey,
      def.id,
    );
    if (validationError) {
      cell.classList.add("ck-zenith-grid-cell-invalid");
      cell.setAttribute("aria-invalid", "true");
      cell.title = String(validationError);
    }

    // 셀 툴팁 (Cell Tooltip)
    if (!validationError) {
      if (typeof def.tooltipComponent === "function") {
        // 리치 툴팁: 커스텀 HTML 팝업
        let tooltipEl = null;
        let showTimer = null;
        cell.addEventListener("mouseenter", () => {
          showTimer = setTimeout(() => {
            tooltipEl = document.createElement("div");
            tooltipEl.className = "ck-zenith-grid-rich-tooltip";
            const content = def.tooltipComponent({ value, row, def });
            if (content instanceof HTMLElement) {
              tooltipEl.appendChild(content);
            } else if (content != null) {
              tooltipEl.innerHTML = String(content);
            } else {
              return;
            }
            document.body.appendChild(tooltipEl);
            const rect = cell.getBoundingClientRect();
            tooltipEl.style.left = `${rect.left + window.scrollX}px`;
            tooltipEl.style.top = `${rect.bottom + window.scrollY + 4}px`;
          }, 400);
        });
        cell.addEventListener("mouseleave", () => {
          clearTimeout(showTimer);
          tooltipEl?.remove();
          tooltipEl = null;
        });
      } else if (typeof def.tooltip === "function") {
        const tip = def.tooltip(value, row);
        if (tip != null) cell.title = String(tip);
      } else if (def.tooltip === true) {
        cell.title = value == null ? "" : String(value);
      } else if (typeof def.tooltip === "string") {
        cell.title = def.tooltip;
      }
    }

    // 범위 선택 하이라이트
    const rangeManager = this._options.getRangeSelectionManager?.();
    if (rangeManager?.hasRange()) {
      const allLeafCols = this._options.getAllLeafColumnDefs?.() ?? [];
      if (
        rangeManager.isInRange(
          row._rowKey,
          def.id,
          this._currentRows,
          allLeafCols,
        )
      ) {
        cell.classList.add("ck-zenith-grid-cell-range-selected");
      }
    }

    if (this._viewModel.isVariableRowHeight()) {
      cell.classList.add("ck-zenith-grid-cell-variable");
    }

    if (row._type === "tree-node" && def._isFirstColumn) {
      cell.style.paddingLeft = `${12 + (row._depth ?? 0) * 18}px`;

      const badge = document.createElement("span");
      badge.className = "ck-zenith-grid-row-kind-badge ck-zenith-grid-row-kind-tree";
      badge.textContent = this._getLocaleText("grid.badges.tree", "TREE");
      cell.appendChild(badge);

      if (row._hasChildren) {
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "ck-zenith-grid-row-toggle";
        toggle.appendChild(
          this._createIcon(row._isExpanded ? "chevronDown" : "chevronRight"),
        );
        toggle.addEventListener("click", (event) => {
          event.stopPropagation();
          this._options.onTreeToggle?.({ rowKey: row._rowKey, row });
        });
        cell.appendChild(toggle);
      } else {
        const spacer = document.createElement("span");
        spacer.className = "ck-zenith-grid-row-toggle ck-zenith-grid-row-toggle-spacer";
        if (this._options.isTreeLeafSpacerVisible?.()) {
          spacer.classList.add("ck-zenith-grid-row-toggle-spacer-visible");
        }
        cell.appendChild(spacer);
      }
    }

    const renderedValue = def.formatter ? def.formatter(value, row) : value;
    this._options.hooks?.beforeCellRender?.({ row, def, state, cell, value });

    if (def.renderer) {
      const rendered = def.renderer({ value, row, def, state });
      if (rendered instanceof HTMLElement) {
        cell.appendChild(rendered);
      } else if (rendered != null) {
        const text = document.createElement("span");
        text.className = "ck-zenith-grid-cell-text";
        text.textContent = String(rendered);
        cell.appendChild(text);
      }
    } else {
      const text = document.createElement("span");
      text.className = "ck-zenith-grid-cell-text";
      text.textContent = renderedValue == null ? "" : String(renderedValue);
      cell.appendChild(text);
    }

    cell.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      const rm = this._options.getRangeSelectionManager?.();
      if (rm) {
        rm.startRange(row._rowKey, def.id);
        // stopPropagation 제거: 행 클릭 이벤트도 정상 처리
      }
    });
    cell.addEventListener("mouseenter", () => {
      const rm = this._options.getRangeSelectionManager?.();
      if (rm?._isSelecting) {
        rm.extendRange(row._rowKey, def.id);
      }
    });

    cell.addEventListener("click", (event) => {
      event.stopPropagation();
      this._options.onCellClick?.({ row, colId: def.id, value, event });
    });
    cell.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      this._options.onCellDoubleClick?.({
        row,
        colId: def.id,
        value,
        cell,
        event,
      });
    });
    cell.addEventListener("contextmenu", (event) => {
      event.stopPropagation();
      this._options.onCellContextMenu?.({ row, colId: def.id, value, event });
    });

    this._options.hooks?.afterCellRender?.({ row, def, state, cell, value });

    // 채우기 핸들 (편집 가능한 셀에만)
    if (this._options.fillHandle && def.editable !== false) {
      const handle = document.createElement("div");
      handle.className = "ck-zenith-grid-fill-handle";
      handle.addEventListener("mousedown", (event) => {
        event.stopPropagation();
        event.preventDefault();
        this._options.onFillHandleStart?.({ row, def, value, cell });
      });
      cell.appendChild(handle);
    }

    return cell;
  }

  _createIcon(type) {
    return createSvgIcon(type, 18);
  }

  renderPinnedRows(rows, position) {
    const container =
      position === "top"
        ? this._dom.getPinnedTopRowsContainer?.()
        : this._dom.getPinnedBottomRowsContainer?.();
    if (!container) return;

    if (!rows || rows.length === 0) {
      container.style.display = "none";
      container.innerHTML = "";
      return;
    }

    container.style.display = "block";
    container.innerHTML = "";

    const rowHeight = this._viewModel.getRowHeight();
    const visibleColumns = this._columnModel.getVisibleLeafColumns();
    const pinnedGroups = this._columnModel.getColumnsByPin();
    const stickyMeta = this._buildStickyMeta(pinnedGroups);
    const totalWidth = visibleColumns.reduce(
      (sum, col) => sum + (col.state.width ?? 0),
      0,
    );

    rows.forEach((row, index) => {
      const rowEl = document.createElement("div");
      rowEl.className = `ck-zenith-grid-row ck-zenith-grid-pinned-row ck-zenith-grid-pinned-row-${position}`;
      rowEl.dataset.rowKey = row._rowKey ?? `pinned-${position}-${index}`;
      rowEl.style.height = `${rowHeight}px`;
      rowEl.setAttribute("role", "row");

      if (row._type === "aggregate") {
        rowEl.classList.add("ck-zenith-grid-row-aggregate");
      }

      let colIndex = 0;
      if (this._options.selectionEnabled && !this._options.isPivotEnabled?.()) {
        const sel = document.createElement("div");
        sel.className = "ck-zenith-grid-cell ck-zenith-grid-cell-pinned";
        sel.style.width = `${this._options.selectionColumnWidth ?? 44}px`;
        sel.style.minWidth = `${this._options.selectionColumnWidth ?? 44}px`;
        rowEl.appendChild(sel);
        colIndex += 1;
      }

      for (const { def, state } of [
        ...pinnedGroups.left,
        ...pinnedGroups.center,
        ...pinnedGroups.right,
      ]) {
        const cell = this._createDataCell(
          row,
          def,
          state,
          stickyMeta.get(def.id),
          index,
          colIndex,
          index,
          0,
          visibleColumns,
          null,
          rows,
        );
        if (cell) rowEl.appendChild(cell);
        colIndex += 1;
      }

      container.appendChild(rowEl);
    });

    // 컨테이너 너비를 헤더와 맞춤
    container.style.minWidth = `${totalWidth}px`;
  }

  /**
   * 범위 선택 하이라이트를 CSS 클래스 토글로만 업데이트 (전체 재렌더 없음)
   */
  updateRangeHighlight(rangeManager, allLeafCols) {
    const container = this._dom.getRowsContainer();
    if (!container) return;

    // 기존 하이라이트 제거
    container.querySelectorAll(".ck-zenith-grid-cell-range-selected").forEach((el) => {
      el.classList.remove("ck-zenith-grid-cell-range-selected");
    });

    if (!rangeManager?.hasRange()) return;

    container.querySelectorAll(".ck-zenith-grid-cell[data-col-id]").forEach((cell) => {
      const rowEl = cell.closest(".ck-zenith-grid-row");
      const rowKey = rowEl?.dataset.rowKey;
      const colId = cell.dataset.colId;
      if (
        rowKey &&
        colId &&
        rangeManager.isInRange(rowKey, colId, this._currentRows, allLeafCols)
      ) {
        cell.classList.add("ck-zenith-grid-cell-range-selected");
      }
    });
  }

  clear() {
    const container = this._dom.getRowsContainer();
    if (container) container.innerHTML = "";
    this._currentRows = [];
  }

  destroy() {
    this.clear();
  }

  _getLocaleText(key, fallback, params = {}) {
    const getter = this._options.getLocaleText;
    if (typeof getter !== "function") {
      return fallback;
    }
    return getter(key, fallback, params);
  }

  _applyClassNames(element, value) {
    if (!value) {
      return;
    }

    const classNames = Array.isArray(value)
      ? value
      : String(value).split(/\s+/);
    classNames
      .map((name) => String(name).trim())
      .filter(Boolean)
      .forEach((name) => element.classList.add(name));
  }

  _applyInlineStyles(element, styles) {
    if (!styles || typeof styles !== "object") {
      return;
    }

    Object.entries(styles).forEach(([property, value]) => {
      if (value == null) {
        return;
      }
      element.style[property] = String(value);
    });
  }

  _shouldRunDecorativeAnimations({ addedCount, removedCount, now }) {
    const changedCount = addedCount + removedCount;
    const renderGap = now - this._lastRenderAt;

    if (changedCount === 0) {
      return renderGap > 90;
    }

    if (changedCount > 6) {
      return false;
    }

    return renderGap > 140;
  }
}
