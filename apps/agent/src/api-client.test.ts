import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import type { AgentIngestRequest } from "@quotalab/contracts";
import { assertSafeServerUrl, ingestBatch } from "./api-client.js";

describe("server URL admission", () => {
  it("allows HTTPS and loopback HTTP", () => {
    expect(assertSafeServerUrl("https://quota.example.test/")).toBe("https://quota.example.test");
    expect(assertSafeServerUrl("http://127.0.0.1:4317")).toBe("http://127.0.0.1:4317");
  });

  it("rejects cleartext remote enrollment", () => {
    expect(() => assertSafeServerUrl("http://192.168.1.20:4317")).toThrow(/HTTPS/);
  });

  it("does not follow redirects with a device bearer token", async () => {
    let redirectedTargetHits = 0;
    const server = createServer((request, response) => {
      if (request.url === "/redirected-target") {
        redirectedTargetHits += 1;
        response.writeHead(200, { "content-type": "application/json" }).end("{}");
        return;
      }
      response.writeHead(307, { location: "/redirected-target" }).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      await expect(
        ingestBatch(`http://127.0.0.1:${port}`, "x".repeat(43), {} as AgentIngestRequest),
      ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
      expect(redirectedTargetHits).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
