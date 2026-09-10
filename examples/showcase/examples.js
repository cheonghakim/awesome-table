import {
  createGrid,
  createXlsxExportPlugin,
  createSparklinePlugin,
  createContextMenuPlugin,
  createCsvShortcutPlugin,
  createFormulaPlugin,
} from '../../src/index.js';
import '../../src/styles/grid.css';

// ── Shared helpers ────────────────────────────────────────────────

const TEAMS    = ['Red', 'Blue', 'Gold', 'Green'];
const STATUSES = ['Active', 'Paused', 'Review'];
const REGIONS  = ['Seoul', 'Tokyo', 'Berlin', 'Austin', 'Dubai'];

function makeRows(n = 200) {
  return Array.from({ length: n }, (_, i) => ({
    id:     i + 1,
    name:   `Operator ${String(i + 1).padStart(3, '0')}`,
    team:   TEAMS[i % TEAMS.length],
    status: STATUSES[i % STATUSES.length],
    score:  1000 + ((i * 37) % 9000),
    region: REGIONS[i % REGIONS.length],
    age:    20 + (i % 40),
    joined: new Date(2020, i % 12, (i % 28) + 1).toISOString().slice(0, 10),
    history: Array.from({ length: 8 }, (_, j) => Math.abs(Math.round(2000 + Math.sin(i * 17 + j * 31) * 1500))),
  }));
}


// ── Example definitions ───────────────────────────────────────────

