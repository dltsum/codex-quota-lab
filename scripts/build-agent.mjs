import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const releaseDir = resolve(root, "release");
const output = resolve(releaseDir, "quota-lab-agent.mjs");

await mkdir(releaseDir, { recursive: true });
await build({
  entryPoints: [resolve(root, "apps/agent/src/cli.ts")],
  outfile: output,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  legalComments: "none",
  sourcemap: false,
});
await chmod(output, 0o755);

const digest = createHash("sha256")
  .update(await readFile(output))
  .digest("hex");
await writeFile(
  resolve(releaseDir, "quota-lab-agent.mjs.sha256"),
  `${digest}  quota-lab-agent.mjs\n`,
);
process.stdout.write(`Built release/quota-lab-agent.mjs (${digest.slice(0, 12)}…)\n`);
