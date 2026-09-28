export function progressTarget(value: unknown, limit?: number): string;
export function toolProgress(name: string, args?: Record<string, unknown>, completed?: boolean): {
  action: string; query: string; kind: string; state: string;
};
