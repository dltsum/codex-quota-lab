import type {
  AgentIngestRequest,
  CreateGroupRequest,
  EnrollDeviceRequest,
} from "@quotalab/contracts";

export class QuotaLabApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "QuotaLabApiError";
  }
}

const endpoint = (serverUrl: string, path: string): URL =>
  new URL(path, `${serverUrl.replace(/\/$/, "")}/`);

const requestJson = async <T>(
  url: URL,
  init: RequestInit,
  timeoutMs: number = 20_000,
): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: "error",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "QuotaLab-Agent/0.1.0",
        ...init.headers,
      },
    });
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    if (!response.ok) {
      throw new QuotaLabApiError(
        response.status,
        body?.error?.code ?? "HTTP_ERROR",
        body?.error?.message ?? `QuotaLab server returned HTTP ${response.status}`,
      );
    }
    return body as T;
  } catch (error) {
    if (error instanceof QuotaLabApiError) throw error;
    if ((error as Error).name === "AbortError") {
      throw new QuotaLabApiError(0, "NETWORK_TIMEOUT", "连接 QuotaLab 服务超时。 ");
    }
    throw new QuotaLabApiError(0, "NETWORK_ERROR", "无法连接 QuotaLab 服务。 ");
  } finally {
    clearTimeout(timer);
  }
};

export const assertSafeServerUrl = (value: string): string => {
  const url = new URL(value);
  const loopback = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback.has(url.hostname))) {
    throw new Error("远程 QuotaLab 服务必须使用 HTTPS；HTTP 只允许 localhost。 ");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
};

export const createGroup = async (
  serverUrl: string,
  payload: CreateGroupRequest,
): Promise<{ group: { id: string; name: string; slug: string } }> =>
  requestJson(endpoint(serverUrl, "/api/groups"), {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const enrollDevice = async (
  serverUrl: string,
  payload: EnrollDeviceRequest,
): Promise<{
  group: { id: string; name: string; slug: string };
  device: { id: string; publicId: string; name: string | null };
  deviceToken: string;
}> =>
  requestJson(endpoint(serverUrl, "/api/agent/enroll"), {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const ingestBatch = async (
  serverUrl: string,
  deviceToken: string,
  payload: AgentIngestRequest,
): Promise<{ accepted: boolean; duplicate: boolean; acceptedSamples: number }> =>
  requestJson(endpoint(serverUrl, "/api/agent/ingest"), {
    method: "POST",
    headers: { authorization: `Bearer ${deviceToken}` },
    body: JSON.stringify(payload),
  });

export const getAgentStatus = async (
  serverUrl: string,
  deviceToken: string,
): Promise<{
  group: { id: string; name: string; slug: string };
  device: { id: string; publicId: string; name: string | null; lastSeenAt: string };
}> =>
  requestJson(endpoint(serverUrl, "/api/agent/status"), {
    method: "GET",
    headers: { authorization: `Bearer ${deviceToken}` },
  });
