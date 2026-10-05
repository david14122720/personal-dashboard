// Zod-validated tool definitions + handlers for the personal-dashboard API.
// Routes mirror backend/src/main.rs `api_routes` (mounted under /api).
//
// Auth is per-request: dispatchTool(name, args, token) forwards the token
// (taken from the incoming MCP request's `Authorization` header, with env
// fallback resolved in client.ts) to every backend call. No global state.

import { z } from "zod";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  login as apiLogin,
  type RequestToken,
} from "./client.js";

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, object>;
    required?: string[];
    minProperties?: number;
  };
}

interface ToolEntry {
  def: McpToolDef;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: z.ZodTypeAny;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: (args: any, token?: RequestToken) => Promise<string>;
}

const uuid = z.uuid();
const optionalUuid = uuid.optional();
const optionalText = z.string().optional();

function fmt(data: unknown): string {
  // G5: backend DELETEs answer 204 → apiDelete resolves `undefined`.
  // JSON.stringify(undefined) is `undefined` (not a string), which produced
  // a malformed MCP text part that strict SDK clients reject (-32602) even
  // though the delete succeeded. Normalize to an explicit success object.
  if (data === undefined) return JSON.stringify({ ok: true }, null, 2);
  if (typeof data === "string") return data;
  return JSON.stringify(data, null, 2);
}

function withoutId<T extends { id: string }>(args: T): Record<string, unknown> {
  const { id: _omit, ...rest } = args;
  void _omit;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function strProp(description: string): object {
  return { type: "string", description };
}

function optStrProp(description: string): object {
  return { type: "string", description };
}

function enumProp(description: string, values: string[]): object {
  return { type: "string", description, enum: values };
}

function boolProp(description: string): object {
  return { type: "boolean", description };
}

function intProp(description: string): object {
  return { type: "integer", description };
}

const LoginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

const ListAccountsSchema = z.object({});

const GetAccountSchema = z.object({ id: uuid });

const CreateAccountSchema = z.strictObject({
  name: z.string().min(1).max(200),
  currency: z.string().optional(),
  notes: optionalText,
  color: optionalText,
  icon: optionalText,
});

const UpdateAccountSchema = z.object({
  id: uuid,
  balance: z.string().optional(),
  notes: optionalText,
  color: optionalText,
  icon: optionalText,
  is_archived: z.boolean().optional(),
});

// (S3a) Transaction schemas deleted with the ledger: migration 0011 drops
// the table and no tool entry references them.

// --- Finanzas FULL (T2): movements ledger + transfers (backend S-A/W2) ---
// Money travels as decimal STRINGS (e.g. "25000.00"), never JSON numbers:
// the backend rejects numeric amounts at the boundary with 422.
// Dates are calendar YYYY-MM-DD. All UUIDs must be owned by the caller.

const MoneyString = z
  .string()
  .min(1)
  .max(32)
  .regex(/^\d+(\.\d{1,2})?$/, "amount must be a positive decimal string, e.g. \"25000.00\"");

const CalendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

const MovementBase = {
  amount: MoneyString,
  account_id: uuid,
  occurred_on: CalendarDate,
  description: z.string().max(2000).optional(),
};

const AddExpenseSchema = z.object({
  ...MovementBase,
  category_id: uuid,
});

const AddIncomeSchema = z.object({
  ...MovementBase,
  category_id: uuid,
});

const ListMovementsSchema = z.object({});

const GetMovementSchema = z.object({ id: uuid });

const UpdateMovementSchema = z.object({
  id: uuid,
  direction: z.enum(["expense", "income"]).optional(),
  amount: MoneyString.optional(),
  account_id: optionalUuid,
  category_id: optionalUuid,
  occurred_on: CalendarDate.optional(),
  description: z.string().max(2000).optional(),
});

const TransferMoneySchema = z.object({
  from_account_id: uuid,
  to_account_id: uuid,
  amount: MoneyString,
  occurred_on: CalendarDate,
  description: z.string().max(2000).optional(),
});

const GetSubscriptionSchema = z.object({ id: uuid });

const ListTasksSchema = z.object({
  view: z.enum(["today", "upcoming", "overdue", "done"]).optional(),
});

const GetTaskSchema = z.object({ id: uuid });

const CreateTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: optionalText,
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
  due_date: z.string().optional(),
  goal_id: optionalUuid,
  category_id: optionalUuid,
  sort_order: z.number().int().optional(),
});

const UpdateTaskSchema = z.object({
  id: uuid,
  title: z.string().min(1).max(200).optional(),
  description: optionalText,
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
  due_date: z.string().optional(),
  goal_id: optionalUuid,
  category_id: optionalUuid,
  sort_order: z.number().int().optional(),
});

const ListHabitsSchema = z.object({});

const GetHabitSchema = z.object({ id: uuid });

const HabitStreakSchema = z.object({ id: uuid });

const ListGoalsSchema = z.object({});

const GetGoalSchema = z.object({ id: uuid });

const CreateGoalSchema = z.object({
  name: z.string().min(1).max(200),
  area: z.string().min(1).max(100),
  description: optionalText,
  category_id: optionalUuid,
  start_date: z.string().optional(),
  due_date: z.string().optional(),
  status: z.enum(["active", "completed", "paused", "cancelled"]).optional(),
  color: optionalText,
});

