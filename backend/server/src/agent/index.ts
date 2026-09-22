/**
 * Agent tool initialization.
 *
 * Importing this module registers every tool with the central registry.
 * Import once at server startup (from app.ts or index.ts).
 */

// Phase 2: Information retrieval
import './tools/web-search.js';
import './tools/web-fetch.js';
import './tools/image-search.js';
import './tools/maps-search.js';
import './tools/generate-image.js';

// Phase 4: Code & computation
import './tools/calculator.js';
import './tools/code-execution.js';
import './tools/file-tools.js';

// Phase 5: Memory & external data
import './tools/memory.js';
import './tools/external-data.js';
import './tools/conversation-search.js';
import './tools/diagram-renderer.js';

// Phase 6: Orchestration (tool_search)
import { registerOrchestrationTools } from './orchestration.js';
registerOrchestrationTools();

// Re-export core utilities for convenience
export { getAllTools, getAllToolSchemas, getTool } from './tool-registry.js';
export { runAgentLoop, resumeAfterConfirmation } from './agent-loop.js';
export { runDeepResearch } from './deep-research.js';
export { getRelevantToolSchemas } from './orchestration.js';
