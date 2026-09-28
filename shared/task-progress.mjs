export function progressTarget(value, limit = 100) {
  if (typeof value !== 'string') return '';
  let text = value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  if (/^https?:\/\//i.test(text)) {
    try { const url = new URL(text); text = url.hostname.replace(/^www\./, '') + (url.pathname === '/' ? '' : url.pathname); }
    catch { return ''; }
  }
  return text.length > limit ? text.slice(0, limit - 1).trimEnd() + '…' : text;
}

export function toolProgress(name, args = {}, completed = false) {
  const currency = name === 'currency_convert' ? `${args.amount ?? ''} ${args.from || ''} → ${args.to || ''}`.trim() : '';
  const query = progressTarget(args.query || args.url || args.filename || args.filepath || args.location || args.symbol || args.expression || args.title || args.key || args.modelId || currency);
  const actions = {
    web_search: ['Searching the web', 'Reviewing search results'],
    news_search: ['Searching the news', 'Reviewing news sources'],
    web_fetch: ['Reading a source', 'Reviewing source content'],
    image_search: ['Finding images', 'Reviewing image results'],
    generate_image: ['Creating an image', 'Checking the generated image'],
    edit_image: ['Editing your image', 'Checking the edited image'],
    generate_document: ['Creating your Word document', 'Checking the document'],
    generate_presentation: ['Creating your presentation', 'Checking the slides and notes'],
    generate_spreadsheet: ['Creating your spreadsheet', 'Checking sheets and formulas'],
    generate_pdf: ['Creating your PDF', 'Checking pages and form fields'],
    render_chart: ['Plotting chart values', 'Checking chart labels and coordinates'],
    memory_list: ['Auditing device memories', 'Reviewing stored memories'],
    usage_tracker: ['Checking conversation usage', 'Reviewing tokens and estimated cost'],
    provider_router: ['Checking connected models and routing', 'Reviewing provider capabilities'],
    calculator: ['Calculating', 'Checking the calculation'],
    code_execution: [`Running ${args.language === 'javascript' ? 'JavaScript' : 'Python'} code`, 'Reviewing the code output'],
    file_read: ['Reading a file', 'Reviewing file contents'],
    file_write: ['Writing a file', 'Checking the saved file'],
    weather_fetch: ['Checking the weather', 'Reviewing the forecast'],
    stock_quote: ['Checking the stock price', 'Reviewing market data'],
    currency_convert: ['Converting currencies', 'Checking the conversion'],
    maps_search: ['Looking up a location', 'Reviewing location details'],
    render_diagram: ['Building a diagram', 'Checking the diagram'],
    memory_get: ['Looking up saved information', 'Reviewing saved information'],
    memory_set: ['Saving your information', 'Checking saved information'],
    memory_delete: ['Removing saved information', 'Checking the update'],
    conversation_search: ['Searching your conversation', 'Reviewing conversation matches'],
    tool_search: ['Selecting the right tool', 'Reviewing available tools'],
  };
  return { action: (actions[name] || ['Processing your request', 'Reviewing the result'])[completed ? 1 : 0],
    query, kind: 'task', state: 'active' };
}
