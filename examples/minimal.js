import "../src/styles/tokens.css";
import "../src/styles/grid.css";
import { createGrid } from "../src/index.js";

const columns = [
  { field: "id",       headerName: "ID",      width: 70 },
  { field: "name",     headerName: "이름",    width: 130 },
  { field: "dept",     headerName: "부서",    width: 120 },
  { field: "salary",   headerName: "연봉",    width: 110, type: "number" },
  { field: "status",   headerName: "상태",    width: 100 },
  { field: "joinDate", headerName: "입사일",  width: 120 },
  { field: "score",    headerName: "평가점수", width: 100, type: "number" },
];

const rows = Array.from({ length: 50 }, (_, i) => ({
  id: i + 1,
  name: ["김민준", "이서연", "박지훈", "최아린", "정도윤"][i % 5],
  dept: ["개발", "디자인", "마케팅", "인사", "재무"][i % 5],
  salary: 40000000 + (i % 7) * 5000000,
  status: ["재직", "휴직", "퇴직"][i % 3],
  joinDate: `202${Math.floor(i / 10)}-0${(i % 9) + 1}-15`,
  score: Math.round(60 + (i % 40) * 1.0),
}));

const shared = {
  columns,
  rows,
  displayMode: "paginated",
  pagination: { pageSize: 15 },
  selectionMode: "single",
};

createGrid(document.getElementById("grid-light"), shared);
createGrid(document.getElementById("grid-dark"),  shared);
