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
import type { RequestToken } from "./client.js";
import { dispatchTool, toolDefinitions } from "./tools.js";

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
    try {
      const text = await dispatchTool(name, args, tokenStore.getStore());
      return {
        content: [{ type: "text" as const, text }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
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

async function main(): Promise<void> {
  const app = express();
  app.use(express.json());

  // Session routing state only: transport per MCP session (no credentials here).
  const transports = new Map<string, StreamableHTTPServerTransport>();

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
    const token = extractRequestToken(req);
    try {
      let transport: StreamableHTTPServerTransport | undefined;
      if (sessionId) transport = transports.get(sessionId);
      if (transport) {
        await tokenStore.run(token, () => transport.handleRequest(req, res, req.body));
        return;
      }
      if (!sessionId && isInitializeRequest(req.body)) {
        const fresh = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            transports.set(sid, fresh);
          },
        });
        fresh.onclose = () => {
          if (fresh.sessionId) transports.delete(fresh.sessionId);
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
    const sessionId = readSessionId(req);
    const transport = sessionId ? transports.get(sessionId) : undefined;
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
    const sessionId = readSessionId(req);
    const transport = sessionId ? transports.get(sessionId) : undefined;
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
      if (sessionId) transports.delete(sessionId);
    }
  });

  const port = resolvePort();
  app.listen(port, () => {
    console.error(`[personal-dashboard-mcp] Streamable HTTP listening on :${port} (POST/GET/DELETE /mcp, GET /healthz)`);
  });
}

main().catch((err) => {
  console.error(`[personal-dashboard-mcp] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
