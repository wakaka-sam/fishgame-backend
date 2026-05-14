const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-backend-test-'));
process.env.DATA_DIR = tmpRoot;
process.env.CORS_ORIGIN = '*';

const { createServer } = require('../server');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

async function request(base, pathname, options = {}) {
  const res = await fetch(base + pathname, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  return { res, body };
}

test('login creates a sanitized default user', async (t) => {
  const server = createServer();
  t.after(() => server.close());
  const base = await listen(server);

  const { res, body } = await request(base, '/api/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'Player One!!' }),
  });

  assert.equal(res.status, 200);
  assert.equal(body.username, 'playerone');
  assert.equal(body.money, 100);
  assert.equal(body.baits.worm, 5);
  assert.deepEqual(body.ownedCharacters, ['fishing_master']);
  assert.ok(fs.existsSync(path.join(tmpRoot, 'users', 'playerone.json')));
});

test('save preserves server-owned vip and clamps money fields', async (t) => {
  const server = createServer();
  t.after(() => server.close());
  const base = await listen(server);

  await request(base, '/api/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'Saver' }),
  });

  const { res, body } = await request(base, '/api/save', {
    method: 'POST',
    body: JSON.stringify({
      username: 'Saver',
      state: {
        vip: true,
        money: -10,
        diamonds: 9.9,
        history: Array.from({ length: 55 }, (_, i) => ({ i })),
      },
    }),
  });

  assert.equal(res.status, 200);
  assert.equal(body.vip, false);
  assert.equal(body.money, 0);
  assert.equal(body.diamonds, 9);
  assert.equal(body.history.length, 50);
  assert.equal(body.history[0].i, 5);
});

test('redeem applies rewards once per user', async (t) => {
  const server = createServer();
  t.after(() => server.close());
  const base = await listen(server);

  await request(base, '/api/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'Redeemer' }),
  });

  const first = await request(base, '/api/redeem', {
    method: 'POST',
    body: JSON.stringify({ username: 'Redeemer', code: 'WELCOME2024' }),
  });
  assert.equal(first.res.status, 200);
  assert.equal(first.body.coins, 500);
  assert.equal(first.body.user.money, 600);

  const second = await request(base, '/api/redeem', {
    method: 'POST',
    body: JSON.stringify({ username: 'Redeemer', code: 'WELCOME2024' }),
  });
  assert.equal(second.res.status, 400);
  assert.match(second.body.error, /已经使用/);
});

test('gacha charges currency and returns persisted results', async (t) => {
  const server = createServer();
  t.after(() => server.close());
  const base = await listen(server);

  await request(base, '/api/save', {
    method: 'POST',
    body: JSON.stringify({
      username: 'Gacha',
      state: { money: 1000, diamonds: 0, baits: { worm: 5 } },
    }),
  });

  const { res, body } = await request(base, '/api/gacha', {
    method: 'POST',
    body: JSON.stringify({ username: 'Gacha', currency: 'coins', count: 1, season: 1 }),
  });

  assert.equal(res.status, 200);
  assert.equal(body.results.length, 1);
  assert.ok(body.user.money >= 0);
});

test('leaderboard reports daily and total stats', async (t) => {
  const server = createServer();
  t.after(() => server.close());
  const base = await listen(server);
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);

  await request(base, '/api/save', {
    method: 'POST',
    body: JSON.stringify({
      username: 'Ranker',
      state: {
        money: 100,
        dailyStats: { date: today, catches: 3, weight: 12.345 },
        stats: { totalCatches: 9, totalWeight: 45.678 },
      },
    }),
  });

  const { res, body } = await request(base, '/api/leaderboard');
  const ranker = body.find((entry) => entry.username === 'ranker');

  assert.equal(res.status, 200);
  assert.equal(ranker.todayCatches, 3);
  assert.equal(ranker.todayWeight, 12.35);
  assert.equal(ranker.totalCatches, 9);
  assert.equal(ranker.totalWeight, 45.68);
});

test('ops db-info reports storage metadata', async (t) => {
  const server = createServer();
  t.after(() => server.close());
  const base = await listen(server);

  await request(base, '/api/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'OpsUser' }),
  });

  const { res, body } = await request(base, '/api/admin/db-info');

  assert.equal(res.status, 200);
  assert.equal(body.storageDriver, 'file');
  assert.equal(body.connection.mode, 'local files');
  assert.ok(body.summary.userCount >= 1);
  assert.ok(body.tables.some((table) => table.name === 'users/*.json'));
});
