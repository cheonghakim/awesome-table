import { createSvgIcon } from './IconFactory.js';

export class SettingsPanelRenderer {
  constructor(domRenderer, core, options = {}) {
    this._dom = domRenderer;
    this._core = core;
    this._options = options;
    this._activeTab = options.defaultTab ?? 'columns';
    this._open = options.defaultOpen ?? false;
    this._host = null;
    this._shell = null;
    this._draggingRangeColId = null;

    // Initialize composition state
    this._isComposing = false;
    this._quickFilterTimer = null;

    // Operator picked in the filter panel before a value is entered.
    // setColumnFilter() drops the filter entry while value is empty, so the
    // operator can't be read back from _core state until a value exists —
    // this map is what keeps the <select> showing the user's pick instead of
    // reverting to the column's default operator on the next render().
    this._pendingFilterOperator = new Map();
  }

  mount() {
    // Don't mount if explicitly disabled
    if (this._options.enabled === false) {
      return;
    }

    this._host = this._dom.getSidePanelHost();
    if (!this._host) {
      return;
    }

    this._dom.getRoot()?.classList.add('ck-zenith-grid-has-side-panel');
    this._shell = document.createElement('div');
    this._shell.className = 'ck-zenith-grid-side-panel';
    this._host.appendChild(this._shell);
    this.render();
  }

  render() {
    if (!this._shell) {
      return;
    }

    // Avoid rebuilding the DOM while the width slider is being dragged —
    // recreating the <input type="range"> mid-drag breaks native mouse capture.
    if (this._draggingRangeColId) {
      return;
    }

    // CRITICAL: Don't render while user is composing Korean/Chinese/Japanese
    // Rendering mid-composition breaks IME input and loses characters
    if (this._isComposing) {
      return;
    }

    // Save focus state before re-rendering
    const activeElement = document.activeElement;
    const isFocusInPanel = this._shell.contains(activeElement);

    // Store the CURRENT input value (what user actually typed)
    const focusedInputValue = (isFocusInPanel && activeElement?.tagName === 'INPUT')
      ? activeElement.value
      : null;
    const focusedInputType = (isFocusInPanel && activeElement?.tagName === 'INPUT')
      ? activeElement.type
      : null;
    const cursorPosition = (isFocusInPanel && activeElement?.tagName === 'INPUT')
      ? activeElement.selectionStart
      : null;

    this._shell.innerHTML = '';
    this._shell.dataset.open = this._open ? 'true' : 'false';
    this._dom.getRoot()?.classList.toggle('ck-zenith-grid-side-panel-open', this._open);

    const rail = document.createElement('div');
    rail.className = 'ck-zenith-grid-side-panel-rail';

    const tabs = [
      { id: 'columns', label: this._t('sidePanel.tabs.columns', 'Columns') },
      { id: 'filters', label: this._t('sidePanel.tabs.filters', 'Filters') },
      { id: 'view', label: this._t('sidePanel.tabs.view', 'View') },
    ];

    // Only show plugins tab if there are available plugins
    const availablePlugins = this._core._availablePlugins ?? [];
    if (availablePlugins.length > 0) {
      tabs.splice(2, 0, { id: 'plugins', label: this._t('sidePanel.tabs.plugins', 'Plugins') });
    }

    tabs.forEach((tab) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ck-zenith-grid-side-panel-tab';
      button.dataset.active = this._open && this._activeTab === tab.id ? 'true' : 'false';
      button.textContent = tab.label;
      button.addEventListener('click', () => {
        if (this._open && this._activeTab === tab.id) {
          this._open = false;
        } else {
          this._open = true;
          this._activeTab = tab.id;
        }
        this.render();
      });
      rail.appendChild(button);
    });

    const card = document.createElement('aside');
    card.className = 'ck-zenith-grid-side-panel-card';

    const header = document.createElement('div');
    header.className = 'ck-zenith-grid-side-panel-header';

    const title = document.createElement('h3');
    title.textContent = tabs.find((tab) => tab.id === this._activeTab)?.label ?? 'Settings';

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'ck-zenith-grid-side-panel-close';
    closeButton.textContent = this._t('sidePanel.close', 'Close');
    closeButton.addEventListener('click', () => {
      this._open = false;
      this.render();
    });

    header.appendChild(title);
    header.appendChild(closeButton);
    card.appendChild(header);

    const body = document.createElement('div');
    body.className = 'ck-zenith-grid-side-panel-body';

    if (this._activeTab === 'columns') {
      body.appendChild(this._renderColumnsSection());
    } else if (this._activeTab === 'filters') {
      body.appendChild(this._renderFiltersSection());
    } else if (this._activeTab === 'plugins') {
      body.appendChild(this._renderPluginsSection());
    } else {
      body.appendChild(this._renderViewSection());
    }

