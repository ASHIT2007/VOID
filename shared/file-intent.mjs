const create = /\b(?:create|make|generate|genrate|genarate|generat|design|prepare|build|draft|produce|compose|export|download|convert|turn|give me|i (?:want|need)|can i (?:get|have))\b/i;
const presentationNoun = /\b(?:powerpoints?|pptx?|presentations?|slide decks?|slides)\b/i;
const fileNoun = /\b(?:powerpoints?|pptx?|presentations?|slide decks?|slides|excel|xlsx|spreadsheets?|workbooks?|pdf|docx|word (?:document|file|report))\b/i;

function authoredRequest(message) {
  return String(message || '').split(/\n\n(?:Artifact requirements:|Topic context from the latest relevant conversation turn:|\[VISUAL DESIGN ENGINE DIRECTIVE\])|\[SYSTEM DIRECTIVE:/)[0];
}
function deliverableTarget(request) {
  const head = request.split(/\b(?:about|on|from)\b/i)[0];
  const otherDeliverable = /\b(?:mind[ -]?maps?|flowcharts?|diagrams?|charts?|graphs?|reports?|documents?|posters?|infographics?|websites?|stories|poems?|emails?)\b/i;
  return fileNoun.test(head) || otherDeliverable.test(head) ? head : request;
}
function creationRequest(request) {
  if (/^\s*\/(?:imagine|model)\b/i.test(request)) return false;
  if (/^\s*(?:please\s+)?(?:explain|how (?:do|can|to)|what is|why)\b/i.test(request) && !/\b(?:and|then)\s+(?:create|make|generate|export)\b/i.test(request)) return false;
  if (/\b(?:image|photo|picture|screenshot|mockup)\s+(?:of|showing)\b/i.test(request)) return false;
  if (/^\s*(?:(?:please|can you|could you)\s+)?(?:create|make|generate|genrate|draw|design)\s+(?:a |an |the )?(?:image|picture|photo|illustration|logo|icon)\b/i.test(request)) return false;
  return create.test(request) || /^\s*(?:an?\s+)?(?:presentations?|powerpoints?|pptx?|slide decks?)\s+(?:about|on|for|of)\b/i.test(request);
}

/** PPT/deck requests use the editable presentation skill. Preview wins over an
 * explicit PowerPoint/PPTX request; negated previews do not request a preview. */
export function presentationDelivery(message) {
  const request = authoredRequest(message);
  const target = deliverableTarget(request);
  if (!creationRequest(request) || !presentationNoun.test(target)) return null;
  const positivePreview = request.replace(/\b(?:no|without|not|skip|do not|don't|don’t)\s+(?:(?:a|any|the|show|showing|generate|generating|include|including|want|need|to|me|us)\s+)*previews?\b/gi, '');
  const preview = /\b(?:previews?|outline only|only (?:an? )?outline|no (?:download|file))\b/i.test(positivePreview);
  const formatRequests = request.match(/\b(?:as|in|to)\s+(?:an?\s+)?(?:downloadable\s+)?(?:powerpoints?|\.?pptx)\b/gi) || [];
  const positiveFileTarget = [target, ...formatRequests].join(' ').replace(/\b(?:no|without|not|do not|don't|don’t)\s+(?:(?:an?|any|the|create|generate|make|download|export)\s+)*(?:powerpoints?|pptx)\b/gi, '');
  return !preview && /\b(?:powerpoints?|pptx)\b/i.test(positiveFileTarget) ? 'powerpoint' : 'preview';
}
/** Identify the requested deliverable before image routing or preview planning. */
export function requestedFileTools(message) {
  const request = authoredRequest(message);
  if (!creationRequest(request)) return [];
  if (/\b(?:preview only|only (?:a |an )?(?:preview|outline)|outline only|no (?:download|file))\b/i.test(request)) return [];
  const target = deliverableTarget(request);
  const names = [];
  if (presentationDelivery(request) === 'powerpoint') names.push('generate_presentation');
  if (/\b(?:excel|xlsx|spreadsheets?|workbooks?)\b/i.test(target)) names.push('generate_spreadsheet');
  if (/\bpdf\b/i.test(target)) names.push('generate_pdf');
  if (/\b(?:docx|word (?:document|file|report))\b/i.test(target)) names.push('generate_document');
  return names;
}
export function fileGenerationDirective(names) {
  return `Create actual downloadable files using these tools: ${names.join(', ')}. These are file requests, not image requests or in-chat preview schemas. Use each requested format's exact argument schema. Preserve the requested topic, content and data; include useful sections, meaningful slides with notes, or typed spreadsheet cells/formulas as appropriate. Do not call generate_image or edit_image, output generator code, substitute a picture, or claim a file exists without a successful generator result. If essential source data or the topic is missing, ask one specific question. After success, give the actual short file brief and preserve the returned download link.`;
}
