# QuotaLab for Codex

QuotaLab 是一个私有优先、可自托管的 Codex 多设备额度观察与协调工具。它把家中、
工位、实验室和实习电脑上的使用情况放进同一个群组仪表盘，帮助你在开始长任务前
回答三个问题：当前窗口还剩多少、主要是哪台设备在用、额度花在了什么模型与用途上。

> QuotaLab is an independent community project. It is not affiliated with or
> endorsed by OpenAI.

## 能做什么

- 读取 Codex 的官方额度百分比、窗口长度与重置时间；主百分比环直接按设备估算份额
  分段，并用“官方总值 / 设备估算”双标签避免混淆。
- 不包装 Codex 启动命令；同一台电脑上的 CLI、IDE 插件和 Codex 桌面端可共同被采集。
- 用一个群组共享密钥加入多台设备；每台设备获得独立、可重新签发的设备 token。
- 设备可命名；未命名时按产品要求在群组内显示 IP / MAC，命名后服务端清除 MAC。
- 查看全局与单设备的模型、推理强度、用途、启动方式、token 和活跃时间构成；
  并有按 IP 标注的各设备活跃时间占比排行。
- 用饼图、官方额度轨迹、设备在线状态和数据质量面板展示当前情况。
- 设置每台设备的软预算提醒线，并导出只含聚合数字的 CSV。
- 采集失败时保留本地待发批次；提供 `status` 与 `doctor` 自检命令。

## 先说明一个关键边界

Codex 的账户接口提供总体额度百分比，但不提供“某台设备 / 某个模型消耗了几个百分
点”。因此 QuotaLab 严格分开三类数据：

| 标签     | 含义                                                                |
| -------- | ------------------------------------------------------------------- |
| 官方读数 | 总体已用百分比、窗口和重置时间，来自 Codex App Server               |
| 本地测量 | token、模型、推理强度、时间和事件类型，由设备本地汇总               |
| 估算分摊 | 把官方百分比的正增量按同时间段本地 token 活动分给设备，并显示置信度 |

如果 ChatGPT App / Web 或远程任务只在账户端产生用量、没有在已注册电脑写入本地
Codex 事件，总体官方百分比仍会更新，但那部分会诚实地保留为“未归因”，不会伪造
设备、模型或用途明细。完整口径见
[`docs/OBSERVABILITY_CONTRACT.md`](docs/OBSERVABILITY_CONTRACT.md)。

## 架构

```text
每台电脑                                      自托管中心
┌────────────────────────────┐             ┌──────────────────────┐
│ Codex CLI / IDE / App      │             │ Fastify API + React │
│      ↓ 本地事件             │   HTTPS     │          ↓           │
│ QuotaLab Agent ────────────┼────────────→│ SQLite + 仪表盘      │
│ 只上传数字聚合与非内容标签   │             │ 群组成员共享查看      │
└────────────────────────────┘             └──────────────────────┘
```

Agent 通过 Codex App Server 的受支持 JSON-RPC 接口读取账户额度，不读取或复制 Codex
凭据文件。实现依据与当前验证版本见
[`docs/OBSERVABILITY_CONTRACT.md`](docs/OBSERVABILITY_CONTRACT.md)。

## 五分钟本地试用

要求：Node.js 22.13+、pnpm 11.7、以及已登录的 Codex CLI。

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm build
$env:QUOTALAB_SECURE_COOKIES="false"
pnpm start
```

打开 <http://127.0.0.1:4317> 创建群组，然后在同一台电脑的另一个终端执行：

```powershell
pnpm agent -- setup --server http://127.0.0.1:4317 --group <群组短名> --name "家中电脑"
pnpm agent -- once
pnpm agent -- daemon
```

`setup` 会隐藏读取群组密钥，且不会保存它。跨电脑使用时必须把中心服务放在 HTTPS
后面。完整步骤见 [`docs/INSTALL.md`](docs/INSTALL.md)，公网或服务器部署见
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)。

## 启动方式覆盖

| Codex 使用方式                      | 官方总体额度 | 本地设备明细                 |
| ----------------------------------- | ------------ | ---------------------------- |
| Codex CLI                           | 支持         | 支持                         |
| VS Code / 兼容 IDE 插件             | 支持         | 支持（该电脑写入本地事件时） |
| Codex 桌面端                        | 支持         | 支持（该电脑写入本地事件时） |
| ChatGPT App / Web 内远程 Codex 活动 | 支持         | 无本地事件时显示为未归因     |
| 云任务 / 子代理                     | 支持         | 有本地事件时分类，否则未归因 |

## 隐私底线

以下内容永不进入上传协议：提示词、回复、reasoning 文本、命令与输出、工具参数与结果、
补丁、文件内容、路径、仓库名、Git 元数据、OpenAI/Codex 凭据和账户邮箱。上传 schema
使用严格白名单，未知字段会直接拒绝而不是静默丢弃。详见
[`docs/PRIVACY.md`](docs/PRIVACY.md)。

## 开发与验证

```powershell
pnpm check          # lint + format + typecheck + unit/integration + production build
pnpm test:e2e       # Chromium 完整浏览器流程
pnpm package:agent  # 生成 release/quota-lab-agent.mjs 与 SHA-256
```

测试覆盖隐私 schema、密钥哈希、认证失败、批次幂等、额度分摊、聚合、活动文件追加/
锁定/截断/坏行、启动来源映射、App Server 归一化和完整浏览器流程。设计与系统说明见
[`docs/DESIGN.md`](docs/DESIGN.md) 和 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## 明确限制

- 软预算是提醒，不会强行中断任意 Codex 客户端。
- 用途分类是由 token 类型与本地事件信封构成的粗粒度统计，不是对提示词语义的分析。
- 同一时间多台设备活跃时，只能做中等置信度的比例估算。
- 知道群组共享密钥的人可以查看聚合数据并注册设备；请使用独立的高熵密钥。
- 当前为小型可信群组设计，不替代 ChatGPT Enterprise/Team 管理后台。

## License

MIT
