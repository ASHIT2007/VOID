# README screenshot slots

The main README reserves one visible image panel for every listed feature. Each panel currently uses `docs/images/screenshot-placeholder.svg`; these are placeholders, not screenshots of completed sessions.

To fill a slot:

1. Save the capture in this folder using the filename listed below. PNG is suggested; WebP or JPEG also works if you update the extension.
2. Find the matching `<!-- Screenshot slot: ... -->` comment in the root README.
3. Replace that section's image path with the capture path and change its alt text to describe the actual screen. Keep the blank lines around the image.
4. Commit the screenshot and README update together.

For example:

```md
<!-- Screenshot slot: docs/screenshots/orchestration.png -->
![VOID orchestration with researcher and answer-writer roles](docs/screenshots/orchestration.png)
```

Use readable captures with a consistent crop and aspect ratio. The README logo already selects the existing light or dark VOID mark to match GitHub's color scheme.

## Reserved filenames

| Feature | Filename |
| --- | --- |
| Email-first sign-in and profiles | `login.png` |
| Bring your own AI providers | `ai-providers.png` |
| Visual model orchestration | `orchestration.png` |
| Your fallback sequence | `routing.png` |
| Organized, responsive settings | `settings.png` |
| Streaming answers and reasoning modes | `chat.png` |
| Web, news and academic research | `web-research.png` |
| Relevant web images | `web-images.png` |
| Files and document-grounded answers | `attachments.png` |
| Chat history, folders and snippets | `chat-history.png` |
| Colorful flowcharts and Mermaid diagrams | `mermaid-flowcharts.png` |
| Branch-colored mind maps | `mind-maps.png` |
| Native charts and graphs | `charts.png` |
| Image generation and source-image edits | `image-generation.png` |
| Presentation previews and editing | `presentation-preview.png` |
| PowerPoint downloads | `powerpoint-export.png` |
| Selective presentation imagery | `presentation-images.png` |
| Posters, infographics and visual editing | `visual-studio.png` |
| Word documents and reports | `word-documents.png` |
| Excel spreadsheets | `spreadsheets.png` |
| PDF reports and forms | `pdf-reports.png` |
| Websites and code artifacts | `web-artifacts.png` |
| Configurable voice conversations | `voice-agent.png` |
| Python and JavaScript workspace | `code-workspace.png` |
| Local files and direct downloads | `workspace-files.png` |
| Device memory and conversation recall | `memory.png` |
| Usage, cost estimates and model inspection | `usage.png` |
| Calculations and external lookups | `lookup-tools.png` |
| Tool execution and permission controls | `tool-execution.png` |
