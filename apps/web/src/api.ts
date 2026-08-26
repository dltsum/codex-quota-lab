import type {
  DashboardResponse,
  DeviceDetailResponse,
  UpdateDeviceRequest,
} from "@quotalab/contracts";

export class BrowserApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BrowserApiError";
  }
}

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => null)) as
    { error?: { code?: string; message?: string } } | T | null;
  if (!response.ok) {
    const error = body as { error?: { code?: string; message?: string } } | null;
    throw new BrowserApiError(
      response.status,
      error?.error?.code ?? "HTTP_ERROR",
      error?.error?.message ?? `请求失败（HTTP ${response.status}）`,
    );
  }
  return body as T;
};

export const getMe = (): Promise<{ group: { id: string; name: string; slug: string } }> =>
  request("/api/me");

export const createGroup = (groupName: string, groupKey: string) =>
  request<{ group: { id: string; name: string; slug: string } }>("/api/groups", {
    method: "POST",
    body: JSON.stringify({ groupName, groupKey }),
  });

export const login = (groupSlug: string, groupKey: string) =>
  request<{ group: { id: string; name: string; slug: string } }>("/api/session", {
    method: "POST",
    body: JSON.stringify({ groupSlug, groupKey }),
  });

export const logout = (): Promise<void> => request("/api/session", { method: "DELETE" });

export const getDashboard = (limitKey?: string): Promise<DashboardResponse> =>
  request(`/api/dashboard${limitKey ? `?limitKey=${encodeURIComponent(limitKey)}` : ""}`);

export const getDevice = (deviceId: string, limitKey?: string): Promise<DeviceDetailResponse> =>
  request(
    `/api/devices/${encodeURIComponent(deviceId)}${limitKey ? `?limitKey=${encodeURIComponent(limitKey)}` : ""}`,
  );

export const updateDevice = (
  deviceId: string,
  payload: UpdateDeviceRequest,
): Promise<DeviceDetailResponse> =>
  request(`/api/devices/${encodeURIComponent(deviceId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
