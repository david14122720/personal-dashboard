// MCP HTTP server for personal-dashboard (Streamable HTTP transport).
//
// Endpoints:
//   POST /mcp       JSON-RPC over Streamable HTTP (initialize, tools/list, tools/call, ...)
//   GET /mcp        SSE stream for a bound session (server-initiated messages)
//   DELETE /mcp     Close an MCP session
//   GET /healthz    Liveness probe, outside MCP: 200 { ok: true }
//
// Auth is strictly per-request (JD R2 hardening):
// - The incoming `Authorization: Bearer <token>` header is bound to the
//   request's AsyncLocalStorage scope and forwarded as the backend Bearer
//   token. Fallback is the PERSONAL_DASHBOARD_TOKEN env var. Concurrent
//   requests on one session can never swap credentials: there is no mutable
//   shared token slot anymore.
// - /mcp routes enforce a Host/Origin allowlist (localhost by default, plus
//   MCP_ALLOWED_HOSTS) so a DNS-rebound hostile page cannot drive the server
//   from another origin.
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
  dispatchTool,
  principalForToken,
  recordAudit,
  tokenPrefixForLog,
  toolDefinitions,
} from "./tools.js";

const DEFAULT_PORT = 3101;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Request-scoped backend token. Set per HTTP request, read at dispatch. */
const tokenStore = new AsyncLocalStorage<RequestToken>();

function resolvePort(): number {
  const raw = process.env.MCP_PORT?.trim();
  if (!raw) return DEFAULT_PORT;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_PORT;
}

/** Bearer token for this HTTP request, or the env fallback. Never cached globally. */
function extractRequestToken(req: Request): RequestToken {
  const header = req.headers.authorization;
  if (header) {
    const m = header.match(/^Bearer\s+(.+)$/i);
    const candidate = m?.[1]?.trim();
    if (candidate && candidate.length > 0) return candidate;
  }
  const env = process.env.PERSONAL_DASHBOARD_TOKEN?.trim();
  return env && env.length > 0 ? env : undefined;
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
    const tokenPrefix = tokenPrefixForLog(tokenStore.getStore());
    const principal = principalForToken(tokenStore.getStore());
    const occurredAt = new Date().toISOString();
    try {
      const text = await dispatchTool(name, args, tokenStore.getStore());
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
}

export interface McpApp {
  app: express.Express;
  sessions: SessionRegistry<StreamableHTTPServerTransport>;
}

export function createApp(options: AppOptions = {}): McpApp {
  const app = express();
  app.use(express.json());

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

  app.use("/mcp", hostGuard);

  app.post("/mcp", async (req: Request, res: Response) => {
    const sessionId = readSessionId(req);
    if (sessionId === null) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: malformed session ID" },
        id: null,
      });
      return;
    }
    // Audit F-02/F-03: every MCP request needs a credential. Without one the
    // reply is 401 before any session, dispatch or audit entry exists.
    const token = extractRequestToken(req);
    if (token === undefined) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized: Bearer token required" },
        id: null,
      });
      return;
    }
    try {
      let transport: StreamableHTTPServerTransport | undefined;
      if (sessionId) transport = sessions.get(sessionId);
      if (transport) {
        await tokenStore.run(token, () => transport.handleRequest(req, res, req.body));
        return;
      }
      if (!sessionId && isInitializeRequest(req.body)) {
        if (!sessions.canOpen()) {
          // Never evict a live session to admit a new one: the caller waits.
          res.status(503).json({
            jsonrpc: "2.0",
            error: { code: -32002, message: "Server busy: too many active sessions" },
            id: null,
          });
          return;
        }
        const fresh = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            if (!sessions.open(sid, fresh)) {
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
        await tokenStore.run(token, () => fresh.handleRequest(req, res, req.body));
        return;
      }
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: no valid session ID provided" },
        id: null,
      });
    } catch (err) {
      console.error(`[personal-dashboard-mcp] POST /mcp error: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", async (req: Request, res: Response) => {
    if (extractRequestToken(req) === undefined) {
      res.status(401).send("Unauthorized: Bearer token required");
      return;
    }
    const sessionId = readSessionId(req);
    const transport = sessionId ? sessions.get(sessionId) : undefined;
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
    if (extractRequestToken(req) === undefined) {
      res.status(401).send("Unauthorized: Bearer token required");
      return;
    }
    const sessionId = readSessionId(req);
    const transport = sessionId ? sessions.get(sessionId) : undefined;
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
      if (sessionId) sessions.close(sessionId);
    }
  });

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
