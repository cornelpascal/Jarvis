import { z } from "zod";

export const visualModeSchema = z.enum([
  "none",
  "sources",
  "images",
  "video",
  "mixed",
]);

export const visualRecommendationSchema = z.strictObject({
  display: z.boolean(),
  score: z.number().min(0).max(1),
  reason: z.string().min(1),
  preferredMode: visualModeSchema,
});
export type VisualRecommendation = z.infer<typeof visualRecommendationSchema>;

export const referenceEvaluationRequestSchema = z.strictObject({
  requestId: z.uuid(),
  query: z.string().min(1),
  answer: z.string().min(1),
  sourceCount: z.int().nonnegative(),
  threshold: z.number().min(0).max(1),
});
export type ReferenceEvaluationRequest = z.infer<
  typeof referenceEvaluationRequestSchema
>;
