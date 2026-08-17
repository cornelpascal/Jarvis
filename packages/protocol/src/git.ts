import { z } from "zod";

export const gitTaskTargetSchema = z.strictObject({
  taskId: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().min(1),
  worktreePath: z.string().min(1),
  branch: z.string().min(1),
  headRevision: z.string().regex(/^[0-9a-f]{40,64}$/i),
  changesDigest: z.string().regex(/^[0-9a-f]{64}$/i),
  hasChanges: z.boolean(),
});
export type GitTaskTarget = z.infer<typeof gitTaskTargetSchema>;

export const gitPublishResultSchema = z.strictObject({
  taskId: z.string().min(1),
  projectId: z.string().min(1),
  branch: z.string().min(1),
  revision: z.string().regex(/^[0-9a-f]{40,64}$/i),
  remote: z.literal("origin"),
  committed: z.boolean(),
});
export type GitPublishResult = z.infer<typeof gitPublishResultSchema>;

export interface GitTaskProvider {
  resolve(input: {
    text: string;
    activeTaskId?: string;
    activeProjectId?: string;
  }): Promise<GitTaskTarget>;
  preview(taskId: string): Promise<GitTaskTarget>;
  publish(taskId: string, expected: GitTaskTarget): Promise<GitPublishResult>;
}
