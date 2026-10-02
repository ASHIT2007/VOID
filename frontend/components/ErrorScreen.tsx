'use client';

/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-location-assign-relative-destination -- Recovery must load a fresh document even when the client router has failed. */

import { useState, useSyncExternalStore } from 'react';
import { ArrowLeft, ArrowUpRight, Check, ChevronDown, Copy, RefreshCw } from 'lucide-react';
import { errorInformation } from '@/lib/error-screen';
import VoidWordmark from './VoidWordmark';
import styles from './ErrorScreen.module.css';

function subscribePath(onChange: () => void) {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
}
const currentPath = () => window.location.pathname;
const serverPath = () => '';

export default function ErrorScreen({ kind, error, onRetry }: {
  kind: 'not-found' | 'application';
  error?: unknown;
  onRetry?: () => void;
}) {
  const missing = kind === 'not-found';
  const path = useSyncExternalStore(subscribePath, currentPath, serverPath);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const information = errorInformation(error);
  const copyDetails = async () => {
    const details = [missing ? 'VOID · 404 · Page not found' : 'VOID · Application error',
      missing ? 'No page exists at this address.' : information.message,
      ...(path ? [`Path: ${path}`] : []),
      ...(information.reference ? [`Error reference: ${information.reference}`] : [])].join('\n');
    try { await navigator.clipboard.writeText(details); setCopyStatus('copied'); }
    catch { setCopyStatus('failed'); }
  };
  const goBack = () => {
    if (window.history.length > 1) window.history.back();
    else window.location.assign('/');
  };

  return <main className={styles.page} aria-labelledby="void-error-title">
    <header className={styles.header}><a href="/" className={styles.wordmark} aria-label="VOID home"><VoidWordmark tone="white" width={96} decorative /></a></header>
    <div className={styles.content}>
      <div className={styles.illustration}>
        {/* A static asset keeps recovery independent of the image optimizer. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.mascot} src="/illustrations/void-mascot.png" width={1122} height={1402} alt="VOID's floating silver and black robot mascot" fetchPriority="high" />
      </div>
      <section className={styles.message}>
        <p className={styles.code}>{missing ? '404 / Page not found' : 'Application error'}</p>
        <h1 id="void-error-title" className={styles.title}>{missing ? <>Lost in<br />the VOID.</> : <>A little interruption.</>}</h1>
        <p className={styles.description}>{missing
          ? 'This address doesn’t lead to a page in VOID. The link may be incorrect, or the page may have moved.'
          : 'Something went wrong while loading this page. Try again, or head back to VOID to continue.'}</p>
        <div className={styles.actions}>
          {!missing && onRetry
            ? <button type="button" onClick={onRetry} className={styles.primary}><RefreshCw size={15} aria-hidden="true" />Try again</button>
            : <a href="/" className={styles.primary}>Back to VOID<ArrowUpRight size={16} aria-hidden="true" /></a>}
          {missing
            ? <button type="button" onClick={goBack} className={styles.secondary}><ArrowLeft size={15} aria-hidden="true" />Go back</button>
            : <a href="/" className={styles.secondary}>Back to VOID<ArrowUpRight size={15} aria-hidden="true" /></a>}
        </div>
        <details className={styles.details} open={!missing}>
          <summary className={styles.summary}>Error details<ChevronDown size={14} aria-hidden="true" /></summary>
          <div className={styles.detailContent}>
            <p className={styles.reason}>{missing ? '404 — No page was found at this address.' : information.message}</p>
            <dl className={styles.metadata}>
              {path && <div><dt>Path</dt><dd>{path}</dd></div>}
              {information.reference && <div><dt>Reference</dt><dd>{information.reference}</dd></div>}
            </dl>
            <button type="button" className={styles.copy} onClick={() => void copyDetails()}>{copyStatus === 'copied' ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}{copyStatus === 'copied' ? 'Copied' : 'Copy details'}</button>
            <p className={styles.copyStatus} role="status" aria-live="polite">{copyStatus === 'failed' ? 'Couldn’t copy. You can select the details above.' : copyStatus === 'copied' ? 'Error details copied.' : ''}</p>
          </div>
        </details>
      </section>
    </div>
  </main>;
}
