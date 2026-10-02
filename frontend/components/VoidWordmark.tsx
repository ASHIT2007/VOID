/* eslint-disable @next/next/no-img-element -- Static branding also needs to work in the global error fallback without the image optimizer. */

import styles from './VoidWordmark.module.css';

/** The supplied name logo. The black-hole symbol is a separate brand asset. */
export default function VoidWordmark({ tone = 'auto', width = 100, className = '', decorative = false }: {
  tone?: 'auto' | 'white' | 'black';
  width?: number;
  className?: string;
  decorative?: boolean;
}) {
  return <span
    className={`${styles.wordmark} ${className}`}
    style={{ width }}
    role={decorative ? undefined : 'img'}
    aria-label={decorative ? undefined : 'VOID'}
    aria-hidden={decorative || undefined}
  >
    {tone !== 'white' && <img className={tone === 'auto' ? styles.lightVariant : undefined} src="/brand/void-wordmark-black.svg" width={1153} height={291} alt="" aria-hidden="true" />}
    {tone !== 'black' && <img className={tone === 'auto' ? styles.darkVariant : undefined} src="/brand/void-wordmark-white.svg" width={1153} height={289} alt="" aria-hidden="true" />}
  </span>;
}
