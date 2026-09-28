# VOID capabilities and tools

Inventory checked against the active application on 2026-09-27. VOID's built-in workflows are described below as skills; there is no separate installed SKILL.md catalog in the application. Existing visual editors remain available alongside format-specific download tools.

## Skills and workflows

| Capability | Implemented behavior |
| --- | --- |
| Chat, writing and reasoning | Streaming answers, Markdown headings/lists/tables/code, mathematical notation, coding help, explanations, summaries, translation and creative writing through connected models |
| Research | Web/news/academic research, reading sources, citations, relevant verified web images, adaptive reasoning effort, deep research and task-specific multi-agent synthesis |
| Attachment understanding | Text/code, PDF including vision-assisted scanned pages, DOCX, PPTX and spreadsheet extraction; image understanding through vision-capable models; document-grounded retrieval and answers |
| Charts and data visualization | Native editable chart data; bar, horizontal bar, stacked bar, pie, donut, line, area, scatter, radar, funnel, gauge, timeline, treemap, waterfall and progress charts; transparent containers and numeric Cartesian axes |
| Diagrams | Mermaid and JSON mind maps/graphs render fully in the chat with transparent backgrounds, readable labels, zoom, SVG download and collapsed source; no fixed-height diagram frame |
| Presentations | Structured slide generation, completeness checks, a plain-text deck brief, visual preview/editor, PPTX and PDF export |
| Posters and infographics | Image generation/compositing, structured editable visual layouts, topic-aware follow-up edits and visual studio previews |
| Reports and documents | Structured reports, executive summaries, sections, tables and supported figures; document editing with Word/DOCX and PDF export |
| Websites and code artifacts | Standalone responsive HTML/CSS/JavaScript generation, isolated in-app preview, artifact editing and downloads; this does not automatically deploy a website |
| Images | Image search, generation and source-image edits through configured image services; stored generated images and previews |
| Voice | Speech recognition, automatic language handling including Hindi/Hinglish, streamed spoken responses and conversation mode; available languages/voices depend on the configured speech service |
| Computation and external data | Calculator, weather, currency conversion, stock quotes and place/address lookup |
| Memory and conversation recall | Device/account IndexedDB memories, full local audit, requested reads and approved writes/deletes; cloud sync disabled. Conversation search covers a known backend agent session, not every saved Supabase chat |
| Tool orchestration | Relevant-tool selection, schema discovery, argument validation, supported native/text tool-call transport and read-result reuse; requested local file creation runs directly and returns a chat download. Code execution, memory changes, image actions, routing changes and source-file selection retain approval. Device results bind one-use requests to their authenticated owner |
| Provider routing | User-connected providers/custom compatible APIs, model capability discovery, automatic/manual routing, fallback, key health and usage tracking |
| Chat organization | Recent-chat overlay, search, pinning, folders, saved snippets and history |

## Complete backend tool catalog

There are **29 implemented function tools**, all registered in normal web/production chat. Browser-dependent tools require the signed-in device workspace. The former development host-shell/file-access mode is removed: `ENABLE_LOCAL_HOST_TOOLS` no longer enables host access. Registration alone does not imply every external provider supports every capability.