    card.appendChild(body);
    this._shell.appendChild(rail);
    this._shell.appendChild(card);

    // Restore focus to the same input if it was focused before
    if (isFocusInPanel && focusedInputType === 'search' && focusedInputValue !== null) {
      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        const searchInput = this._shell.querySelector('input[type="search"]');
        if (searchInput) {
          // CRITICAL: Preserve the user's actual input, don't overwrite!
          // Only set value if it's different (to preserve what user typed)
          if (searchInput.value !== focusedInputValue) {
            searchInput.value = focusedInputValue;
          }

          searchInput.focus();

          // Restore cursor position (use saved position or end of text)
          const pos = cursorPosition ?? focusedInputValue.length;
          searchInput.setSelectionRange(pos, pos);
        }
      });
    }
  }

  _renderColumnsSection() {
    const section = document.createElement('div');
    section.className = 'ck-zenith-grid-side-panel-section';

    const columns = this._core.getAllLeafColumns();
    columns.forEach((column) => {
      const row = document.createElement('div');
      row.className = 'ck-zenith-grid-side-panel-row';
      row.dataset.colId = column.def.id;

      // Only make the drag handle draggable, not the entire row
      let isDraggable = false;

      row.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('text/plain', column.def.id);
        row.classList.add('ck-zenith-grid-side-panel-row-dragging');
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('ck-zenith-grid-side-panel-row-dragging');
        section.querySelectorAll('.ck-zenith-grid-side-panel-row').forEach((r) => r.classList.remove('ck-zenith-grid-side-panel-row-drag-over'));
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        section.querySelectorAll('.ck-zenith-grid-side-panel-row').forEach((r) => r.classList.remove('ck-zenith-grid-side-panel-row-drag-over'));
        row.classList.add('ck-zenith-grid-side-panel-row-drag-over');
      });
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('ck-zenith-grid-side-panel-row-drag-over');
        const fromColId = e.dataTransfer?.getData('text/plain');
        const toColId = column.def.id;
        if (fromColId && fromColId !== toColId) {
          const allCols = this._core.getAllLeafColumns();
          const toIndex = allCols.findIndex((c) => c.def.id === toColId);
          if (toIndex !== -1) this._core.moveColumn(fromColId, toIndex);
        }
      });

      const top = document.createElement('div');
      top.className = 'ck-zenith-grid-side-panel-row-top';

      const dragHandle = document.createElement('span');
      dragHandle.className = 'ck-zenith-grid-side-panel-drag-handle';
      dragHandle.setAttribute('aria-hidden', 'true');
      dragHandle.appendChild(createSvgIcon('dragVertical', 14));

      // Enable drag only when mouse is on drag handle
      dragHandle.addEventListener('mouseenter', () => {
        row.draggable = true;
      });
      dragHandle.addEventListener('mouseleave', () => {
        row.draggable = false;
      });

      top.appendChild(dragHandle);

      const label = document.createElement('label');
      label.className = 'ck-zenith-grid-side-panel-checkbox';

      const visible = document.createElement('input');
      visible.type = 'checkbox';
      visible.checked = column.state.visible !== false;
      visible.addEventListener('change', () => {
        this._core.setColumnVisible(column.def.id, visible.checked);
      });

      const text = document.createElement('span');
      text.textContent = column.def.headerName;

      label.appendChild(visible);
      label.appendChild(text);

      const pinSelect = document.createElement('select');
      pinSelect.className = 'ck-zenith-grid-side-panel-select';
      ['none', 'left', 'right'].forEach((value) => {
        const option = document.createElement('option');
        option.value = value === 'none' ? '' : value;
        option.textContent = value === 'none'
          ? this._t('sidePanel.noPin', 'No Pin')
          : value === 'left'
            ? this._t('sidePanel.pinLeft', 'Pin left')
            : this._t('sidePanel.pinRight', 'Pin right');
        if ((column.state.pinned ?? '') === option.value) {
          option.selected = true;
        }
        pinSelect.appendChild(option);
      });
      pinSelect.addEventListener('change', () => {
        this._core.setColumnPinned(column.def.id, pinSelect.value || null);
      });

      top.appendChild(label);
      top.appendChild(pinSelect);

      const rangeWrap = document.createElement('div');
      rangeWrap.className = 'ck-zenith-grid-side-panel-range-wrap';
      rangeWrap.draggable = false; // Prevent drag on wrapper

      const range = document.createElement('input');
      range.type = 'range';
      range.min = String(column.def.minWidth ?? 50);
      range.max = String(Number.isFinite(column.def.maxWidth) ? column.def.maxWidth : 480);
      range.step = '10';
      range.value = String(column.state.width ?? 150);
      range.draggable = false; // Explicitly disable dragging

      // Prevent all drag events from bubbling
      range.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        // Suppress full panel re-render while dragging so the slider
        // element isn't torn down mid-gesture (which breaks mouse capture).
        this._draggingRangeColId = column.def.id;
      });

      range.addEventListener('dragstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        return false;
      });

      range.addEventListener('touchstart', (e) => {
        e.stopPropagation();
        this._draggingRangeColId = column.def.id;
      }, { passive: true });

      const stopDragging = () => {
        if (this._draggingRangeColId === column.def.id) {
          this._draggingRangeColId = null;
          this.render();
        }
      };
      range.addEventListener('change', stopDragging);
      range.addEventListener('touchend', stopDragging);

      range.addEventListener('input', () => {
        this._core.setColumnWidth(column.def.id, Number(range.value));
        // Update displayed value
        widthValue.textContent = `${range.value}px`;
      });

      const widthValue = document.createElement('span');
      widthValue.className = 'ck-zenith-grid-side-panel-range-value';
      widthValue.textContent = `${column.state.width ?? 150}px`;

      rangeWrap.appendChild(range);
      rangeWrap.appendChild(widthValue);

      row.appendChild(top);
      row.appendChild(rangeWrap);
      section.appendChild(row);
    });

    return section;
  }

  _renderFiltersSection() {
    const section = document.createElement('div');
    section.className = 'ck-zenith-grid-side-panel-section';

    const state = this._core.getFilterState();

    const quickWrap = document.createElement('div');
    quickWrap.className = 'ck-zenith-grid-side-panel-block';

    const quickLabel = document.createElement('label');
    quickLabel.className = 'ck-zenith-grid-side-panel-field';

    const quickText = document.createElement('span');
    quickText.textContent = this._t('sidePanel.quickFilter', 'Quick Filter');

    const quickInput = document.createElement('input');
    quickInput.type = 'search';
    quickInput.placeholder = this._t('sidePanel.quickFilterPlaceholder', 'Search visible data...');

    // IMPORTANT: Use the user's current input value if available, not the state
    // This prevents overwriting what the user is actively typing
    const activeElement = document.activeElement;
    const isSearchFocused = activeElement?.type === 'search' && activeElement?.placeholder === quickInput.placeholder;
    quickInput.value = isSearchFocused ? activeElement.value : (state.quickFilter ?? '');

    quickInput.addEventListener('compositionstart', () => {
      this._isComposing = true;
    });

    quickInput.addEventListener('compositionend', (e) => {
      // Keep _isComposing = true for a short delay to protect against
      // rapid consecutive typing (e.g., "싸" + "이" + "버" + "거")
      // Without this delay, render() can be called between compositions,
      // causing the next character to be lost
      setTimeout(() => {
        this._isComposing = false;
      }, 50);

      // Apply filter with slight delay to allow consecutive typing
      clearTimeout(this._quickFilterTimer);
      this._quickFilterTimer = setTimeout(() => {
        this._core.setQuickFilter(e.target.value, this._options.quickFilterFields ?? []);
      }, 150);
    });

    quickInput.addEventListener('input', (e) => {
      // Skip if composing (Korean/Chinese/Japanese input in progress)
      if (this._isComposing) return;

      // For non-IME input (English, numbers), use debounce
      clearTimeout(this._quickFilterTimer);
      this._quickFilterTimer = setTimeout(() => {
        this._core.setQuickFilter(e.target.value, this._options.quickFilterFields ?? []);
      }, 300);
    });

    quickLabel.appendChild(quickText);
    quickLabel.appendChild(quickInput);
    quickWrap.appendChild(quickLabel);
    section.appendChild(quickWrap);

    const visibleColumns = this._core.getVisibleLeafColumns().filter((column) => column.def.filterable !== false);
    visibleColumns.forEach((column) => {
      section.appendChild(this._renderColumnFilterField(column, state.columnFilters?.[column.def.id] ?? null));
    });

    // 고급 필터 빌더 UI
    if (typeof this._core.setAdvancedFilter === 'function') {
      const advSection = document.createElement('div');
      advSection.className = 'ck-zenith-grid-side-panel-block ck-zenith-grid-advanced-filter-section';

      const advTitle = document.createElement('div');
      advTitle.className = 'ck-zenith-grid-side-panel-subtitle';
      advTitle.textContent = this._t('sidePanel.advancedFilter', 'Advanced Filter');
      advSection.appendChild(advTitle);

      const addConditionBtn = document.createElement('button');
      addConditionBtn.type = 'button';
      addConditionBtn.className = 'ck-zenith-grid-side-panel-action';
      addConditionBtn.textContent = this._t('sidePanel.addCondition', '+ Add Condition');
      addConditionBtn.addEventListener('click', () => this._openAdvancedFilterBuilder());
      advSection.appendChild(addConditionBtn);

      const advState = this._core._advancedFilterManager?.getState?.();
      if (advState?.filter) {
        const badge = document.createElement('span');
        badge.className = 'ck-zenith-grid-advanced-filter-badge';
        badge.textContent = this._t('sidePanel.advancedFilterActive', 'Advanced filter active');
        advSection.appendChild(badge);

        const clearAdv = document.createElement('button');
        clearAdv.type = 'button';
        clearAdv.className = 'ck-zenith-grid-side-panel-action ck-zenith-grid-side-panel-action-danger';
        clearAdv.textContent = this._t('sidePanel.clearAdvancedFilter', 'Clear Advanced Filter');
        clearAdv.addEventListener('click', () => {
          this._core.clearAdvancedFilter();
          this.render();
        });
        advSection.appendChild(clearAdv);
      }

      section.appendChild(advSection);
    }

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className = 'ck-zenith-grid-side-panel-action';
    clearButton.textContent = this._t('sidePanel.clearAllFilters', 'Clear All Filters');
    clearButton.addEventListener('click', () => {
      this._core.clearFilters();
      this._core.clearAdvancedFilter?.();
      this.render();
    });
    section.appendChild(clearButton);

    return section;
  }

  _openAdvancedFilterBuilder() {
    const existing = document.querySelector('.ck-zenith-grid-advanced-filter-dialog');
    if (existing) { existing.remove(); return; }

    const columns = this._core.getVisibleLeafColumns().filter((c) => c.def.filterable !== false);
    const dialog = document.createElement('div');
    dialog.className = 'ck-zenith-grid-advanced-filter-dialog';

    const title = document.createElement('div');
    title.className = 'ck-zenith-grid-advanced-filter-dialog-title';
    title.textContent = this._t('sidePanel.advancedFilter', 'Advanced Filter');
    dialog.appendChild(title);

    // 조건 목록
    const conditionsList = document.createElement('div');
    conditionsList.className = 'ck-zenith-grid-advanced-filter-conditions';
    dialog.appendChild(conditionsList);

    const conditions = [];

    const addCondition = () => {
      const cond = { field: columns[0]?.def.field ?? '', operator: 'contains', value: '', filterType: 'text' };
      conditions.push(cond);
      const row = document.createElement('div');
      row.className = 'ck-zenith-grid-advanced-filter-row';

      if (conditions.length > 1) {
        const logicSel = document.createElement('select');
        logicSel.className = 'ck-zenith-grid-header-filter-select';
        ['AND', 'OR'].forEach((v) => {
          const o = document.createElement('option');
          o.value = v; o.textContent = v;
          logicSel.appendChild(o);
        });
        logicSel.dataset.logic = 'true';
        row.appendChild(logicSel);
      }

      const fieldSel = document.createElement('select');
      fieldSel.className = 'ck-zenith-grid-header-filter-select';
      columns.forEach((col) => {
        const o = document.createElement('option');
        o.value = col.def.field; o.textContent = col.def.headerName ?? col.def.header ?? col.def.id;
        fieldSel.appendChild(o);
      });
      fieldSel.addEventListener('change', () => { cond.field = fieldSel.value; });

      const opSel = document.createElement('select');
      opSel.className = 'ck-zenith-grid-header-filter-select';
      ['contains', 'notContains', 'equals', 'notEquals', 'startsWith', 'endsWith', 'empty', 'notEmpty'].forEach((op) => {
        const o = document.createElement('option');
        o.value = op; o.textContent = op;
        opSel.appendChild(o);
      });
      opSel.addEventListener('change', () => {
        cond.operator = opSel.value;
        valueInput.style.display = ['empty', 'notEmpty'].includes(opSel.value) ? 'none' : '';
      });

      const valueInput = document.createElement('input');
      valueInput.type = 'text';
      valueInput.className = 'ck-zenith-grid-header-filter-input';
      valueInput.placeholder = this._t('sidePanel.filterValue', 'Value...');
      valueInput.addEventListener('input', () => { cond.value = valueInput.value; });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'ck-zenith-grid-advanced-filter-remove';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        const idx = conditions.indexOf(cond);
        if (idx >= 0) conditions.splice(idx, 1);
        row.remove();
      });

      row.appendChild(fieldSel);
      row.appendChild(opSel);
      row.appendChild(valueInput);
      row.appendChild(removeBtn);
      conditionsList.appendChild(row);
    };

    addCondition();

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'ck-zenith-grid-side-panel-action';
    addBtn.textContent = this._t('sidePanel.addCondition', '+ Add Condition');
    addBtn.addEventListener('click', addCondition);

    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'ck-zenith-grid-side-panel-action ck-zenith-grid-side-panel-action-primary';
    applyBtn.textContent = this._t('sidePanel.applyFilter', 'Apply');
    applyBtn.addEventListener('click', () => {
      if (conditions.length === 0) return;
      const logicEls = conditionsList.querySelectorAll('[data-logic]');
      const logics = [...logicEls].map((el) => el.value);
      let tree;
      if (conditions.length === 1) {
        tree = { ...conditions[0] };
      } else {
        const logic = logics[0] ?? 'AND';
        tree = { type: logic, conditions: conditions.map((c) => ({ ...c })) };
      }
      this._core.setAdvancedFilter(tree);
      dialog.remove();
      this.render();
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'ck-zenith-grid-side-panel-action';
    cancelBtn.textContent = this._t('sidePanel.cancel', 'Cancel');
    cancelBtn.addEventListener('click', () => dialog.remove());

    const btnRow = document.createElement('div');
    btnRow.className = 'ck-zenith-grid-advanced-filter-actions';
    btnRow.appendChild(addBtn);
    btnRow.appendChild(applyBtn);
    btnRow.appendChild(cancelBtn);
    dialog.appendChild(btnRow);

    document.body.appendChild(dialog);

    // 외부 클릭 시 닫기
    setTimeout(() => {
      const dismiss = (e) => {
        if (!dialog.contains(e.target)) { dialog.remove(); document.removeEventListener('pointerdown', dismiss, true); }
      };
      document.addEventListener('pointerdown', dismiss, true);
    }, 0);
  }

  _renderColumnFilterField(column, filter) {
    const field = document.createElement('div');
    field.className = 'ck-zenith-grid-side-panel-field';

    const label = document.createElement('span');
    label.textContent = column.def.headerName;
    field.appendChild(label);

    const meta = this._resolveFilterMeta(column);
    const currentOperator = filter?.operator ?? this._pendingFilterOperator.get(column.def.id) ?? meta.defaultOperator;
    const currentValue = filter?.value ?? (currentOperator === 'between' ? ['', ''] : meta.type === 'select' ? [] : '');

    if (meta.type !== 'select') {
      const operatorSelect = document.createElement('select');
      operatorSelect.className = 'ck-zenith-grid-side-panel-select';
      meta.operators.forEach((operator) => {
        const option = document.createElement('option');
        option.value = operator;
        option.textContent = this._getOperatorLabel(operator);
        option.selected = operator === currentOperator;
        operatorSelect.appendChild(option);
      });
      field.appendChild(operatorSelect);

      const valueEditor = this._createFilterValueEditor(meta, currentOperator, currentValue, (value) => {
        this._core.setColumnFilter(column.def.id, {
          type: meta.type,
          field: column.def.field,
          operator: operatorSelect.value,
          value,
        });
      });

      operatorSelect.addEventListener('change', () => {
        this._pendingFilterOperator.set(column.def.id, operatorSelect.value);
        const nextValue = operatorSelect.value === 'between' ? ['', ''] : '';
        this._core.setColumnFilter(column.def.id, {
          type: meta.type,
          field: column.def.field,
          operator: operatorSelect.value,
          value: nextValue,
        });
        this.render();
      });

      field.appendChild(valueEditor);
    } else {
      const selectValues = Array.isArray(currentValue)
        ? currentValue.map(String)
        : currentValue == null || currentValue === ''
          ? []
          : [String(currentValue)];

      const select = document.createElement('select');
      select.className = 'ck-zenith-grid-side-panel-select ck-zenith-grid-side-panel-select-multiple';
      select.multiple = meta.multiple;
      select.size = Math.min(Math.max(meta.choices.length, 3), 6);

      meta.choices.forEach((choice) => {
        const option = document.createElement('option');
        option.value = String(choice.value);
        option.textContent = choice.label;
        option.selected = selectValues.includes(String(choice.value));
        select.appendChild(option);
      });

      select.addEventListener('change', () => {
        const selectedValues = [...select.selectedOptions].map((option) => option.value);
        this._core.setColumnFilter(column.def.id, {
          type: 'select',
          field: column.def.field,
          operator: 'in',
          value: meta.multiple ? selectedValues : selectedValues[0] ?? '',
        });
        this.render(); // Refresh UI to show updated filter state
      });

      field.appendChild(select);

      if (meta.choices.length === 0) {
        const hint = document.createElement('small');
        hint.className = 'ck-zenith-grid-side-panel-help';
        hint.textContent = this._t(
          'sidePanel.noFilterChoices',
          'No filter choices are available yet. Provide filterOptions for remote datasets.'
        );
        field.appendChild(hint);
      }
    }

    const actions = document.createElement('div');
    actions.className = 'ck-zenith-grid-side-panel-inline-actions';

    const summary = document.createElement('small');
    summary.className = 'ck-zenith-grid-side-panel-help';
    summary.textContent = filter
      ? this._t('sidePanel.filterActive', 'Filter active')
      : this._t('sidePanel.filterInactive', 'No filter set');

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'ck-zenith-grid-side-panel-action ck-zenith-grid-side-panel-action-inline';
    clear.textContent = this._t('sidePanel.clearFilter', 'Clear');
    clear.disabled = !filter;
    clear.addEventListener('click', () => {
      this._pendingFilterOperator.delete(column.def.id);
      this._core.clearColumnFilter(column.def.id);
    });

    actions.appendChild(summary);
    actions.appendChild(clear);
    field.appendChild(actions);

    return field;
  }

  _createFilterValueEditor(meta, operator, value, onCommit) {
    if (operator === 'between') {
      const wrap = document.createElement('div');
      wrap.className = 'ck-zenith-grid-side-panel-split-inputs';

      const startInput = this._createPrimitiveFilterInput(meta, Array.isArray(value) ? value[0] ?? '' : '', () => {
        onCommit([startInput.value, endInput.value]);
      });
      const endInput = this._createPrimitiveFilterInput(meta, Array.isArray(value) ? value[1] ?? '' : '', () => {
        onCommit([startInput.value, endInput.value]);
      });

      startInput.placeholder = this._t('sidePanel.rangeStart', 'From');
      endInput.placeholder = this._t('sidePanel.rangeEnd', 'To');

      wrap.appendChild(startInput);
      wrap.appendChild(endInput);
      return wrap;
    }

    const input = this._createPrimitiveFilterInput(meta, Array.isArray(value) ? value[0] ?? '' : value ?? '', () => {
      onCommit(input.value);
    });
    return input;
  }

  _createPrimitiveFilterInput(meta, value, onCommit) {
    const input = document.createElement('input');
    input.type = meta.inputType;
    input.value = value ?? '';
    input.placeholder = meta.placeholder;

    let timer = null;
    const commit = () => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        onCommit();
      }, meta.inputType === 'search' ? 160 : 0);
    };

    input.addEventListener(meta.inputType === 'search' ? 'input' : 'change', commit);
    if (meta.inputType !== 'search') {
      input.addEventListener('input', commit);
    }
    return input;
  }

  _resolveFilterMeta(column) {
    const type = column.def.filterType ?? this._inferFilterType(column.def);
    const operators = Array.isArray(column.def.filterOperators) && column.def.filterOperators.length > 0
      ? column.def.filterOperators
      : this._getDefaultOperators(type);

    return {
      type,
      operators,
      defaultOperator: operators[0],
      multiple: column.def.filterMultiple ?? true,
      inputType: type === 'number' ? 'number' : type === 'date' ? 'date' : 'search',
      placeholder: column.def.filterPlaceholder ?? this._t('sidePanel.filterPlaceholder', 'Filter {label}', {
        label: column.def.headerName,
      }),
      choices: type === 'select' ? this._core.getColumnFilterChoices(column.def.id) : [],
    };
  }

  _inferFilterType(def) {
    if (Array.isArray(def.filterOptions) && def.filterOptions.length > 0) {
      return 'select';
    }
    if (def.type === 'number' || def.type === 'date') {
      return def.type;
    }
    return 'text';
  }

  _getDefaultOperators(type) {
    switch (type) {
      case 'number':
        return ['equals', 'notEquals', 'greaterThan', 'greaterThanOrEqual', 'lessThan', 'lessThanOrEqual', 'between'];
      case 'date':
        return ['equals', 'notEquals', 'before', 'after', 'between'];
      case 'select':
        return ['in'];
      default:
        return ['contains', 'startsWith', 'endsWith', 'equals', 'notContains', 'notEquals'];
    }
  }

  _getOperatorLabel(operator) {
    const labels = {
      contains: this._t('sidePanel.operators.contains', 'Contains'),
      startsWith: this._t('sidePanel.operators.startsWith', 'Starts With'),
      endsWith: this._t('sidePanel.operators.endsWith', 'Ends With'),
      equals: this._t('sidePanel.operators.equals', 'Equals'),
      notEquals: this._t('sidePanel.operators.notEquals', 'Does Not Equal'),
      notContains: this._t('sidePanel.operators.notContains', 'Does Not Contain'),
      greaterThan: this._t('sidePanel.operators.greaterThan', 'Greater Than'),
      greaterThanOrEqual: this._t('sidePanel.operators.greaterThanOrEqual', 'Greater Or Equal'),
      lessThan: this._t('sidePanel.operators.lessThan', 'Less Than'),
      lessThanOrEqual: this._t('sidePanel.operators.lessThanOrEqual', 'Less Or Equal'),
      before: this._t('sidePanel.operators.before', 'Before'),
      after: this._t('sidePanel.operators.after', 'After'),
      between: this._t('sidePanel.operators.between', 'Between'),
      in: this._t('sidePanel.operators.in', 'Includes'),
    };
    return labels[operator] ?? operator;
  }

  _renderPluginsSection() {
    const section = document.createElement('div');
    section.className = 'ck-zenith-grid-side-panel-section';

    const plugins = this._core.getAvailablePlugins();
    if (plugins.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'ck-zenith-grid-side-panel-empty';
      empty.textContent = this._t('sidePanel.noPlugins', 'No built-in plugins were provided for this grid instance.');
      section.appendChild(empty);
      return section;
    }

    plugins.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'ck-zenith-grid-side-panel-row';

      const top = document.createElement('div');
      top.className = 'ck-zenith-grid-side-panel-row-top';

      const copy = document.createElement('div');
      copy.className = 'ck-zenith-grid-side-panel-copy';

      const title = document.createElement('strong');
      title.textContent = entry.label ?? entry.name;

      const meta = document.createElement('span');
      meta.textContent = entry.description ?? entry.name;

      copy.appendChild(title);
      copy.appendChild(meta);

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'ck-zenith-grid-side-panel-toggle';
      const installed = this._core.hasPlugin(entry.name);
      toggle.dataset.active = installed ? 'true' : 'false';
      toggle.textContent = installed ? 'On' : 'Off';
      toggle.addEventListener('click', () => {
        if (this._core.hasPlugin(entry.name)) {
          this._core.unusePlugin(entry.name);
        } else if (entry.plugin) {
          this._core.usePlugin(entry.plugin, entry.options ?? {});
        }
      });

      top.appendChild(copy);
      top.appendChild(toggle);
      row.appendChild(top);
      section.appendChild(row);
    });

    return section;
  }

  _renderViewSection() {
    const section = document.createElement('div');
    section.className = 'ck-zenith-grid-side-panel-section';

    const grouping = this._core.getGroupingState();
    const tree = this._core.getTreeState();

    const groupField = document.createElement('label');
    groupField.className = 'ck-zenith-grid-side-panel-field';
    const groupLabel = document.createElement('span');
    groupLabel.textContent = this._t('sidePanel.groupBy', 'Group By');
    const groupSelect = document.createElement('select');
    groupSelect.className = 'ck-zenith-grid-side-panel-select';

    const noneOption = document.createElement('option');
    noneOption.value = '';
    noneOption.textContent = this._t('sidePanel.disabled', 'Disabled');
    groupSelect.appendChild(noneOption);

    this._core.getAllLeafColumns().forEach((column) => {
      const option = document.createElement('option');
      option.value = column.def.field;
      option.textContent = column.def.headerName;
      if (grouping.enabled && grouping.groupByFields?.[0] === column.def.field) {
        option.selected = true;
      }
      groupSelect.appendChild(option);
    });

    groupSelect.addEventListener('change', () => {
      if (!groupSelect.value) {
        this._core.disableGrouping();
      } else {
        this._core.enableGrouping([groupSelect.value]);
      }
    });

    groupField.appendChild(groupLabel);
    groupField.appendChild(groupSelect);
    section.appendChild(groupField);

    const treeRow = document.createElement('div');
    treeRow.className = 'ck-zenith-grid-side-panel-row';

    const treeCopy = document.createElement('div');
    treeCopy.className = 'ck-zenith-grid-side-panel-copy';
    const treeTitle = document.createElement('strong');
    treeTitle.textContent = this._t('sidePanel.treeMode', 'Tree Mode');
    const treeMeta = document.createElement('span');
    treeMeta.textContent = tree.enabled
      ? this._t('sidePanel.enabled', 'Enabled')
      : this._t('sidePanel.disabled', 'Disabled');
    treeCopy.appendChild(treeTitle);
    treeCopy.appendChild(treeMeta);

    const treeToggle = document.createElement('button');
    treeToggle.type = 'button';
    treeToggle.className = 'ck-zenith-grid-side-panel-toggle';
    treeToggle.dataset.active = tree.enabled ? 'true' : 'false';
    treeToggle.textContent = tree.enabled
      ? this._t('sidePanel.on', 'On')
      : this._t('sidePanel.off', 'Off');
    treeToggle.addEventListener('click', () => {
      if (tree.enabled) {
        this._core.disableTree();
      } else {
        this._core.enableTree();
      }
    });

    treeRow.appendChild(treeCopy);
    treeRow.appendChild(treeToggle);
    section.appendChild(treeRow);

    if (tree.enabled) {
      const leafSpacerRow = document.createElement('div');
      leafSpacerRow.className = 'ck-zenith-grid-side-panel-row';

      const leafSpacerCopy = document.createElement('div');
      leafSpacerCopy.className = 'ck-zenith-grid-side-panel-copy';
      const leafSpacerTitle = document.createElement('strong');
      leafSpacerTitle.textContent = this._t('sidePanel.treeLeafSpacer', 'Leaf Row Placeholder');
      const leafSpacerMeta = document.createElement('span');
      leafSpacerMeta.textContent = this._core.isTreeLeafSpacerVisible()
        ? this._t('sidePanel.visible', 'Visible')
        : this._t('sidePanel.hidden', 'Hidden');
      leafSpacerCopy.appendChild(leafSpacerTitle);
      leafSpacerCopy.appendChild(leafSpacerMeta);

      const leafSpacerToggle = document.createElement('button');
      leafSpacerToggle.type = 'button';
      leafSpacerToggle.className = 'ck-zenith-grid-side-panel-toggle';
      leafSpacerToggle.dataset.active = this._core.isTreeLeafSpacerVisible() ? 'true' : 'false';
      leafSpacerToggle.textContent = this._core.isTreeLeafSpacerVisible()
        ? this._t('sidePanel.on', 'On')
        : this._t('sidePanel.off', 'Off');
      leafSpacerToggle.addEventListener('click', () => {
        this._core.setTreeLeafSpacerVisible(!this._core.isTreeLeafSpacerVisible());
      });

      leafSpacerRow.appendChild(leafSpacerCopy);
      leafSpacerRow.appendChild(leafSpacerToggle);
      section.appendChild(leafSpacerRow);
    }

    const variableRow = document.createElement('div');
    variableRow.className = 'ck-zenith-grid-side-panel-row';

    const variableCopy = document.createElement('div');
    variableCopy.className = 'ck-zenith-grid-side-panel-copy';
    const variableTitle = document.createElement('strong');
    variableTitle.textContent = this._t('sidePanel.variableRowHeight', 'Variable Row Height');
    const variableMeta = document.createElement('span');
    variableMeta.textContent = this._core.isVariableRowHeight()
      ? this._t('sidePanel.adaptive', 'Adaptive')
      : this._t('sidePanel.fixed', 'Fixed');
    variableCopy.appendChild(variableTitle);
    variableCopy.appendChild(variableMeta);

    const variableToggle = document.createElement('button');
    variableToggle.type = 'button';
    variableToggle.className = 'ck-zenith-grid-side-panel-toggle';
    variableToggle.dataset.active = this._core.isVariableRowHeight() ? 'true' : 'false';
    variableToggle.textContent = this._core.isVariableRowHeight()
      ? this._t('sidePanel.on', 'On')
      : this._t('sidePanel.off', 'Off');
    variableToggle.addEventListener('click', () => {
      this._core.setVariableRowHeight(!this._core.isVariableRowHeight());
    });

    variableRow.appendChild(variableCopy);
    variableRow.appendChild(variableToggle);
    section.appendChild(variableRow);

    const liveAnimationRow = document.createElement('div');
    liveAnimationRow.className = 'ck-zenith-grid-side-panel-row';

    const liveAnimationCopy = document.createElement('div');
    liveAnimationCopy.className = 'ck-zenith-grid-side-panel-copy';
    const liveAnimationTitle = document.createElement('strong');
    liveAnimationTitle.textContent = this._t('sidePanel.rowMotion', 'Row Motion');
    const liveAnimationMeta = document.createElement('span');
    liveAnimationMeta.textContent = this._core.isLiveRowAnimationEnabled()
      ? this._t('sidePanel.animated', 'Animated')
      : this._t('sidePanel.static', 'Static');
    liveAnimationCopy.appendChild(liveAnimationTitle);
    liveAnimationCopy.appendChild(liveAnimationMeta);

    const liveAnimationToggle = document.createElement('button');
    liveAnimationToggle.type = 'button';
    liveAnimationToggle.className = 'ck-zenith-grid-side-panel-toggle';
    liveAnimationToggle.dataset.active = this._core.isLiveRowAnimationEnabled() ? 'true' : 'false';
    liveAnimationToggle.textContent = this._core.isLiveRowAnimationEnabled()
      ? this._t('sidePanel.on', 'On')
      : this._t('sidePanel.off', 'Off');
    liveAnimationToggle.addEventListener('click', () => {
      this._core.setLiveRowAnimationEnabled(!this._core.isLiveRowAnimationEnabled());
    });

    liveAnimationRow.appendChild(liveAnimationCopy);
    liveAnimationRow.appendChild(liveAnimationToggle);
    section.appendChild(liveAnimationRow);

    return section;
  }

  destroy() {
    this._dom.getRoot()?.classList.remove('ck-zenith-grid-has-side-panel', 'ck-zenith-grid-side-panel-open');
    if (this._host) {
      this._host.innerHTML = '';
    }
    this._host = null;
    this._shell = null;
  }

  _t(key, fallback, params = {}) {
    return this._core.getLocaleText?.(key, fallback, params) ?? fallback;
  }
}
