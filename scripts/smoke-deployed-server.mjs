import { execFile as execFileCallback, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const root = resolve(import.meta.dirname, "..");
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error("test:deploy must be launched through pnpm");

const reservePort = async () =>
  new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a smoke-test port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolvePort(address.port)));
    });
  });

const deployedServer = await mkdtemp(join(tmpdir(), "quotalab-deploy-smoke-"));
let child;
try {
  const commandEnvironment = { ...process.env, CI: "true" };
  await execFile(process.execPath, [pnpmCli, "build"], {
    cwd: root,
    env: commandEnvironment,
    windowsHide: true,
  });
  await execFile(
    process.execPath,
    [pnpmCli, "--filter", "@quotalab/server", "deploy", "--prod", "--legacy", deployedServer],
    { cwd: root, env: commandEnvironment, windowsHide: true },
  );

  const port = await reservePort();
  child = spawn(process.execPath, ["dist/index.js"], {
    cwd: deployedServer,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      NODE_ENV: "production",
      QUOTALAB_DB: resolve(deployedServer, "smoke.db"),
      QUOTALAB_WEB_DIST: resolve(root, "apps/web/dist"),
      QUOTALAB_SECURE_COOKIES: "false",
      QUOTALAB_TRUST_PROXY: "false",
      LOG_LEVEL: "silent",
    },
    stdio: "ignore",
    windowsHide: true,
  });

  let healthy = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (child.exitCode !== null) throw new Error("Deployed server exited before health check");
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      const body = await response.json();
      if (response.ok && body?.status === "ok") {
        healthy = true;
        break;
      }
    } catch {
      // Startup races are expected during this bounded health-check loop.
    }
    await delay(200);
  }
  if (!healthy) throw new Error("Deployed server health check timed out");

  const dashboard = await fetch(`http://127.0.0.1:${port}/`);
  if (!dashboard.ok || !(await dashboard.text()).includes('id="root"')) {
    throw new Error("Deployed server did not serve the production dashboard");
  }
  process.stdout.write("Deployed server and dashboard smoke check: ok\n");
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), delay(3_000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  await rm(deployedServer, { recursive: true, force: true });
}
