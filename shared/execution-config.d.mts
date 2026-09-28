export type ExecutionRole = { id: string; name: string; kind: 'researcher' | 'analyst' | 'fact_checker' | 'answer_writer' | 'custom'; modelId: string; instruction: string };
export type ExecutionConfig = { version: 1; primaryModelId: string | null; roles: ExecutionRole[]; fallbackModelIds: string[] };
export const EXECUTION_METADATA_KEY: string;
export const ROLE_KINDS: ExecutionRole['kind'][];
export function defaultExecutionConfig(primaryModelId?: string | null): ExecutionConfig;
export function parseExecutionConfig(value: unknown): ExecutionConfig;
export function reconcileExecutionConfig(value: unknown, eligibleIds: string[], preferredId?: string | null): ExecutionConfig;