const UpdateGoalSchema = z.object({
  id: uuid,
  name: z.string().min(1).max(200).optional(),
  description: optionalText,
  area: z.string().min(1).max(100).optional(),
  category_id: optionalUuid,
  start_date: z.string().optional(),
  due_date: z.string().optional(),
  status: z.enum(["active", "completed", "paused", "cancelled"]).optional(),
  color: optionalText,
});

const ListEventsSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

const GetEventSchema = z.object({ id: uuid });

const CreateEventSchema = z.object({
  title: z.string().min(1).max(200),
  starts_at: z.string().min(1),
  description: optionalText,
  kind: z.string().optional(),
  ends_at: z.string().optional(),
  all_day: z.boolean().optional(),
  location: optionalText,
  habit_id: optionalUuid,
  goal_id: optionalUuid,
  task_id: optionalUuid,
  debt_id: optionalUuid,
  subscription_id: optionalUuid,
  category_id: optionalUuid,
});

const UpdateEventSchema = z.object({
  id: uuid,
  title: z.string().min(1).max(200).optional(),
  description: optionalText,
  kind: z.string().optional(),
  starts_at: z.string().optional(),
  ends_at: z.string().optional(),
  all_day: z.boolean().optional(),
  location: optionalText,
  habit_id: optionalUuid,
  goal_id: optionalUuid,
  task_id: optionalUuid,
  debt_id: optionalUuid,
  subscription_id: optionalUuid,
  category_id: optionalUuid,
});

const ListNotesSchema = z.object({});

const GetNoteSchema = z.object({ id: uuid });

const CreateNoteSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().optional(),
  is_markdown: z.boolean().optional(),
  is_pinned: z.boolean().optional(),
  category_id: optionalUuid,
});

const UpdateNoteSchema = z.object({
  id: uuid,
  title: z.string().min(1).max(200).optional(),
  body: z.string().optional(),
  is_markdown: z.boolean().optional(),
  is_pinned: z.boolean().optional(),
  category_id: optionalUuid,
});

const SearchNotesSchema = z.object({ q: z.string().min(1) });

const ListCategoriesSchema = z.object({ kind: z.string().optional() });

const EmptySchema = z.object({});

const DeleteByIdSchema = z.object({ id: uuid });

// --- Config FULL (T3): tokens + preferences (backend routes::tokens, routes::me) ---
// Security: the raw `pd_...` secret travels ONLY in the create_token response
// (backend sets Cache-Control: no-store there). List/revoke shapes carry
// metadata (id, name, prefix, scopes, timestamps) — never the raw secret or
// its hash. Descriptions below warn agents to never log/commit the raw value.

const CreateTokenSchema = z.object({
  name: z.string().min(1).max(80),
  expires_in_days: z.number().int().min(1).max(3650).optional(),
});

const ListTokensSchema = z.object({});

const RevokeTokenSchema = z.object({ id: uuid });

const GetPreferencesSchema = z.object({});

const UpdatePreferencesSchema = z
  .object({
    currency_code: z.string().optional(),
    locale: z.string().optional(),
    timezone: z.string().optional(),
    dashboard_layout: z.unknown().optional(),
  })
  .refine(
    (v) =>
      v.currency_code !== undefined ||
      v.locale !== undefined ||
      v.timezone !== undefined ||
      v.dashboard_layout !== undefined,
    {
      message:
        "at least one field (currency_code, locale, timezone, dashboard_layout) is required",
    },
  );

// --- Dashboard read (T3): no backend aggregate endpoint exists (main.rs has
// no /stats or /dashboard route; dashboard_layout lives in user_preferences
// and the layout is frontend-only). Composition is client-side only.
const DashboardSummarySchema = z.object({});

// --- Audit log read (T7): in-memory ring buffer, read-only. Optional
// limit 1-200 (default applied at read time); validation rejects 0,
// negatives and >200 before any read.
const ListAuditLogSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
});

