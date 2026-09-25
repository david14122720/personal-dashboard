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
const dateString = z.string().min(1);
const optionalText = z.string().optional();

function fmt(data: unknown): string {
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

const CreateAccountSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(["bank", "savings", "cash", "digital_wallet", "credit_card", "investment", "other"]),
  currency: z.string().optional(),
  credit_limit: z.string().optional(),
  statement_day: z.number().int().min(1).max(31).optional(),
  payment_due_day: z.number().int().min(1).max(31).optional(),
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

const CreateHabitSchema = z.object({
  name: z.string().min(1).max(200),
  description: optionalText,
  direction: z.enum(["build", "maintain", "reduce", "quit"]),
  frequency: z.enum(["daily", "weekly", "monthly", "custom"]).optional(),
  days_of_week: z.array(z.number().int().min(0).max(6)).optional(),
  target_per_period: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  category_id: optionalUuid,
  color: optionalText,
  icon: optionalText,
});

const UpdateHabitSchema = z.object({
  id: uuid,
  name: z.string().min(1).max(200).optional(),
  description: optionalText,
  target_per_period: z.string().optional(),
  end_date: z.string().optional(),
  category_id: optionalUuid,
  color: optionalText,
  icon: optionalText,
  is_archived: z.boolean().optional(),
});

const CreateHabitLogSchema = z.object({
  id: uuid,
  log_date: dateString,
  status: z.enum(["done", "missed", "skipped"]),
  count_value: z.string().optional(),
  notes: optionalText,
});

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

const entries: ToolEntry[] = [
  {
    def: {
      name: "login",
      description:
        "POST /api/login. Authenticates with email+password and returns the Bearer token. The token is NOT cached: send it back as `Authorization: Bearer <token>` on subsequent MCP requests.",
      inputSchema: {
        type: "object",
        properties: {
          email: strProp("User email"),
          password: strProp("User password"),
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
      description: "POST /api/accounts. Creates a bank/cash/card/investment account.",
      inputSchema: {
        type: "object",
        properties: {
          name: strProp("Account name"),
          type: strProp("bank|savings|cash|digital_wallet|credit_card|investment|other"),
          currency: optStrProp("ISO currency, e.g. USD"),
          credit_limit: optStrProp("Required iff type=credit_card, e.g. \"5000.00\""),
          statement_day: intProp("Billing statement day 1-31 (credit_card only)"),
          payment_due_day: intProp("Payment due day 1-31 (credit_card only)"),
          notes: optStrProp("Notes"),
          color: optStrProp("Color tag"),
          icon: optStrProp("Icon tag"),
        },
        required: ["name", "type"],
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
      name: "list_tasks",
      description: "GET /api/tasks. Optional status view: today|upcoming|overdue|done.",
      inputSchema: {
        type: "object",
        properties: { view: optStrProp("today|upcoming|overdue|done") },
      },
    },
    schema: ListTasksSchema,
    run: async (args, token) =>
      fmt(await apiGet("/tasks", args.view ? { view: args.view } : undefined, token)),
  },
  {
    def: {
      name: "get_task",
      description: "GET /api/tasks/{id}.",
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
      description: "POST /api/tasks.",
      inputSchema: {
        type: "object",
        properties: {
          title: strProp("Task title"),
          description: optStrProp("Description"),
          priority: optStrProp("low|medium|high|urgent"),
          status: optStrProp("pending|in_progress|completed|cancelled"),
          due_date: optStrProp("YYYY-MM-DD"),
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
      description: "PATCH /api/tasks/{id}.",
      inputSchema: {
        type: "object",
        properties: {
          id: strProp("Task UUID"),
          title: optStrProp("Title"),
          description: optStrProp("Description"),
          priority: optStrProp("low|medium|high|urgent"),
          status: optStrProp("pending|in_progress|completed|cancelled"),
          due_date: optStrProp("YYYY-MM-DD"),
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
      description: "DELETE /api/tasks/{id}.",
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
      name: "create_habit",
      description: "POST /api/habits. direction=build|maintain|reduce|quit; custom frequency requires days_of_week.",
      inputSchema: {
        type: "object",
        properties: {
          name: strProp("Habit name"),
          description: optStrProp("Description"),
          direction: strProp("build|maintain|reduce|quit"),
          frequency: optStrProp("daily|weekly|monthly|custom"),
          days_of_week: { type: "array", items: { type: "integer" }, description: "0=Sun..6=Sat (custom only)" } as object,
          target_per_period: optStrProp("Decimal string, e.g. \"1.00\""),
          start_date: optStrProp("YYYY-MM-DD"),
          end_date: optStrProp("YYYY-MM-DD"),
          category_id: optStrProp("Owned habit-kind category UUID"),
          color: optStrProp("Color tag"),
          icon: optStrProp("Icon tag"),
        },
        required: ["name", "direction"],
      },
    },
    schema: CreateHabitSchema,
    run: async (args, token) => fmt(await apiPost("/habits", args, token)),
  },
  {
    def: {
      name: "update_habit",
      description: "PATCH /api/habits/{id}. Metadata-scoped: name/description/target/end/category/color/icon/archived.",
      inputSchema: {
        type: "object",
        properties: {
          id: strProp("Habit UUID"),
          name: optStrProp("Name"),
          description: optStrProp("Description"),
          target_per_period: optStrProp("Decimal string"),
          end_date: optStrProp("YYYY-MM-DD"),
          category_id: optStrProp("Category UUID"),
          color: optStrProp("Color tag"),
          icon: optStrProp("Icon tag"),
          is_archived: boolProp("Archive flag"),
        },
        required: ["id"],
      },
    },
    schema: UpdateHabitSchema,
    run: async (args, token) => fmt(await apiPatch(`/habits/${args.id}`, withoutId(args), token)),
  },
  {
    def: {
      name: "delete_habit",
      description: "DELETE /api/habits/{id}.",
      inputSchema: {
        type: "object",
        properties: { id: strProp("Habit UUID") },
        required: ["id"],
      },
    },
    schema: DeleteByIdSchema,
    run: async (args, token) => fmt(await apiDelete(`/habits/${args.id}`, token)),
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
      name: "create_habit_log",
      description: "POST /api/habits/{id}/logs. status=done|missed|skipped.",
      inputSchema: {
        type: "object",
        properties: {
          id: strProp("Habit UUID"),
          log_date: strProp("YYYY-MM-DD"),
          status: strProp("done|missed|skipped"),
          count_value: optStrProp("Decimal string, e.g. \"1.00\""),
          notes: optStrProp("Notes"),
        },
        required: ["id", "log_date", "status"],
      },
    },
    schema: CreateHabitLogSchema,
    run: async (args, token) => {
      const { id, ...body } = args as { id: string } & Record<string, unknown>;
      return fmt(await apiPost(`/habits/${id}/logs`, body, token));
    },
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
      description: "GET /api/goals.",
      inputSchema: { type: "object", properties: {} },
    },
    schema: ListGoalsSchema,
    run: async (_args, token) => fmt(await apiGet("/goals", undefined, token)),
  },
  {
    def: {
      name: "get_goal",
      description: "GET /api/goals/{id}.",
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
      description: "POST /api/goals. progress is trigger-owned (read-only).",
      inputSchema: {
        type: "object",
        properties: {
          name: strProp("Goal name"),
          area: strProp("Free-form area label"),
          description: optStrProp("Description"),
          category_id: optStrProp("Owned goal-kind category UUID"),
          start_date: optStrProp("YYYY-MM-DD"),
          due_date: optStrProp("YYYY-MM-DD"),
          status: optStrProp("active|completed|paused|cancelled"),
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
      description: "PATCH /api/goals/{id}.",
      inputSchema: {
        type: "object",
        properties: {
          id: strProp("Goal UUID"),
          name: optStrProp("Name"),
          description: optStrProp("Description"),
          area: optStrProp("Area label"),
          category_id: optStrProp("Category UUID"),
          start_date: optStrProp("YYYY-MM-DD"),
          due_date: optStrProp("YYYY-MM-DD"),
          status: optStrProp("active|completed|paused|cancelled"),
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
      description: "DELETE /api/goals/{id}.",
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
      description: "GET /api/events. Optional from/to (RFC3339 or YYYY-MM-DD).",
      inputSchema: {
        type: "object",
        properties: {
          from: optStrProp("Start filter"),
          to: optStrProp("End filter"),
        },
      },
    },
    schema: ListEventsSchema,
    run: async (args, token) => fmt(await apiGet("/events", args, token)),
  },
  {
    def: {
      name: "get_event",
      description: "GET /api/events/{id}.",
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
      description: "POST /api/events. starts_at is RFC3339 and required.",
      inputSchema: {
        type: "object",
        properties: {
          title: strProp("Title"),
          starts_at: strProp("RFC3339 datetime"),
          description: optStrProp("Description"),
          kind: optStrProp("Event kind"),
          ends_at: optStrProp("RFC3339 datetime, must be > starts_at"),
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
      description: "PATCH /api/events/{id}.",
      inputSchema: {
        type: "object",
        properties: {
          id: strProp("Event UUID"),
          title: optStrProp("Title"),
          description: optStrProp("Description"),
          kind: optStrProp("Event kind"),
          starts_at: optStrProp("RFC3339 datetime"),
          ends_at: optStrProp("RFC3339 datetime"),
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
      description: "DELETE /api/events/{id}.",
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
];

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
