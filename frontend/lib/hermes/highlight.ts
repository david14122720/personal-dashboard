/**
 * Deterministic, dependency-free syntax highlighting for fenced code blocks.
 *
 * The reply is untrusted text, so this module never produces HTML: it returns
 * ordered tokens with a `kind`, and the renderer turns them into React text
 * nodes. An unknown language degrades to one plain token — the block still
 * renders, only without colour.
 *
 * Languages were chosen from what Hermes actually emits in this dashboard
 * (shell recipes, Python data scripts, SQL, JSON payloads, Rust snippets and
 * diffs). Adding a language means adding a pattern and a case in
 * `normalizeLanguage`; nothing else changes.
 */
export type TokenKind =
  | "plain"
  | "comment"
  | "string"
  | "keyword"
  | "number"
  | "function"
  | "operator"
  | "builtin"
  | "addition"
  | "deletion"
  | "meta";

export interface CodeToken {
  text: string;
  kind: TokenKind;
}

export type HighlightLanguage =
  | "python"
  | "javascript"
  | "typescript"
  | "json"
  | "bash"
  | "sql"
  | "rust"
  | "diff";

const ALIASES: Record<string, HighlightLanguage> = {
  py: "python",
  python: "python",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  javascript: "javascript",
  ts: "typescript",
  tsx: "typescript",
  typescript: "typescript",
  json: "json",
  jsonc: "json",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  bash: "bash",
  sql: "sql",
  postgres: "sql",
  postgresql: "sql",
  rs: "rust",
  rust: "rust",
  diff: "diff",
  patch: "diff",
};

export function normalizeLanguage(raw: string | undefined | null): HighlightLanguage | null {
  if (!raw) return null;
  return ALIASES[raw.trim().toLowerCase()] ?? null;
}

function words(list: string[]): string {
  return `\\b(?:${list.join("|")})\\b`;
}

const PYTHON_KEYWORDS = words([
  "def", "class", "return", "if", "elif", "else", "for", "while", "in", "not", "and", "or",
  "import", "from", "as", "with", "try", "except", "finally", "raise", "yield", "lambda",
  "pass", "break", "continue", "global", "nonlocal", "assert", "del", "async", "await",
  "is", "None", "True", "False", "self", "match", "case",
]);
const PYTHON_BUILTINS = words([
  "print", "len", "range", "int", "str", "float", "bool", "dict", "list", "set", "tuple",
  "open", "zip", "enumerate", "sorted", "sum", "min", "max", "any", "all", "isinstance",
  "type", "super", "input", "format",
]);

const JS_KEYWORDS = words([
  "const", "let", "var", "function", "return", "if", "else", "for", "while", "do", "switch",
  "case", "break", "continue", "class", "extends", "new", "await", "async", "import", "export",
  "from", "default", "try", "catch", "finally", "throw", "typeof", "instanceof", "void",
  "delete", "in", "of", "yield", "interface", "type", "enum", "implements", "public",
  "private", "protected", "readonly", "static", "as", "satisfies", "declare", "namespace",
  "true", "false", "null", "undefined", "this", "super",
]);
const JS_BUILTINS = words([
  "console", "JSON", "Math", "Object", "Array", "String", "Number", "Boolean", "Promise",
  "Map", "Set", "Date", "RegExp", "Error", "require", "module", "process",
]);

const SQL_KEYWORDS = words([
  "select", "from", "where", "insert", "into", "values", "update", "set", "delete", "join",
  "left", "right", "inner", "outer", "full", "cross", "on", "group", "by", "order", "having",
  "limit", "offset", "as", "and", "or", "not", "null", "is", "in", "exists", "case", "when",
  "then", "else", "end", "create", "alter", "drop", "table", "index", "view", "primary",
  "key", "foreign", "references", "unique", "default", "returning", "distinct", "union",
  "all", "with", "asc", "desc", "between", "like", "ilike", "cast", "true", "false",
  "begin", "commit", "rollback", "conflict", "do", "nothing",
]);
const SQL_BUILTINS = words([
  "count", "sum", "avg", "min", "max", "coalesce", "nullif", "now", "current_date",
  "date_trunc", "extract", "to_char", "upper", "lower", "length", "round", "greatest",
  "least", "generate_series",
]);

