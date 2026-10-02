export function isDiagramRequest(message: string): boolean;
export function normalizeImageIntent(message: string): string;
export function isStudyRoadmapRequest(message: string): boolean;
export function requestedDiagramKind(message: string): 'flowchart' | 'mindmap' | null;
export function workspaceInspectionTools(message: string): string[];
