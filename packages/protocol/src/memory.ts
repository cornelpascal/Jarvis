import { z } from "zod";

export const memoryScopeSchema = z.enum([
  "EPHEMERAL",
  "SESSION",
  "PROJECT",
  "GLOBAL",
]);
export type MemoryScope = z.infer<typeof memoryScopeSchema>;

export const memoryProvenanceSchema = z.strictObject({
  origin: z.enum(["user", "project", "web", "system", "agent"]),
  trusted: z.boolean(),
  source: z.string().min(1).max(2_000).optional(),
});

export const memoryRecordSchema = z.strictObject({
  id: z.uuid(),
  scope: memoryScopeSchema,
  scopeId: z.string().min(1).max(500).optional(),
  content: z.string().trim().min(1).max(4_000),
  provenance: memoryProvenanceSchema,
  confidence: z.number().min(0).max(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  supersedesId: z.uuid().optional(),
});
export type MemoryRecord = z.infer<typeof memoryRecordSchema>;

export const rememberRequestSchema = z
  .strictObject({
    requestId: z.uuid(),
    scope: memoryScopeSchema,
    content: z.string().trim().min(1).max(4_000),
    sessionId: z.string().min(1).max(500).optional(),
    projectId: z.string().min(1).max(500).optional(),
    provenance: memoryProvenanceSchema,
    confidence: z.number().min(0).max(1).default(1),
    supersedesId: z.uuid().optional(),
  })
  .superRefine((value, context) => {
    if (
      (value.scope === "EPHEMERAL" || value.scope === "SESSION") &&
      !value.sessionId
    )
      context.addIssue({
        code: "custom",
        path: ["sessionId"],
        message: `${value.scope} memory requires sessionId`,
      });
    if (value.scope === "PROJECT" && !value.projectId)
      context.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "PROJECT memory requires projectId",
      });
  });
export type RememberRequest = z.infer<typeof rememberRequestSchema>;

export const memorySearchRequestSchema = z.strictObject({
  requestId: z.uuid(),
  query: z.string().trim().max(1_000).default(""),
  scopes: z.array(memoryScopeSchema).min(1).max(4),
  sessionId: z.string().min(1).max(500).optional(),
  projectId: z.string().min(1).max(500).optional(),
  limit: z.int().min(1).max(50).default(20),
});
export type MemorySearchRequest = z.infer<typeof memorySearchRequestSchema>;

export const forgetMemoryRequestSchema = z.strictObject({
  requestId: z.uuid(),
  memoryId: z.uuid(),
  sessionId: z.string().min(1).max(500).optional(),
  projectId: z.string().min(1).max(500).optional(),
});
export type ForgetMemoryRequest = z.infer<typeof forgetMemoryRequestSchema>;

export const memorySearchResultSchema = z.strictObject({
  requestId: z.uuid(),
  memories: z.array(memoryRecordSchema),
});
export type MemorySearchResult = z.infer<typeof memorySearchResultSchema>;

export interface MemoryProvider {
  remember(request: RememberRequest): Promise<MemoryRecord>;
  search(request: MemorySearchRequest): Promise<MemorySearchResult>;
  forget(request: ForgetMemoryRequest): Promise<boolean>;
}
