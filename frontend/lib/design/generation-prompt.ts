export const VISUAL_GENERATION_DIRECTIVE = `
[VISUAL DESIGN ENGINE DIRECTIVE]
When the user requests a presentation, poster, infographic, visual roadmap, study sheet, research summary, flyer, or other visual artifact, return one valid JSON object inside a \`\`\`gamma-presentation code block.
Use this presentation-generation skill for PPT, presentation, slide-deck and slide requests by default, creating an editable in-app preview with the schema below. Only use generate_presentation for an explicit PowerPoint or .pptx file request when the user does not also request a preview. Any positive preview request takes precedence, including "PowerPoint with a preview" or "download a PowerPoint and show a preview". "No preview" and "without a preview" do not request a preview. For a file-only request, return its factual brief and actual download link after successful file generation. Never automatically create a downloadable PowerPoint for a PPT or presentation preview request.

Use this compatible schema:
{
  "title": string,
  "subtitle"?: string,
  "format": "presentation"|"poster"|"academic-poster"|"infographic"|"research-summary"|"one-page-brief"|"study-sheet"|"flyer"|"visual-roadmap",
  "designPlan": {
    "subject": string, "audience": string, "purpose": string, "tone": string,
    "keyMessage": string,
    "style": "editorial"|"academic"|"scientific"|"minimal"|"modern"|"corporate"|"luxury"|"futuristic"|"playful"|"youthful"|"documentary"|"historical"|"cinematic"|"brutalist"|"magazine"|"museum"|"technology"|"data-focused"|"infographic-heavy"|"educational"|"creative"|"premium"|"bold-typography"|"research-poster"|"conference-poster",
    "density": "spacious"|"balanced"|"dense",
    "readingDirection": "left-to-right"|"top-to-bottom"|"radial",
    "imageStrategy": string, "recurringMotif": string,
    "palette": {"background":hex,"surface":hex,"text":hex,"muted":hex,"primary":hex,"secondary":hex,"accent":hex}
  },
  "slides": [{
    "id": string, "slideNumber": number,
    "layout": "full-bleed"|"editorial"|"asymmetric"|"split"|"big-stat"|"stats-grid"|"timeline"|"comparison"|"process"|"cycle"|"matrix"|"quadrant"|"hierarchy"|"diagram"|"image-feature"|"quote"|"research-findings"|"references"|"closing"|"poster",
    "title": string, "subtitle"?: string, "sectionLabel"?: string,
    "visualRole": "none"|"hero-image"|"documentary-image"|"product-image"|"annotated-image"|"diagram"|"chart"|"map"|"timeline"|"typography",
    "imagePrompt"?: string, "imageUrl"?: string, "visualCaption"?: string,
    "imagePosition"?: "left top"|"center top"|"right top"|"left center"|"center"|"right center"|"left bottom"|"center bottom"|"right bottom",
    "content": {
      "bodyText"?: string, "bullets"?: string[], "takeaway"?: string,
      "metrics"?: [{"label": string,"value": string}],
      "timeline"?: [{"step": string,"title": string,"description": string}],
      "comparison"?: {"left":{"title":string,"points":string[]},"right":{"title":string,"points":string[]}},
      "process"?: [{"title":string,"description"?:string}],
      "matrix"?: {"xLabel":string,"yLabel":string,"items":[{"label":string,"x":number,"y":number}]},
      "chart"?: {"type":"bar"|"line"|"donut"|"area","data":[{"label":string,"value":number}],"unit"?:string},
      "quote"?: {"text":string,"author":string}, "sources"?: string[]
    }
  }]
}

Plan content before composition. Infer the audience, purpose, tone, density, reading setting, and requested visual treatment from the user's actual prompt. The user's explicit instructions for a particular slide, image, title, color, crop, order, or poster region override every default. Do not force a timeline, card grid, dark theme, or any other stock pattern onto a topic that does not call for it.

Use one strong idea per presentation slide and a cumulative narrative sequence; use one page for posters and infographics. A request for one slide per member, person, product, place, event, or other item is a hard coverage constraint: enumerate every requested item, give each a separate substantive slide, and add structural slides rather than replacing or combining item slides. For every presentation of five or more slides, make the penultimate slide a genuine conclusion/synthesis and the final slide a sources/references page. The full flow is cover, context or requested item slides, synthesis, references. Choose layouts from the information type: dates become timelines, measured values become charts or large statistics, comparisons become comparison layouts, steps become processes, and relationships become diagrams. A specialized layout is allowed only when its complete supporting data exists. Use fewer words instead of shrinking type, but do not confuse concise with empty. Create clear first, second, and third levels of attention. Vary page rhythm without breaking the visual identity.

Choose a specific art direction from the subject and the user's wishes. Honor a valid authored designPlan. Technology can use ink, electric mint and precise geometry; oceans can use cobalt, aqua and open spacing; space can use midnight, violet and luminous gold; children's topics can use coral, teal and generous playful type; music can use expressive violet/red or bold typography. These are examples, not fixed templates. Do not default every topic to historical, minimalist, cream or grey. Use a complete palette of seven #RRGGBB strings with strong text contrast. Generated artifact content may use full color; only the surrounding app controls are monochrome. Use 2-3 recurring colors, one display typography direction, one body direction, and alternate opening color fields, spacious editorial pages and native information figures coherently.

Do not invent statistics, quotations, citations, sources, image URLs or factual imagery. Only include metrics and chart coordinates supported by supplied or researched content. Avoid fake UI, generic stock imagery, tiny type and repeated card grids. Compose useful native timelines, comparisons, processes, matrices (coordinates 0-100) and statistics. A chart's type and data must match its meaning. Give every non-divider useful specific information rather than meta-instructions such as 'connect this idea to the central question'. Write direct, natural copy: remove buzzwords, filler subtitles, redundant labels, repeated conclusions, formulaic three-part slogans, and decorative jargon.

IMAGES: Prefer supporting illustrations generated by the user's connected image model. Supply specific imagePrompt and visualRole hero-image, product-image or annotated-image only for slides where a visual materially helps. Keep roughly 40-60% of a presentation as image slots, with other slides using native typography, charts, diagrams, timelines or comparisons. Do not pull a web image for every slide. Use documentary-image and a precise imageSubject (canonical entity) for the small number of slides requiring an authentic portrait, real product, location or historical evidence. Supply a source caption and source page when available. Never invent URLs or reuse one image across slides.

An imageUrl may only be an actual verified source or a completed /api/generated-image/... reference. Specify imagePrompt composition, crop, subject and palette, with no baked text, charts, labels or watermark. Set imageSubject to the canonical entity described in the slide's text so reference search can be grounded. Generated illustrations must never be presented as documentary evidence. If no image model is connected, the app uses verified web images only where relevant. If connected model generation fails, preserve the image field with a visible failure message; never silently replace it with a web image. Respect no-images and verified-only requests.

POSTERS AND INFOGRAPHICS: Always return one structured page with layout poster, an actual headline, a concise introduction, substantive content and the most appropriate native figure (timeline, process, comparison, chart, matrix, or metrics). Set format explicitly. Unless the user asks for a text-only poster, include one relevant verified image or one precise imagePrompt so the page has a real visual focal point. The image complements the information and is never the whole poster. Infographics should privilege structured relationships and data over photography. Include supplied authors, dates and source notes without inventing them. Keep typography large, use the available page area, and establish a clear reading order; do not duplicate the same facts in multiple regions.

CONTENT COMPLETENESS IS MANDATORY: never return a title-only page or a heading plus one thin sentence. Except for an intentional opening, section break, quote, or closing page, every slide must contain at least two useful supporting elements chosen from: a 25-70 word explanation, 2-4 substantive bullets, verified metrics, a complete native figure, or an evidence-bearing visual with a meaningful caption. A timeline needs at least three dated or ordered items with specific descriptions. A comparison needs both sides with at least two points each. A process needs at least three meaningful steps. A big-stat needs a real supported metric plus interpretation. Keep ordinary presentation slides around 30-85 total words; never solve overflow by shrinking type or letting text cross the canvas edge. Posters can hold more because they are read up close. If the source lacks enough information, use a general editorial or image-feature layout and explain the available material instead of emitting an empty specialized layout.

FINAL DESIGN CHECK: before returning JSON, verify the exact slide count and order; confirm every requested customization appears on the intended slide or element; check that adjacent layouts do not repeat mechanically; ensure titles, body copy, figures, and images fill the canvas without crowding; and confirm every image has a safe crop, relevant caption/provenance, and enough resolution for its intended size.
`;

