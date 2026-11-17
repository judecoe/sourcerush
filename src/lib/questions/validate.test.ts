import { describe, expect, it } from "vitest";
import { normalize, parseModelOutput, shuffleChoices, validateQuestions, type Question } from "./validate";

const SOURCE = `# Why the Bridge Closed

Inspectors found **cracked welds** on the main span in early March. The city closed the bridge the same week, citing [the 2019 audit](https://example.com/audit) that had already flagged the welds.

Repairs are expected to take about eight months. Shop owners on the east bank say foot traffic has dropped by nearly half.`;

function goodQuestion(overrides: Partial<Question> = {}): Question {
  return {
    prompt: "Why did the city close the bridge?",
    choices: ["Cracked welds were found", "A flood damaged it", "Traffic was too heavy", "Funding ran out"],
    correctIndex: 0,
    passage: "Inspectors found cracked welds on the main span in early March.",
    explanation: "The article says inspectors found cracked welds, prompting the closure.",
    ...overrides,
  };
}

describe("validateQuestions", () => {
  it("accepts a well-formed, grounded question", () => {
    const { valid, rejected } = validateQuestions([goodQuestion()], SOURCE);
    expect(valid).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it("rejects a passage that does not appear in the source", () => {
    const fake = goodQuestion({ passage: "The mayor said the bridge would reopen by summer." });
    const { valid, rejected } = validateQuestions([fake], SOURCE);
    expect(valid).toHaveLength(0);
    expect(rejected[0].reasons).toContain("passage not found in source");
  });

  it("matches across Markdown links and emphasis", () => {
    const q = goodQuestion({
      passage: "citing the 2019 audit that had already flagged the welds",
    });
    expect(validateQuestions([q], SOURCE).valid).toHaveLength(1);
  });

  it("matches across curly quotes and dashes", () => {
    const source = "She said it\u2019s \u201Cfine\u201D \u2014 for now, at least, until the next inspection.";
    const q = goodQuestion({ passage: `She said it's "fine" - for now, at least` });
    expect(validateQuestions([q], source).valid).toHaveLength(1);
  });

  it("rejects wrong choice counts, duplicate choices, and bad indexes", () => {
    const three = goodQuestion({ choices: ["a", "b", "c"] as unknown as Question["choices"] });
    const dupes = goodQuestion({ choices: ["Same", "same", "Other", "Third"] });
    const badIndex = goodQuestion({ correctIndex: 4 });
    const { valid, rejected } = validateQuestions([three, dupes, badIndex], SOURCE);
    expect(valid).toHaveLength(0);
    expect(rejected.map((r) => r.reasons[0])).toEqual([
      "must have exactly 4 choices",
      "choices must be distinct",
      "correctIndex must be an integer from 0 to 3",
    ]);
  });

  it("rejects duplicate prompts but keeps the first", () => {
    const { valid, rejected } = validateQuestions([goodQuestion(), goodQuestion()], SOURCE);
    expect(valid).toHaveLength(1);
    expect(rejected[0].reasons).toContain("duplicate prompt");
  });

  it("does not throw on garbage entries", () => {
    const { valid, rejected } = validateQuestions([null, "text", 42, goodQuestion()], SOURCE);
    expect(valid).toHaveLength(1);
    expect(rejected).toHaveLength(3);
  });
});

describe("parseModelOutput", () => {
  it("parses JSON wrapped in code fences", () => {
    const raw = '```json\n{"questions":[{"prompt":"x"}]}\n```';
    expect(parseModelOutput(raw)).toHaveLength(1);
  });

  it("throws a clear error on invalid JSON or a missing array", () => {
    expect(() => parseModelOutput("Sure! Here are your questions:")).toThrow("not valid JSON");
    expect(() => parseModelOutput('{"items":[]}')).toThrow('no "questions" array');
  });
});

describe("shuffleChoices", () => {
  it("keeps the correct answer pointing at the same text", () => {
    const q = goodQuestion();
    const seq = [0.9, 0.1, 0.5];
    let i = 0;
    const shuffled = shuffleChoices(q, () => seq[i++ % seq.length]);
    expect(shuffled.choices[shuffled.correctIndex]).toBe("Cracked welds were found");
    expect([...shuffled.choices].sort()).toEqual([...q.choices].sort());
  });
});

describe("normalize", () => {
  it("collapses whitespace and lowercases", () => {
    expect(normalize("  Hello\n\n   World  ")).toBe("hello world");
  });
});