| Tool | Purpose | Availability/limits |
| --- | --- | --- |
| `web_search` | General web search | Search service configuration/availability |
| `web_fetch` | Read a public web page | Public URL/security checks |
| `news_search` | Search news | Search service configuration/availability |
| `academic_search` | Search academic material | Search service configuration/availability |
| `image_search` | Retrieve and verify relevant web images | Image/search service availability |
| `generate_image` | Create an image through the frontend image pipeline | A permitted configured image service; missing-key and admin-backup notices apply |
| `edit_image` | Edit an explicitly selected source image | Existing image pipeline, actual provider edit support and user approval; no pretend background removal/inpainting |
| `calculator` | Evaluate mathematical expressions | Local computation |
| `weather_fetch` | Current weather and forecast for a location | External geocoding/weather service |
| `currency_convert` | Convert an amount using exchange rates | External rates service |
| `stock_quote` | Retrieve market quote information | External quote service |
| `maps_search` | Search locations/addresses and coordinates | External geocoding service; not a navigation/map-rendering engine |
| `render_diagram` | Produce Mermaid diagram content | The frontend renders the diagram |
| `render_chart` | Validate/render numeric bar, horizontal bar, line, area, scatter, pie or donut data | Native transparent chart viewer; preserves supplied values and X/Y pairings |
| `memory_set` | Store/update a device memory entry | IndexedDB for this account/device; explicit approval |
| `memory_get` | Retrieve matching device memory entries | Requested results go to the connected model; no extra overlay for a read |
| `memory_list` | Audit every local memory entry | Memory tab also lists entries without an LLM request |
| `memory_delete` | Delete a device memory entry | Explicit approval; no cloud sync |
| `conversation_search` | Search messages in a specified active agent session | Requires its session ID; not cloud history search |
| `tool_search` | Discover matching registered tools and schemas | Respects the actual runtime registry |
| `code_execution` | Execute Python or JavaScript in the separate Code overlay | Disposable Pyodide/QuickJS worker in opaque sandbox; standard libraries, 30-second wall limit, no host filesystem/account storage/unrestricted network; JS has a 64 MiB VM limit |
| `file_read` | Read a file explicitly selected by the user | Local text/DOCX/XLSX extraction; PDF/OCR/images use approved upload and configured vision where needed; errors are explicit |
| `file_write` | Create a raw text/code/CSV download | Device Files tab; cannot disguise HTML as an Office file |
| `generate_document` | Create an actual styled DOCX | Headings, paragraphs, bullets, tables, approved embedded PNG/JPEG/GIF images |
| `generate_spreadsheet` | Create an actual XLSX | Multiple sheets, styled headers, formulas/cached numeric results and native bar/line/pie charts; Excel recalculates formulas on opening |
| `generate_presentation` | Create an actual PPTX | Monochrome dark/light theme, content-dependent text/bullet/chart layouts, notes and native charts; factual title/slide-count/topic brief |
| `generate_pdf` | Create an actual paginated PDF or fillable report | Headings, paragraphs, grid tables and text form fields; unsupported scripts fail clearly rather than producing broken glyphs; Word/editor export remains available |
| `usage_tracker` | Inspect conversation tokens and estimated USD cost | Per-provider/model device records; provider-reported counts when supplied, otherwise labeled estimates; user-configured token rates; missing rates mean unknown |
| `provider_router` | Inspect connected capabilities or select a model | Never exposes API keys; approved device override applies next turn, can be cleared in Usage tab |

Tool availability also respects connected-model capabilities, search settings and per-task permissions. Registration and mocked execution tests do not imply that every external account, endpoint or credential has been live-tested.

Sources in this repository: `backend/server/src/agent/index.ts`, `backend/server/src/agent/tools/`, `backend/server/src/agent/orchestration.ts`, `frontend/app/api/`, `frontend/components/` and `shared/tool-protocol.mjs`.

## Scope and storage

Workspace opens from the sidebar for files, code, memory and usage. Explicit PowerPoint/PPTX, Excel/XLSX, Word/DOCX and PDF file-creation requests route to actual format tools before image routing. Plain PPT, presentation and slide-deck requests use the editable presentation preview by default. An explicit PowerPoint/PPTX request creates a file when no preview is requested; an explicit preview takes precedence. Requested local file generation does not open Workspace or require a second approval. Its factual brief and device download appear in chat and persist in history; the download requires the same account/browser where the file was created. Workspace also supports direct selected-file reading and memory deletion, with visible errors and saved-rate feedback. A provider that returns preview/code without completing a generator is repaired once or reports a clear failure.

This pass fixes the existing capability gaps and exposes usage/routing. Persistent publishing, connector registry/invocation, mail/calendar tools and a generic card renderer are deferred; they are not advertised as implemented. Existing multilingual transcription/speech are reused rather than replaced with duplicate audio tools. Generation, file-reading, cost-awareness and privacy rules are encoded in tool schemas and the shared agent prompt.

Files, memories, token records, configured rates and routing overrides persist in this browser/account until its storage is cleared. They do not automatically sync across devices. Download important files. Existing server-memory files and historical cloud usage records are preserved without automatic migration; the legacy usage API identifies its results as historical. New automatic cloud usage inserts are disabled. Existing cloud chat history and deliberately stored image artifacts remain separate product features.

Costs are estimates from configured input/output rates, not invoices. Failed/unreported attempts, helper repair calls, images, voice, cache discounts and provider-specific fees can be absent. No current provider price is invented. The actual connected service controls multilingual/vision/image-edit support.
