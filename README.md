# Fish Game Backend

从 `wakaka-sam/fishing-game` 拆出的 Node.js 后端服务。生产环境使用 MySQL 存储用户存档、兑换码和排名奖励。

## 本地运行

```bash
npm start
PORT=3456 npm start
DATA_DIR=/path/to/data npm start
```

服务默认监听 `3000`。未配置 `MYSQL_URL` 时会使用本地文件存储，方便测试和本地开发。

## MySQL 存储

生产环境配置 `MYSQL_URL` 后会自动创建表：

```bash
MYSQL_URL='mysql://fish_user:password@127.0.0.1:3306/fish_backend' npm start
```

可选环境变量：

| Name | Description |
| --- | --- |
| `MYSQL_URL` | MySQL 连接串，配置后默认启用 MySQL 存储 |
| `STORAGE_DRIVER` | `mysql` 或 `file`，需要强制指定存储类型时使用 |
| `MYSQL_POOL_LIMIT` | MySQL 连接池大小，默认 `10` |
| `PORT` | 服务端口，默认 `3000` |
| `CORS_ORIGIN` | CORS 允许来源，默认 `*` |
| `OPS_ADMIN_TOKEN` | 运维平台访问令牌；配置后访问数据库信息接口需要 Bearer Token |

## 运维平台

服务内置一个只读运维页面，用于查看当前后端连接的数据库信息：

```bash
MYSQL_URL='mysql://fish_user:password@127.0.0.1:3306/fish_backend' \
OPS_ADMIN_TOKEN='change-me' \
npm start
```

打开：

```text
http://<gz-server-host>:3000/ops/
```

当前支持查看：

- MySQL 连接摘要、库名、用户、版本和连接池大小
- 数据表列表、行数、数据大小、索引大小和更新时间
- 字段结构和索引信息

如果 `OPS_ADMIN_TOKEN` 已配置，需要在页面右上角输入 token；也可以直接调用接口：

```bash
curl -H 'Authorization: Bearer change-me' http://<gz-server-host>:3000/api/admin/db-info
```

## API

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/login` | `POST` | 加载或创建用户存档 |
| `/api/save` | `POST` | 保存用户状态 |
| `/api/gacha` | `POST` | 金币/钻石抽奖 |
| `/api/redeem` | `POST` | 兑换码 |
| `/api/leaderboard` | `GET` | 排行榜 |
| `/api/rank-history` | `GET` | 排名奖励历史 |
| `/api/admin/db-info` | `GET` | 运维平台数据库信息 |

## 测试

```bash
npm test
```

测试会使用临时 `DATA_DIR`，不会污染本地运行数据。
