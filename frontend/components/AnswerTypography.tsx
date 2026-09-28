import React from 'react';
import type { Components } from 'react-markdown';

function containsImage(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const element = node as { tagName?: string; children?: unknown[] };
  return element.tagName === 'img' || Boolean(element.children?.some(containsImage));
}

// Reuse the same hierarchy in chat and development previews.
export const answerTypographyComponents: Components = {
  p: ({ children, node }) => containsImage(node)
    ? <div className="answer-paragraph">{children}</div>
    : <p className="answer-paragraph">{children}</p>,
  h1: ({ children }) => <h1 className="answer-heading answer-title">{children}</h1>,
  h2: ({ children }) => <h2 className="answer-heading answer-section">{children}</h2>,
  h3: ({ children }) => <h3 className="answer-heading answer-subsection">{children}</h3>,
  h4: ({ children }) => <h4 className="answer-heading answer-minor-heading">{children}</h4>,
  h5: ({ children }) => <h5 className="answer-heading answer-minor-heading">{children}</h5>,
  h6: ({ children }) => <h6 className="answer-heading answer-minor-heading">{children}</h6>,
  ul: ({ children }) => <ul className="answer-list answer-unordered">{children}</ul>,
  ol: ({ children, start }) => <ol start={start} className="answer-list answer-ordered">{children}</ol>,
  li: ({ children }) => <li className="answer-list-item">{children}</li>,
  strong: ({ children }) => <strong className="answer-strong">{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
  blockquote: ({ children }) => <blockquote className="answer-quote">{children}</blockquote>,
  hr: () => <hr className="answer-divider" />,
};
