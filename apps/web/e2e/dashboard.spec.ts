import { expect, test, type APIRequestContext } from "@playwright/test";

const groupKey = "e2e-quotalab-shared-key-2026";

interface Enrollment {
  device: { id: string };
  deviceToken: string;
}

const quotaBuckets = (
  usedPrimary: number,
  usedSecondary: number,
  primaryReset: number,
  secondaryReset: number,
) =>
  [
    {
      limitId: "codex",
      limitName: "codex",
      planType: "plus",
      windows: [
        {
          kind: "primary",
          usedPercent: usedPrimary,
          windowDurationMins: 300,
          resetsAt: primaryReset,
        },
        {
          kind: "secondary",
          usedPercent: usedSecondary,
          windowDurationMins: 10_080,
          resetsAt: secondaryReset,
        },
      ],
    },
  ] as const;

const usageSlice = ({
  id,
  session,
  start,
  surface,
  model,
  effort,
  total,
  tools,
  files,
}: {
  id: string;
  session: string;
  start: number;
  surface: "cli" | "ide" | "desktop";
  model: string;
  effort: string;
  total: number;
  tools: number;
  files: number;
}) => ({
  sampleId: id.repeat(64),
  sessionKey: session.repeat(64),
  startedAt: new Date(start).toISOString(),
  endedAt: new Date(start + 42_000).toISOString(),
  surface,
  model,
  reasoningEffort: effort,
  tokens: {
    input: Math.floor(total * 0.68),
    cachedInput: Math.floor(total * 0.18),
    cacheWriteInput: 0,
    output: Math.floor(total * 0.32),
    reasoningOutput: Math.floor(total * 0.14),
    total,
  },
  purposes: {
    context: Math.floor(total * 0.42),
    reasoning: Math.floor(total * 0.14),
    code: Math.floor(total * 0.22),
    tools: Math.floor(total * 0.16),
    conversation: total - Math.floor(total * 0.94),
  },
  activity: { toolCalls: tools, fileChanges: files, activeMs: 42_000 },
  measurement: "local",
  purposeMethod: "event-envelope-v1",
});

