# 中心服务部署

## 安全约束

只要中心服务会被另一台电脑访问，就必须使用 HTTPS。生产模式下，QuotaLab 对非
loopback 监听强制使用 Secure Cookie，并要求反向代理正确传递客户端地址。建议把
服务端口只暴露给同机反向代理，不直接开放到公网。

中心服务只需要一个进程写 SQLite。不要让多个容器同时挂载并写同一个数据库文件。

## Docker Compose + Caddy

要求：一台有公网 80/443 端口的服务器、Docker Compose、以及指向该服务器的 DNS
名称。Caddy 会自动申请和续期 HTTPS 证书。

```bash
cp deploy/compose.env.example .env
# 编辑 .env，把 QUOTALAB_DOMAIN 改成真实域名
docker compose up -d --build
curl https://quota.example.edu/api/health
```

健康检查应返回 `{"status":"ok","version":"0.1.0"}`。SQLite、Caddy 证书与配置存放
在 Docker named volumes 中。只有 Caddy 映射宿主机端口，QuotaLab API 只在 Compose
网络内暴露。

查看日志：

```bash
docker compose logs -f quotalab caddy
```

升级：

```bash
git pull --ff-only
docker compose up -d --build
```

## 备份与恢复

先停止唯一写入进程，确保 WAL 合并，再复制数据库：

```bash
docker compose stop quotalab
container_id=$(docker compose ps -aq quotalab)
docker cp "$container_id:/data/quotalab.db" "./quotalab-$(date +%F).db"
docker compose start quotalab
```

恢复前先停止服务，并保留现有数据库副本。将备份复制为容器内
`/data/quotalab.db` 后再启动；不要只复制 `.db` 而遗漏一个仍在写入的 WAL 状态。

## 使用现有 HTTPS 反向代理

构建并运行容器，把 4317 只绑定到宿主机 loopback：

```bash
docker build -t quotalab:0.1.0 .
docker run -d --name quotalab \
  --restart unless-stopped \
  -e HOST=0.0.0.0 \
  -e QUOTALAB_SECURE_COOKIES=true \
  -e QUOTALAB_TRUST_PROXY=true \
  -v quotalab-data:/data \
  -p 127.0.0.1:4317:4317 \
  quotalab:0.1.0
```

让 Nginx、Traefik 或 Caddy 把 HTTPS 请求代理到 `http://127.0.0.1:4317`，并保留
`X-Forwarded-For` 与 `X-Forwarded-Proto`。不要把 `QUOTALAB_TRUST_PROXY=true` 用在
能够由不可信客户端直接访问的应用端口上。

## 不使用 Docker

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
export NODE_ENV=production
export HOST=127.0.0.1
export PORT=4317
export QUOTALAB_DB=/srv/quotalab/quotalab.db
export QUOTALAB_WEB_DIST=/opt/codex-quota-lab/apps/web/dist
export QUOTALAB_SECURE_COOKIES=true
export QUOTALAB_TRUST_PROXY=true
pnpm start
```

由 systemd 或其他进程管理器常驻，并通过同机 HTTPS 反向代理访问。`HOST=127.0.0.1`
可防止绕过代理直连。

## 数据保留与监控

- 定期备份 SQLite 数据卷；备份本身包含设备网络标识，应按私有数据保护。
- 监控 `/api/health`、容器重启次数、磁盘空间和 Agent 的最后在线时间。
- 仪表盘出现 `STALE` 时，先检查至少一台 Agent，而不是把旧百分比当作当前值。
- 不要把数据库、Agent 配置、outbox、环境文件或日志包提交到 Git。
