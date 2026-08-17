import { z } from "zod";

export const projectCommandEvidenceSchema = z.strictObject({
  command: z.string().min(1),
  source: z.string().min(1),
});
export type ProjectCommandEvidence = z.infer<
  typeof projectCommandEvidenceSchema
>;

export const projectRecordSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  enabled: z.boolean(),
  signals: z.array(z.string().min(1)),
  stack: z.array(z.string().min(1)),
  git: z.strictObject({
    enabled: z.boolean(),
    defaultBranch: z.string().min(1).optional(),
  }),
  commands: z.record(z.string(), projectCommandEvidenceSchema.nullable()),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type ProjectRecord = z.infer<typeof projectRecordSchema>;

export const projectRootSchema = z.strictObject({
  id: z.string().min(1),
  path: z.string().min(1),
  enabled: z.boolean(),
});

export type ProjectRoot = z.infer<typeof projectRootSchema>;

export const projectRegistrySnapshotSchema = z.strictObject({
  roots: z.array(projectRootSchema),
  projects: z.array(projectRecordSchema),
  selectedProjectId: z.string().min(1).optional(),
});

export type ProjectRegistrySnapshot = z.infer<
  typeof projectRegistrySnapshotSchema
>;

export const projectRegisterRequestSchema = z.strictObject({
  path: z.string().min(1),
  enabled: z.boolean().default(true),
});

export const projectEnabledRequestSchema = z.strictObject({
  enabled: z.boolean(),
});

export const projectSelectRequestSchema = z.strictObject({
  projectId: z.string().min(1),
});

export interface ProjectRegistryProvider {
  initialize(): Promise<ProjectRegistrySnapshot>;
  snapshot(): ProjectRegistrySnapshot;
  scan(): Promise<ProjectRegistrySnapshot>;
  register(path: string, enabled?: boolean): Promise<ProjectRecord>;
  setEnabled(projectId: string, enabled: boolean): ProjectRecord;
  remove(projectId: string): void;
  select(projectId: string): ProjectRecord;
}
