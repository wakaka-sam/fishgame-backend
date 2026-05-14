const tokenForm = document.querySelector('#tokenForm');
const tokenInput = document.querySelector('#tokenInput');
const statusLine = document.querySelector('#statusLine');
const metrics = document.querySelector('#metrics');
const connectionDetails = document.querySelector('#connectionDetails');
const tablesBody = document.querySelector('#tablesBody');
const columnsList = document.querySelector('#columnsList');
const indexesList = document.querySelector('#indexesList');

const savedToken = localStorage.getItem('fish_ops_token') || '';
tokenInput.value = savedToken;

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '-';
  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
}

function text(value) {
  return value === null || value === undefined || value === '' ? '-' : String(value);
}

function escapeHtml(value) {
  return text(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderDetails(connection) {
  connectionDetails.innerHTML = '';
  Object.entries(connection || {}).forEach(([key, value]) => {
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = key;
    dd.textContent = text(value);
    connectionDetails.append(dt, dd);
  });
}

function renderMetrics(info) {
  const summary = info.summary || {};
  const items = [
    ['存储', info.storageDriver || '-'],
    ['数据表', formatNumber(summary.tableCount || info.tables?.length || 0)],
    ['总行数', formatNumber(summary.totalRows || summary.userCount || 0)],
    ['总容量', formatBytes(summary.totalBytes || 0)],
  ];
  metrics.innerHTML = items.map(([label, value]) => `
    <div class="metric">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `).join('');
}

function renderTables(tables) {
  tablesBody.innerHTML = '';
  (tables || []).forEach((table) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${escapeHtml(table.name)}</td>
      <td>${formatNumber(table.rowCount ?? table.estimatedRows)}</td>
      <td>${escapeHtml(table.engine)}</td>
      <td>${formatBytes(table.dataLength)}</td>
      <td>${formatBytes(table.indexLength)}</td>
      <td>${formatDate(table.updateTime)}</td>
    `;
    tablesBody.append(row);
  });
}

function renderList(container, items, renderItem) {
  container.innerHTML = '';
  if (!items || items.length === 0) {
    container.innerHTML = '<p class="empty">暂无数据</p>';
    return;
  }
  items.forEach((item) => {
    const el = document.createElement('div');
    el.className = 'list-item';
    el.innerHTML = renderItem(item);
    container.append(el);
  });
}

function render(info) {
  renderMetrics(info);
  renderDetails(info.connection);
  renderTables(info.tables);
  renderList(columnsList, info.columns, (column) => `
    <strong>${escapeHtml(column.tableName)}.${escapeHtml(column.name)}</strong>
    <span>${escapeHtml(column.type)} · ${column.nullable === 'YES' ? 'nullable' : 'not null'} · ${escapeHtml(column.columnKey || column.extra)}</span>
  `);
  renderList(indexesList, info.indexes, (index) => `
    <strong>${escapeHtml(index.tableName)}.${escapeHtml(index.name)}</strong>
    <span>${index.unique ? 'unique' : 'non-unique'} · ${escapeHtml(index.columns)}</span>
  `);
}

async function loadInfo() {
  const token = tokenInput.value.trim();
  localStorage.setItem('fish_ops_token', token);
  statusLine.className = 'status-line';
  statusLine.textContent = '正在读取数据库信息...';

  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch('/api/admin/db-info', { headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  render(body);
  statusLine.textContent = `最后刷新：${formatDate(body.generatedAt)}`;
}

tokenForm.addEventListener('submit', (event) => {
  event.preventDefault();
  loadInfo().catch((error) => {
    statusLine.className = 'status-line error';
    statusLine.textContent = `读取失败：${error.message}`;
  });
});

loadInfo().catch((error) => {
  statusLine.className = 'status-line error';
  statusLine.textContent = `读取失败：${error.message}`;
});
