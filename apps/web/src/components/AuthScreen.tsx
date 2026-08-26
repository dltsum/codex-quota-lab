import { useState, type FormEvent } from "react";

import { BrowserApiError, createGroup, login } from "../api";

interface AuthScreenProps {
  onAuthenticated: () => Promise<void>;
}

type Mode = "login" | "create";

export const AuthScreen = ({ onAuthenticated }: AuthScreenProps) => {
  const [mode, setMode] = useState<Mode>("login");
  const [groupName, setGroupName] = useState("");
  const [groupSlug, setGroupSlug] = useState("");
  const [groupKey, setGroupKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "create") await createGroup(groupName, groupKey);
      else await login(groupSlug, groupKey);
      await onAuthenticated();
    } catch (caught) {
      setError(
        caught instanceof BrowserApiError
          ? caught.message
          : "无法连接 QuotaLab 服务，请检查服务是否已启动。",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-story" aria-labelledby="auth-title">
        <div className="brand-lockup brand-lockup--large">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>QuotaLab</span>
        </div>
        <p className="eyebrow">CODEX QUOTA INSTRUMENT</p>
        <h1 id="auth-title">让每一台电脑，都看见同一个额度地平线。</h1>
        <p className="auth-lede">
          汇总家中、工位、实验室与实习电脑上的 Codex
          活动。在开始下一次长任务前，先知道谁用了多少、窗口何时重置。
        </p>
        <div className="coverage-strip" aria-label="支持的 Codex 启动方式">
          <span>CLI</span>
          <span>IDE 插件</span>
          <span>Codex App</span>
          <span>远程活动</span>
        </div>
        <div className="privacy-note">
          <span className="privacy-note__signal" aria-hidden="true" />
          <div>
            <strong>内容留在本机</strong>
            <p>服务端只接收 token 数、模型、推理强度、时间和事件类型等聚合值。</p>
          </div>
        </div>
      </section>

      <section className="auth-panel" aria-label="QuotaLab 群组访问">
        <div className="mode-switch" role="tablist" aria-label="访问方式">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            className={mode === "login" ? "is-active" : ""}
            onClick={() => {
              setMode("login");
              setError(null);
            }}
          >
            加入群组
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "create"}
            className={mode === "create" ? "is-active" : ""}
            onClick={() => {
              setMode("create");
              setError(null);
            }}
          >
            新建群组
          </button>
        </div>

        <form onSubmit={submit} className="auth-form">
          <div className="form-heading">
            <span className="plate-index">01 / ACCESS</span>
            <h2>{mode === "login" ? "回到你的额度工作台" : "建立共享额度组"}</h2>
            <p>
              {mode === "login"
                ? "输入群组短名和共享密钥。"
                : "创建后，把群组短名与密钥分别安全地发给其他设备。"}
            </p>
          </div>

          {mode === "create" ? (
            <label className="field">
              <span>群组名称</span>
              <input
                autoComplete="organization"
                maxLength={80}
                required
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder="例如：Fresnel 研究设备"
              />
            </label>
          ) : (
            <label className="field">
              <span>群组短名</span>
              <input
                autoCapitalize="none"
                autoComplete="username"
                pattern="[a-z0-9][a-z0-9-]{4,79}"
                required
                value={groupSlug}
                onChange={(event) => setGroupSlug(event.target.value.trim().toLowerCase())}
                placeholder="例如：fresnel-lab-a1b2"
              />
            </label>
          )}

          <label className="field">
            <span>群组共享密钥</span>
            <span className="password-wrap">
              <input
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                minLength={12}
                maxLength={256}
                required
                type={showKey ? "text" : "password"}
                value={groupKey}
                onChange={(event) => setGroupKey(event.target.value)}
                placeholder="至少 12 个字符"
              />
              <button type="button" onClick={() => setShowKey((current) => !current)}>
                {showKey ? "隐藏" : "显示"}
              </button>
            </span>
            <small>这是 QuotaLab 群组密钥，不是 OpenAI API Key 或 Codex 登录凭据。</small>
          </label>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <button className="primary-action" disabled={busy} type="submit">
            {busy ? "正在验证…" : mode === "login" ? "进入工作台" : "创建并进入"}
          </button>
        </form>
      </section>
    </main>
  );
};