export const EXAMPLES = [
  // ────────────────── Getting Started ──────────────────
  {
    id: 'basic',
    category: 'Getting Started',
    label: 'Basic Grid',
    desc: 'createGrid으로 가장 단순한 그리드를 만듭니다.',
    code: `import { createGrid } from 'zenith-grid';
import 'zenith-grid/styles/grid.css';

const grid = createGrid(document.getElementById('grid'), {
  columns: [
    { id: 'id',   field: 'id',   header: 'ID',     width: 80,  type: 'number' },
    { id: 'name', field: 'name', header: 'Name',   flex: 1 },
    { id: 'team', field: 'team', header: 'Team',   width: 120 },
    { id: 'score',field: 'score',header: 'Score',  width: 100, type: 'number' },
  ],
  rows: myRows,
  rowKey: 'id',
});`,
    setup(el) {
      return createGrid(el, {
        columns: [
          { id: 'id',    field: 'id',    header: 'ID',    width: 80,  type: 'number' },
          { id: 'name',  field: 'name',  header: 'Name',  flex: 1 },
          { id: 'team',  field: 'team',  header: 'Team',  width: 120 },
          { id: 'score', field: 'score', header: 'Score', width: 100, type: 'number' },
        ],
        rows: makeRows(100),
        rowKey: 'id',
      });
    },
  },

  {
    id: 'custom-renderer',
    category: 'Getting Started',
    label: 'Custom Renderer',
    desc: '셀에 커스텀 DOM 요소를 렌더링합니다.',
    code: `const grid = createGrid(el, {
  columns: [
    { id: 'name', field: 'name', header: 'Name', flex: 1 },
    {
      id: 'status',
      field: 'status',
      header: 'Status',
      width: 110,
      renderer: ({ value }) => {
        const badge = document.createElement('span');
        badge.style.cssText =
          'padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;' +
          (value === 'Active'  ? 'background:#dcfce7;color:#166534;' :
           value === 'Paused'  ? 'background:#fef9c3;color:#854d0e;' :
                                 'background:#fee2e2;color:#991b1b;');
        badge.textContent = value;
        return badge;
      },
    },
    {
      id: 'score',
      field: 'score',
      header: 'Score',
      width: 130,
      renderer: ({ value }) => {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;align-items:center;gap:6px;';
        const bar = document.createElement('div');
        bar.style.cssText =
          \`flex:1;height:6px;border-radius:3px;background:#e2e8f0;overflow:hidden;\`;
        const fill = document.createElement('div');
        fill.style.cssText =
          \`height:100%;width:\${Math.round(value/100)}%;background:#38bdf8;border-radius:3px;\`;
        bar.appendChild(fill);
        const txt = document.createElement('span');
        txt.style.cssText = 'font-size:11px;min-width:36px;text-align:right;';
        txt.textContent = value;
        wrap.appendChild(bar);
        wrap.appendChild(txt);
        return wrap;
      },
    },
  ],
  rows: myRows,
  rowKey: 'id',
});`,
    setup(el) {
      return createGrid(el, {
        columns: [
          { id: 'name', field: 'name', header: 'Name', flex: 1 },
          {
            id: 'status', field: 'status', header: 'Status', width: 110,
            renderer: ({ value }) => {
              const badge = document.createElement('span');
              badge.style.cssText =
                'padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;' +
                (value === 'Active' ? 'background:#dcfce7;color:#166534;' :
                 value === 'Paused' ? 'background:#fef9c3;color:#854d0e;' :
                                      'background:#fee2e2;color:#991b1b;');
              badge.textContent = value;
              return badge;
            },
          },
          {
            id: 'score', field: 'score', header: 'Score', width: 140,
            renderer: ({ value }) => {
              const wrap = document.createElement('div');
              wrap.style.cssText = 'display:flex;align-items:center;gap:6px;';
              const bar = document.createElement('div');
              bar.style.cssText = 'flex:1;height:6px;border-radius:3px;background:#e2e8f0;overflow:hidden;';
              const fill = document.createElement('div');
              fill.style.cssText = `height:100%;width:${Math.round(value / 100)}%;background:#38bdf8;border-radius:3px;`;
              bar.appendChild(fill);
              const txt = document.createElement('span');
              txt.style.cssText = 'font-size:11px;min-width:36px;text-align:right;';
              txt.textContent = value;
              wrap.appendChild(bar);
              wrap.appendChild(txt);
              return wrap;
            },
          },
        ],
        rows: makeRows(100),
        rowKey: 'id',
      });
    },
  },

  // ────────────────── Sorting & Filtering ──────────────
  {
    id: 'sorting',
    category: 'Sorting & Filtering',
    label: 'Sorting',
    desc: '헤더 클릭으로 정렬합니다. type을 지정하면 숫자/날짜 정렬이 적용됩니다.',
    code: `const grid = createGrid(el, {
  columns: [
    { id: 'id',     field: 'id',     header: 'ID',     width: 80,  type: 'number' },
    { id: 'name',   field: 'name',   header: 'Name',   flex: 1 },
    { id: 'score',  field: 'score',  header: 'Score',  width: 100, type: 'number' },
    { id: 'joined', field: 'joined', header: 'Joined', width: 120, type: 'date' },
  ],
  rows: myRows,
  rowKey: 'id',
});

// 초기 정렬 지정 (선택) - 생성 옵션이 아니라 API 호출로 적용합니다.
grid.sortBy({ field: 'score', direction: 'desc' });`,
    setup(el) {
      const grid = createGrid(el, {
        columns: [
          { id: 'id',     field: 'id',     header: 'ID',     width: 80,  type: 'number' },
          { id: 'name',   field: 'name',   header: 'Name',   flex: 1 },
          { id: 'score',  field: 'score',  header: 'Score',  width: 100, type: 'number' },
          { id: 'joined', field: 'joined', header: 'Joined', width: 120, type: 'date' },
        ],
        rows: makeRows(200),
        rowKey: 'id',
      });
      grid.sortBy({ field: 'score', direction: 'desc' });
      return grid;
    },
  },

  {
    id: 'column-filter',
    category: 'Sorting & Filtering',
    label: 'Column Filter',
    desc: '헤더 메뉴에서 컬럼별 필터를 설정합니다. text / number / select 타입을 지원합니다.',
    code: `const grid = createGrid(el, {
  columns: [
    { id: 'name',   field: 'name',   header: 'Name',   flex: 1 },
    // select 필터
    {
      id: 'team', field: 'team', header: 'Team', width: 120,
      filterType: 'select',
      filterOptions: ['Red', 'Blue', 'Gold', 'Green'],
    },
    {
      id: 'status', field: 'status', header: 'Status', width: 120,
      filterType: 'select',
      filterOptions: ['Active', 'Paused', 'Review'],
    },
    // number 필터
    { id: 'score', field: 'score', header: 'Score', width: 100, type: 'number' },
  ],
  rows: myRows,
  rowKey: 'id',
});`,
    setup(el) {
      return createGrid(el, {
        columns: [
          { id: 'name',   field: 'name',   header: 'Name',   flex: 1 },
          { id: 'team',   field: 'team',   header: 'Team',   width: 120, filterType: 'select', filterOptions: TEAMS },
          { id: 'status', field: 'status', header: 'Status', width: 120, filterType: 'select', filterOptions: STATUSES },
          { id: 'score',  field: 'score',  header: 'Score',  width: 100, type: 'number' },
        ],
        rows: makeRows(200),
        rowKey: 'id',
      });
    },
  },

  {
    id: 'quick-filter',
    category: 'Sorting & Filtering',
    label: 'Quick Filter (Side Panel)',
    desc: '사이드 패널의 빠른 검색으로 여러 필드를 동시에 검색합니다.',
    code: `const grid = createGrid(el, {
  columns: [...],
  rows: myRows,
  rowKey: 'id',
  sidePanel: {
    enabled: true,
    quickFilterFields: ['name', 'team', 'region'],
    defaultTab: 'filters',
    defaultOpen: true,
  },
});`,
    setup(el) {
      return createGrid(el, {
        columns: [
          { id: 'name',   field: 'name',   header: 'Name',   flex: 1 },
          { id: 'team',   field: 'team',   header: 'Team',   width: 120 },
          { id: 'region', field: 'region', header: 'Region', width: 120 },
          { id: 'score',  field: 'score',  header: 'Score',  width: 100, type: 'number' },
        ],
        rows: makeRows(200),
        rowKey: 'id',
        sidePanel: {
          enabled: true,
          quickFilterFields: ['name', 'team', 'region'],
          defaultTab: 'filters',
          defaultOpen: true,
        },
      });
    },
  },

  // ────────────────── Layout ────────────────────────────
  {
    id: 'column-pinning',
    category: 'Layout',
    label: 'Column Pinning',
    desc: 'pinned 옵션으로 컬럼을 왼쪽 또는 오른쪽에 고정합니다.',
    code: `const grid = createGrid(el, {
  columns: [
    { id: 'id',   field: 'id',   header: 'ID',   width: 70,  pinned: 'left' },
    { id: 'name', field: 'name', header: 'Name', width: 160, pinned: 'left' },
    { id: 'c1',   field: 'team',   header: 'Team',   width: 120 },
    { id: 'c2',   field: 'status', header: 'Status', width: 120 },
    { id: 'c3',   field: 'region', header: 'Region', width: 120 },
    { id: 'c4',   field: 'age',    header: 'Age',    width: 80  },
    { id: 'score',field: 'score',  header: 'Score',  width: 100, pinned: 'right' },
  ],
  rows: myRows,
  rowKey: 'id',
});`,
    setup(el) {
      return createGrid(el, {
        columns: [
          { id: 'id',     field: 'id',     header: 'ID',     width: 70,  pinned: 'left' },
          { id: 'name',   field: 'name',   header: 'Name',   width: 160, pinned: 'left' },
          { id: 'team',   field: 'team',   header: 'Team',   width: 120 },
          { id: 'status', field: 'status', header: 'Status', width: 120 },
          { id: 'region', field: 'region', header: 'Region', width: 120 },
          { id: 'age',    field: 'age',    header: 'Age',    width: 80 },
          { id: 'joined', field: 'joined', header: 'Joined', width: 120 },
          { id: 'score',  field: 'score',  header: 'Score',  width: 100, pinned: 'right' },
        ],
        rows: makeRows(200),
        rowKey: 'id',
      });
    },
  },

  {
    id: 'multi-header',
    category: 'Layout',
    label: 'Multi-level Headers',
    desc: 'children을 사용해 컬럼 그룹 헤더를 만듭니다.',
    code: `const grid = createGrid(el, {
  columns: [
    { id: 'name', field: 'name', header: 'Player', width: 160 },
    {
      id: 'season',
      header: 'Season Stats',
      children: [
        { id: 'goals',   field: 'goals',   header: 'G',  width: 70, type: 'number' },
        { id: 'assists', field: 'assists', header: 'A',  width: 70, type: 'number' },
        { id: 'rating',  field: 'rating',  header: 'Rtg',width: 80, type: 'number' },
      ],
    },
    {
      id: 'form',
      header: 'Form',
      children: [
        { id: 'wins',   field: 'wins',   header: 'W', width: 60, type: 'number' },
        { id: 'draws',  field: 'draws',  header: 'D', width: 60, type: 'number' },
        { id: 'losses', field: 'losses', header: 'L', width: 60, type: 'number' },
      ],
    },
  ],
  rows: myRows,
  rowKey: 'id',
});`,
    setup(el) {

      const names = ['Luca Moretti','Kai Hoffmann','Mateo Vidal','Oliver Crane',
        'Hugo Renard','Enzo Ferrara','Daan Vermeer','Samir Nasri','Bruno Alves','Timo Bauer'];
      const rows = names.map((name, i) => ({
        id: i + 1, name,
        goals: Math.floor(Math.random() * 25),
        assists: Math.floor(Math.random() * 18),
        rating: Number((6 + Math.random() * 3.5).toFixed(1)),
        wins: Math.floor(Math.random() * 12),
        draws: Math.floor(Math.random() * 6),
        losses: Math.floor(Math.random() * 5),
      }));
      return createGrid(el, {
        columns: [
          { id: 'name',    field: 'name',    header: 'Player', width: 160 },
          { id: 'season',  header: 'Season Stats', children: [
            { id: 'goals',   field: 'goals',   header: 'G',   width: 70, type: 'number' },
            { id: 'assists', field: 'assists', header: 'A',   width: 70, type: 'number' },
            { id: 'rating',  field: 'rating',  header: 'Rtg', width: 80, type: 'number' },
          ]},
          { id: 'form', header: 'Form', children: [
            { id: 'wins',   field: 'wins',   header: 'W', width: 60, type: 'number' },
            { id: 'draws',  field: 'draws',  header: 'D', width: 60, type: 'number' },
            { id: 'losses', field: 'losses', header: 'L', width: 60, type: 'number' },
          ]},
        ],
        rows,
        rowKey: 'id',
      });
    },
  },

  // ────────────────── Hierarchy ─────────────────────────
  {
    id: 'grouping',
    category: 'Hierarchy',
    label: 'Row Grouping',
    desc: 'enableGrouping으로 컬럼 기준 그룹화 및 집계를 적용합니다.',
    code: `const grid = createGrid(el, {
  columns: [
    { id: 'name',  field: 'name',  header: 'Name',  flex: 1 },
    { id: 'team',  field: 'team',  header: 'Team',  width: 120 },
    { id: 'score', field: 'score', header: 'Score', width: 110, type: 'number', aggregate: 'avg' },
  ],
  rows: myRows,
  rowKey: 'id',
});

// 그룹화 활성화
grid.enableGrouping(['team'], {
  aggregations: { score: [{ type: 'avg' }] },
});`,
    setup(el) {

      const grid = createGrid(el, {
        columns: [
          { id: 'name',   field: 'name',   header: 'Name',   flex: 1 },
          { id: 'team',   field: 'team',   header: 'Team',   width: 120 },
          { id: 'status', field: 'status', header: 'Status', width: 110 },
          { id: 'score',  field: 'score',  header: 'Score',  width: 110, type: 'number', aggregate: 'avg' },
        ],
        rows: makeRows(200),
        rowKey: 'id',
      });
      grid.enableGrouping(['team'], { aggregations: { score: [{ type: 'avg' }] } });
      return grid;
    },
  },

  {
    id: 'tree',
    category: 'Hierarchy',
    label: 'Tree Data',
    desc: '계층형 children 데이터를 트리 모드로 표시합니다. 지연 로딩도 지원합니다.',
    code: `const rows = [
  {
    id: 'root', name: 'Division A', hasChildren: true,
    children: [
      { id: 'root-1', name: 'Team Alpha', hasChildren: false },
      { id: 'root-2', name: 'Team Beta',  hasChildren: true, children: [] },
    ],
  },
];

const grid = createGrid(el, {
  columns: [...],
  rows,
  rowKey: 'id',
  tree: {
    treeMode: 'children',
    childrenField: 'children',
    hasChildrenField: 'hasChildren',
    // 지연 로딩
    onLoadChildren: async (row) => {
      const data = await fetchChildren(row.id);
      return data;
    },
  },
});`,
    setup(el) {

      function makeChildren(parentId, depth) {
        if (depth > 2) return [];
        return Array.from({ length: 3 }, (_, i) => {
          const id = `${parentId}-${i + 1}`;
          return {
            id, name: `Node ${id}`,
            score: 1000 + Math.floor(Math.random() * 5000),
            status: STATUSES[i % STATUSES.length],
            hasChildren: depth < 2,
            children: depth < 2 ? makeChildren(id, depth + 1) : [],
          };
        });
      }
      return createGrid(el, {
        columns: [
          { id: 'name',   field: 'name',   header: 'Name',   flex: 1 },
          { id: 'status', field: 'status', header: 'Status', width: 110 },
          { id: 'score',  field: 'score',  header: 'Score',  width: 100, type: 'number' },
        ],
        rows: [
          { id: 'a', name: 'Division A', score: 9000, status: 'Active', hasChildren: true, children: makeChildren('a', 1) },
          { id: 'b', name: 'Division B', score: 7200, status: 'Paused', hasChildren: true, children: makeChildren('b', 1) },
          { id: 'c', name: 'Division C', score: 5500, status: 'Review', hasChildren: true, children: makeChildren('c', 1) },
        ],
        rowKey: 'id',
        tree: { treeMode: 'children', childrenField: 'children', hasChildrenField: 'hasChildren' },
      });
    },
  },

  {
    id: 'master-detail',
    category: 'Hierarchy',
    label: 'Master-Detail',
    desc: '행을 클릭하면 상세 패널이 펼쳐집니다.',
    code: `const grid = createGrid(el, {
  columns: [...],
  rows: myRows,
  rowKey: 'id',
  masterDetail: {
    detailRenderer: (row) => {
      const div = document.createElement('div');
      div.innerHTML = \`
        <div style="padding:12px 16px;">
          <strong>\${row.name}</strong>
          <p>Team: \${row.team} | Region: \${row.region}</p>
          <p>Score: \${row.score.toLocaleString()}</p>
        </div>
      \`;
      return div;
    },
    detailRowHeight: 120,
  },
});`,
    setup(el) {
      return createGrid(el, {
        columns: [
          { id: 'name',   field: 'name',   header: 'Name',   flex: 1 },
          { id: 'team',   field: 'team',   header: 'Team',   width: 110 },
          { id: 'status', field: 'status', header: 'Status', width: 110 },
          { id: 'score',  field: 'score',  header: 'Score',  width: 100, type: 'number' },
        ],
        rows: makeRows(80),
        rowKey: 'id',
        masterDetail: {
          detailRenderer: (row) => {
            const div = document.createElement('div');
            div.style.cssText = 'padding:14px 16px;display:flex;gap:32px;font-size:13px;';
            div.innerHTML = `
              <div><strong style="font-size:14px;">${row.name}</strong>
                <p style="margin-top:6px;color:#888;">Team: ${row.team} · Region: ${row.region}</p>
                <p style="margin-top:4px;color:#888;">Status: ${row.status}</p>
              </div>
              <div>
                <p>Score: <strong>${row.score.toLocaleString()}</strong></p>
                <p>Joined: ${row.joined}</p>
                <p>Age: ${row.age}</p>
              </div>`;
            return div;
          },
          detailRowHeight: 110,
        },
      });
    },
  },

  // ────────────────── Pagination ────────────────────────
  {
    id: 'pagination-client',
    category: 'Pagination',
    label: 'Client Pagination',
    desc: '클라이언트 데이터를 페이지로 나눠 표시합니다.',
    code: `const grid = createGrid(el, {
  columns: [...],
  rows: myRows,  // 전체 데이터를 한 번에 전달
  rowKey: 'id',
  // displayMode를 지정해야 pagination 옵션이 실제로 적용됩니다.
  displayMode: 'paginated',
  pagination: {
    mode: 'client',
    pageSize: 20,
  },
});

// 페이지 이동
grid.nextPage();
grid.prevPage();
grid.setPage(3);`,
    setup(el) {
      return createGrid(el, {
        columns: [
          { id: 'id',     field: 'id',     header: 'ID',     width: 80,  type: 'number' },
          { id: 'name',   field: 'name',   header: 'Name',   flex: 1 },
          { id: 'team',   field: 'team',   header: 'Team',   width: 120 },
          { id: 'score',  field: 'score',  header: 'Score',  width: 100, type: 'number' },
        ],
        rows: makeRows(300),
        rowKey: 'id',
        displayMode: 'paginated',
        pagination: { mode: 'client', pageSize: 20 },
      });
    },
  },

  {
    id: 'pagination-server',
    category: 'Pagination',
    label: 'Server Pagination',
    desc: '페이지 변경 시 서버에서 데이터를 가져옵니다.',
    code: `const grid = createGrid(el, {
  columns: [...],
  rowKey: 'id',
  // displayMode를 지정해야 초기 fetchPage 호출이 실행됩니다.
  displayMode: 'paginated',
  pagination: {
    mode: 'server',
    pageSize: 25,
    fetchPage: async ({ page, pageSize, filters, sort }) => {
      const res = await fetch(
        \`/api/rows?page=\${page}&size=\${pageSize}\`
      );
      const { rows, totalCount } = await res.json();
      return { rows, totalCount };
    },
  },
});`,
    setup(el) {

      const allRows = makeRows(500);
      return createGrid(el, {
        columns: [
          { id: 'id',    field: 'id',    header: 'ID',    width: 80, type: 'number' },
          { id: 'name',  field: 'name',  header: 'Name',  flex: 1 },
          { id: 'team',  field: 'team',  header: 'Team',  width: 120 },
          { id: 'score', field: 'score', header: 'Score', width: 100, type: 'number' },
        ],
        rowKey: 'id',
        displayMode: 'paginated',
        pagination: {
          mode: 'server',
          pageSize: 25,
          fetchPage: async ({ page, pageSize }) => {
            await new Promise(r => setTimeout(r, 180));
            const start = page * pageSize;
            return { rows: allRows.slice(start, start + pageSize), totalCount: allRows.length };
          },
        },
      });
    },
  },

  {
    id: 'infinite-scroll',
    category: 'Pagination',
    label: 'Infinite Scroll',
    desc: '스크롤 하단에 도달하면 자동으로 다음 데이터를 로드합니다.',
    code: `const grid = createGrid(el, {
  columns: [...],
  rowKey: 'id',
  // displayMode를 지정해야 초기 로드가 실행됩니다.
  displayMode: 'infinite',
  infiniteScroll: {
    mode: 'server',
    initialLoadSize: 50,
    loadMoreSize: 30,
    onLoadMore: async ({ offset, loadSize }) => {
      const res = await fetch(\`/api/rows?offset=\${offset}&size=\${loadSize}\`);
      const { rows, totalCount } = await res.json();
      return { rows, totalCount, hasMore: offset + rows.length < totalCount };
    },
  },
});`,
    setup(el) {

      const allRows = makeRows(600);
      return createGrid(el, {
        columns: [
          { id: 'id',    field: 'id',    header: 'ID',    width: 80, type: 'number' },
          { id: 'name',  field: 'name',  header: 'Name',  flex: 1 },
          { id: 'team',  field: 'team',  header: 'Team',  width: 120 },
          { id: 'score', field: 'score', header: 'Score', width: 100, type: 'number' },
        ],
        rowKey: 'id',
        displayMode: 'infinite',
        infiniteScroll: {
          mode: 'server',
          initialLoadSize: 50,
          loadMoreSize: 30,
          onLoadMore: async ({ offset, loadSize }) => {
            await new Promise(r => setTimeout(r, 200));
            const rows = allRows.slice(offset, offset + loadSize);
            return { rows, totalCount: allRows.length, hasMore: offset + rows.length < allRows.length };
          },
        },
      });
    },
  },

  // ────────────────── Editing ───────────────────────────
  {
    id: 'editing',
    category: 'Editing',
    label: 'Cell Editing',
    desc: '더블클릭으로 셀을 편집합니다. text, number, select, date 에디터를 지원합니다.',
    code: `const grid = createGrid(el, {
  columns: [
    { id: 'name',   field: 'name',   header: 'Name',   flex: 1,  editable: true },
    {
      id: 'status', field: 'status', header: 'Status', width: 120, editable: true,
      editor: 'select',
      editorOptions: { options: ['Active', 'Paused', 'Review'] },
    },
    { id: 'score',  field: 'score',  header: 'Score',  width: 100, type: 'number', editable: true },
    { id: 'joined', field: 'joined', header: 'Joined', width: 130, editable: true, editor: 'date' },
  ],
  rows: myRows,
  rowKey: 'id',
  editing: { enabled: true },
});`,
    setup(el) {
      return createGrid(el, {
        columns: [
          { id: 'name',   field: 'name',   header: 'Name',   flex: 1,  editable: true },
          { id: 'status', field: 'status', header: 'Status', width: 120, editable: true,
            editor: 'select', editorOptions: { options: STATUSES } },
          { id: 'score',  field: 'score',  header: 'Score',  width: 100, type: 'number', editable: true },
          { id: 'joined', field: 'joined', header: 'Joined', width: 130, editable: true, editor: 'date' },
        ],
        rows: makeRows(100),
        rowKey: 'id',
        editing: { enabled: true },
      });
    },
  },

  {
    id: 'undo-redo',
    category: 'Editing',
    label: 'Undo / Redo',
    desc: '편집 후 Ctrl+Z / Ctrl+Y 또는 API로 실행 취소·재실행합니다.',
    code: `const grid = createGrid(el, {
  columns: [...],
  rows: myRows,
  rowKey: 'id',
  editing: { enabled: true },
});

// API 사용
if (grid.canUndo()) grid.undo();
if (grid.canRedo()) grid.redo();`,
    setup(el) {

      const grid = createGrid(el, {
        columns: [
          { id: 'name',   field: 'name',   header: 'Name (더블클릭하여 편집)', flex: 1, editable: true },
          { id: 'status', field: 'status', header: 'Status', width: 120, editable: true,
            editor: 'select', editorOptions: { options: STATUSES } },
          { id: 'score',  field: 'score',  header: 'Score',  width: 100, type: 'number', editable: true },
        ],
        rows: makeRows(80),
        rowKey: 'id',
        editing: { enabled: true },
      });
      return grid;
    },
  },

  // ────────────────── Real-time ─────────────────────────
  {
    id: 'live-streaming',
    category: 'Real-time',
    label: 'Live Streaming',
    desc: 'liveAddRows로 실시간으로 행을 추가합니다. 스크롤 위치를 유지하며 새 데이터를 표시합니다.',
    code: `const grid = createGrid(el, {
  columns: [...],
  rows: initialRows,
  rowKey: 'id',
  liveUpdates: {
    enabled: true,
    maxRows: 500,         // 최대 행 수
    rowAnimationEnabled: true,
  },
});

// 새 행 추가
grid.liveAddRows(newRows);

// 일시 정지 / 재개
grid.pauseLiveUpdates();
grid.resumeLiveUpdates();`,
    setup(el) {

      let counter = 200;
      const grid = createGrid(el, {
        columns: [
          { id: 'id',     field: 'id',     header: 'ID',     width: 80, type: 'number' },
          { id: 'name',   field: 'name',   header: 'Name',   flex: 1 },
          { id: 'status', field: 'status', header: 'Status', width: 110 },
          { id: 'score',  field: 'score',  header: 'Score',  width: 100, type: 'number' },
        ],
        rows: makeRows(50),
        rowKey: 'id',
        liveUpdates: { enabled: true, maxRows: 300, rowAnimationEnabled: true },
      });
      const timer = setInterval(() => {
        counter++;
        grid.liveAddRows([{
          id: counter,
          name: `Stream Op ${counter}`,
          status: STATUSES[counter % STATUSES.length],
          score: 1000 + ((counter * 9) % 9000),
        }]);
      }, 800);
      grid._showcaseCleanup = () => clearInterval(timer);
      return grid;
    },
  },

  // ────────────────── Export ────────────────────────────
  {
    id: 'export',
    category: 'Export',
    label: 'CSV & Excel Export',
    desc: 'downloadCsv / downloadXlsx로 현재 데이터를 내보냅니다.',
    code: `import { createGrid, createXlsxExportPlugin } from 'zenith-grid';

const grid = createGrid(el, {
  columns: [...],
  rows: myRows,
  rowKey: 'id',
  plugins: [
    { plugin: createXlsxExportPlugin({ fileName: 'export.xlsx' }) },
  ],
});

// CSV 다운로드
grid.downloadCsv({ fileName: 'data.csv' });

// Excel 다운로드 (플러그인 필요)
grid.downloadXlsx({ fileName: 'data.xlsx' });

// 선택 행만 내보내기
grid.downloadCsv({ fileName: 'selected.csv', onlySelected: true });`,
    setup(el) {

      const grid = createGrid(el, {
        columns: [
          { id: 'id',     field: 'id',     header: 'ID',     width: 80,  type: 'number' },
          { id: 'name',   field: 'name',   header: 'Name',   flex: 1 },
          { id: 'team',   field: 'team',   header: 'Team',   width: 120 },
          { id: 'status', field: 'status', header: 'Status', width: 120 },
          { id: 'score',  field: 'score',  header: 'Score',  width: 100, type: 'number' },
        ],
        rows: makeRows(100),
        rowKey: 'id',
        plugins: [{ plugin: createXlsxExportPlugin({ fileName: 'zenith-grid-export.xlsx' }) }],
      });
      // 버튼 UI
      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex;gap:8px;padding:8px 0;';
      const btnCsv = document.createElement('button');
      btnCsv.textContent = '⬇ CSV';
      btnCsv.style.cssText = 'padding:5px 12px;border-radius:5px;border:1px solid #38bdf8;background:none;color:#38bdf8;cursor:pointer;font-size:12px;';
      btnCsv.onclick = () => grid.downloadCsv({ fileName: 'zenith-grid.csv' });
      const btnXlsx = document.createElement('button');
      btnXlsx.textContent = '⬇ Excel';
      btnXlsx.style.cssText = btnCsv.style.cssText;
      btnXlsx.onclick = () => grid.downloadXlsx?.({ fileName: 'zenith-grid.xlsx' });
      bar.appendChild(btnCsv);
      bar.appendChild(btnXlsx);
      el.parentElement.insertBefore(bar, el);
      return grid;
    },
  },

  // ────────────────── Enterprise ────────────────────────
  {
    id: 'conditional-format',
    category: 'Enterprise',
    label: 'Conditional Formatting',
    desc: 'conditionalFormat 함수로 값에 따라 셀 스타일을 동적으로 적용합니다.',
    code: `const grid = createGrid(el, {
  columns: [
    { id: 'name', field: 'name', header: 'Name', flex: 1 },
    {
      id: 'score',
      field: 'score',
      header: 'Score',
      width: 110,
      type: 'number',
      conditionalFormat: (value) => {
        if (value >= 8000) return { style: { color: '#34d399', fontWeight: 'bold' } };
        if (value <= 2000) return { style: { color: '#f87171' } };
        return null;
      },
    },
  ],
  rows: myRows,
  rowKey: 'id',
});`,
    setup(el) {
      return createGrid(el, {
        columns: [
          { id: 'name', field: 'name', header: 'Name', flex: 1 },
          { id: 'team', field: 'team', header: 'Team', width: 110 },
          {
            id: 'score', field: 'score', header: 'Score', width: 110, type: 'number',
            conditionalFormat: (value) => {
              if (value >= 8000) return { style: { color: '#34d399', fontWeight: 'bold' } };
              if (value <= 2000) return { style: { color: '#f87171' } };
              return null;
            },
          },
          {
            id: 'age', field: 'age', header: 'Age', width: 90, type: 'number',
            conditionalFormat: (value) => {
              if (value >= 50) return { style: { background: 'rgba(251,191,36,0.15)' } };
              return null;
            },
          },
        ],
        rows: makeRows(200),
        rowKey: 'id',
      });
    },
  },

  {
    id: 'sparklines',
    category: 'Enterprise',
    label: 'Sparklines',
    desc: '셀 안에 미니 라인/바 차트를 렌더링합니다.',
    code: `import { createGrid, createSparklinePlugin } from 'zenith-grid';

const grid = createGrid(el, {
  columns: [
    { id: 'name', field: 'name', header: 'Name', flex: 1 },
    {
      id: 'trend-line',
      field: 'history',
      header: 'Trend (Line)',
      width: 140,
      sparkline: { type: 'line', field: 'history', color: '#38bdf8' },
    },
    {
      id: 'trend-bar',
      field: 'history',
      header: 'Trend (Bar)',
      width: 140,
      sparkline: { type: 'bar', field: 'history', color: '#a78bfa' },
    },
  ],
  rows: myRows,
  rowKey: 'id',
  plugins: [{ plugin: createSparklinePlugin() }],
});`,
    setup(el) {
      return createGrid(el, {
        columns: [
          { id: 'name', field: 'name', header: 'Name', flex: 1 },
          { id: 'trend-line', field: 'history', header: 'Line', width: 140,
            sparkline: { type: 'line', field: 'history', color: '#38bdf8' } },
          { id: 'trend-bar',  field: 'history', header: 'Bar',  width: 140,
            sparkline: { type: 'bar',  field: 'history', color: '#a78bfa' } },
        ],
        rows: makeRows(100),
        rowKey: 'id',
        rowHeight: 44,
        plugins: [{ plugin: createSparklinePlugin() }],
      });
    },
  },

  {
    id: 'formula-plugin',
    category: 'Enterprise',
    label: 'Cell Formulas',
    desc: 'createFormulaPlugin으로 셀 수식(사칙연산, IF, 셀 참조)을 계산합니다. Qty/Unit Price를 더블클릭해 직접 수정해보세요.',
    code: `import { createGrid, createFormulaPlugin } from 'zenith-grid';

// 컬럼 순서가 곧 수식의 열 문자(A, B, C...)입니다.
const columns = [
  { id: 'item',      field: 'item',      header: 'Item',       flex: 1 },       // A
  { id: 'qty',       field: 'qty',       header: 'Qty',        width: 80,  type: 'number', editable: true },  // B
  { id: 'unitPrice', field: 'unitPrice', header: 'Unit Price', width: 110, type: 'number', editable: true },  // C
  { id: 'total',     field: 'total',     header: 'Total',      width: 110, type: 'number' },  // D (수식, 읽기 전용)
  { id: 'tier',      field: 'tier',      header: 'Tier',       width: 90 },      // E (수식, 읽기 전용)
];

const rows = myItems.map((item, i) => {
  const n = i + 1; // 1-based row number, A1 표기와 동일
  return {
    ...item,
    // 필드 값을 '='로 시작하는 문자열로 주면 자동으로 수식 셀이 됩니다.
    // 기본 엔진은 =SUM/=AVG/단일 셀 참조만 이해하지만, 플러그인을 설치하면
    // 사칙연산·IF·VLOOKUP 등 전체 수식을 그대로 쓸 수 있습니다.
    total: \`=B\${n}*C\${n}\`,
    tier: \`=IF(D\${n}>=500,"HIGH",IF(D\${n}>=200,"MID","LOW"))\`,
  };
});

const grid = createGrid(el, {
  columns,
  rows,
  rowKey: 'id',
  editing: { enabled: true },
  plugins: [{ plugin: createFormulaPlugin() }],
});`,
    setup(el) {
      const items = [
        { id: 1, item: 'Keyboard',    qty: 12, unitPrice: 45 },
        { id: 2, item: 'Monitor',     qty: 4,  unitPrice: 220 },
        { id: 3, item: 'Mouse',       qty: 30, unitPrice: 15 },
        { id: 4, item: 'Dock',        qty: 6,  unitPrice: 90 },
        { id: 5, item: 'Webcam',      qty: 10, unitPrice: 55 },
        { id: 6, item: 'Headset',     qty: 8,  unitPrice: 60 },
        { id: 7, item: 'USB Hub',     qty: 20, unitPrice: 12 },
        { id: 8, item: 'Laptop Stand',qty: 5,  unitPrice: 40 },
      ];

      const rows = items.map((item, i) => {
        const n = i + 1;
        return {
          ...item,
          total: `=B${n}*C${n}`,
          tier: `=IF(D${n}>=500,"HIGH",IF(D${n}>=200,"MID","LOW"))`,
        };
      });

      return createGrid(el, {
        columns: [
          { id: 'item',      field: 'item',      header: 'Item',       flex: 1 },
          { id: 'qty',       field: 'qty',       header: 'Qty',        width: 80,  type: 'number', editable: true },
          { id: 'unitPrice', field: 'unitPrice', header: 'Unit Price', width: 110, type: 'number', editable: true },
          { id: 'total',     field: 'total',     header: 'Total',      width: 110, type: 'number' },
          {
            id: 'tier', field: 'tier', header: 'Tier', width: 90,
            conditionalFormat: (value) => {
              if (value === 'HIGH') return { style: { color: '#34d399', fontWeight: 'bold' } };
              if (value === 'LOW') return { style: { color: '#f87171' } };
              return null;
            },
          },
        ],
        rows,
        rowKey: 'id',
        editing: { enabled: true },
        plugins: [{ plugin: createFormulaPlugin() }],
      });
    },
  },

  {
    id: 'context-menu',
    category: 'Enterprise',
    label: 'Context Menu',
    desc: '우클릭 컨텍스트 메뉴를 커스터마이징합니다.',
    code: `import { createGrid, createContextMenuPlugin } from 'zenith-grid';

const grid = createGrid(el, {
  columns: [...],
  rows: myRows,
  rowKey: 'id',
  plugins: [
    {
      plugin: createContextMenuPlugin({
        getItems: ({ type, row, column, core }) => {
          if (type === 'cell') {
            return [
              {
                label: 'Copy Row',
                action: () => navigator.clipboard.writeText(JSON.stringify(row)),
              },
              { type: 'separator' },
              {
                label: 'Filter by Team',
                action: () => core.setColumnFilter('team', {
                  type: 'select', value: [row.team],
                }),
              },
            ];
          }
          return [];
        },
      }),
    },
  ],
});`,
    setup(el) {
      return createGrid(el, {
        columns: [
          { id: 'name',   field: 'name',   header: 'Name',   flex: 1 },
          { id: 'team',   field: 'team',   header: 'Team',   width: 120 },
          { id: 'status', field: 'status', header: 'Status', width: 120 },
          { id: 'score',  field: 'score',  header: 'Score',  width: 100, type: 'number' },
        ],
        rows: makeRows(100),
        rowKey: 'id',
        plugins: [{
          plugin: createContextMenuPlugin({
            getItems: ({ type, row, column, core }) => {
              if (type === 'cell') return [
                { label: 'Copy Row JSON', action: () => {
                  navigator.clipboard?.writeText(JSON.stringify(row, null, 2));
                }},
                { type: 'separator' },
                { label: `Filter: Team = ${row.team}`, action: () => {
                  core.setColumnFilter?.('team', { type: 'select', value: [row.team] });
                }},
              ];
              if (type === 'header' && column) return [
                { label: 'Auto-size Column', action: () => core.autoSizeColumn(column.def.id) },
                { label: `Hide "${column.def.header}"`, action: () => core.setColumnVisible(column.def.id, false) },
              ];
              return [];
            },
          }),
        }],
      });
    },
  },

  {
    id: 'pinned-rows',
    category: 'Enterprise',
    label: 'Pinned Rows',
    desc: '특정 행을 상단 또는 하단에 고정합니다.',
    code: `const grid = createGrid(el, {
  columns: [...],
  rows: myRows,
  rowKey: 'id',
});

// 상단 고정
grid.setPinnedTopRows([{ id: 'pinned', name: '📌 Pinned Row', score: 9999 }]);

// 하단 고정 (합계 행 등)
grid.setPinnedBottomRows([{ id: 'total', name: 'Total', score: totalScore }]);

// 해제
grid.setPinnedTopRows([]);`,
    setup(el) {

      const rows = makeRows(100);
      const total = rows.reduce((s, r) => s + r.score, 0);
      const grid = createGrid(el, {
        columns: [
          { id: 'id',    field: 'id',    header: 'ID',    width: 80, type: 'number' },
          { id: 'name',  field: 'name',  header: 'Name',  flex: 1 },
          { id: 'team',  field: 'team',  header: 'Team',  width: 120 },
          { id: 'score', field: 'score', header: 'Score', width: 100, type: 'number' },
        ],
        rows,
        rowKey: 'id',
      });
      grid.setPinnedTopRows([{ id: '__top', name: '📌 Pinned Header Row', team: '—', score: 0 }]);
      grid.setPinnedBottomRows([{ id: '__total', name: '∑ Total', team: '—', score: total }]);
      return grid;
    },
  },
];