const RUST_KEYWORDS = words([
  "fn", "let", "mut", "impl", "trait", "struct", "enum", "mod", "use", "pub", "crate", "self",
  "super", "as", "where", "async", "await", "move", "ref", "dyn", "const", "static", "unsafe",
  "type", "in", "break", "continue", "match", "if", "else", "for", "while", "loop", "return",
  "true", "false", "Some", "None", "Ok", "Err", "String", "Vec", "Option", "Result", "Box",
]);
const RUST_BUILTINS = words(["println", "print", "format", "write", "vec", "panic", "assert"]);

const BASH_KEYWORDS = words([
  "if", "then", "else", "elif", "fi", "for", "while", "until", "do", "done", "case", "esac",
  "in", "function", "return", "local", "export", "unset", "set", "source", "exit", "shift",
  "read", "trap", "eval", "true", "false",
]);
const BASH_BUILTINS = words([
  "echo", "cd", "ls", "cat", "grep", "sed", "awk", "curl", "wget", "mkdir", "rm", "cp", "mv",
  "find", "chmod", "chown", "tar", "zip", "unzip", "git", "docker", "python3", "node", "npm",
  "cargo", "sudo", "kill", "ps", "df", "du", "head", "tail", "sort", "uniq", "wc", "jq",
]);

const SOURCES: Record<HighlightLanguage, string> = {
  python: [
    "(?<comment>#[^\\n]*)",
    "(?<string>\"\"\"[\\s\\S]*?\"\"\"|'''[\\s\\S]*?'''|\"(?:\\\\.|[^\"\\\\\\n])*\"|'(?:\\\\.|[^'\\\\\\n])*')",
    "(?<number>\\b\\d+(?:\\.\\d+)?\\b)",
    `(?<keyword>${PYTHON_KEYWORDS})`,
    `(?<builtin>${PYTHON_BUILTINS})`,
    "(?<function>\\b[A-Za-z_][A-Za-z0-9_]*(?=\\())",
    "(?<operator>\\*\\*|//|[-+*/%=<>!&|^~:])",
  ].join("|"),
  javascript: [
    "(?<comment>//[^\\n]*|/\\*[\\s\\S]*?\\*/)",
    "(?<string>`(?:\\\\.|[^`\\\\])*`|\"(?:\\\\.|[^\"\\\\\\n])*\"|'(?:\\\\.|[^'\\\\\\n])*')",
    "(?<number>\\b\\d+(?:\\.\\d+)?\\b)",
    `(?<keyword>${JS_KEYWORDS})`,
    `(?<builtin>${JS_BUILTINS})`,
    "(?<function>\\b[A-Za-z_$][A-Za-z0-9_$]*(?=\\())",
    "(?<operator>=>|===|!==|\\?\\?|\\?\\.|[-+*/%=<>!&|^~?])",
  ].join("|"),
  typescript: [
    "(?<comment>//[^\\n]*|/\\*[\\s\\S]*?\\*/)",
    "(?<string>`(?:\\\\.|[^`\\\\])*`|\"(?:\\\\.|[^\"\\\\\\n])*\"|'(?:\\\\.|[^'\\\\\\n])*')",
    "(?<number>\\b\\d+(?:\\.\\d+)?\\b)",
    `(?<keyword>${JS_KEYWORDS})`,
    `(?<builtin>${JS_BUILTINS}|string|number|boolean|unknown|never|any)`,
    "(?<function>\\b[A-Za-z_$][A-Za-z0-9_$]*(?=\\())",
    "(?<operator>=>|===|!==|\\?\\?|\\?\\.|[-+*/%=<>!&|^~?])",
  ].join("|"),
  json: [
    "(?<comment>//[^\\n]*)",
    "(?<builtin>\"(?:\\\\.|[^\"\\\\\\n])*\"(?=\\s*:))",
    "(?<string>\"(?:\\\\.|[^\"\\\\\\n])*\")",
    "(?<number>-?\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b)",
    "(?<keyword>\\b(?:true|false|null)\\b)",
    "(?<operator>[:{}\\[\\],])",
  ].join("|"),
  bash: [
    "(?<comment>#[^\\n]*)",
    "(?<string>\"(?:\\\\.|[^\"\\\\])*\"|'[^']*')",
    "(?<keyword>\\$\\{[^}\\n]*\\}|\\$[A-Za-z_][A-Za-z0-9_]*)",
    "(?<number>\\b\\d+\\b)",
    `(?<keyword>${BASH_KEYWORDS})`,
    `(?<builtin>${BASH_BUILTINS})`,
    "(?<operator>\\|\\||&&|[|&;<>]|--?[A-Za-z-]+)",
  ].join("|"),
  sql: [
    "(?<comment>--[^\\n]*|/\\*[\\s\\S]*?\\*/)",
    "(?<string>'(?:''|[^'])*')",
    "(?<number>\\b\\d+(?:\\.\\d+)?\\b)",
    `(?<keyword>${SQL_KEYWORDS})`,
    `(?<builtin>${SQL_BUILTINS})`,
    "(?<function>\\$\\d+)",
    "(?<operator>[-+*/%=<>]|::)",
  ].join("|"),
  rust: [
    "(?<comment>//[^\\n]*|/\\*[\\s\\S]*?\\*/)",
    "(?<string>r#*\"[\\s\\S]*?\"#*|\"(?:\\\\.|[^\"\\\\])*\"|'(?:\\\\.|[^'\\\\])')",
    "(?<number>\\b\\d+(?:_\\d+)*(?:\\.\\d+)?(?:[iuf](?:8|16|32|64|size))?\\b)",
    `(?<keyword>${RUST_KEYWORDS})`,
    `(?<builtin>${RUST_BUILTINS})`,
    "(?<function>\\b[A-Za-z_][A-Za-z0-9_]*(?=\\s*[!(]))",
    "(?<operator>=>|->|::|[-+*/%=<>!&|^~?:])",
  ].join("|"),
  diff: "",
};

