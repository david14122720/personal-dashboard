// MCP HTTP server for personal-dashboard (Streamable HTTP transport).
//
// Endpoints:
//   POST /mcp       JSON-RPC over Streamable HTTP (initialize, tools/list, tools/call, ...)
//   GET /mcp        SSE stream for a bound session (server-initiated messages)
//   DELETE /mcp     Close an MCP session
//   GET /healthz    Liveness probe, outside MCP: 200 { ok: true }
//
// Auth is strictly per-request and validated server-side (audit F-09/F-10):
// - The incoming `Authorization: Bearer <token>` header is the only source of
//   a credential; there is no env fallback, so a missing/malformed header or a
//   non-Bearer scheme is a 401, never an authenticated request.
// - Before any session is allocated or any `tools/call` dispatched, the token
//   is checked with the backend `GET /api/me` and the request is rejected with
//   JSON-RPC -32001 if the backend does not accept it. Verdicts are cached per
//   token hash in a bounded map for at most 60 s (auth.ts).
// - The credential is bound to the request's AsyncLocalStorage scope and
//   forwarded as the backend Bearer token; the audit principal comes from the
//   validated `user_id`, never from unverified input. Concurrent requests on
//   one session can never swap credentials: there is no mutable shared token
//   slot anymore.
// - A session is bound to the identity that opened it. A valid credential
//   presented with someone else's `mcp-session-id` gets the exact answer a
//   missing session gets (400), so knowing a UUID does not let it consume or
//   close another caller's session, and does not confirm the session exists.
// - /mcp routes enforce a Host/Origin allowlist (localhost by default, plus
//   MCP_ALLOWED_HOSTS) so a DNS-rebound hostile page cannot drive the server
//   from another origin. The guard runs BEFORE the JSON body parser, so a
//   malformed body cannot reach it first.
// - mcp-session-id values must be UUIDs; anything else is a 400 before any
//   session lookup (no prototype-key games, no 500s).

import { AsyncLocalStorage } from "node:async_hooks";
import express, { type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { pathToFileURL } from "node:url";
import type { RequestToken } from "./client.js";
import { SessionRegistry } from "./sessions.js";
import {
  createApiValidator,
  TokenValidationCache,
  type CallerIdentity,
  type TokenValidator,
} from "./auth.js";
import {
  dispatchTool,
  principalForUser,
  recordAudit,
  tokenPrefixForLog,
  toolDefinitions,
} from "./tools.js";

const DEFAULT_PORT = 3101;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Request-scoped credential + resolved identity. Never shared across requests. */
interface RequestContext {
  token: RequestToken;
  identity: CallerIdentity;
}

const requestStore = new AsyncLocalStorage<RequestContext>();

function resolvePort(): number {
  const raw = process.env.MCP_PORT?.trim();
  if (!raw) return DEFAULT_PORT;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_PORT;
}

/**
 * Bearer token for this HTTP request. Only a well-formed `Authorization:
 * Bearer <token>` header yields a credential; everything else (absent header,
 * non-Bearer scheme, empty value) is `undefined`, and `undefined` is never
 * authenticated (audit F-10: no environment fallback).
 */
function extractRequestToken(req: Request): RequestToken {
  const header = req.headers.authorization;
  if (!header) return undefined;
  const m = header.match(/^Bearer\s+(.+)$/i);
  const candidate = m?.[1]?.trim();
  return candidate && candidate.length > 0 ? candidate : undefined;
}

function allowedHosts(): Set<string> {
  const set = new Set(["localhost", "127.0.0.1", "::1"]);
  const extra = process.env.MCP_ALLOWED_HOSTS?.split(",") ?? [];
  for (const h of extra) {
    const host = h.trim().toLowerCase();
    if (host) set.add(host);
  }
  return set;
}

function hostAllowed(value: string | undefined, allowed: Set<string>): boolean {
  if (!value) return false;
  // Strip any :port suffix (careful with bracketed IPv6).
  let host = value.trim().toLowerCase();
  if (host.startsWith("[")) {
    host = host.slice(0, host.indexOf("]") + 1);
  } else {
    const colon = host.lastIndexOf(":");
    if (colon > -1 && host.indexOf(":") === colon) host = host.slice(0, colon);
  }
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  return allowed.has(host) || allowed.has(value.trim().toLowerCase());
}

/**
 * Reject cross-origin / DNS-rebinding traffic on /mcp before any session
 * or credential handling. /healthz stays open for local probes.
 */
function hostGuard(req: Request, res: Response, next: NextFunction): void {
  const allowed = allowedHosts();
  if (!hostAllowed(req.headers.host, allowed)) {
    res.status(403).send("Forbidden: host not allowed");
    return;
  }
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let originHost: string | undefined;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = undefined;
    }
    if (!hostAllowed(originHost, allowed)) {
      res.status(403).send("Forbidden: origin not allowed");
      return;
    }
  }
  next();
}

