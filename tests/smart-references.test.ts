import { describe, expect, it } from "vitest";
import { SmartReferenceEvaluator } from "../services/research/src/reference-evaluator.js";

const evaluator = new SmartReferenceEvaluator();
const base = {
  requestId: "7cb5ddae-a2f8-46af-b45a-8a2056dc3617",
  answer: "A current sourced answer.",
  sourceCount: 3,
  threshold: 0.65,
};

describe("smart reference evaluator", () => {
  it("does not interrupt latest Node.js LTS research with imagery", () => {
    expect(
      evaluator.evaluate({
        ...base,
        query: "What is the latest Node.js LTS release?",
      }),
    ).toMatchObject({ display: false, preferredMode: "none" });
  });

  it("recommends images and motion media for humanoid robotics", () => {
    const result = evaluator.evaluate({
      ...base,
      query: "Show me what the latest humanoid robot can do in action.",
    });
    expect(result.display).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.65);
    expect(result.preferredMode).toBe("mixed");
  });

  it("avoids visual interruption for recursion", () => {
    expect(
      evaluator.evaluate({ ...base, query: "Explain recursion." }),
    ).toMatchObject({ display: false, preferredMode: "none" });
  });

  it("honors a configured threshold", () => {
    const input = { ...base, query: "Describe this robot." };
    expect(evaluator.evaluate(input).display).toBe(true);
    expect(evaluator.evaluate({ ...input, threshold: 0.9 }).display).toBe(
      false,
    );
  });
});
