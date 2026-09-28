import { registerTool } from '../tool-registry.js';
import { requestClientTool } from '../client-tools.js';
import { currentByokContext } from '../../ai/byok-context.js';
type Properties = Record<string, Record<string, unknown>>;
export function browserTool(name: string, description: string, properties: Properties, required: string[] = []) {
  registerTool(name, { type: 'function', function: { name, description: `${description} Runs on the user's device. Requested file creation runs directly; execution, memory changes, paid image actions and external file reading request approval. Never claim completion before the tool returns success.`,
    parameters: { type: 'object', properties, required } } }, args => requestClientTool(name, args),
    { readOnly: false, requiresConfirmation: false, category: 'action' });
}
export function registerWorkspaceTools() {
  browserTool('generate_document', 'Create a real styled DOCX Word file. Sections support heading, text, bullets and table rows. Generated files stay on-device until downloaded.', {
    title: { type: 'string' }, sections: { type: 'array', items: { type: 'object', properties: { heading: { type: 'string' }, text: { type: 'string' }, image: { type: 'string', description: 'Actual PNG/JPEG/GIF data URL from an approved source, not an invented image.' }, bullets: { type: 'array', items: { type: 'string' } }, table: { type: 'array', items: { type: 'array', items: { type: 'string' } } } } } } }, ['title', 'sections']);
  browserTool('generate_presentation', 'Create a downloadable PowerPoint PPTX only for an explicit PowerPoint or .pptx file request without any requested preview. PPT, presentation and slides requests default to the editable presentation-generation skill instead of this file tool. A preview request always takes precedence. Create meaningful slides and speaker notes. Use different layouts by content; charts support native data. Plan supporting imagePrompt illustrations on selected slides (not every slide). Set imageSource reference only when an authentic real-world image is necessary, and imageSubject to its canonical entity. The app uses the connected image model, or sparse verified web imagery if no image key exists. Do not invent URLs.', {
    title: { type: 'string' }, theme: { type: 'string', enum: ['dark', 'light'] }, slides: { type: 'array', items: { type: 'object', properties: {
      title: { type: 'string' }, text: { type: 'string' }, bullets: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' }, imagePrompt: { type: 'string' }, imageSubject: { type: 'string' }, imageSource: { type: 'string', enum: ['auto', 'reference'] }, chart: { type: 'object' } }, required: ['title'] } } }, ['title', 'slides']);
  browserTool('generate_spreadsheet', 'Create a real XLSX with named sheets, formatted headers, numeric cells and formulas. Cells may be strings/numbers/booleans/null or {formula,result,format}. Formula results must be supplied when known; otherwise Excel calculates on opening. Charts may specify type bar/line/pie, labels and values.', {
    title: { type: 'string' }, sheets: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, rows: { type: 'array', items: { type: 'array' } }, chart: { type: 'object' } }, required: ['name', 'rows'] } } }, ['title', 'sheets']);
  browserTool('generate_pdf', 'Create a real paginated PDF report with headings, paragraphs, tables, and optional fillable text form fields. This is direct PDF generation.', {
    title: { type: 'string' }, sections: { type: 'array', items: { type: 'object', properties: { heading: { type: 'string' }, text: { type: 'string' }, table: { type: 'array', items: { type: 'array', items: { type: 'string' } } } } } },
    fields: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, label: { type: 'string' } }, required: ['name', 'label'] } } }, ['title', 'sections']);
  browserTool('usage_tracker', 'Inspect on-device conversation token totals, provider/model breakdown and estimated USD cost. Missing configured prices yield unknown cost, never zero. Token/cost estimates are not a provider invoice.', {});
  registerTool('provider_router', { type: 'function', function: { name: 'provider_router', description: 'Inspect connected models/capabilities and routing preferences without exposing keys. With action select, request a user-approved device-only preference for the next turn.',
    parameters: { type: 'object', properties: { action: { type: 'string', enum: ['inspect', 'select'] }, modelId: { type: 'string' } } } } }, async args => {
    const context = currentByokContext();
    if (!context) return { content: 'Sign in and connect a provider to inspect routing.', error: 'routing_unavailable' };
    if (args.action === 'select') {
      if (!context.models.some(model => model.id === args.modelId && model.enabled && model.capabilities.text)) return { content: 'Choose an enabled connected text model.', error: 'invalid_model' };
      return requestClientTool('provider_router', args);
    }
    return { content: JSON.stringify({ mode: context.mode, taskType: context.taskType, manualModelId: context.manualModelId, preferredModelId: context.preferredModelId,
      fallbackEnabled: context.fallbackEnabled, models: context.models.filter(model => model.enabled).map(model => ({ id: model.id, provider: model.providerId,
        model: model.modelId, name: model.displayName, capabilities: model.capabilities, contextWindow: model.contextWindow })) }) };
  }, { readOnly: false, requiresConfirmation: false, category: 'meta' });
}
