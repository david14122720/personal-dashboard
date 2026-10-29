import { describe, expect, it } from "vitest";
import { highlight, normalizeLanguage } from "./highlight";

function joined(code: string, language: string): string {
  return highlight(code, language)
    .map((token) => token.text)
    .join("");
}

function kinds(code: string, language: string): string[] {
  return highlight(code, language).map((token) => token.kind);
}

describe("hermes syntax highlighting", () => {
  it("never loses or reorders a character", () => {
    const samples: Array<[string, string]> = [
      ["def f(x):\n    return x * 2  # doble\n", "python"],
      ["const n = 1; // uno\nconsole.log(n);\n", "ts"],
      ["select id, count(*) from t where a = 'x' -- nota\n", "sql"],
      ['fn main() { println!("hola"); }', "rust"],
      ['echo "hola" | grep -i hola # nota', "bash"],
      ['{"a": 1, "b": [true, null]}', "json"],
      ["+ añadido\n- quitado\n@@ hunk @@\n", "diff"],
      ["texto sin lenguaje", "brainfuck"],
    ];
    for (const [code, language] of samples) {
      expect(joined(code, language)).toBe(code);
    }
  });

  it("recognises comments, strings, keywords and numbers", () => {
    expect(kinds("def f(x):\n    return 42  # nota\n", "python")).toEqual(
      expect.arrayContaining(["keyword", "number", "comment"]),
    );
    const js = highlight("const s = 'hola'; // fin", "javascript");
    expect(js.some((token) => token.kind === "string")).toBe(true);
    expect(js.some((token) => token.kind === "keyword")).toBe(true);
    expect(js.some((token) => token.kind === "comment")).toBe(true);
  });

  it("highlights diff lines by prefix", () => {
    expect(kinds("+ añadido\n- quitado\n@@ x @@", "diff")).toEqual(
      expect.arrayContaining(["addition", "deletion", "meta"]),
    );
  });

  it("degrades to one plain token for unknown languages", () => {
    const tokens = highlight("hola <script>", "occam");
    expect(tokens).toEqual([{ text: "hola <script>", kind: "plain" }]);
  });

  it("normalises aliases and rejects empty input", () => {
    expect(normalizeLanguage("PY")).toBe("python");
    expect(normalizeLanguage("tsx")).toBe("typescript");
    expect(normalizeLanguage("shell")).toBe("bash");
    expect(normalizeLanguage("yml")).toBeNull();
    expect(normalizeLanguage(undefined)).toBeNull();
    expect(highlight("", "python")).toEqual([{ text: "", kind: "plain" }]);
  });

  it("handles an unterminated fence body without hanging", () => {
    const code = 'const x = "sin cerrar';
    const tokens = highlight(code, "javascript");
    expect(tokens.map((token) => token.text).join("")).toBe(code);
  });
});