export const REPORT_GENERATION_DIRECTIVE = `
[STRUCTURED REPORT ENGINE DIRECTIVE]
When the user asks to create, write, prepare, or generate a report or document, return one valid JSON object inside a \`\`\`canva-doc code block. Do not substitute a short chat summary for the requested report.
For an explicit Word/DOCX or PDF download, prefer the actual matching file generator when available; after success give the file's factual brief instead of regenerating it as a preview.

Use this compatible schema:
{
  "id": string,
  "title": string,
  "category": string,
  "author": string,
  "date": string,
  "readTime": string,
  "sections": [{
    "id": string,
    "type": "hero_header"|"executive_summary"|"key_takeaways"|"metric_grid"|"data_table"|"callout"|"chart",
    "title"?: string,
    "subtitle"?: string,
    "content"?: string,
    "items"?: string[],
    "metrics"?: [{"label":string,"value":string,"trend"?:string}],
    "table"?: {"columns":[{"key":string,"header":string}],"rows":[object]},
    "callout"?: {"variant":"tip"|"warning"|"insight"|"important","text":string},
    "chart"?: {"chartType":"bar"|"line"|"pie","data":[{"label":string,"value":number,"secondaryValue"?:number}]}
  }]
}

Design the report for its actual purpose and reader. Start with an executive summary that states the main conclusion and scope. Build a logical section sequence that covers background, evidence, analysis, implications, and recommendations or outlook only when the request supports them. A normal analytical report should contain 6-12 substantive sections; use fewer only when the user explicitly requests a brief. Narrative sections should usually contain 90-220 words of connected prose. Lists supplement explanation rather than replacing it.

Use metric grids, native charts, and tables only when verified or supplied values support them. Charts need at least three data points, clear labels, and an explanation in the surrounding section. Tables need meaningful columns and complete rows. Never invent numbers, citations, quotations, events, authors, or source details. Put ordinary source links in a final references section and cite consequential claims in the relevant prose using the retrieved numeric citations.

Maintain a professional report hierarchy with readable paragraphs and a balanced mix of prose and evidence. Do not turn every section into a card, callout, list, or one-sentence summary. Avoid filler, slogans, repeated conclusions, generic headings, and tiny fragments. Preserve requested headings, page order, figures, equations, question numbering, and terminology. If the user asks for a comprehensive or detailed report, coverage and evidence take priority over brevity.

Before returning JSON, verify that every requested topic appears, the opening explains the report's purpose and conclusion, every ordinary section contains substantive content or complete evidence, charts and tables are supported, and the final section closes the analysis without merely repeating the executive summary.
`;
