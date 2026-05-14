const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const OPS_PUBLIC = path.join(ROOT, 'ops_public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const USERS_DIR = path.join(DATA_DIR, 'users');

const CODES_FILE = path.join(DATA_DIR, 'codes.json');
const REWARDS_FILE = path.join(DATA_DIR, 'rewards.json');
const STORAGE_DRIVER = process.env.STORAGE_DRIVER || (process.env.MYSQL_URL ? 'mysql' : 'file');

function bjNow() { return new Date(Date.now() + 8 * 3600000); }
function bjDateStr(d) { return d.toISOString().slice(0, 10); }
function bjMinutes(d) { return d.getUTCHours() * 60 + d.getUTCMinutes(); }

async function loadRewards() {
  await store.init();
  return (await store.getRewards()) || { lastSettleDate: '', history: [] };
}
async function saveRewards(r) {
  await store.init();
  await store.saveRewards(r);
}

async function settleRankReward(settleDate = bjDateStr(bjNow())) {
  const rewards = await loadRewards();
  if (rewards.lastSettleDate >= settleDate) return;

  let topUser = null;
  let topCatches = 0;
  const users = await store.listUsers();
  for (const u of users) {
    try {
      const daily = (u.dailyStats && u.dailyStats.date === settleDate) ? u.dailyStats : null;
      if (daily && (daily.catches || 0) > topCatches) {
        topCatches = daily.catches;
        topUser = u.username;
      }
    } catch (_) {}
  }

  if (topUser && topCatches > 0) {
    const u = await loadUser(topUser);
    u.diamonds = (u.diamonds || 0) + 5000;
    if (!u.rankRewards) u.rankRewards = [];
    u.rankRewards.push({ date: settleDate, catches: topCatches, diamonds: 5000, seen: false });
    await saveUser(u);
    rewards.history.unshift({ date: settleDate, username: topUser, catches: topCatches, diamonds: 5000 });
    if (rewards.history.length > 30) rewards.history = rewards.history.slice(0, 30);
    console.log(`[排名奖励] ${settleDate} 钓鱼数第一名: ${topUser} (${topCatches}次) 获得5000钻石`);
  }
  rewards.lastSettleDate = settleDate;
  await saveRewards(rewards);
}

function scheduleSettlement() {
  const today = bjDateStr(bjNow());
  const target = new Date(`${today}T15:59:00.000Z`);
  if (Date.now() >= target.getTime()) target.setUTCDate(target.getUTCDate() + 1);
  const ms = target.getTime() - Date.now();
  console.log(`[排名奖励] 下次结算时间: ${bjDateStr(target)} 23:59 北京时间 (${Math.round(ms/60000)}分钟后)`);
  setTimeout(() => {
    settleRankReward(bjDateStr(bjNow())).catch((e) => console.error('[排名奖励] 结算失败:', e));
    scheduleSettlement();
  }, ms);
}

async function settleRankRewardIfDue() {
  const now = bjNow();
  if (bjMinutes(now) >= 23 * 60 + 59) await settleRankReward(bjDateStr(now));
}

const DEFAULT_CODES = {
  'WELCOME2024': { coins: 500, desc: '欢迎礼包', usedBy: [] },
  'FISHING666': { coins: 200, desc: '钓鱼大吉', usedBy: [] },
  'GOLDENROD': { coins: 1000, desc: '黄金鱼竿基金', usedBy: [] },
  'LUCKYDAY': { coins: 300, desc: '幸运日', usedBy: [] },
  'VIP888': { coins: 888, desc: 'VIP大礼', usedBy: [] },
  'WAKAKA_NB': { coins: 0, diamonds: 900, desc: 'WAKAKA钻石大礼', usedBy: [] },
  'WAKAKA666': { coins: 0, diamonds: 10000, desc: '神秘钻石宝藏', usedBy: [] },
};

const GACHA_ACCESSORIES = ['scale_charm', 'tide_bracelet', 'star_brooch'];

function createAccessory(type) {
  return {
    uid: 'acc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
    type,
    star: 1,
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseStoredJson(value) {
  if (!value) return null;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function maskConnectionUri(uri) {
  if (!uri) return '';
  try {
    const parsed = new URL(uri);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch (_) {
    return uri.replace(/:\/\/([^:\s]+):([^@\s]+)@/, '://$1:***@');
  }
}

function quoteIdentifier(name) {
  return '`' + String(name).replace(/`/g, '``') + '`';
}

function createFileStore() {
  return {
    async init() {
      if (!fs.existsSync(USERS_DIR)) fs.mkdirSync(USERS_DIR, { recursive: true });
    },
    async getUser(name) {
      const p = userPath(name);
      return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
    },
    async saveUser(user) {
      fs.writeFileSync(userPath(user.username), JSON.stringify(user, null, 2));
    },
    async listUsers() {
      if (!fs.existsSync(USERS_DIR)) return [];
      const files = fs.readdirSync(USERS_DIR).filter(f => f.endsWith('.json'));
      return files.flatMap((f) => {
        try {
          return [JSON.parse(fs.readFileSync(path.join(USERS_DIR, f), 'utf8'))];
        } catch (_) {
          return [];
        }
      });
    },
    async getCodes() {
      return fs.existsSync(CODES_FILE) ? JSON.parse(fs.readFileSync(CODES_FILE, 'utf8')) : {};
    },
    async saveCodes(codes) {
      fs.writeFileSync(CODES_FILE, JSON.stringify(codes, null, 2));
    },
    async getRewards() {
      return fs.existsSync(REWARDS_FILE) ? JSON.parse(fs.readFileSync(REWARDS_FILE, 'utf8')) : null;
    },
    async saveRewards(rewards) {
      fs.writeFileSync(REWARDS_FILE, JSON.stringify(rewards, null, 2));
    },
    async getDbInfo() {
      const users = await this.listUsers();
      const files = fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR).sort() : [];
      return {
        storageDriver: 'file',
        generatedAt: new Date().toISOString(),
        connection: {
          mode: 'local files',
          dataDir: DATA_DIR,
        },
        summary: {
          userCount: users.length,
          dataFiles: files.length,
        },
        tables: [
          { name: 'users/*.json', rowCount: users.length, engine: 'filesystem', comment: 'User archives' },
          { name: 'codes.json', rowCount: fs.existsSync(CODES_FILE) ? 1 : 0, engine: 'filesystem', comment: 'Redeem codes' },
          { name: 'rewards.json', rowCount: fs.existsSync(REWARDS_FILE) ? 1 : 0, engine: 'filesystem', comment: 'Rank rewards' },
        ],
        columns: [],
        indexes: [],
      };
    },
  };
}

function createMysqlStore() {
  let pool = null;
  let initPromise = null;

  async function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      if (!process.env.MYSQL_URL) throw new Error('MYSQL_URL is required when STORAGE_DRIVER=mysql');
      const mysql = require('mysql2/promise');
      pool = mysql.createPool({
        uri: process.env.MYSQL_URL,
        waitForConnections: true,
        connectionLimit: Number(process.env.MYSQL_POOL_LIMIT || 10),
      });
      await pool.query(`
        CREATE TABLE IF NOT EXISTS fish_users (
          username VARCHAR(32) PRIMARY KEY,
          data LONGTEXT NOT NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS fish_kv (
          name VARCHAR(64) PRIMARY KEY,
          data LONGTEXT NOT NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    })();
    return initPromise;
  }

  async function getKv(name) {
    await init();
    const [rows] = await pool.execute('SELECT data FROM fish_kv WHERE name = ?', [name]);
    return rows[0] ? parseStoredJson(rows[0].data) : null;
  }

  async function setKv(name, value) {
    await init();
    await pool.execute(
      'INSERT INTO fish_kv (name, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)',
      [name, JSON.stringify(value)]
    );
  }

  async function getDbInfo() {
    await init();
    const [[versionRow]] = await pool.query('SELECT VERSION() AS version, DATABASE() AS databaseName, CURRENT_USER() AS currentUser');
    const databaseName = versionRow.databaseName;
    const [tableRows] = await pool.execute(
      `SELECT TABLE_NAME AS name,
              ENGINE AS engine,
              TABLE_ROWS AS estimatedRows,
              DATA_LENGTH AS dataLength,
              INDEX_LENGTH AS indexLength,
              CREATE_TIME AS createTime,
              UPDATE_TIME AS updateTime,
              TABLE_COMMENT AS comment
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_NAME`,
      [databaseName]
    );
    const [columnRows] = await pool.execute(
      `SELECT TABLE_NAME AS tableName,
              COLUMN_NAME AS name,
              COLUMN_TYPE AS type,
              IS_NULLABLE AS nullable,
              COLUMN_KEY AS columnKey,
              COLUMN_DEFAULT AS defaultValue,
              EXTRA AS extra,
              COLUMN_COMMENT AS comment
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [databaseName]
    );
    const [indexRows] = await pool.execute(
      `SELECT TABLE_NAME AS tableName,
              INDEX_NAME AS name,
              NON_UNIQUE AS nonUnique,
              GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ', ') AS columns
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ?
        GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE
        ORDER BY TABLE_NAME, INDEX_NAME`,
      [databaseName]
    );

    const tables = [];
    for (const table of tableRows) {
      let rowCount = null;
      try {
        const [[countRow]] = await pool.query(`SELECT COUNT(*) AS rowCount FROM ${quoteIdentifier(table.name)}`);
        rowCount = Number(countRow.rowCount);
      } catch (_) {}
      tables.push({
        ...table,
        rowCount,
        dataLength: Number(table.dataLength || 0),
        indexLength: Number(table.indexLength || 0),
      });
    }

    return {
      storageDriver: 'mysql',
      generatedAt: new Date().toISOString(),
      connection: {
        uri: maskConnectionUri(process.env.MYSQL_URL),
        database: databaseName,
        currentUser: versionRow.currentUser,
        version: versionRow.version,
        poolLimit: Number(process.env.MYSQL_POOL_LIMIT || 10),
      },
      summary: {
        tableCount: tables.length,
        totalRows: tables.reduce((sum, table) => sum + (table.rowCount || 0), 0),
        totalBytes: tables.reduce((sum, table) => sum + (table.dataLength || 0) + (table.indexLength || 0), 0),
      },
      tables,
      columns: columnRows,
      indexes: indexRows.map((index) => ({ ...index, unique: Number(index.nonUnique) === 0 })),
    };
  }

  return {
    init,
    async getUser(name) {
      await init();
      const [rows] = await pool.execute('SELECT data FROM fish_users WHERE username = ?', [name]);
      return rows[0] ? parseStoredJson(rows[0].data) : null;
    },
    async saveUser(user) {
      await init();
      await pool.execute(
        'INSERT INTO fish_users (username, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)',
        [user.username, JSON.stringify(user)]
      );
    },
    async listUsers() {
      await init();
      const [rows] = await pool.execute('SELECT data FROM fish_users');
      return rows.flatMap((row) => {
        try {
          return [parseStoredJson(row.data)];
        } catch (_) {
          return [];
        }
      });
    },
    getCodes: () => getKv('codes'),
    saveCodes: (codes) => setKv('codes', codes),
    getRewards: () => getKv('rewards'),
    saveRewards: (rewards) => setKv('rewards', rewards),
    getDbInfo,
  };
}

function createStore() {
  if (STORAGE_DRIVER === 'mysql') return createMysqlStore();
  return createFileStore();
}

const store = createStore();

async function loadCodes() {
  await store.init();
  let codes = (await store.getCodes()) || {};
  let updated = false;
  for (const [key, val] of Object.entries(DEFAULT_CODES)) {
    if (!codes[key]) { codes[key] = cloneJson(val); updated = true; }
  }
  if (updated) await store.saveCodes(codes);
  return codes;
}

async function saveCodes(codes) {
  await store.init();
  await store.saveCodes(codes);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const CACHEABLE_EXTS = new Set(['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico']);

function sanitize(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9_\-]/g, '').slice(0, 24);
}

function userPath(name) {
  return path.join(USERS_DIR, sanitize(name) + '.json');
}

function defaultUser(name) {
  return {
    username: name,
    vip: false,
    money: 100,
    diamonds: 0,
    baits: { worm: 5, black_silk: 0, divine: 0, jb: 0 },
    currentBait: 'worm',
    dex: {}, // fishId -> { count, maxWeight }
    stats: { totalCatches: 0, totalEarned: 0, totalDiamonds: 0 },
    history: [], // last 50 catches
    lastShareDate: '',
    rodSkin: '',
    dailyStats: { date: '', catches: 0, weight: 0 },
    ownedRods: [],
    ownedPets: [],
    activePet: null,
    ownedCharacters: ['fishing_master'],
    activeCharacter: 'fishing_master',
    characterFragments: {},
    accessories: [],
    equippedAccessory: null,
    rankRewards: [],
  };
}

async function loadUser(name) {
  await store.init();
  const existing = await store.getUser(name);
  if (!existing) {
    const u = defaultUser(name);
    await store.saveUser(u);
    return u;
  }
  const defaults = defaultUser(name);
  return {
    ...defaults,
    ...existing,
    vip: existing.vip === true,
    money: Math.max(0, Math.floor(existing.money ?? defaults.money)),
    diamonds: Math.max(0, Math.floor(existing.diamonds ?? defaults.diamonds)),
    baits: { ...defaults.baits, ...(existing.baits || {}) },
    dex: existing.dex || defaults.dex,
    stats: { ...defaults.stats, ...(existing.stats || {}) },
    history: existing.history || defaults.history,
    dailyStats: existing.dailyStats || defaults.dailyStats,
    ownedRods: existing.ownedRods || defaults.ownedRods,
    ownedPets: existing.ownedPets || defaults.ownedPets,
    activePet: existing.activePet ?? defaults.activePet,
    ownedCharacters: Array.isArray(existing.ownedCharacters) ? existing.ownedCharacters : defaults.ownedCharacters,
    activeCharacter: existing.activeCharacter || defaults.activeCharacter,
    characterFragments: existing.characterFragments || defaults.characterFragments,
    accessories: Array.isArray(existing.accessories) ? existing.accessories : defaults.accessories,
    equippedAccessory: existing.equippedAccessory ?? defaults.equippedAccessory,
  };
}

async function saveUser(user) {
  await store.init();
  await store.saveUser(user);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => { buf += c; if (buf.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(buf ? JSON.parse(buf) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function json(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(obj));
}

function getAssetVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(PUBLIC, 'version.json'), 'utf8')).version || 'dev';
  } catch (_) {
    return 'dev';
  }
}

function getVersionMtimeMs() {
  try {
    return fs.statSync(path.join(PUBLIC, 'version.json')).mtimeMs;
  } catch (_) {
    return 0;
  }
}

function withAssetVersion(pathname, data) {
  if (pathname !== '/index.html') return data;
  const version = encodeURIComponent(getAssetVersion());
  return Buffer.from(data.toString('utf8').replace(/__ASSET_VERSION__/g, version));
}

function staticHeaders(pathname, ext, versioned, mtime, data) {
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Last-Modified': mtime.toUTCString(),
    ETag: '"' + crypto.createHash('sha1').update(data).digest('hex') + '"',
  };

  if (pathname === '/index.html' || pathname === '/version.json') {
    headers['Cache-Control'] = 'no-cache';
  } else if (CACHEABLE_EXTS.has(ext)) {
    headers['Cache-Control'] = versioned
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=3600';
  } else {
    headers['Cache-Control'] = 'no-cache';
  }

  return headers;
}

function clientHasFreshCopy(req, headers) {
  const ifNoneMatch = req.headers['if-none-match'];
  if (ifNoneMatch && ifNoneMatch.split(/\s*,\s*/).includes(headers.ETag)) return true;

  const ifModifiedSince = req.headers['if-modified-since'];
  if (!ifModifiedSince) return false;
  const since = Date.parse(ifModifiedSince);
  const modified = Date.parse(headers['Last-Modified']);
  return Number.isFinite(since) && Number.isFinite(modified) && modified <= since;
}

function serveStatic(req, res) {
  return serveStaticFrom(req, res, PUBLIC, '');
}

function serveOpsStatic(req, res) {
  return serveStaticFrom(req, res, OPS_PUBLIC, '/ops');
}

function serveStaticFrom(req, res, rootDir, mountPath) {
  const parsed = new URL(req.url, 'http://localhost');
  let p;
  try {
    p = decodeURIComponent(parsed.pathname);
  } catch (_) {
    res.writeHead(400);
    return res.end('Bad request');
  }
  if (mountPath && (p === mountPath || p === mountPath + '/')) p = mountPath + '/index.html';
  if (mountPath && p.startsWith(mountPath + '/')) p = p.slice(mountPath.length);
  if (p === '/') p = '/index.html';
  const file = path.resolve(rootDir, '.' + p);
  const rel = path.relative(rootDir, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (statErr, stat) => {
    if (statErr || !stat.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(file);
    fs.readFile(file, (err, raw) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      const data = withAssetVersion(p, raw);
      const mtimeMs = p === '/index.html' ? Math.max(stat.mtimeMs, getVersionMtimeMs()) : stat.mtimeMs;
      const headers = staticHeaders(p, ext, parsed.searchParams.has('v'), new Date(mtimeMs), data);
      if (clientHasFreshCopy(req, headers)) {
        res.writeHead(304, headers);
        return res.end();
      }
      res.writeHead(200, headers);
      res.end(data);
    });
  });
}

function isOpsAuthorized(req) {
  const token = process.env.OPS_ADMIN_TOKEN;
  if (!token) return true;
  const auth = req.headers.authorization || '';
  if (auth === `Bearer ${token}`) return true;
  const parsed = new URL(req.url, 'http://localhost');
  return parsed.searchParams.get('token') === token;
}

async function getLeaderboard() {
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const entries = [];
  const users = await store.listUsers();
  for (const u of users) {
    try {
      const daily = (u.dailyStats && u.dailyStats.date === today) ? u.dailyStats : { catches: 0, weight: 0 };
      entries.push({
        username: u.username,
        todayCatches: daily.catches || 0,
        todayWeight: +(daily.weight || 0).toFixed(2),
        totalCatches: (u.stats && u.stats.totalCatches) || 0,
        totalWeight: +((u.stats && u.stats.totalWeight) || 0).toFixed(2),
      });
    } catch (_) {}
  }
  return entries;
}

function createServer() {
  return http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    });
    return res.end();
  }

  if (req.url.startsWith('/api/')) {
    try {
      if (req.url.startsWith('/api/admin/db-info')) {
        if (!isOpsAuthorized(req)) return json(res, 401, { error: 'unauthorized' });
        await store.init();
        return json(res, 200, await store.getDbInfo());
      }
      if (req.url === '/api/leaderboard') {
        return json(res, 200, await getLeaderboard());
      }
      if (req.url === '/api/rank-history') {
        const rewards = await loadRewards();
        return json(res, 200, { history: rewards.history || [] });
      }

      const body = req.method === 'POST' ? await readBody(req) : {};
      const name = sanitize(body.username || '');
      if (!name) return json(res, 400, { error: '用户名无效' });

      if (req.url === '/api/login') {
        const user = await loadUser(name);
        const unseen = (user.rankRewards || []).filter(r => !r.seen);
        if (unseen.length > 0) {
          unseen.forEach(r => r.seen = true);
          await saveUser(user);
        }
        return json(res, 200, { ...user, pendingRankRewards: unseen });
      }
      if (req.url === '/api/save') {
        // 客户端发送整个 user state，做最小校验
        const existing = await loadUser(name);
        const incoming = body.state || {};
        // 服务器是权威——但简化：信任客户端，仅做基本字段保护
        const merged = {
          ...existing,
          vip: existing.vip === true,
          money: Math.max(0, Math.floor(incoming.money ?? existing.money)),
          diamonds: Math.max(0, Math.floor(incoming.diamonds ?? existing.diamonds ?? 0)),
          baits: incoming.baits || existing.baits,
          currentBait: incoming.currentBait || existing.currentBait,
          dex: incoming.dex || existing.dex,
          stats: incoming.stats || existing.stats,
          history: (incoming.history || existing.history).slice(-50),
          lastShareDate: incoming.lastShareDate || existing.lastShareDate || '',
          rodSkin: incoming.rodSkin || existing.rodSkin || '',
          dailyStats: incoming.dailyStats || existing.dailyStats || { date: '', catches: 0, weight: 0 },
          ownedRods: incoming.ownedRods || existing.ownedRods || [],
          ownedPets: incoming.ownedPets || existing.ownedPets || [],
          activePet: incoming.activePet ?? existing.activePet ?? null,
          ownedCharacters: Array.isArray(incoming.ownedCharacters) ? incoming.ownedCharacters : (existing.ownedCharacters || ['fishing_master']),
          activeCharacter: incoming.activeCharacter || existing.activeCharacter || 'fishing_master',
          characterFragments: incoming.characterFragments || existing.characterFragments || {},
          accessories: Array.isArray(incoming.accessories) ? incoming.accessories : (existing.accessories || []),
          equippedAccessory: incoming.equippedAccessory ?? existing.equippedAccessory ?? null,
        };
        await saveUser(merged);
        return json(res, 200, merged);
      }
      if (req.url === '/api/gacha') {
        const count = body.count === 10 ? 10 : 1;
        const currency = body.currency === 'diamonds' ? 'diamonds' : 'coins';
        const season = [1, 2, 3].includes(body.season) ? body.season : 1;
        const cost = currency === 'diamonds'
          ? (count === 1 ? 10 : 90)
          : (season === 2 ? (count === 1 ? 10000 : 100000) : (count === 1 ? 1000 : 9000));
        const u = await loadUser(name);
        u.diamonds = Math.max(0, Math.floor(u.diamonds || 0));
        if (currency === 'diamonds') {
          if (u.diamonds < cost) return json(res, 400, { error: '钻石不足' });
          u.diamonds -= cost;
        } else {
          if ((u.money || 0) < cost) return json(res, 400, { error: '金币不足' });
          u.money -= cost;
        }
        if (!u.ownedRods) u.ownedRods = [];
        if (!u.ownedPets) u.ownedPets = [];
        if (!Array.isArray(u.accessories)) u.accessories = [];
        const results = [];
        for (let i = 0; i < count; i++) {
          const roll = Math.random() * 100;
          if (currency === 'coins' && season === 2) {
            // cat/dog 0.1%, parrot/penguin/rabbit/fox 0.05%, dragon/unicorn 0.01%, diamonds 10%, coins rest
            const petRolls = [
              { threshold: 0.1, id: 'cat' }, { threshold: 0.2, id: 'dog' },
              { threshold: 0.25, id: 'parrot' }, { threshold: 0.30, id: 'penguin' },
              { threshold: 0.35, id: 'rabbit' }, { threshold: 0.40, id: 'fox' },
              { threshold: 0.41, id: 'dragon' }, { threshold: 0.42, id: 'unicorn' },
            ];
            let matched = null;
            for (const p of petRolls) {
              if (roll < p.threshold) { matched = p.id; break; }
            }
            if (matched) {
              results.push({ type: 'pet', id: matched });
              if (!u.ownedPets.includes(matched)) u.ownedPets.push(matched);
            } else if (roll < 10.42) {
              results.push({ type: 'diamonds', diamonds: 10 });
              u.diamonds += 10;
            } else {
              results.push({ type: 'coins', coins: 1 });
              u.money += 1;
            }
          } else if (currency === 'diamonds' && season === 3) {
            if (roll < 10) {
              const item = createAccessory(GACHA_ACCESSORIES[0]);
              u.accessories.push(item);
              results.push({ type: 'accessory', id: item.type, star: item.star });
            } else if (roll < 20) {
              const item = createAccessory(GACHA_ACCESSORIES[1]);
              u.accessories.push(item);
              results.push({ type: 'accessory', id: item.type, star: item.star });
            } else if (roll < 30) {
              const item = createAccessory(GACHA_ACCESSORIES[2]);
              u.accessories.push(item);
              results.push({ type: 'accessory', id: item.type, star: item.star });
            } else {
              results.push({ type: 'coins', coins: 100 });
              u.money += 100;
            }
          } else if (currency === 'diamonds' && season === 2) {
            if (roll < 0.01) {
              results.push({ type: 'rod', id: 'headphone' });
              if (!u.ownedRods.includes('headphone')) u.ownedRods.push('headphone');
            } else if (roll < 1) {
              results.push({ type: 'rod', id: 'candy' });
              if (!u.ownedRods.includes('candy')) u.ownedRods.push('candy');
            } else if (roll < 11) {
              results.push({ type: 'diamonds', diamonds: 10 });
              u.diamonds += 10;
            } else {
              results.push({ type: 'coins', coins: 1000 });
              u.money += 1000;
            }
          } else if (currency === 'diamonds') {
            if (roll < 1) {
              results.push({ type: 'rod', id: 'firekirin' });
              if (!u.ownedRods.includes('firekirin')) u.ownedRods.push('firekirin');
            } else if (roll < 2) {
              results.push({ type: 'rod', id: 'greenxuanwu' });
              if (!u.ownedRods.includes('greenxuanwu')) u.ownedRods.push('greenxuanwu');
            } else if (roll < 10) {
              results.push({ type: 'diamonds', diamonds: 10 });
              u.diamonds += 10;
            } else {
              results.push({ type: 'coins', coins: 1000 });
              u.money += 1000;
            }
          } else if (roll < 10) {
            if (roll < 0.1) {
              results.push({ type: 'rod', id: 'nightmyst' });
              if (!u.ownedRods.includes('nightmyst')) u.ownedRods.push('nightmyst');
            } else if (roll < 1.1) {
              results.push({ type: 'rod', id: 'panda' });
              if (!u.ownedRods.includes('panda')) u.ownedRods.push('panda');
            } else {
              results.push({ type: 'coins', coins: 1000 });
              u.money += 1000;
            }
          } else {
            results.push({ type: 'coins', coins: 1 });
            u.money += 1;
          }
        }
        await saveUser(u);
        return json(res, 200, { results, user: u });
      }
      if (req.url === '/api/redeem') {
        const code = String(body.code || '').trim().toUpperCase();
        if (!code) return json(res, 400, { error: '请输入兑换码' });
        const codes = await loadCodes();
        const entry = codes[code];
        if (!entry) return json(res, 400, { error: '兑换码不存在' });
        if (entry.usedBy.includes(name)) return json(res, 400, { error: '你已经使用过这个兑换码了' });
        entry.usedBy.push(name);
        await saveCodes(codes);
        const u = await loadUser(name);
        if (entry.coins) u.money = (u.money || 0) + entry.coins;
        if (entry.diamonds) u.diamonds = (u.diamonds || 0) + entry.diamonds;
        await saveUser(u);
        return json(res, 200, { success: true, coins: entry.coins || 0, diamonds: entry.diamonds || 0, desc: entry.desc, user: u });
      }
      return json(res, 404, { error: 'unknown api' });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }
  if (req.url === '/ops' || req.url.startsWith('/ops/')) {
    return serveOpsStatic(req, res);
  }
  serveStatic(req, res);
});
}

if (require.main === module) {
  store.init()
    .then(() => {
      const server = createServer();
      server.listen(PORT, () => {
        console.log(`Fishing game backend running at http://localhost:${PORT}`);
        console.log(`Storage driver: ${STORAGE_DRIVER}`);
        settleRankRewardIfDue().catch((e) => console.error('[排名奖励] 检查失败:', e));
        scheduleSettlement();
      });
    })
    .catch((e) => {
      console.error('Failed to initialize storage:', e);
      process.exit(1);
    });
}

module.exports = {
  createServer,
  sanitize,
  defaultUser,
  loadUser,
  saveUser,
  loadCodes,
  getLeaderboard,
  settleRankReward,
};
