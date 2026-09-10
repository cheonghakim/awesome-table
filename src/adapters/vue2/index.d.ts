import { DefineComponent } from 'vue';
import type { GridCore, GridOptions } from '../../index.js';

export interface ZenithGridProps extends Omit<GridOptions, 'container'> {}

export interface ZenithGridEmits {
  (e: 'ready', grid: GridCore): void;
  (e: 'row-click', payload: any): void;
  (e: 'cell-click', payload: any): void;
  (e: 'cell-dblclick', payload: any): void;
  (e: 'row-contextmenu', payload: any): void;
  (e: 'cell-contextmenu', payload: any): void;
  (e: 'selection-change', payload: any): void;
  (e: 'group-toggle', payload: any): void;
  (e: 'tree-toggle', payload: any): void;
  (e: 'row-drag-start', payload: any): void;
  (e: 'row-drag-end', payload: any): void;
  (e: 'row-reorder', payload: any): void;
  (e: 'range-selection-change', payload: any): void;
  (e: 'detail-toggle', payload: any): void;
  (e: 'cell-value-change', payload: any): void;
  (e: 'render', payload: any): void;
  (e: 'state-change', payload: any): void;
}

export interface ZenithGridMethods extends Omit<GridCore, 'on' | 'destroy'> {
  grid: GridCore | null;
  // Vue2's DefineComponent requires its methods type param to satisfy MethodOptions,
  // which needs a string index signature.
  [key: string]: any;
}

export const ZenithGrid: DefineComponent<ZenithGridProps, {}, {}, {}, ZenithGridMethods>;
