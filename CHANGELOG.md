# Changelog

## [3.0.3] - 2026-09-10

### Fixed

**Tree mode**
- `tree: {...}` constructor option now actually activates tree mode; previously it silently configured the manager without enabling it, requiring an explicit `enableTree()` call afterward.
- Tree row keys now respect a configured `rowKey` (field or function) instead of always falling back to `row.id`. Previously, rows without an `id` field could collide onto the same key, so expanding one group could incorrectly expand a sibling group as well; `toggleTreeRow()` also now works correctly when a custom `rowKey` is configured.
- `parentId` tree mode now links parent/child rows using the configured `rowKey` as well.
- Lazily-loaded tree children (`onLoadChildren`) now render correctly even when the row's own `children` field started out as `[]` — that value was previously masking the freshly-loaded children.
- `expandAllTree()` now expands the entire hierarchy in a single call instead of only the currently-visible depth level.

**Editing & Undo/Redo**
- Editing a formula cell and then undoing the edit no longer permanently destroys the formula.
- Pasting over a range no longer overwrites cells that are `editable: false` or when editing is disabled entirely.
- Pasting a multi-column block of tab-separated data now fills every column, not just the first.
- Confirming a cell edit with Enter no longer pushes duplicate entries onto the undo stack — a single Enter press could previously push up to three, and a single Undo would only revert the last (no-op) one.
- `setRows()` (a full dataset replacement) now clears undo/redo history, so a stale action from the previous dataset can no longer overwrite unrelated data in the new one.
- Fixed focus silently dropping to `<body>` after committing a cell edit, which broke grid keyboard shortcuts (like Ctrl+Z) until the user clicked back into the grid.
- An edit rejected by a column `validator` no longer deletes the cell's existing formula — the formula (and the cell's value) are now left untouched when validation fails, instead of only the value being rolled back while the formula silently disappeared.
- `setCellValue()` now returns `false` (instead of always reporting success) when the underlying patch is rejected — e.g. an edit to the `rowKey` field that would collide with another row — and no longer pushes a phantom undo entry for an edit that never actually applied.

**Filtering & Pagination**
- Advanced filters (`setAdvancedFilter`) are now applied before pagination, so `totalCount` and page count reflect the filtered result instead of the full, unfiltered dataset.
- Advanced filters now evaluate every row independently in group and tree mode (including nested tree descendants), instead of only the top-level rows — a matching child of a non-matching parent is no longer dropped along with it, and a `parentId`-mode child is no longer promoted to a fake root when its parent is filtered out.
- Sorting or filtering with a Web Worker enabled no longer silently ignores custom `comparator`/filter functions — those operations now run on the main thread instead of producing a different, incorrect result with no warning.
- Web Worker filtering now reads the correct data field when a column's `id` differs from its `field`.

**Grouping & Pivot**
- Group aggregates now sum every row in the group instead of only the rows on the currently displayed page.
- `disablePivot()` now restores the grid's original columns instead of leaving the pivot-generated ones in place, and now correctly invalidates cached row heights and re-saves column state, matching every other column-changing API.
- Pivot `count` aggregation now counts non-numeric values (e.g. text) correctly instead of returning `null`. As part of this fix, `sum`/`avg`/`min`/`max` now exclude `null`/`undefined` value-field cells from the calculation entirely, rather than silently coercing them to `0` (this mainly changes `avg`, whose denominator no longer counts blank cells — matching typical spreadsheet `AVERAGE` semantics).

**Data & Export**
- `DataStore.patchRow()` now keeps its key index in sync when a patch changes the value of the configured `rowKey` field itself, and refuses the change outright (returning `false`) if it would collide with another row's existing key instead of silently merging the two rows' identities.
- Expanded Master-Detail rows are no longer exported as blank rows in CSV/Excel export.

**Side panel**
- The built-in side panel (columns/filters/view) no longer overlaps and clips the grid's rightmost columns when it's open.
- Keyboard focus on the row-selection checkbox is now also preserved across a re-render (the earlier focus-preservation fix only covered data cells).

**Framework adapters**
- The React and Vue 3 hooks' `selectionCount`, `isAllSelected`, `isSomeSelected`, and `paginationState` now actually update — they previously read fields that didn't exist on the emitted events and stayed stuck at their initial values.

**Packaging & TypeScript types**
- The published React, Vue 2, and Vue 3 type declaration files no longer import from a path outside the package.
- Removed a reference to the nonexistent `GridInstance` type (now `GridCore`) and the nonexistent `useZenithGridReact` export from the type declarations; added the missing `createFormulaPlugin` declaration.
- Fixed a duplicate `onRowContextMenu` property and a non-generic `GridPlugin` type misuse in the Vue 3 declarations.
- `createEchartsPlugin` can now actually be imported from the published package, via `zenith-grid/plugins/echarts`, with its own type declarations.

