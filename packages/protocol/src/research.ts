import { z } from "zod";
import { visualRecommendationSchema } from "./references.js";

export const sourceReferenceSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  url: z.url(),
  retrievedAt: z.iso.datetime(),
  provenance: z.strictObject({
    origin: z.literal("web"),
    trusted: z.literal(false),
    source: z.url(),
  }),
});
export type SourceReference = z.infer<typeof sourceReferenceSchema>;

export const researchRequestSchema = z.strictObject({
  requestId: z.uuid(),
  query: z.string().trim().min(1).max(20_000),
});
export type ResearchRequest = z.infer<typeof researchRequestSchema>;

export const researchResultSchema = z.strictObject({
  requestId: z.uuid(),
  answer: z.string().min(1),
  sources: z.array(sourceReferenceSchema),
  images: z.array(z.never()),
  videos: z.array(z.never()),
  visualRecommendation: visualRecommendationSchema,
});
export type ResearchResult = z.infer<typeof researchResultSchema>;
