# 安装与设备接入

## 前置条件

- 中心服务：Node.js 22.13 或更高版本、pnpm 11.7。
- 每台设备：Node.js 22.13 或更高版本，以及已安装并登录的 Codex CLI。
- 跨设备访问：一个指向中心服务的 HTTPS URL。不要把明文 HTTP 暴露到局域网或公网。

QuotaLab Agent 会启动本机的 `codex app-server` 子进程读取官方额度。它复用 Codex
自己的已登录状态，但不打开、复制或上传 Codex 凭据。

## 1. 启动中心服务

仅限本机试用：

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm build
$env:HOST="127.0.0.1"
$env:QUOTALAB_SECURE_COOKIES="false"
pnpm start
```

打开 <http://127.0.0.1:4317>，选择“新建群组”，设置：

1. 容易辨认的群组名称；
2. 至少 12 字符、且不与其他账户共用的高熵群组密钥。

创建后顶部会显示群组短名。群组短名不是秘密；共享密钥是秘密。跨电脑部署请先按
[`DEPLOYMENT.md`](DEPLOYMENT.md) 配置 HTTPS。

## 2. 在每台电脑设置 Agent

在项目副本中构建后运行：

```powershell
pnpm agent -- setup `
  --server https://quota.example.edu `
  --group <群组短名> `
  --name "实验室主机"
```

程序会在当前终端隐藏读取群组密钥。密钥只用于本次注册，不写入 Agent 配置；配置中
保存的是该设备独有的随机 token。省略 `--name` 时，仪表盘显示该设备的 IP / MAC。

可选参数：

| 参数                   | 默认值         | 作用                           |
| ---------------------- | -------------- | ------------------------------ |
| `--interval <秒>`      | 60             | 同步周期，允许 30–3600         |
| `--lookback-days <天>` | 8              | 首次扫描回看范围，允许 1–40    |
| `--max-scan-mb <MiB>`  | 16             | 每周期最大读取量，允许 1–256   |
| `--codex-home <路径>`  | Codex 默认目录 | 使用自定义 `CODEX_HOME` 时指定 |

非交互部署可临时使用环境变量；完成后立即从当前进程环境清除：

```powershell
$env:QUOTALAB_GROUP_KEY="<群组密钥>"
pnpm agent -- setup --server https://quota.example.edu --group <群组短名> --name "工位电脑"
Remove-Item Env:QUOTALAB_GROUP_KEY
```

不要使用 `--key`，除非你明确接受密钥进入 shell 历史的风险。

## 3. 首次检查

```powershell
pnpm agent -- doctor
pnpm agent -- once
pnpm agent -- status
```

`doctor` 应显示 Codex 可执行文件已找到、账户采集为 `ok`、官方额度桶数量大于零、
QuotaLab 服务已连接。`once` 成功后刷新仪表盘，应看到设备、官方窗口和本地活动。

若某台电脑刚安装而当前窗口已有大量历史消耗，首个百分比会保留为“未归因”；这是
有意的保守行为。等下一个重置周期后，覆盖率会自然改善。

## 4. 常驻运行

### Windows

先完成 `setup` 和 `pnpm build`，再在普通 PowerShell 中执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-agent-windows.ps1
```

脚本创建当前用户登录时启动的计划任务，不需要管理员权限。移除任务但保留本地配置：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-agent-windows.ps1
```

### Linux

复制 [`deploy/quotalab-agent.service`](../deploy/quotalab-agent.service) 到
`~/.config/systemd/user/`，把 `ExecStart` 和 `WorkingDirectory` 改成实际绝对路径，然后：

```bash
systemctl --user daemon-reload
systemctl --user enable --now quotalab-agent.service
systemctl --user status quotalab-agent.service
```

使用 user service 很重要，因为 Agent 要读取当前用户的 Codex 本地事件与登录状态。

### macOS

把 [`deploy/com.quotalab.agent.plist`](../deploy/com.quotalab.agent.plist) 中的 Node 和项目
绝对路径改正确，复制到 `~/Library/LaunchAgents/`，再执行：

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.quotalab.agent.plist
```

## 5. 单文件 Agent

仓库 CI 和本地命令可生成一个跨 Windows/macOS/Linux 的 Node 单文件：

```powershell
pnpm package:agent
node .\release\quota-lab-agent.mjs --version
```

复制 `.mjs` 与 `.sha256` 到其他设备，先验证 SHA-256，再用
`node quota-lab-agent.mjs setup ...`。单文件仍要求目标设备安装 Node 22.13+ 与 Codex CLI。

## 故障排查

| 现象                         | 检查                                                      |
| ---------------------------- | --------------------------------------------------------- |
| `Codex 可执行文件：未找到`   | 确认 `codex --version` 在同一用户的 PATH 中可运行         |
| 账户采集为 `unauthenticated` | 在该用户下重新完成 Codex 登录，再运行 `doctor`            |
| 服务拒绝 HTTP                | 远程地址必须使用 HTTPS；仅 `localhost`/loopback 允许 HTTP |
| 设备 token 无效              | 重新运行 `setup`；同一设备 UUID 再注册会撤销旧 token      |
| 有官方消耗但没有设备明细     | 检查其他电脑 Agent；纯远程活动会正确显示为未归因          |
| 待扫描字节持续增加           | 适度提高 `--max-scan-mb`，不要删除 outbox 或游标来绕过    |

遇到失败不要反复注册或删除状态。先保留配置目录与错误码，运行 `doctor` 确认是 Codex、
网络还是群组认证问题。
