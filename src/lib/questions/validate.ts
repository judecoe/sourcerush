/**
 * Validates questions returned by the model before anything is stored.
 * The key check: each question's supporting passage must actually appear
 * in the source text the model was given. Invented quotes are rejected.
 *
 * Pure functions only, so this runs the same in tests and in the worker.
 */

export interface Question {
  prompt: string;
  choices: [string, string, string, string];
  correctIndex: number;
  passage: string;
  explanation: string;
}

export interface Rejection {
  index: number;
  reasons: string[];
}

export interface ValidationResult {
  valid: Question[];
  rejected: Rejection[];
}

const LIMITS = {
  promptMin: 10,
  promptMax: 300,
  choiceMax: 200,
  passageMin: 20,
  passageMax: 400,
  explanationMax: 300,
} as const;

/**
 * Normalize text so formatting differences don't cause false rejections.
 * Firecrawl returns Markdown, while the model tends to quote the plain text,
 * so Markdown syntax is stripped from both sides before comparing.
 */
export function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images: ![alt](url) -> alt
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links: [text](url) -> text
    .replace(/[*_`#>]+/g, "") // emphasis, code, headings, quotes
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Parse the model's raw text into an array, tolerating code fences. */
export function parseModelOutput(raw: string): unknown[] {
  const cleaned = raw.replace(/```(?:json)?/g, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("Model output was not valid JSON");
  }
  const questions = (parsed as { questions?: unknown })?.questions;
  if (!Array.isArray(questions)) {
    throw new Error('Model output had no "questions" array');
  }
  return questions;
}

/**
 * Validate every candidate against the source. Never throws for a bad
 * question; it lands in `rejected` with reasons, which are worth logging.
 */
export function validateQuestions(candidates: unknown[], sourceText: string): ValidationResult {
  const normalizedSource = normalize(sourceText);
  const valid: Question[] = [];
  const rejected: Rejection[] = [];
  const seenPrompts = new Set<string>();

  candidates.forEach((candidate, index) => {
    const reasons = checkQuestion(candidate, normalizedSource);

    if (reasons.length === 0) {
      const q = candidate as Question;
      const key = normalize(q.prompt);
      if (seenPrompts.has(key)) {
        reasons.push("duplicate prompt");
      } else {
        seenPrompts.add(key);
        valid.push(trimQuestion(q));
        return;
      }
    }
    rejected.push({ index, reasons });
  });

  return { valid, rejected };
}

function checkQuestion(c: unknown, normalizedSource: string): string[] {
  if (typeof c !== "object" || c === null) return ["not an object"];
  const q = c as Record<string, unknown>;
  const reasons: string[] = [];

  if (!isStringInRange(q.prompt, LIMITS.promptMin, LIMITS.promptMax)) {
    reasons.push("prompt missing or wrong length");
  }

  if (!Array.isArray(q.choices) || q.choices.length !== 4) {
    reasons.push("must have exactly 4 choices");
  } else {
    if (!q.choices.every((ch) => isStringInRange(ch, 1, LIMITS.choiceMax))) {
      reasons.push("every choice must be a non-empty string");
    } else if (new Set(q.choices.map((ch) => normalize(ch as string))).size !== 4) {
      reasons.push("choices must be distinct");
    }
  }

  if (!Number.isInteger(q.correctIndex) || (q.correctIndex as number) < 0 || (q.correctIndex as number) > 3) {
    reasons.push("correctIndex must be an integer from 0 to 3");
  }

  if (!isStringInRange(q.explanation, 1, LIMITS.explanationMax)) {
    reasons.push("explanation missing or too long");
  }

  if (!isStringInRange(q.passage, LIMITS.passageMin, LIMITS.passageMax)) {
    reasons.push("passage missing or wrong length");
  } else if (!normalizedSource.includes(normalize(q.passage as string))) {
    reasons.push("passage not found in source");
  }

  return reasons;
}

function isStringInRange(v: unknown, min: number, max: number): v is string {
  return typeof v === "string" && v.trim().length >= min && v.trim().length <= max;
}

function trimQuestion(q: Question): Question {
  return {
    prompt: q.prompt.trim(),
    choices: q.choices.map((c) => c.trim()) as Question["choices"],
    correctIndex: q.correctIndex,
    passage: q.passage.trim(),
    explanation: q.explanation.trim(),
  };
}

/**
 * Models tend to put the correct answer in the same position. Shuffle the
 * choices on the server and remap correctIndex. `random` is injectable so
 * tests are deterministic.
 */
export function shuffleChoices(q: Question, random: () => number = Math.random): Question {
  const order = [0, 1, 2, 3];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return {
    ...q,
    choices: order.map((i) => q.choices[i]) as Question["choices"],
    correctIndex: order.indexOf(q.correctIndex),
  };
}
