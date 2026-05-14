# Fish Game Backend

从 `wakaka-sam/fishing-game` 拆出的纯 Node.js 后端服务，无外部依赖。

## 本地运行

```bash
npm start
PORT=3456 npm start
DATA_DIR=/path/to/data npm start
```

服务默认监听 `3000`，运行数据默认保存在 `./data`。

## API

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/login` | `POST` | 加载或创建用户存档 |
| `/api/save` | `POST` | 保存用户状态 |
| `/api/gacha` | `POST` | 金币/钻石抽奖 |
| `/api/redeem` | `POST` | 兑换码 |
| `/api/leaderboard` | `GET` | 排行榜 |
| `/api/rank-history` | `GET` | 排名奖励历史 |

## 测试

```bash
npm test
```

测试会使用临时 `DATA_DIR`，不会污染本地运行数据。