function buildServer(): Server {
  const server = new Server(
    { name: "personal-dashboard-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: toolDefinitions };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments ?? {};
    // T7 audit: one entry per tools/call. Only the masked token prefix and
    // the outcome are logged — never the raw token, never args/bodies.
    const requestId = randomUUID();
    const context = requestStore.getStore();
    const token = context?.token;
    const tokenPrefix = tokenPrefixForLog(token);
    // Audit F-09/S1: the principal is the identity the backend resolved, not
    // a hash of whatever the caller presented. Only in-process dispatch (no
    // HTTP gate) falls back to the token hash, inside list_audit_log.
    const principal =
      context === undefined ? undefined : principalForUser(context.identity.userId);
    const occurredAt = new Date().toISOString();
    try {
      const text = await dispatchTool(
        name,
        args,
        token,
        principal === undefined ? undefined : { principal },
      );
      recordAudit({
        occurred_at: occurredAt,
        tool: name,
        success: true,
        error_code: null,
        token_prefix: tokenPrefix,
        request_id: requestId,
        principal,
      });
      return {
        content: [{ type: "text" as const, text }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      recordAudit({
        occurred_at: occurredAt,
        tool: name,
        success: false,
        error_code: message.startsWith("unknown tool") ? "UNKNOWN_TOOL" : "TOOL_ERROR",
        token_prefix: tokenPrefix,
        request_id: requestId,
        principal,
      });
      return {
        content: [{ type: "text" as const, text: message }],
        isError: true,
      };
    }
  });

  return server;
}

function readSessionId(req: Request): string | null | undefined {
  const raw = req.headers["mcp-session-id"];
  const sid = Array.isArray(raw) ? raw[0] : raw;
  if (sid === undefined) return undefined;
  // UUID-only: rejects __proto__/constructor keys and any garbage with 400.
  return UUID_RE.test(sid) ? sid : null;
}

export interface AppOptions {
  /** Hard cap on concurrent MCP sessions (audit F-02). */
  maxSessions?: number;
  /** Idle lifetime of a session before it is evicted (audit F-02). */
  ttlMs?: number;
  /** Injectable clock so the TTL is testable without sleeping. */
  now?: () => number;
  /**
   * Server-side credential validator (audit F-09/S1). Defaults to
   * `GET /api/me` against the configured backend; tests inject a fake so no
   * backend request is made.
   */
  validateToken?: TokenValidator;
  /** How long a validation verdict is reused. Clamped to 60 s (S1). */
  validationTtlMs?: number;
  /** Upper bound on cached verdicts, so the cache cannot grow unbounded. */
  validationCacheSize?: number;
}

export interface McpApp {
  app: express.Express;
  sessions: SessionRegistry<StreamableHTTPServerTransport>;
}

/** JSON-RPC 2.0 error reply. Never includes a stack trace or the raw error. */
function replyJsonRpcError(
  res: Response,
  status: number,
  code: number,
  message: string,
): void {
  res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });
}

/**
 * body-parser failures (malformed JSON, oversized payload) carry a `type`
 * such as `entity.parse.failed`. They are client errors, not 500s, and must
 * never surface the parser's stack or the offending body.
 */
function isBodyParserError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const candidate = err as { type?: unknown; body?: unknown };
  if (typeof candidate.type === "string" && candidate.type.startsWith("entity.")) return true;
  return err instanceof SyntaxError && "body" in candidate;
}

/**
 * Final JSON error handler (audit F-17/S3). Body-parser failures become a
 * JSON-RPC parse error with 400; anything else is a generic 500. Neither
 * branch echoes `err.stack` or the request body.
 */
function jsonErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (isBodyParserError(err)) {
    replyJsonRpcError(res, 400, -32700, "Parse error: malformed JSON body");
    return;
  }
  console.error(
    `[personal-dashboard-mcp] unhandled error: ${err instanceof Error ? err.message : String(err)}`,
  );
  replyJsonRpcError(res, 500, -32603, "Internal server error");
}

