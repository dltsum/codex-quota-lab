#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import {
  assertSafeServerUrl,
  createGroup,
  enrollDevice,
  getAgentStatus,
  QuotaLabApiError,
} from "./api-client.js";
import { collectCodexAccount, resolveCodexCommand } from "./codex-client.js";
import { defaultCodexHome, loadAgentConfig, saveAgentConfig, type AgentConfig } from "./config.js";
import { getNetworkIdentity, platformLabel } from "./network.js";
import { collectAndUploadOnce, runDaemon } from "./runner.js";

const VERSION = "0.1.0";

const help = `
QuotaLab Agent ${VERSION}

用法:
  quota-lab setup --server <https://...> --group <slug> [--name <设备名>]
  quota-lab setup --server <https://...> --create --group-name <群组名> [--name <设备名>]
  quota-lab once
  quota-lab daemon
  quota-lab status
  quota-lab doctor

密钥默认以隐藏输入读取，也可临时设置 QUOTALAB_GROUP_KEY。不要把密钥写进脚本或命令历史。
远程服务必须使用 HTTPS；HTTP 只允许 localhost。
`;

const readSecret = async (prompt: string): Promise<string> => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("非交互终端请临时设置 QUOTALAB_GROUP_KEY。 ");
  }
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  let value = "";
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      process.stdout.write("\n");
    };
    const onData = (chunk: string): void => {
      for (const character of chunk) {
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (character === "\u0003") {
          cleanup();
          reject(new Error("已取消。"));
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= " ") value += character;
      }
    };
    process.stdin.on("data", onData);
  });
};

