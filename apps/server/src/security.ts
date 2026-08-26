import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;
const KEY_BYTES = 64;

const scrypt = (
  secret: string,
  salt: Buffer,
  cost: number,
  blockSize: number = SCRYPT_BLOCK_SIZE,
  parallelism: number = SCRYPT_PARALLELISM,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scryptCallback(
      secret,
      salt,
      KEY_BYTES,
      {
        N: cost,
        r: blockSize,
        p: parallelism,
        maxmem: Math.max(128 * cost * blockSize + 2 * 1024 * 1024, 64 * 1024 * 1024),
      },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });

export const hashGroupKey = async (secret: string, cost: number): Promise<string> => {
  const salt = randomBytes(24);
  const derived = await scrypt(secret, salt, cost);
  return [
    "scrypt",
    String(cost),
    String(SCRYPT_BLOCK_SIZE),
    String(SCRYPT_PARALLELISM),
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
};

export const verifyGroupKey = async (secret: string, encoded: string): Promise<boolean> => {
  const [algorithm, costText, blockText, parallelText, saltText, hashText] = encoded.split("$");
  if (
    algorithm !== "scrypt" ||
    costText === undefined ||
    blockText === undefined ||
    parallelText === undefined ||
    saltText === undefined ||
    hashText === undefined
  ) {
    return false;
  }

  const cost = Number.parseInt(costText, 10);
  const blockSize = Number.parseInt(blockText, 10);
  const parallelism = Number.parseInt(parallelText, 10);
  if (![cost, blockSize, parallelism].every(Number.isSafeInteger)) return false;

  try {
    const expected = Buffer.from(hashText, "base64url");
    const actual = await scrypt(
      secret,
      Buffer.from(saltText, "base64url"),
      cost,
      blockSize,
      parallelism,
    );
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
};

export const createOpaqueToken = (): string => randomBytes(32).toString("base64url");

export const hashOpaqueToken = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");

export const randomId = (): string => randomBytes(16).toString("hex");

export const createSlug = (name: string): string => {
  const base = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${base || "group"}-${randomBytes(4).toString("hex")}`;
};
