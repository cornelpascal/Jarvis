import { z } from "zod";

export const toolRouteSchema = z.enum([
  "conversation",
  "research",
  "project",
  "coding",
  "browser",
  "system",
  "git",
  "deployment",
  "reference",
  "memory",
]);
export type ToolRoute = z.infer<typeof toolRouteSchema>;

export const routeRequestSchema = z.strictObject({
  requestId: z.uuid(),
  text: z.string().trim().min(1).max(20_000),
  activeProjectId: z.string().min(1).optional(),
  activeTaskId: z.string().min(1).optional(),
  provenance: z.strictObject({
    origin: z.literal("user"),
    trusted: z.literal(true),
  }),
});
export type RouteRequest = z.infer<typeof routeRequestSchema>;

export const routeCandidateSchema = z.strictObject({
  route: toolRouteSchema,
  score: z.number().min(0).max(1),
});

export const routeDecisionSchema = z.strictObject({
  requestId: z.uuid(),
  route: toolRouteSchema,
  confidence: z.number().min(0).max(1),
  candidates: z.array(routeCandidateSchema).min(1).max(4),
  toolShortlist: z.array(z.string().min(1)).min(3).max(8),
  reasons: z.array(z.string().min(1)).min(1).max(8),
  requiresClarification: z.boolean(),
});
export type RouteDecision = z.infer<typeof routeDecisionSchema>;