const entries: ToolEntry[] = [
  {
    def: {
      name: "login",
      description:
        "POST /api/login. Authenticates with email+password and returns the Bearer token (plus expires_at). The token is NOT cached: send it back as `Authorization: Bearer <token>` on subsequent MCP requests. Example: {\"email\":\"you@example.com\",\"password\":\"secret\"}.",
      inputSchema: {
        type: "object",
        properties: {
          email: strProp("User email address, e.g. you@example.com"),
          password: strProp("User password (min 1 char, never log it)"),
        },
        required: ["email", "password"],
      },
    },
    schema: LoginSchema,
    run: async (args) => fmt(await apiLogin(args.email, args.password)),
  },
  {
    def: {
      name: "list_accounts",
      description: "GET /api/accounts. Lists non-archived accounts.",
      inputSchema: { type: "object", properties: {} },
    },
    schema: ListAccountsSchema,
    run: async (_args, token) => fmt(await apiGet("/accounts", undefined, token)),
  },
  {
    def: {
      name: "get_account",
      description: "GET /api/accounts/{id}. Fetches one account.",
      inputSchema: {
        type: "object",
        properties: { id: strProp("Account UUID") },
        required: ["id"],
      },
    },
    schema: GetAccountSchema,
    run: async (args, token) => fmt(await apiGet(`/accounts/${args.id}`, undefined, token)),
  },
  {
    def: {
      name: "create_account",
      description:
        "POST /api/accounts. Creates an account with name plus optional currency/notes/color/icon. Unknown keys are rejected by the strict schema, including the removed card fields (type, credit_limit, statement_day, payment_due_day).",
      inputSchema: {
        type: "object",
        properties: {
          name: strProp("Account name"),
          currency: optStrProp("ISO currency, e.g. USD"),
          notes: optStrProp("Notes"),
          color: optStrProp("Color tag"),
          icon: optStrProp("Icon tag"),
        },
        required: ["name"],
      },
    },
    schema: CreateAccountSchema,
    run: async (args, token) => fmt(await apiPost("/accounts", args, token)),
  },
  {
    def: {
      name: "update_account",
      description:
        "PATCH /api/accounts/{id}. Accepted fields: balance/notes/color/icon/is_archived. Balance is user-owned manual data as a decimal string (e.g. \"980000.00\").",
      inputSchema: {
        type: "object",
        properties: {
          id: strProp("Account UUID"),
          balance: optStrProp("Manual balance as a decimal string, e.g. \"980000.00\""),
          notes: optStrProp("Notes"),
          color: optStrProp("Color tag"),
          icon: optStrProp("Icon tag"),
          is_archived: boolProp("Archive flag"),
        },
        required: ["id"],
      },
    },
    schema: UpdateAccountSchema,
    run: async (args, token) => fmt(await apiPatch(`/accounts/${args.id}`, withoutId(args), token)),
  },
  {
    def: {
      name: "delete_account",
      description: "DELETE /api/accounts/{id}. Deletes an account.",
      inputSchema: {
        type: "object",
        properties: { id: strProp("Account UUID") },
        required: ["id"],
      },
    },
    schema: DeleteByIdSchema,
    run: async (args, token) => fmt(await apiDelete(`/accounts/${args.id}`, token)),
  },
  {
    def: {
      name: "add_expense",
      description:
        "POST /api/movements. Records an expense: debits the account balance atomically. Requires account_id (owned account UUID), category_id (owned category UUID), amount as a decimal string (e.g. \"25000.00\", never a JSON number), occurred_on as YYYY-MM-DD. Optional description (max 2000 chars).",
      inputSchema: {
        type: "object",
        properties: {
          account_id: strProp("Owned account UUID to debit"),
          category_id: strProp("Owned category UUID"),
          amount: strProp("Positive amount as a decimal string, e.g. \"25000.00\""),
          occurred_on: strProp("Calendar date YYYY-MM-DD"),
          description: optStrProp("Free text, max 2000 chars"),
        },
        required: ["account_id", "category_id", "amount", "occurred_on"],
      },
    },
    schema: AddExpenseSchema,
    run: async (args, token) =>
      fmt(await apiPost("/movements", { direction: "expense", ...args }, token)),
  },
  {
    def: {
      name: "add_income",
      description:
        "POST /api/movements. Records income: credits the account balance atomically. Requires account_id (owned account UUID), category_id (owned category UUID), amount as a decimal string (e.g. \"25000.00\", never a JSON number), occurred_on as YYYY-MM-DD. Optional description (max 2000 chars).",
      inputSchema: {
        type: "object",
        properties: {
          account_id: strProp("Owned account UUID to credit"),
          category_id: strProp("Owned category UUID"),
          amount: strProp("Positive amount as a decimal string, e.g. \"25000.00\""),
          occurred_on: strProp("Calendar date YYYY-MM-DD"),
          description: optStrProp("Free text, max 2000 chars"),
        },
        required: ["account_id", "category_id", "amount", "occurred_on"],
      },
    },
    schema: AddIncomeSchema,
    run: async (args, token) =>
      fmt(await apiPost("/movements", { direction: "income", ...args }, token)),
  },
  {
    def: {
      name: "list_movements",
      description:
        "GET /api/movements. Lists all movements (expenses, income and transfers) ordered by date descending. No filters server-side: fetch then filter client-side for charts or summaries.",
      inputSchema: { type: "object", properties: {} },
    },
    schema: ListMovementsSchema,
    run: async (_args, token) => fmt(await apiGet("/movements", undefined, token)),
  },
  {
    def: {
      name: "get_movement",
      description: "GET /api/movements/{id}. Fetches one movement by UUID.",
      inputSchema: {
        type: "object",
        properties: { id: strProp("Movement UUID") },
        required: ["id"],
      },
    },
    schema: GetMovementSchema,
    run: async (args, token) => fmt(await apiGet(`/movements/${args.id}`, undefined, token)),
  },
  {
    def: {
      name: "update_movement",
      description:
        "PATCH /api/movements/{id}. Edits an expense/income movement; omitted fields keep their stored value and balances are reversed/re-applied atomically. Any subset of direction (expense|income), amount (decimal string), account_id, category_id, occurred_on (YYYY-MM-DD), description. Transfers cannot be edited (backend is 422): delete and re-create instead.",
      inputSchema: {
        type: "object",
        properties: {
          id: strProp("Movement UUID"),
          direction: optStrProp("expense|income"),
          amount: optStrProp("Amount as a decimal string, e.g. \"25000.00\""),
          account_id: optStrProp("Owned account UUID"),
          category_id: optStrProp("Owned category UUID"),
          occurred_on: optStrProp("Calendar date YYYY-MM-DD"),
          description: optStrProp("Free text, max 2000 chars"),
        },
        required: ["id"],
      },
    },
    schema: UpdateMovementSchema,
    run: async (args, token) =>
      fmt(await apiPatch(`/movements/${args.id}`, withoutId(args), token)),
  },
  {
    def: {
      name: "delete_movement",
      description:
        "DELETE /api/movements/{id}. Deletes a movement and reverses its balance effect atomically. Also the way to remove a transfer (transfers are create/delete only).",
      inputSchema: {
        type: "object",
        properties: { id: strProp("Movement UUID") },
        required: ["id"],
      },
    },
    schema: DeleteByIdSchema,
    run: async (args, token) => fmt(await apiDelete(`/movements/${args.id}`, token)),
  },
  {
    def: {
      name: "transfer_money",
      description:
        "POST /api/movements/transfer. Moves money between two owned accounts in one atomic transaction: debits from_account_id, credits to_account_id. Both accounts must be owned, distinct, and share the same currency. Amount is a decimal string (e.g. \"25000.00\"), occurred_on is YYYY-MM-DD, description optional. No category: transfers carry no category_id.",
      inputSchema: {
        type: "object",
        properties: {
          from_account_id: strProp("Origin account UUID (debited)"),
          to_account_id: strProp("Destination account UUID (credited)"),
          amount: strProp("Positive amount as a decimal string, e.g. \"25000.00\""),
          occurred_on: strProp("Calendar date YYYY-MM-DD"),
          description: optStrProp("Free text, max 2000 chars"),
        },
        required: ["from_account_id", "to_account_id", "amount", "occurred_on"],
      },
    },
    schema: TransferMoneySchema,
    run: async (args, token) => fmt(await apiPost("/movements/transfer", args, token)),
  },
  {
    def: {
      name: "list_tasks",
      description:
        "GET /api/tasks. Lists tasks, optionally filtered by status view (today|upcoming|overdue|done). Omitted view returns all tasks.",
      inputSchema: {
        type: "object",
        properties: {
          view: enumProp("Status view filter: today|upcoming|overdue|done. Omit for all tasks.", [
            "today",
            "upcoming",
            "overdue",
            "done",
          ]),
        },
      },
    },
    schema: ListTasksSchema,
    run: async (args, token) =>
      fmt(await apiGet("/tasks", args.view ? { view: args.view } : undefined, token)),
  },
  {
    def: {
      name: "get_task",
      description: "GET /api/tasks/{id}. Fetches one task by its UUID.",
      inputSchema: {
        type: "object",
        properties: { id: strProp("Task UUID") },
        required: ["id"],
      },
    },
    schema: GetTaskSchema,
    run: async (args, token) => fmt(await apiGet(`/tasks/${args.id}`, undefined, token)),
  },
  {
    def: {
      name: "create_task",
      description:
        "POST /api/tasks. Creates a task. Only title is required; priority defaults server-side, status defaults to pending. Dates are YYYY-MM-DD. Linked IDs (goal_id, category_id) must be owned UUIDs. Example: {\"title\":\"Pay rent\",\"priority\":\"high\",\"due_date\":\"2026-10-10\"}.",
      inputSchema: {
        type: "object",
        properties: {
          title: strProp("Task title (1-200 chars, required)"),
          description: optStrProp("Description"),
          priority: enumProp("Priority: low|medium|high|urgent", [
            "low",
            "medium",
            "high",
            "urgent",
          ]),
          status: enumProp("Status: pending|in_progress|completed|cancelled", [
            "pending",
            "in_progress",
            "completed",
            "cancelled",
          ]),
          due_date: optStrProp("Due date as YYYY-MM-DD"),
          goal_id: optStrProp("Owned goal UUID"),
          category_id: optStrProp("Owned task-kind category UUID"),
          sort_order: intProp("Ordering within the list"),
        },
        required: ["title"],
      },
    },
    schema: CreateTaskSchema,
    run: async (args, token) => fmt(await apiPost("/tasks", args, token)),
  },
  {
    def: {
      name: "update_task",
      description:
        "PATCH /api/tasks/{id}. Partial update: only supplied fields change (title, description, priority, status, due_date YYYY-MM-DD, goal_id/category_id UUIDs, sort_order). Requires the task UUID.",
      inputSchema: {
        type: "object",
        properties: {
          id: strProp("Task UUID"),
          title: optStrProp("Title (1-200 chars)"),
          description: optStrProp("Description"),
          priority: enumProp("Priority: low|medium|high|urgent", [
            "low",
            "medium",
            "high",
            "urgent",
          ]),
          status: enumProp("Status: pending|in_progress|completed|cancelled", [
            "pending",
            "in_progress",
            "completed",
            "cancelled",
          ]),
          due_date: optStrProp("Due date as YYYY-MM-DD"),
          goal_id: optStrProp("Owned goal UUID"),
          category_id: optStrProp("Category UUID"),
          sort_order: intProp("Sort order"),
        },
        required: ["id"],
      },
    },
    schema: UpdateTaskSchema,
    run: async (args, token) => fmt(await apiPatch(`/tasks/${args.id}`, withoutId(args), token)),
  },
  {
    def: {
      name: "delete_task",
      description: "DELETE /api/tasks/{id}. Deletes a task by its UUID.",
      inputSchema: {
        type: "object",
        properties: { id: strProp("Task UUID") },
        required: ["id"],
      },
    },
    schema: DeleteByIdSchema,
    run: async (args, token) => fmt(await apiDelete(`/tasks/${args.id}`, token)),
  },
  {
    def: {
      name: "list_habits",
      description: "GET /api/habits.",
      inputSchema: { type: "object", properties: {} },
    },
    schema: ListHabitsSchema,
    run: async (_args, token) => fmt(await apiGet("/habits", undefined, token)),
  },
  {
    def: {
      name: "get_habit",
      description: "GET /api/habits/{id}.",
      inputSchema: {
        type: "object",
        properties: { id: strProp("Habit UUID") },
        required: ["id"],
      },
    },
    schema: GetHabitSchema,
    run: async (args, token) => fmt(await apiGet(`/habits/${args.id}`, undefined, token)),
  },
  {
    def: {
      name: "habits_today",
      description: "GET /api/habits/today. Today's habit checklist.",
      inputSchema: { type: "object", properties: {} },
    },
    schema: EmptySchema,
    run: async (_args, token) => fmt(await apiGet("/habits/today", undefined, token)),
  },
  {
    def: {
      name: "get_habit_streak",
      description: "GET /api/habits/{id}/streak. On-demand streak read model.",
      inputSchema: {
        type: "object",
        properties: { id: strProp("Habit UUID") },
        required: ["id"],
      },
    },
    schema: HabitStreakSchema,
    run: async (args, token) => fmt(await apiGet(`/habits/${args.id}/streak`, undefined, token)),
  },
  {
    def: {
      name: "list_goals",
      description: "GET /api/goals. Lists all goals.",
      inputSchema: { type: "object", properties: {} },
    },
    schema: ListGoalsSchema,
    run: async (_args, token) => fmt(await apiGet("/goals", undefined, token)),
  },
  {
    def: {
      name: "get_goal",
      description: "GET /api/goals/{id}. Fetches one goal by its UUID.",
      inputSchema: {
        type: "object",
        properties: { id: strProp("Goal UUID") },
        required: ["id"],
      },
    },
    schema: GetGoalSchema,
    run: async (args, token) => fmt(await apiGet(`/goals/${args.id}`, undefined, token)),
  },
  {
    def: {
      name: "create_goal",
      description:
        "POST /api/goals. Creates a goal. Requires name (1-200 chars) and area (free-form label, 1-100 chars); progress is trigger-owned (read-only). Dates are YYYY-MM-DD. Example: {\"name\":\"Run 10k\",\"area\":\"health\"}.",
      inputSchema: {
        type: "object",
        properties: {
          name: strProp("Goal name (1-200 chars, required)"),
          area: strProp("Free-form area label (1-100 chars, required)"),
          description: optStrProp("Description"),
          category_id: optStrProp("Owned goal-kind category UUID"),
          start_date: optStrProp("Start date as YYYY-MM-DD"),
          due_date: optStrProp("Due date as YYYY-MM-DD"),
          status: enumProp("Status: active|completed|paused|cancelled", [
            "active",
            "completed",
            "paused",
            "cancelled",
          ]),
          color: optStrProp("Color tag"),
        },
        required: ["name", "area"],
      },
    },
    schema: CreateGoalSchema,
    run: async (args, token) => fmt(await apiPost("/goals", args, token)),
  },
  {
    def: {
      name: "update_goal",
      description:
        "PATCH /api/goals/{id}. Partial update: only supplied fields change. Requires the goal UUID.",
      inputSchema: {
        type: "object",
        properties: {
          id: strProp("Goal UUID"),
          name: optStrProp("Name (1-200 chars)"),
          description: optStrProp("Description"),
          area: optStrProp("Area label (1-100 chars)"),
          category_id: optStrProp("Category UUID"),
          start_date: optStrProp("Start date as YYYY-MM-DD"),
          due_date: optStrProp("Due date as YYYY-MM-DD"),
          status: enumProp("Status: active|completed|paused|cancelled", [
            "active",
            "completed",
            "paused",
            "cancelled",
          ]),
          color: optStrProp("Color tag"),
        },
        required: ["id"],
      },
    },
    schema: UpdateGoalSchema,
    run: async (args, token) => fmt(await apiPatch(`/goals/${args.id}`, withoutId(args), token)),
  },
  {
    def: {
      name: "delete_goal",
      description: "DELETE /api/goals/{id}. Deletes a goal by its UUID.",
      inputSchema: {
        type: "object",
        properties: { id: strProp("Goal UUID") },
        required: ["id"],
      },
    },
    schema: DeleteByIdSchema,
    run: async (args, token) => fmt(await apiDelete(`/goals/${args.id}`, token)),
  },
  {
    def: {
      name: "list_events",
      description:
        "GET /api/events. Lists events, optionally filtered by from/to date range (RFC3339 datetime or YYYY-MM-DD). Omitted filters return all events.",
      inputSchema: {
        type: "object",
        properties: {
          from: optStrProp("Start filter: RFC3339 datetime or YYYY-MM-DD"),
          to: optStrProp("End filter: RFC3339 datetime or YYYY-MM-DD"),
        },
      },
    },
    schema: ListEventsSchema,
    run: async (args, token) => fmt(await apiGet("/events", args, token)),
  },
  {
    def: {
      name: "get_event",
      description: "GET /api/events/{id}. Fetches one event by its UUID.",
      inputSchema: {
        type: "object",
        properties: { id: strProp("Event UUID") },
        required: ["id"],
      },
    },
    schema: GetEventSchema,
    run: async (args, token) => fmt(await apiGet(`/events/${args.id}`, undefined, token)),
  },
  {
    def: {
      name: "create_event",
      description:
        "POST /api/events. Creates a calendar event. Requires title (1-200 chars) and starts_at (RFC3339 datetime, e.g. 2026-10-10T09:00:00Z). Optional ends_at must be > starts_at; linked IDs must be owned UUIDs. Example: {\"title\":\"Dentist\",\"starts_at\":\"2026-10-10T09:00:00Z\"}.",
      inputSchema: {
        type: "object",
        properties: {
          title: strProp("Title (1-200 chars, required)"),
          starts_at: strProp("Start as RFC3339 datetime (required), e.g. 2026-10-10T09:00:00Z"),
          description: optStrProp("Description"),
          kind: optStrProp("Event kind label"),
          ends_at: optStrProp("End as RFC3339 datetime, must be > starts_at"),
          all_day: boolProp("All-day flag"),
          location: optStrProp("Location"),
          habit_id: optStrProp("Habit UUID link"),
          goal_id: optStrProp("Goal UUID link"),
          task_id: optStrProp("Task UUID link"),
          debt_id: optStrProp("Debt UUID link"),
          subscription_id: optStrProp("Subscription UUID link"),
          category_id: optStrProp("Category UUID link"),
        },
        required: ["title", "starts_at"],
      },
    },
    schema: CreateEventSchema,
    run: async (args, token) => fmt(await apiPost("/events", args, token)),
  },
  {
    def: {
      name: "update_event",
      description:
        "PATCH /api/events/{id}. Partial update: only supplied fields change (datetimes are RFC3339). Requires the event UUID.",
      inputSchema: {
        type: "object",
        properties: {
          id: strProp("Event UUID"),
          title: optStrProp("Title (1-200 chars)"),
          description: optStrProp("Description"),
          kind: optStrProp("Event kind"),
          starts_at: optStrProp("Start as RFC3339 datetime"),
          ends_at: optStrProp("End as RFC3339 datetime"),
          all_day: boolProp("All-day flag"),
          location: optStrProp("Location"),
          habit_id: optStrProp("Habit UUID"),
          goal_id: optStrProp("Goal UUID"),
          task_id: optStrProp("Task UUID"),
          debt_id: optStrProp("Debt UUID"),
          subscription_id: optStrProp("Subscription UUID"),
          category_id: optStrProp("Category UUID"),
        },
        required: ["id"],
      },
    },
    schema: UpdateEventSchema,
    run: async (args, token) => fmt(await apiPatch(`/events/${args.id}`, withoutId(args), token)),
  },
  {
    def: {
      name: "delete_event",
      description: "DELETE /api/events/{id}. Deletes an event by its UUID.",
      inputSchema: {
        type: "object",
        properties: { id: strProp("Event UUID") },
        required: ["id"],
      },
    },
    schema: DeleteByIdSchema,
    run: async (args, token) => fmt(await apiDelete(`/events/${args.id}`, token)),
  },
  {
    def: {
      name: "list_notes",
      description: "GET /api/notes. Pinned-first order.",
      inputSchema: { type: "object", properties: {} },
    },
    schema: ListNotesSchema,
    run: async (_args, token) => fmt(await apiGet("/notes", undefined, token)),
  },
  {
    def: {
      name: "get_note",
      description: "GET /api/notes/{id}.",
      inputSchema: {
        type: "object",
        properties: { id: strProp("Note UUID") },
        required: ["id"],
      },
    },
    schema: GetNoteSchema,
    run: async (args, token) => fmt(await apiGet(`/notes/${args.id}`, undefined, token)),
  },
  {
    def: {
      name: "create_note",
      description: "POST /api/notes.",
      inputSchema: {
        type: "object",
        properties: {
          title: strProp("Title"),
          body: optStrProp("Body (max 1MiB)"),
          is_markdown: boolProp("Markdown flag"),
          is_pinned: boolProp("Pin flag"),
          category_id: optStrProp("Owned category UUID"),
        },
        required: ["title"],
      },
    },
    schema: CreateNoteSchema,
    run: async (args, token) => fmt(await apiPost("/notes", args, token)),
  },
  {
    def: {
      name: "update_note",
      description: "PATCH /api/notes/{id}. Pin toggle via {is_pinned:true}.",
      inputSchema: {
        type: "object",
        properties: {
          id: strProp("Note UUID"),
          title: optStrProp("Title"),
          body: optStrProp("Body"),
          is_markdown: boolProp("Markdown flag"),
          is_pinned: boolProp("Pin flag"),
          category_id: optStrProp("Category UUID"),
        },
        required: ["id"],
      },
    },
    schema: UpdateNoteSchema,
    run: async (args, token) => fmt(await apiPatch(`/notes/${args.id}`, withoutId(args), token)),
  },
  {
    def: {
      name: "delete_note",
      description: "DELETE /api/notes/{id}.",
      inputSchema: {
        type: "object",
        properties: { id: strProp("Note UUID") },
        required: ["id"],
      },
    },
    schema: DeleteByIdSchema,
    run: async (args, token) => fmt(await apiDelete(`/notes/${args.id}`, token)),
  },
  {
    def: {
      name: "search_notes",
      description: "GET /api/notes/search?q=. Full-text search over title/body.",
      inputSchema: {
        type: "object",
        properties: { q: strProp("Search query") },
        required: ["q"],
      },
    },
    schema: SearchNotesSchema,
    run: async (args, token) => fmt(await apiGet("/notes/search", { q: args.q }, token)),
  },
  {
    def: {
      name: "list_categories",
      description: "GET /api/categories. Optional kind filter.",
      inputSchema: {
        type: "object",
        properties: { kind: optStrProp("Category kind filter") },
      },
    },
    schema: ListCategoriesSchema,
    run: async (args, token) =>
      fmt(await apiGet("/categories", args.kind ? { kind: args.kind } : undefined, token)),
  },
  {
    def: {
      name: "list_subscriptions",
      description: "GET /api/subscriptions.",
      inputSchema: { type: "object", properties: {} },
    },
    schema: EmptySchema,
    run: async (_args, token) => fmt(await apiGet("/subscriptions", undefined, token)),
  },
  {
    def: {
      name: "get_subscription",
      description:
        "GET /api/subscriptions/{id}. Fetches one subscription with its lifecycle (is_active, cancelled_at) and pay state (last_paid_on, next_billing_on).",
      inputSchema: {
        type: "object",
        properties: { id: strProp("Subscription UUID") },
        required: ["id"],
      },
    },
    schema: GetSubscriptionSchema,
    run: async (args, token) =>
      fmt(await apiGet(`/subscriptions/${args.id}`, undefined, token)),
  },
  {
    def: {
      name: "list_assets",
      description: "GET /api/assets.",
      inputSchema: { type: "object", properties: {} },
    },
    schema: EmptySchema,
    run: async (_args, token) => fmt(await apiGet("/assets", undefined, token)),
  },
  {
    def: {
      name: "get_net_worth",
      description: "GET /api/net-worth. Total assets valuation.",
      inputSchema: { type: "object", properties: {} },
    },
    schema: EmptySchema,
    run: async (_args, token) => fmt(await apiGet("/net-worth", undefined, token)),
  },
  {
    def: {
      name: "list_tokens",
      description:
        "GET /api/tokens. Lists personal API tokens as metadata only (id, name, prefix, scopes, expires_at, last_used_at, revoked_at, created_at). NEVER returns the raw secret or its hash — the raw `pd_...` value appears only once in the create_token response. Accepts session or API-token auth.",
      inputSchema: { type: "object", properties: {} },
    },
    schema: ListTokensSchema,
    run: async (_args, token) => fmt(await apiGet("/tokens", undefined, token)),
  },
  {
    def: {
      name: "create_token",
      description:
        "POST /api/tokens. Creates a personal API token. SESSION AUTH ONLY: call with a session Bearer token from login, never with an existing `pd_...` token (backend is 401 otherwise). Returns the raw `pd_...` secret EXACTLY ONCE (Cache-Control: no-store) — copy it now, it is never stored nor shown again. SENSITIVE: never log, commit, or share the raw value. Optional expires_in_days (1-3650); omitted means no expiry. Duplicate names per user are 409.",
      inputSchema: {
        type: "object",
        properties: {
          name: strProp("Token name, 1-80 chars (trimmed)"),
          expires_in_days: intProp("Lifetime in whole days, 1-3650; omitted means no expiry"),
        },
        required: ["name"],
      },
    },
    schema: CreateTokenSchema,
    run: async (args, token) => fmt(await apiPost("/tokens", args, token)),
  },
  {
    def: {
      name: "revoke_token",
      description:
        "DELETE /api/tokens/{id}. Revokes an API token immediately (soft revoke; idempotent — a repeated call returns 200 with the original revoked_at). A revoked token is rejected with 401 on next use. Accepts session or API-token auth. Returns the revoked token metadata (no secret).",
      inputSchema: {
        type: "object",
        properties: { id: strProp("Token UUID") },
        required: ["id"],
      },
    },
    schema: RevokeTokenSchema,
    run: async (args, token) => fmt(await apiDelete(`/tokens/${args.id}`, token)),
  },
  {
    def: {
      name: "get_preferences",
      description:
        "GET /api/me (preferences view). Returns the caller's stored preferences (currency_code, locale, timezone, dashboard_layout). No dedicated GET /api/me/preferences exists on the backend — this tool reads GET /api/me and returns its `preferences` object. Session auth.",
      inputSchema: { type: "object", properties: {} },
    },
    schema: GetPreferencesSchema,
    run: async (_args, token) => {
      const me = await apiGet<{ preferences?: unknown }>("/me", undefined, token);
      return fmt(me.preferences ?? me);
    },
  },
  {
    def: {
      name: "update_preferences",
      description:
        "PATCH /api/me/preferences. Partial update: only supplied fields change (currency_code must be a known ISO-4217 code, e.g. USD; locale must match ll or ll-CC, e.g. es-CO; timezone must be a known IANA name, e.g. America/Bogota; dashboard_layout must be {widgets:[{id,type,order,size}]} with type in metric|chart|list|ledger|heatmap and size in sm|md|lg). Every value is validated before any write — invalid input is 422 and writes nothing. At least one field is required.",
      inputSchema: {
        type: "object",
        minProperties: 1,
        properties: {
          currency_code: optStrProp("Known ISO-4217 code, e.g. USD"),
          locale: optStrProp("ll or ll-CC, e.g. es-CO"),
          timezone: optStrProp("IANA time zone name, e.g. America/Bogota"),
          dashboard_layout: {
            type: "object",
            description:
              "{widgets:[{id,type,order,size}]} with type in metric|chart|list|ledger|heatmap and size in sm|md|lg, max 32 widgets",
          },
        },
      },
    },
    schema: UpdatePreferencesSchema,
    run: async (args, token) => fmt(await apiPatch("/me/preferences", args, token)),
  },
  {
    def: {
      name: "get_dashboard_summary",
      description:
        "Client-side read-only summary (no backend aggregate endpoint exists — main.rs has no /stats or /dashboard route and the layout is frontend-only). Composes GET /api/accounts + GET /api/movements + GET /api/tasks?view=today + GET /api/habits/today into one JSON snapshot. For charts or totals, fetch list_movements and aggregate locally.",
      inputSchema: { type: "object", properties: {} },
    },
    schema: DashboardSummarySchema,
    run: async (_args, token) => {
      const [accounts, movements, tasks, habits] = await Promise.all([
        apiGet<unknown>("/accounts", undefined, token),
        apiGet<unknown>("/movements", undefined, token),
        apiGet<unknown>("/tasks", { view: "today" }, token),
        apiGet<unknown>("/habits/today", undefined, token),
      ]);
      const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
      return fmt({
        accounts: { count: asArray(accounts).length, items: accounts },
        movements: { count: asArray(movements).length, items: movements },
        tasks_today: { count: asArray(tasks).length, items: tasks },
        habits_today: habits,
        note: "Client-side composition; no backend aggregate endpoint. Aggregate list_movements locally for charts/totals.",
      });
    },
  },
  {
    def: {
      name: "list_audit_log",
      description:
        "Read-only view of the in-memory MCP audit log (T7). Returns recent tools/call entries newest-first: occurred_at, tool, success, error_code, token_prefix (masked display prefix only, never a secret), request_id. No arguments required; optional limit (1-200, default 50). The log is a ring buffer of the last 200 calls and resets on server restart — it is a demo, not durable storage (durable table design is pending owner decision, see backend/migrations/0017_mcp_audit_log.sql).",
      inputSchema: {
        type: "object",
        properties: {
          limit: intProp("Max entries to return, 1-200 (default 50)"),
        },
      },
    },
    schema: ListAuditLogSchema,
    run: async (args) => fmt(readAuditLog(args.limit)),
  },
];

