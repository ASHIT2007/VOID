# Attachment analysis

Attachments are analyzed without web or web-image search unless the request explicitly asks for external research. Text-bearing PDFs are extracted in 20-page batches; scanned pages are rendered and transcribed through an available vision model. Page labels are preserved. Extracted text is cached by content hash under `backend/server/data/attachment-index` for follow-up retrieval.

Focused questions retrieve relevant passages from the entire extracted text, including the end of the file. Large overall reviews use representative passages across the document and disclose that coverage. They must not claim an exhaustive review of every page.

When cloud attachment storage is unavailable, `/api/attachments` streams uploads to `backend/server/data/attachments`. The default limit is 256 MB per file; set `ATTACHMENT_MAX_MB` on the backend and restart to change it. This is a host resource limit, not a model context limit. Local uploads and indexes persist on that host; they are not synchronized to other hosts.

Images are normalized to JPEG within 2048 × 2048 pixels before routing. Their encoded bytes do not count as text tokens. Auto selects vision-capable routes and preserves the attachment if all providers are unavailable. OCR accuracy and service availability cannot be guaranteed; unreadable pages are explicitly marked.
