import { describe, expect, it } from "vitest";

import {
  createOpaqueToken,
  createSlug,
  hashGroupKey,
  hashOpaqueToken,
  verifyGroupKey,
} from "./security.js";

describe("security primitives", () => {
  it("stores and verifies a salted group-key hash", async () => {
    const encoded = await hashGroupKey("correct horse battery staple", 1_024);
    expect(encoded).not.toContain("correct horse");
    await expect(verifyGroupKey("correct horse battery staple", encoded)).resolves.toBe(true);
    await expect(verifyGroupKey("wrong horse battery staple", encoded)).resolves.toBe(false);
  });

  it("creates opaque tokens and stable one-way token hashes", () => {
    const token = createOpaqueToken();
    expect(token.length).toBeGreaterThan(32);
    expect(hashOpaqueToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashOpaqueToken(token)).toBe(hashOpaqueToken(token));
  });

  it("creates safe slugs even for a non-Latin group name", () => {
    expect(createSlug("我的实验室")).toMatch(/^group-[a-f0-9]{8}$/);
    expect(createSlug("My Research Desk")).toMatch(/^my-research-desk-[a-f0-9]{8}$/);
  });
});
