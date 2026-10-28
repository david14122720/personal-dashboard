/**
 * Hermes asks for choices as plain prose: a question line followed by a
 * numbered list and, usually, an instruction ("Respondé con el número").
 * A static numbered list is the wrong UI for a decision, so the chat turns
 * that trailing block into an interactive card.
 *
 * The heuristic is deliberately conservative: anything that does not match
 * every rule stays exactly as written (a wrong card is worse than a list).
 */

export interface QuestionOption {
  title: string;
  description?: string;
  /** What gets sent back when the option is chosen. */
  value: string;
}

export interface HermesQuestion {
  prompt: string;
  options: QuestionOption[];
}

export interface QuestionSplit {
  text: string;
  question: HermesQuestion | null;
}

const NUMBERED = /^\s{0,3}(\d{1,2})[.)]\s+(.+?)\s*$/;
// No `\b` here: `é`/`á`/`í` are not ASCII word characters, so a trailing
// boundary would fail right where the Spanish verb ends.
const INSTRUCTION =
  /^\s*(respond[eé]|respondeme|contesta|contest[aá]|contestame|eleg[ií]|elige|seleccion[aá]|selecciona|marc[aá]|marca|tild[aá]|tilda|escog[eé]|indic[aá]|indica|decime|dec[ií]|escrib[ií]|escribe)(?=\s|[:.]|$)/i;

const MAX_OPTIONS = 8;
const MAX_OPTION_CHARS = 200;

/** Split `**Título** — descripción` into its two parts, dropping emphasis. */
export function optionParts(raw: string): { title: string; description?: string } {
  const text = raw
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  for (const separator of [" — ", " – ", " - "]) {
    const at = text.indexOf(separator);
    if (at > 0 && at + separator.length < text.length) {
      const title = text.slice(0, at).trim();
      const description = text.slice(at + separator.length).trim();
      if (title && description) return { title, description };
    }
  }
  return { title: text };
}

export function splitQuestion(reply: string): QuestionSplit {
  const unchanged: QuestionSplit = { text: reply, question: null };
  if (!reply.trim()) return unchanged;

  const lines = reply.split("\n");
  let last = lines.length - 1;
  while (last >= 0 && !lines[last].trim()) last -= 1;
  if (last < 0) return unchanged;

  let tail = last;
  let trailing = "";
  if (INSTRUCTION.test(lines[tail])) {
    // Drop the instruction sentence, keep anything the model added after it.
    const parts = lines[tail].split(/(?<=[.!?])\s+/);
    trailing = parts.slice(1).join(" ").trim();
    tail -= 1;
    // Models usually separate the list from the instruction with a blank line.
    while (tail >= 0 && !lines[tail].trim()) tail -= 1;
  }

  const numbers: number[] = [];
  const raw: string[] = [];
  let cursor = tail;
  while (cursor >= 0) {
    const match = NUMBERED.exec(lines[cursor]);
    if (!match) break;
    numbers.unshift(Number(match[1]));
    raw.unshift(match[2]);
    cursor -= 1;
  }
  if (raw.length < 2 || raw.length > MAX_OPTIONS) return unchanged;
  if (numbers.some((value, index) => value !== index + 1)) return unchanged;
  if (raw.some((item) => item.length > MAX_OPTION_CHARS)) return unchanged;

  let promptLine = cursor;
  while (promptLine >= 0 && !lines[promptLine].trim()) promptLine -= 1;
  if (promptLine < 0) return unchanged;
  const prompt = lines[promptLine].trim();
  if (!/[?¿]/.test(prompt)) return unchanged;

  const options = raw.map<QuestionOption>((item) => {
    const { title, description } = optionParts(item);
    return description ? { title, description, value: title } : { title, value: title };
  });

  const kept = lines.slice(0, promptLine).join("\n").replace(/\s+$/, "");
  const text = [kept, trailing].filter(Boolean).join("\n\n").replace(/\s+$/, "");

  return { text, question: { prompt, options } };
}
