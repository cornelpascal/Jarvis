import {
  visualRecommendationSchema,
  type ReferenceEvaluationRequest,
  type VisualRecommendation,
} from "@jarvis/protocol";

const visualSubjects =
  /\b(robot|humanoid|person|place|city|country|hardware|device|vehicle|car|aircraft|product|animal|architecture|building|art|design|map|component|artifact)\b/i;
const motionSubjects =
  /\b(move|movement|walking|running|demonstration|demo|operation|mechanism|tutorial|sport|speech|interview|process|can do|in action)\b/i;
const explicitVisual =
  /\b(show|look like|image|picture|photo|video|watch|see)\b/i;
const lowValueVisual =
  /\b(recursion|closure|basic math|definition|lts release|version|syntax|type error)\b/i;

export class SmartReferenceEvaluator {
  evaluate(request: ReferenceEvaluationRequest): VisualRecommendation {
    const text = `${request.query} ${request.answer}`;
    let score = 0.2;
    const reasons: string[] = [];
    if (visualSubjects.test(text)) {
      score += 0.48;
      reasons.push("physical or strongly visual subject");
    }
    if (motionSubjects.test(text)) {
      score += 0.18;
      reasons.push("motion is important to understanding");
    }
    if (explicitVisual.test(request.query)) {
      score += 0.3;
      reasons.push("user explicitly requested visual material");
    }
    if (lowValueVisual.test(request.query)) {
      score -= 0.35;
      reasons.push("visual interruption adds little for this request");
    }
    score = Math.max(0, Math.min(1, Number(score.toFixed(2))));
    const display = score >= request.threshold;
    const preferredMode = !display
      ? "none"
      : motionSubjects.test(text)
        ? "mixed"
        : visualSubjects.test(text)
          ? "images"
          : "sources";
    return visualRecommendationSchema.parse({
      display,
      score,
      reason: reasons.join("; ") || "no material visual benefit detected",
      preferredMode,
    });
  }
}
