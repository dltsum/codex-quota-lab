import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { DashboardResponse } from "@quotalab/contracts";

import { BrowserApiError, getDashboard, getMe, logout } from "./api";
import { AuthScreen } from "./components/AuthScreen";

const Dashboard = lazy(() =>
  import("./components/Dashboard").then((module) => ({ default: module.Dashboard })),
);

const REFRESH_INTERVAL_MS = 60_000;

export const App = () => {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const focusRef = useRef<string | null>(null);

  const loadDashboard = useCallback(async (focus?: string | null) => {
    setRefreshing(true);
    setError(null);
    try {
      const next = await getDashboard(focus ?? focusRef.current ?? undefined);
      focusRef.current = next.focusLimitKey;
      setDashboard(next);
      setAuthenticated(true);
    } catch (caught) {
      if (caught instanceof BrowserApiError && caught.status === 401) {
        setAuthenticated(false);
        setDashboard(null);
      } else {
        setError(caught instanceof Error ? caught.message : "仪表盘加载失败。 ");
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getMe()
      .then(async () => {
        if (!cancelled) await loadDashboard();
      })
      .catch((caught) => {
        if (cancelled) return;
        if (caught instanceof BrowserApiError && caught.status === 401) setAuthenticated(false);
        else {
          setAuthenticated(false);
          setError(caught instanceof Error ? caught.message : "无法连接 QuotaLab 服务。 ");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadDashboard]);

  useEffect(() => {
    if (!authenticated) return;
    const timer = window.setInterval(() => void loadDashboard(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [authenticated, loadDashboard]);

  const signOut = async () => {
    await logout();
    focusRef.current = null;
    setDashboard(null);
    setAuthenticated(false);
  };

  if (authenticated === null) {
    return (
      <div className="boot-screen" role="status">
        <span className="boot-orbit" aria-hidden="true" />
        <strong>QuotaLab</strong>
        <p>正在校准额度仪表…</p>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <>
        {error ? (
          <div className="connection-banner" role="alert">
            {error}
          </div>
        ) : null}
        <AuthScreen onAuthenticated={() => loadDashboard(null)} />
      </>
    );
  }

  if (!dashboard) {
    return (
      <div className="boot-screen" role="status">
        <span className="boot-orbit" aria-hidden="true" />
        <strong>额度数据暂不可用</strong>
        <p>{error ?? "正在等待服务响应。"}</p>
        <button className="secondary-action" onClick={() => void loadDashboard()} type="button">
          重试
        </button>
      </div>
    );
  }

  return (
    <>
      {error ? (
        <div className="connection-banner" role="alert">
          {error}
        </div>
      ) : null}
      <Suspense
        fallback={
          <div className="boot-screen" role="status">
            <span className="boot-orbit" aria-hidden="true" />
            <strong>正在装配可视化工作台</strong>
          </div>
        }
      >
        <Dashboard
          data={dashboard}
          refreshing={refreshing}
          onRefresh={() => loadDashboard()}
          onFocusLimit={(key) => {
            focusRef.current = key;
            return loadDashboard(key);
          }}
          onLogout={signOut}
        />
      </Suspense>
    </>
  );
};