export function createApp(options: AppOptions = {}): McpApp {
  const app = express();
  // Audit F-17/S3: no framework fingerprint, and the Host/Origin guard below
  // is mounted before the JSON parser so a malformed body cannot reach the
  // parser (and its error path) ahead of the allowlist check.
  app.disable("x-powered-by");
  app.use("/mcp", hostGuard);
  app.use(express.json({ limit: "100kb" }));

  // Audit F-09/S1: the credential is validated by the backend before any
  // session exists, with the verdict cached per token hash (≤60 s, bounded).
  const validator = new TokenValidationCache(options.validateToken ?? createApiValidator(), {
    ttlMs: options.validationTtlMs,
    maxEntries: options.validationCacheSize,
    now: options.now,
  });

  /**
   * Turn a request into { token, identity }, or write the 401 and return
   * undefined. Shared by every /mcp method, so GET/DELETE cannot reach a
   * session with an unvalidated credential either.
   */
  async function authenticate(req: Request, res: Response): Promise<RequestContext | undefined> {
    const token = extractRequestToken(req);
    if (token === undefined) {
      replyJsonRpcError(res, 401, -32001, "Unauthorized: Bearer token required");
      return undefined;
    }
    const identity = await validator.check(token);
    if (identity === undefined) {
      replyJsonRpcError(res, 401, -32001, "Unauthorized: invalid or expired Bearer token");
      return undefined;
    }
    return { token, identity };
  }

  // Session routing state only: transport per MCP session (no credentials
  // here). Bounded by a cap and an idle TTL (audit F-02).
  const sessions = new SessionRegistry<StreamableHTTPServerTransport>(
    options.maxSessions ?? 64,
    options.ttlMs ?? 30 * 60 * 1000,
    options.now,
  );

  app.get("/healthz", (_req: Request, res: Response) => {
    res.status(200).json({ ok: true });
  });

  app.post("/mcp", async (req: Request, res: Response) => {
    const sessionId = readSessionId(req);
    if (sessionId === null) {
      replyJsonRpcError(res, 400, -32000, "Bad Request: malformed session ID");
      return;
    }
    // Audit F-09/S1: a credential is validated by the backend before any
    // session is allocated and before any tools/call is dispatched. A rejected
    // token leaves no session, no transport and no audit entry behind.
    const context = await authenticate(req, res);
    if (context === undefined) return;
    const { token, identity } = context;
    try {
      let transport: StreamableHTTPServerTransport | undefined;
      if (sessionId) transport = sessions.get(sessionId, identity.userId);
      if (transport) {
        await requestStore.run(context, () => transport.handleRequest(req, res, req.body));
        return;
      }
      if (!sessionId && isInitializeRequest(req.body)) {
        if (!sessions.canOpen()) {
          // Never evict a live session to admit a new one: the caller waits.
          replyJsonRpcError(res, 503, -32002, "Server busy: too many active sessions");
          return;
        }
        const fresh = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            if (!sessions.open(sid, fresh, identity.userId)) {
              // Lost a race for the last slot; never leak a second session.
              fresh.close();
            }
          },
        });
        fresh.onclose = () => {
          if (fresh.sessionId) sessions.close(fresh.sessionId);
        };
        const server = buildServer();
        await server.connect(fresh);
        await requestStore.run(context, () => fresh.handleRequest(req, res, req.body));
        return;
      }
      replyJsonRpcError(res, 400, -32000, "Bad Request: no valid session ID provided");
    } catch (err) {
      console.error(`[personal-dashboard-mcp] POST /mcp error: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) {
        replyJsonRpcError(res, 500, -32603, "Internal server error");
      }
    }
  });

  app.get("/mcp", async (req: Request, res: Response) => {
    const context = await authenticate(req, res);
    if (context === undefined) return;
    const sessionId = readSessionId(req);
    const transport = sessionId ? sessions.get(sessionId, context.identity.userId) : undefined;
    if (!transport) {
      res.status(400).send("No valid session: missing or unknown mcp-session-id");
      return;
    }
    try {
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error(`[personal-dashboard-mcp] GET /mcp error: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) res.status(500).send("Internal server error");
    }
  });

  app.delete("/mcp", async (req: Request, res: Response) => {
    const context = await authenticate(req, res);
    if (context === undefined) return;
    const owner = context.identity.userId;
    const sessionId = readSessionId(req);
    const transport = sessionId ? sessions.get(sessionId, owner) : undefined;
    if (!transport) {
      res.status(400).send("No valid session: missing or unknown mcp-session-id");
      return;
    }
    try {
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error(`[personal-dashboard-mcp] DELETE /mcp error: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) res.status(500).send("Internal server error");
    } finally {
      if (sessionId) sessions.close(sessionId, owner);
    }
  });

  // Audit F-17/S3: every failure leaves as JSON, with no stack trace. Mounted
  // last so it only sees errors the routes and the body parser passed on.
  app.use(jsonErrorHandler);

  return { app, sessions };
}

/** Positive number from the environment, or the default. */
function positiveFromEnv(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export async function main(): Promise<void> {
  const ttlMs = positiveFromEnv(process.env.MCP_SESSION_TTL_MS, 30 * 60 * 1000);
  const { app, sessions } = createApp({
    maxSessions: Math.floor(positiveFromEnv(process.env.MCP_MAX_SESSIONS, 64)),
    ttlMs,
  });
  // Evict idle sessions on a timer; `unref` keeps the sweeper from pinning the
  // process open on shutdown.
  const sweeper = setInterval(() => {
    const closed = sessions.sweep();
    if (closed.length > 0) {
      console.error(`[personal-dashboard-mcp] evicted ${closed.length} idle session(s)`);
    }
  }, Math.min(ttlMs, 60_000));
  sweeper.unref();

  const port = resolvePort();
  app.listen(port, () => {
    console.error(`[personal-dashboard-mcp] Streamable HTTP listening on :${port} (POST/GET/DELETE /mcp, GET /healthz)`);
  });
}

// Only auto-start when this file is the process entry: importing it from a
// test must not bind a port.
if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error(`[personal-dashboard-mcp] fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