## [3.0.0] - 2026-07-14

### ⚠️ BREAKING CHANGES

The project has been renamed from **HighGrid** to **Zenith Grid**. Every public identifier that carried the old name has changed.

#### Package name changed: `highgrid` → `zenith-grid`

```diff
- npm install highgrid
+ npm install zenith-grid

- import { createGrid } from 'highgrid';
- import 'highgrid/styles/grid.css';
+ import { createGrid } from 'zenith-grid';
+ import 'zenith-grid/styles/grid.css';
```

Subpath exports follow the same pattern: `highgrid/vue` → `zenith-grid/vue`, `highgrid/vue2` → `zenith-grid/vue2`, `highgrid/react` → `zenith-grid/react`. The UMD global is now `ZenithGrid` instead of `HighGrid`, and bundle files are `dist/zenith-grid.js`, `dist/zenith-grid-vue.js`, etc.

#### CSS class prefix changed: `ck-high-grid-` → `ck-zenith-grid-`

```diff
- <div class="ck-high-grid-theme-dark">
+ <div class="ck-zenith-grid-theme-dark">
```

#### CSS custom property prefix changed: `--ck-high-grid-` → `--ck-zenith-grid-`

```diff
  :root {
-   --ck-high-grid-accent: #7c3aed;
-   --ck-high-grid-row-height: 48px;
+   --ck-zenith-grid-accent: #7c3aed;
+   --ck-zenith-grid-row-height: 48px;
  }
```

#### Framework adapter API renamed

| Before | After |
| --- | --- |
| `HighGrid` (Vue 2 / Vue 3 component) | `ZenithGrid` |
| `useHighGrid` (React / Vue 3 composable) | `useZenithGrid` |
| `HighGridProps` (TypeScript type) | `ZenithGridProps` |
| `UseHighGridReturn` (TypeScript type) | `UseZenithGridReturn` |

The grid's core API (`createGrid`, `GridCore`, all managers, plugins, and options) is unchanged — only names carrying the old brand were touched.

#### Migrating an existing project

Every rename is a mechanical string substitution, so most projects can migrate with a single pass over their source:

```bash
npm uninstall highgrid && npm install zenith-grid

# macOS/Linux — adjust the file glob to match your project
grep -rl 'HighGrid\|high-grid\|highgrid' src \
  | xargs sed -i 's/HighGrid/ZenithGrid/g; s/ck-high-grid-/ck-zenith-grid-/g; s/--ck-high-grid-/--ck-zenith-grid-/g; s/highgrid/zenith-grid/g'
```

On Windows (PowerShell):

```powershell
Get-ChildItem -Recurse src -File | ForEach-Object {
  (Get-Content $_ -Raw) `
    -replace 'HighGrid', 'ZenithGrid' `
    -replace 'ck-high-grid-', 'ck-zenith-grid-' `
    -replace '--ck-high-grid-', '--ck-zenith-grid-' `
    -replace 'highgrid', 'zenith-grid' | Set-Content $_ -Encoding utf8
}
```

Order matters: replace `HighGrid` before the lowercase forms, and the `ck-`/`--ck-` prefixes before the bare `highgrid` package name.

## [2.1.0] - 2026-07-01

### Added
- **Flex Columns**: Added support for proportional column widths using `flex` property (AG-Grid style)
  - Use `flex` instead of `width` for responsive, ratio-based column sizing
  - Supports `minWidth` and `maxWidth` constraints with flex columns
  - Automatically recalculates on grid resize
  - Example: `{ id: 'name', flex: 2, minWidth: 120, maxWidth: 300 }`
  - Mixed usage with fixed-width columns is supported
- **Formula Engine Plugin**: Added the new `createFormulaPlugin` using `hot-formula-parser` for full Excel-like functions.
  - Supports arithmetic operators (`+ - * / ^`), comparison operations, and the full formula.js function set (`MIN`, `MAX`, `IF`, `COUNT`, `VLOOKUP`, logical/string functions, etc.).
  - Preserves standard formula authoring via `row._formulas[field] = "=..."` and circular reference guard.
- **Context Menu Enhancements**: Added support for both `action` and `onSelect` callbacks in context menu items, and context menu separators.

### Fixed
- **Korean/CJK IME Input**: Fixed character loss in quick filter when typing Korean, Chinese, or Japanese text
  - Added composition event tracking (`compositionstart`/`compositionend`)
  - Prevented rendering during IME composition to protect character input
  - Added 50ms protection window after composition end for rapid consecutive typing
  - Input focus and cursor position now properly restored after re-rendering
