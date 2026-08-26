import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import {
  AgentIngestRequestSchema,
  CreateGroupRequestSchema,
  EnrollDeviceRequestSchema,
  LoginRequestSchema,
  UpdateDeviceRequestSchema,
  type ApiErrorBody,
} from "@quotalab/contracts";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ZodError, z } from "zod";

import type { ServerConfig } from "./config.js";
import { dashboardCsv, buildDashboard, buildDeviceDetail } from "./dashboard.js";
import { openDatabase } from "./database.js";
import { ApiError } from "./errors.js";
import { Repository, type AuthenticatedDevice } from "./repository.js";

const SESSION_COOKIE = "quotalab_session";

export interface BuildAppOptions {
  config: ServerConfig;
  repository?: Repository;
  now?: () => number;
}

const normalizeIp = (ip: string | undefined): string | null => {
  if (!ip) return null;
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
};

const apiErrorBody = (code: string, message: string, details?: unknown): ApiErrorBody => ({
  error: { code, message, ...(details === undefined ? {} : { details }) },
});

const bearerToken = (request: FastifyRequest): string | null => {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token.length >= 32 ? token : null;
};

export const buildApp = async (options: BuildAppOptions): Promise<FastifyInstance> => {
  const { config } = options;
  const now = options.now ?? Date.now;
  const ownsRepository = options.repository === undefined;
  const repository =
    options.repository ?? new Repository(openDatabase(config.databasePath), config.scryptCost);
  const app = Fastify({
    logger: config.logLevel === "silent" ? false : { level: config.logLevel },
    trustProxy: config.trustProxy,
    bodyLimit: 2 * 1024 * 1024,
    requestIdHeader: false,
  });

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: "1 minute",
  });

  const setSessionCookie = (reply: FastifyReply, token: string) => {
    reply.setCookie(SESSION_COOKIE, token, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: config.secureCookies,
      maxAge: Math.floor(config.sessionTtlMs / 1_000),
    });
  };

  const requireGroup = (request: FastifyRequest) => {
    const token = request.cookies[SESSION_COOKIE];
    const group = token ? repository.resolveBrowserSession(token, now()) : undefined;
    if (!group) throw new ApiError(401, "SESSION_REQUIRED", "请使用群组密钥登录。 ");
    return group;
  };

  const requireDevice = (request: FastifyRequest): AuthenticatedDevice => {
    const token = bearerToken(request);
    const auth = token ? repository.authenticateDevice(token) : undefined;
    if (!auth) throw new ApiError(401, "DEVICE_TOKEN_INVALID", "设备凭据无效，请重新加入群组。 ");
    return auth;
  };

  app.get("/api/health", async () => ({ status: "ok", version: "0.1.0" }));

  app.post(
    "/api/groups",
    { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = CreateGroupRequestSchema.parse(request.body);
      const group = await repository.createGroup(body.groupName, body.groupKey, now());
      const token = repository.createBrowserSession(group.id, now(), config.sessionTtlMs);
      setSessionCookie(reply, token);
      return reply
        .status(201)
        .send({ group: { id: group.id, name: group.name, slug: group.slug } });
    },
  );

  app.post(
    "/api/session",
    { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = LoginRequestSchema.parse(request.body);
      const group = await repository.authenticateGroup(body.groupSlug, body.groupKey);
      if (!group) throw new ApiError(401, "GROUP_LOGIN_FAILED", "群组标识或密钥不正确。 ");
      const token = repository.createBrowserSession(group.id, now(), config.sessionTtlMs);
      setSessionCookie(reply, token);
      return { group: { id: group.id, name: group.name, slug: group.slug } };
    },
  );

  app.delete("/api/session", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) repository.deleteBrowserSession(token);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.status(204).send();
  });

  app.get("/api/me", async (request) => {
    const group = requireGroup(request);
    return { group: { id: group.id, name: group.name, slug: group.slug } };
  });

  app.post(
    "/api/agent/enroll",
    { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = EnrollDeviceRequestSchema.parse(request.body);
      const enrollment = await repository.enrollDevice(body, normalizeIp(request.ip), now());
      if (!enrollment) {
        throw new ApiError(401, "GROUP_LOGIN_FAILED", "群组标识或密钥不正确。 ");
      }
      return reply.status(201).send({
        group: enrollment.group,
        device: {
          id: enrollment.device.id,
          publicId: enrollment.device.public_id,
          name: enrollment.device.name,
        },
        deviceToken: enrollment.token,
      });
    },
  );

  app.get("/api/agent/status", async (request) => {
    const auth = requireDevice(request);
    return {
      group: auth.group,
      device: {
        id: auth.device.id,
        publicId: auth.device.public_id,
        name: auth.device.name,
        lastSeenAt: new Date(auth.device.last_seen_at).toISOString(),
      },
    };
  });

  app.post("/api/agent/ingest", async (request, reply) => {
    const auth = requireDevice(request);
    const body = AgentIngestRequestSchema.parse(request.body);
    const result = repository.ingest(auth, body, normalizeIp(request.ip), now());
    return reply.status(result.duplicate ? 200 : 202).send({
      accepted: !result.duplicate,
      duplicate: result.duplicate,
      acceptedSamples: result.acceptedSamples,
    });
  });

  const dashboardQuerySchema = z.object({ limitKey: z.string().max(180).optional() }).strict();
  app.get("/api/dashboard", async (request) => {
    const group = requireGroup(request);
    const query = dashboardQuerySchema.parse(request.query);
    return buildDashboard(repository, group.id, query.limitKey, now());
  });

  const deviceParamsSchema = z.object({ id: z.string().regex(/^[a-f0-9]{32}$/) }).strict();
  app.get("/api/devices/:id", async (request) => {
    const group = requireGroup(request);
    const params = deviceParamsSchema.parse(request.params);
    const query = dashboardQuerySchema.parse(request.query);
    return buildDeviceDetail(repository, group.id, params.id, query.limitKey, now());
  });

  app.patch("/api/devices/:id", async (request) => {
    const group = requireGroup(request);
    const params = deviceParamsSchema.parse(request.params);
    const body = UpdateDeviceRequestSchema.parse(request.body);
    repository.updateDevice(group.id, params.id, body);
    return buildDeviceDetail(repository, group.id, params.id, undefined, now());
  });

  app.get("/api/export.csv", async (request, reply) => {
    const group = requireGroup(request);
    const query = dashboardQuerySchema.parse(request.query);
    const csv = dashboardCsv(buildDashboard(repository, group.id, query.limitKey, now()));
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="quotalab-devices.csv"')
      .send(`\uFEFF${csv}`);
  });

  const indexPath = resolve(config.webDistPath, "index.html");
  if (existsSync(indexPath)) {
    await app.register(staticFiles, { root: config.webDistPath, wildcard: false });
  }

  app.setNotFoundHandler(async (request, reply) => {
    if (
      existsSync(indexPath) &&
      request.method === "GET" &&
      !request.url.startsWith("/api/") &&
      request.headers.accept?.includes("text/html")
    ) {
      return reply.sendFile("index.html");
    }
    return reply.status(404).send(apiErrorBody("NOT_FOUND", "请求的资源不存在。"));
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send(
        apiErrorBody(
          "INVALID_REQUEST",
          "请求数据格式不正确。",
          error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code })),
        ),
      );
    }
    if (error instanceof ApiError) {
      return reply
        .status(error.statusCode)
        .send(apiErrorBody(error.code, error.message.trim(), error.details));
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      error.statusCode === 413
    ) {
      return reply.status(413).send(apiErrorBody("PAYLOAD_TOO_LARGE", "上传批次超过大小限制。"));
    }
    request.log.error({ err: error }, "request failed");
    return reply.status(500).send(apiErrorBody("INTERNAL_ERROR", "服务暂时无法完成请求。"));
  });

  if (ownsRepository) app.addHook("onClose", async () => repository.close());
  return app;
};