// --- T7 audit log (in-memory ring buffer, mostrable sin migración) ---
//
// What is stored per tools/call: occurred_at, tool name, success flag,
// error_code (UNKNOWN_TOOL | TOOL_ERROR | null), token_prefix (masked —
// `pd_` display prefix of 8 chars, or the label "session"/"none"; NEVER
// the raw token), request_id (random UUID per call).
// What is NEVER stored: raw tokens, token hashes, tool arguments, request
// bodies, Authorization headers. `tools/list` is not logged (call only).

/** One auditable tools/call outcome. No secrets, no params, no bodies. */
export interface AuditEntry {
  occurred_at: string;
  tool: string;
  success: boolean;
  error_code: string | null;
  token_prefix: string;
  request_id: string;
}

const MAX_AUDIT_ENTRIES = 200;

const auditLog: AuditEntry[] = [];

/**
 * Mask a request token for the audit log. `pd_` API tokens contribute
 * only their 8-char display prefix (useless without the 256-bit secret);
 * opaque session tokens collapse to the label "session"; missing tokens
 * log as "none". The raw value never reaches the log.
 */
export function tokenPrefixForLog(token?: RequestToken): string {
  if (token === undefined) return "none";
  const t = token.trim();
  if (t.length === 0) return "none";
  if (t.startsWith("pd_")) return t.slice(0, 8);
  return "session";
}

/** Append an entry, evicting the oldest once the buffer is full. */
export function recordAudit(entry: AuditEntry): void {
  auditLog.push(entry);
  if (auditLog.length > MAX_AUDIT_ENTRIES) {
    auditLog.splice(0, auditLog.length - MAX_AUDIT_ENTRIES);
  }
}

/** Recent entries newest-first, capped to the buffer size. */
export function readAuditLog(limit?: number): AuditEntry[] {
  const n =
    limit === undefined ? 50 : Math.max(1, Math.min(Math.floor(limit), MAX_AUDIT_ENTRIES));
  return auditLog.slice(-n).reverse();
}

export const toolDefinitions: McpToolDef[] = entries.map((e) => e.def);

export async function dispatchTool(
  name: string,
  rawArgs: unknown,
  token?: RequestToken,
): Promise<string> {
  const entry = entries.find((e) => e.def.name === name);
  if (!entry) {
    throw new Error(`unknown tool: ${name}`);
  }
  const parsed = entry.schema.parse(rawArgs ?? {});
  return entry.run(parsed, token);
}

export function listToolNames(): string[] {
  return entries.map((e) => e.def.name);
}