const COMPILED = new Map<HighlightLanguage, RegExp>();

function compiled(language: HighlightLanguage): RegExp {
  const cached = COMPILED.get(language);
  if (cached) return cached;
  const source = SOURCES[language];
  const re = new RegExp(source, "g");
  COMPILED.set(language, re);
  return re;
}

function diffTokens(code: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  const lines = code.split("\n");
  lines.forEach((line, index) => {
    const kind: TokenKind = line.startsWith("+++") || line.startsWith("---")
      ? "meta"
      : line.startsWith("@@")
        ? "meta"
        : line.startsWith("+")
          ? "addition"
          : line.startsWith("-")
            ? "deletion"
            : "plain";
    tokens.push({ text: line, kind });
    if (index < lines.length - 1) tokens.push({ text: "\n", kind: "plain" });
  });
  return tokens;
}

/**
 * Tokenize one code block. Always returns at least one token, and the
 * concatenation of every `text` is exactly the input code.
 */
export function highlight(code: string, language: string | null | undefined): CodeToken[] {
  if (code.length === 0) return [{ text: "", kind: "plain" }];
  const normalized = normalizeLanguage(language);
  if (normalized === null) return [{ text: code, kind: "plain" }];
  if (normalized === "diff") return diffTokens(code);

  const re = compiled(normalized);
  re.lastIndex = 0;
  const tokens: CodeToken[] = [];
  let cursor = 0;
  for (let match = re.exec(code); match; match = re.exec(code)) {
    if (match.index > cursor) tokens.push({ text: code.slice(cursor, match.index), kind: "plain" });
    const groups = match.groups ?? {};
    const kind = (Object.keys(groups).find((key) => groups[key] !== undefined) ?? "plain") as TokenKind;
    tokens.push({ text: match[0], kind });
    cursor = match.index + match[0].length;
    // A zero-length match would loop forever; the patterns never produce one,
    // but an exhausted regex must not hang the renderer.
    if (match[0].length === 0) re.lastIndex += 1;
  }
  if (cursor < code.length) tokens.push({ text: code.slice(cursor), kind: "plain" });
  return tokens;
}
