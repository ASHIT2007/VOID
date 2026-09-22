"use client";

export default function ResponseActivity({ thinking = false }: { thinking?: boolean }) {
  return (
    <div className="response-activity mt-4 flex items-center gap-2.5 text-xs text-gray-500 dark:text-gray-400" role="status" aria-live="polite">
      <svg className="response-activity-icon h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {Array.from({ length: 12 }, (_, i) => (
          <path key={i} d="M12 2.5 C10.8 5.5 13.3 7 12 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" transform={`rotate(${i * 30} 12 12)`} opacity={0.3 + i / 17} />
        ))}
      </svg>
      <span>{thinking ? "Thinking" : "Generating"}</span>
    </div>
  );
}
