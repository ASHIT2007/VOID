'use client';
import { motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

export default function ScrollToLatestButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  const label = loading ? 'Answer loading below. Scroll to latest message' : 'Scroll to latest message';
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, scale: 0.8, x: '-50%', y: 8 }}
      animate={{ opacity: 1, scale: 1, x: '-50%', y: 0 }}
      exit={{ opacity: 0, scale: 0.8, x: '-50%', y: 8 }}
      whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }} onClick={onClick}
      className="absolute left-1/2 top-1 z-40 flex h-10 w-10 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-800 shadow-xl transition-colors hover:bg-gray-100 dark:border-[#4A4A4A] dark:bg-[#27272A] dark:text-white dark:hover:bg-[#333]"
      title={label} aria-label={label} data-loading={loading}
    >
      {loading ? <span className="answer-loading-dots" aria-hidden="true">
        {[0, 1, 2].map(index => <span key={index} style={{ animationDelay: `${index * 160}ms` }} />)}
      </span> : <ChevronDown size={18} aria-hidden="true" />}
    </motion.button>
  );
}