const enroll = async (
  request: APIRequestContext,
  slug: string,
  publicId: string,
  name: string | null,
  platform: string,
  ip: string,
  mac: string,
): Promise<Enrollment> => {
  const response = await request.post("/api/agent/enroll", {
    data: {
      groupSlug: slug,
      groupKey,
      devicePublicId: publicId,
      deviceName: name,
      platform,
      agentVersion: "0.1.0",
      network: { privateIp: ip, macAddress: mac },
    },
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<Enrollment>;
};

const ingest = async (
  request: APIRequestContext,
  token: string,
  batchId: string,
  observedAt: number,
  buckets: ReturnType<typeof quotaBuckets>,
  slices: ReturnType<typeof usageSlice>[],
  platform: string,
  network: { privateIp: string; macAddress: string },
) => {
  const response = await request.post("/api/agent/ingest", {
    headers: { authorization: `Bearer ${token}` },
    data: {
      batchId,
      observedAt: new Date(observedAt).toISOString(),
      agentVersion: "0.1.0",
      platform,
      network,
      quotaBuckets: buckets,
      accountUsage: {
        lifetimeTokens: 8_420_000,
        peakDailyTokens: 422_000,
        longestRunningTurnSec: 1_340,
        currentStreakDays: 12,
        longestStreakDays: 31,
        dailyUsageBuckets: [
          { startDate: new Date(observedAt).toISOString().slice(0, 10), tokens: 148_000 },
        ],
      },
      usageSlices: slices,
      collector: { appServer: "ok", errorCode: null },
      scanner: {
        filesSeen: 9,
        filesUpdated: slices.length,
        bytesRead: 14_800,
        recordsRead: 78,
        malformedRecords: 0,
        truncatedFiles: 0,
        backlogBytes: 0,
      },
    },
  });
  expect(response.status()).toBe(202);
};

test("完整群组流程：登录、全局图表、设备明细、改名与导出", async ({ page }) => {
  const nonce = Date.now().toString(36);
  const created = await page.request.post("/api/groups", {
    data: { groupName: `研究设备组 ${nonce}`, groupKey },
  });
  expect(created.status()).toBe(201);
  const { group } = (await created.json()) as { group: { slug: string } };

  const home = await enroll(
    page.request,
    group.slug,
    "1fd135ba-8079-40bd-bb08-bd6ef985ea67",
    "家中笔记本",
    "win32-x64",
    "192.168.1.8",
    "AA:BB:CC:DD:EE:01",
  );
  const lab = await enroll(
    page.request,
    group.slug,
    "6cb6ab20-5145-4427-9b19-41d14f03333c",
    null,
    "linux-x64",
    "10.0.0.9",
    "AA:BB:CC:DD:EE:02",
  );

  const now = Date.now();
  const primaryReset = Math.floor((now + 4 * 60 * 60_000) / 1_000);
  const secondaryReset = Math.floor((now + 6 * 24 * 60 * 60_000) / 1_000);
  const first = now - 170_000;
  const second = now - 100_000;
  const third = now - 25_000;

  await ingest(
    page.request,
    home.deviceToken,
    "a10b6d72-8a62-4ad0-814f-d5a273682d34",
    first,
    quotaBuckets(0, 11.2, primaryReset, secondaryReset),
    [],
    "win32-x64",
    { privateIp: "192.168.1.8", macAddress: "AA:BB:CC:DD:EE:01" },
  );
  await ingest(
    page.request,
    lab.deviceToken,
    "9f7c9f6c-55eb-4ed4-945f-c18f30be6b5b",
    second,
    quotaBuckets(18.4, 12.1, primaryReset, secondaryReset),
    [
      usageSlice({
        id: "b",
        session: "d",
        start: first + 8_000,
        surface: "cli",
        model: "gpt-5.6-sol",
        effort: "high",
        total: 86_000,
        tools: 18,
        files: 9,
      }),
    ],
    "linux-x64",
    { privateIp: "10.0.0.9", macAddress: "AA:BB:CC:DD:EE:02" },
  );
  await ingest(
    page.request,
    home.deviceToken,
    "85355134-6183-461c-b380-ed0560b0e40f",
    third,
    quotaBuckets(34.8, 13.4, primaryReset, secondaryReset),
    [
      usageSlice({
        id: "c",
        session: "e",
        start: second + 7_000,
        surface: "ide",
        model: "gpt-5.6-terra",
        effort: "medium",
        total: 54_000,
        tools: 6,
        files: 14,
      }),
      usageSlice({
        id: "f",
        session: "e",
        start: second + 18_000,
        surface: "desktop",
        model: "gpt-5.6-sol",
        effort: "xhigh",
        total: 22_000,
        tools: 3,
        files: 2,
      }),
    ],
    "win32-x64",
    { privateIp: "192.168.1.8", macAddress: "AA:BB:CC:DD:EE:01" },
  );

  await page.request.delete("/api/session");
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "让每一台电脑，都看见同一个额度地平线。" }),
  ).toBeVisible();
  await page.locator('input[autocomplete="username"]').fill(group.slug);
  await page.locator('input[autocomplete="current-password"]').fill(groupKey);
  await page.getByRole("button", { name: "进入工作台" }).click();

  await expect(page.getByText("额度地平线")).toBeVisible();
  await expect(page.getByTestId("global-breakdowns")).toContainText("设备额度分摊");
  await expect(page.getByTestId("global-breakdowns")).toContainText("模型构成");
  await expect(page.getByTestId("global-breakdowns")).toContainText("推理强度");
  await expect(page.getByTestId("global-breakdowns")).toContainText("用途粗分类");
  await expect(page.getByTestId("quota-horizon")).toContainText("34.8%");
  await expect(page.getByText("官方读数")).toBeVisible();
  await expect(page.getByText("本地 + 估算").first()).toBeVisible();
  await expect(page.getByTestId("global-breakdowns")).toContainText("pp");

  await page.screenshot({ path: "test-results/dashboard-desktop.png", fullPage: true });

  await page.getByTestId(`device-${lab.device.id}`).click();
  await expect(page.getByTestId("device-drawer")).toBeVisible();
  await expect(page.getByTestId("device-breakdowns")).toContainText("模型");
  await expect(page.getByTestId("device-breakdowns")).toContainText("推理强度");
  await expect(page.getByTestId("device-breakdowns")).toContainText("用途");
  await page.getByLabel("设备名称").fill("实验室主机");
  await page.getByLabel("本窗口软预算（百分点）").fill("20");
  await page.getByRole("button", { name: "保存设备设置" }).click();
  await expect(page.getByRole("heading", { name: "实验室主机" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("device-drawer")).not.toBeVisible();
  await expect(page.getByTestId(`device-${lab.device.id}`)).toContainText("实验室主机");

  const download = page.waitForEvent("download");
  await page.getByText("导出 CSV").click();
  expect((await download).suggestedFilename()).toContain("quotalab");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("quota-horizon")).toBeVisible();
  await page.screenshot({ path: "test-results/dashboard-mobile.png", fullPage: false });
});