const integerOption = (
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number => {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} 必须在 ${minimum} 到 ${maximum} 之间。`);
  }
  return parsed;
};

const setup = async (args: string[]): Promise<void> => {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      server: { type: "string" },
      group: { type: "string" },
      name: { type: "string" },
      create: { type: "boolean", default: false },
      "group-name": { type: "string" },
      key: { type: "string" },
      "codex-home": { type: "string" },
      interval: { type: "string" },
      "lookback-days": { type: "string" },
      "max-scan-mb": { type: "string" },
    },
  });
  if (!values.server) throw new Error("setup 需要 --server。 ");
  if (!values.create && !values.group) throw new Error("加入群组需要 --group，或使用 --create。 ");
  if (values.create && values.group) throw new Error("--create 与 --group 不能同时使用。 ");

  const serverUrl = assertSafeServerUrl(values.server);
  if (values.key) process.stderr.write("警告：--key 可能保留在命令历史中，建议改用隐藏输入。\n");
  const groupKey =
    values.key ??
    process.env.QUOTALAB_GROUP_KEY ??
    (await readSecret("群组密钥（至少 12 字符）: "));
  if (groupKey.length < 12) throw new Error("群组密钥至少需要 12 个字符。 ");

  let groupSlug = values.group;
  if (values.create) {
    const created = await createGroup(serverUrl, {
      groupName: values["group-name"]?.trim() || "我的 Codex 设备",
      groupKey,
    });
    groupSlug = created.group.slug;
    process.stdout.write(`已创建群组：${created.group.name}（${groupSlug}）\n`);
  }
  if (!groupSlug) throw new Error("缺少群组标识。 ");

  let existing: AgentConfig | null = null;
  try {
    existing = await loadAgentConfig();
  } catch {
    existing = null;
  }
  const deviceName = values.name?.trim() || null;
  const network = getNetworkIdentity();
  if (deviceName) network.macAddress = null;
  const devicePublicId = existing?.devicePublicId ?? randomUUID();
  const enrollment = await enrollDevice(serverUrl, {
    groupSlug,
    groupKey,
    devicePublicId,
    deviceName,
    platform: platformLabel(),
    agentVersion: VERSION,
    network,
  });
  const config: AgentConfig = {
    version: 1,
    serverUrl,
    groupSlug: enrollment.group.slug,
    deviceToken: enrollment.deviceToken,
    devicePublicId,
    deviceId: enrollment.device.id,
    deviceName,
    codexHome: values["codex-home"] ?? existing?.codexHome ?? defaultCodexHome(),
    pollIntervalSeconds: integerOption(values.interval, 60, 30, 3_600, "interval"),
    lookbackDays: integerOption(values["lookback-days"], 8, 1, 40, "lookback-days"),
    maxBytesPerScan: integerOption(values["max-scan-mb"], 16, 1, 256, "max-scan-mb") * 1024 * 1024,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  await saveAgentConfig(config);
  process.stdout.write(
    `设备已加入 ${enrollment.group.name}：${deviceName ?? "未命名（仪表盘显示 IP / MAC）"}\n` +
      "运行 quota-lab once 完成首次同步，或运行 quota-lab daemon 持续采集。\n",
  );
};

const once = async (): Promise<void> => {
  const config = await loadAgentConfig();
  const receipt = await collectAndUploadOnce(config);
  process.stdout.write(
    `同步完成：批次 ${receipt.batchId.slice(0, 8)}，新增 ${receipt.acceptedSamples} 条本地汇总，` +
      `App Server=${receipt.appServerStatus}，待扫描 ${receipt.backlogBytes} bytes` +
      `${receipt.resumedOutbox ? "（恢复待发批次）" : ""}。\n`,
  );
};

const daemon = async (): Promise<void> => {
  const config = await loadAgentConfig();
  process.stdout.write(
    `QuotaLab 常驻采集已启动，每 ${config.pollIntervalSeconds} 秒同步。Ctrl+C 停止。\n`,
  );
  await runDaemon(
    config,
    (receipt) => {
      process.stdout.write(
        `[${new Date().toISOString()}] 同步 ${receipt.batchId.slice(0, 8)}：` +
          `${receipt.acceptedSamples} 条，App Server=${receipt.appServerStatus}。\n`,
      );
    },
    (error, retrySeconds) => {
      const code = error instanceof QuotaLabApiError ? error.code : "LOCAL_COLLECTION_ERROR";
      process.stderr.write(
        `[${new Date().toISOString()}] ${code}；${retrySeconds} 秒后重试。待发批次会保留。\n`,
      );
    },
  );
};

const status = async (): Promise<void> => {
  const config = await loadAgentConfig();
  const remote = await getAgentStatus(config.serverUrl, config.deviceToken);
  process.stdout.write(
    [
      `群组：${remote.group.name}（${remote.group.slug}）`,
      `设备：${remote.device.name ?? "未命名"} / ${remote.device.publicId}`,
      `服务：${config.serverUrl}`,
      `上次服务端在线：${remote.device.lastSeenAt}`,
      `轮询：${config.pollIntervalSeconds}s，回看：${config.lookbackDays} 天`,
      `本地状态：已配置（路径不输出）`,
    ].join("\n") + "\n",
  );
};

const doctor = async (): Promise<void> => {
  const config = await loadAgentConfig();
  const [command, account, remote] = await Promise.all([
    resolveCodexCommand(),
    collectCodexAccount(),
    getAgentStatus(config.serverUrl, config.deviceToken),
  ]);
  process.stdout.write(
    [
      `Codex 可执行文件：${command ? "已找到" : "未找到"}`,
      `Codex 账户采集：${account.collector.appServer}`,
      `官方额度桶：${account.quotaBuckets.length}`,
      `QuotaLab 服务：已连接 ${remote.group.name}`,
      `设备 token：有效（仅显示状态，不显示 token）`,
    ].join("\n") + "\n",
  );
};

const safeFailure = (error: unknown): { code: string; message: string } => {
  if (error instanceof QuotaLabApiError) return { code: error.code, message: error.message.trim() };
  const message = error instanceof Error ? error.message : "未知错误";
  const known = new Set(["AGENT_NOT_CONFIGURED", "SCANNER_STATE_INVALID", "OUTBOX_INVALID"]);
  return known.has(message)
    ? { code: message, message: "本地配置或状态无效，请检查 QuotaLab 配置目录。" }
    : { code: "COMMAND_FAILED", message: message.trim() };
};

const main = async (): Promise<void> => {
  const [command = "help", ...args] = process.argv.slice(2);
  if (command === "setup") await setup(args);
  else if (command === "once") await once();
  else if (command === "daemon") await daemon();
  else if (command === "status") await status();
  else if (command === "doctor") await doctor();
  else if (command === "help" || command === "--help" || command === "-h")
    process.stdout.write(help);
  else if (command === "--version" || command === "-v") process.stdout.write(`${VERSION}\n`);
  else throw new Error(`未知命令：${command}`);
};

main().catch((error: unknown) => {
  const failure = safeFailure(error);
  process.stderr.write(`${failure.code}: ${failure.message}\n`);
  process.exitCode = 1;
});