- **Quick Filter Focus**: Fixed input losing focus during typing
  - Preserved user input value during component re-renders
  - Restored cursor position after DOM reconstruction
- **Settings Panel Range Slider**: Prevented slider handles from triggering drag-and-drop actions.
- **Drag & Drop Typos**: Corrected typographical errors in CSS classes, JavaScript code, and event APIs related to row dragging (restored back to `drag`, e.g. `.ck-high-grid-row-drag-handle` and event `row-drag-start`).
- **UTF-8 BOM Test Fix**: Removed dynamic BOM characters in `tests/grid-core.dom.spec.js` that caused parsing errors in Vitest/Vite.

---

## [1.3.0] - 2026-06-17

### Breaking Changes

#### CSS class prefix changed: `ag-` → `ck-high-grid-`

All internal CSS class names have been renamed from the `ag-` prefix to `ck-high-grid-` to prevent conflicts with AG-Grid and other grid libraries that use the same prefix.

**Before:**
```html
<div class="ag-theme-dark">
  <div id="grid"></div>
</div>
```

**After:**
```html
<div class="ck-high-grid-theme-dark">
  <div id="grid"></div>
</div>
```

---

#### CSS custom property prefix changed: `--ag-` → `--ck-high-grid-`

All CSS design tokens have been renamed from `--ag-` to `--ck-high-grid-`.

**Before:**
```css
#my-grid {
  --ag-accent: #7c3aed;
  --ag-font-size: 15px;
  --ag-row-height: 48px;
}
```

**After:**
```css
#my-grid {
  --ck-high-grid-accent: #7c3aed;
  --ck-high-grid-font-size: 15px;
  --ck-high-grid-row-height: 48px;
}
```

---

### Migration Guide

#### 1. Theme classes

| Before | After |
|---|---|
| `ag-theme-dark` | `ck-high-grid-theme-dark` |
| `ag-theme-compact` | `ck-high-grid-theme-compact` |
| `ag-theme-spacious` | `ck-high-grid-theme-spacious` |

#### 2. CSS custom properties (commonly used)

| Before | After |
|---|---|
| `--ag-accent` | `--ck-high-grid-accent` |
| `--ag-surface` | `--ck-high-grid-surface` |
| `--ag-ink` | `--ck-high-grid-ink` |
| `--ag-border` | `--ck-high-grid-border` |
| `--ag-font-size` | `--ck-high-grid-font-size` |
| `--ag-row-height` | `--ck-high-grid-row-height` |
| `--ag-header-bg` | `--ck-high-grid-header-bg` |
| `--ag-row-hover-bg` | `--ck-high-grid-row-hover-bg` |
| `--ag-row-selected-bg` | `--ck-high-grid-row-selected-bg` |

#### 3. Custom cell editor class names

If you are using internal class names inside custom cell editors or renderers, update them as well:

**Before:**
```js
input.className = "ag-cell-editor";
```

**After:**
```js
input.className = "ck-high-grid-cell-editor";
```

#### 4. Custom CSS overrides

If you have written custom CSS targeting HighGrid's internal classes, update all selectors:

**Before:**
```css
.ag-row-selected { background: #e0f0ff; }
.ag-header-cell { font-weight: 700; }
.ag-cell-pinned { background: #f8fafc; }
```

**After:**
```css
.ck-high-grid-row-selected { background: #e0f0ff; }
.ck-high-grid-header-cell { font-weight: 700; }
.ck-high-grid-cell-pinned { background: #f8fafc; }
```

#### 5. JavaScript classList manipulation

If you toggle dark mode programmatically:

**Before:**
```js
container.classList.add('ag-theme-dark');
container.classList.remove('ag-theme-dark');
container.classList.toggle('ag-theme-dark');
```

**After:**
```js
container.classList.add('ck-high-grid-theme-dark');
container.classList.remove('ck-high-grid-theme-dark');
container.classList.toggle('ck-high-grid-theme-dark');
```

---

### Why this change?

AG-Grid also uses the `ag-` prefix for its CSS classes and `--ag-` for its design tokens. When both libraries are loaded on the same page, styles bleed into each other and cause visual corruption. The `ck-high-grid-` prefix is unique to HighGrid and eliminates this conflict entirely.

---

## [1.2.1] - 2026-06-05

- Fix: style path resolution

## [1.2.0] - 2026-06-05

- Enterprise features: RowDragManager, AggregateManager, RangeSelectionManager, StatusBarRenderer, conditional formatting, row pinning, print support

## [1.0.0] - Initial Release

- Virtual scrolling, pagination, infinite scroll
- Grouping, tree data, live updates
- Side panel, plugins, custom cell renderers
