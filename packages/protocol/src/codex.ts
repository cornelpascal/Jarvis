import { z } from "zod";

export const codingTaskStateSchema = z.enum([
  "QUEUED",
  "PREPARING",
  "INSPECTING",
  "PLANNING",
  "EDITING",
  "TESTING",
  "READY_FOR_REVIEW",
  "WAITING_APPROVAL",
  "COMMITTING",
  "PUSHING",
  "DEPLOYING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "BLOCKED",
]);
export type CodingTaskState = z.infer<typeof codingTaskStateSchema>;

export const codingTaskSchema = z.strictObject({
  id: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().min(1),
  instruction: z.string().min(1),
  workingDirectory: z.string().min(1),
  state: codingTaskStateSchema,
  provider: z.string().min(1),
  threadId: z.string().min(1).optional(),
  turnId: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type CodingTask = z.infer<typeof codingTaskSchema>;

export const codingTaskCreateSchema = z.strictObject({
  taskId: z.string().min(1).optional(),
  projectId: z.string().min(1),
  title: z.string().trim().min(1).max(300),
  instruction: z.string().trim().min(1).max(50_000),
  workingDirectory: z.string().min(1),
});
export type CodingTaskCreate = z.infer<typeof codingTaskCreateSchema>;

export const codingTaskRequestSchema = codingTaskCreateSchema.omit({
  workingDirectory: true,
  taskId: true,
});
export const codingInstructionRequestSchema = z.strictObject({
  instruction: z.string().trim().min(1).max(50_000),
});

export const codingAgentEventSchema = z.strictObject({
  taskId: z.string().min(1),
  projectId: z.string().min(1),
  type: z.enum(["state", "item", "message", "approval", "diff", "error"]),
  state: codingTaskStateSchema.optional(),
  label: z.string().min(1),
  detail: z.string().max(20_000).optional(),
  timestamp: z.iso.datetime(),
});
export type CodingAgentEvent = z.infer<typeof codingAgentEventSchema>;

export type CodingAgentEventListener = (
  event: CodingAgentEvent,
) => void | Promise<void>;

export const worktreeRecordSchema = z.strictObject({
  taskId: z.string().min(1),
  projectId: z.string().min(1),
  sourcePath: z.string().min(1),
  path: z.string().min(1),
  branch: z.string().min(1),
  baselineRevision: z.string().min(1),
  sourceDirty: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type WorktreeRecord = z.infer<typeof worktreeRecordSchema>;

export interface WorktreeManager {
  create(input: {
    taskId: string;
    projectId: string;
    projectPath: string;
    title: string;
  }): Promise<WorktreeRecord>;
  get(taskId: string): WorktreeRecord;
  cleanup(taskId: string): Promise<void>;
}

export const verificationCheckSchema = z.strictObject({
  name: z.enum(["lint", "typecheck", "test", "build"]),
  command: z.string().min(1),
  status: z.enum(["PASSED", "FAILED", "SKIPPED", "TIMED_OUT"]),
  exitCode: z.int().optional(),
  durationMs: z.int().nonnegative(),
  output: z.string(),
});
export type VerificationCheck = z.infer<typeof verificationCheckSchema>;

export const verificationReportSchema = z.strictObject({
  taskId: z.string().min(1),
  projectId: z.string().min(1),
  passed: z.boolean(),
  checks: z.array(verificationCheckSchema),
  diff: z.string(),
  completedAt: z.iso.datetime(),
});
export type VerificationReport = z.infer<typeof verificationReportSchema>;

export interface TaskVerificationProvider {
  verify(taskId: string): Promise<VerificationReport>;
}
