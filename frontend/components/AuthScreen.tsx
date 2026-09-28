"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Image from 'next/image';
import { ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, Phone, UserRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { sendPhoneCode, verifyPhoneCode } from '@/lib/auth-phone';
import { normalizeLoginEmail, readLoginAvatar } from '@/lib/login-profile';
import styles from './AuthScreen.module.css';
import AuthStarfield from './AuthStarfield';

type AuthMode = 'login' | 'signup' | 'reset' | 'phone';
type SocialProvider = 'google' | 'github';
const providers: { id: SocialProvider; label: string }[] = [
  { id: 'google', label: 'Google' },
  { id: 'github', label: 'GitHub' },
];

function SpaceBackground() {
  return (
    <div className={styles.space} aria-hidden="true">
      <Image src="/auth/space-background.webp" alt="" fill loading="eager" fetchPriority="high" sizes="100vw" className={styles.spaceImage} />
      <div className={styles.spaceLight} />
      <AuthStarfield />
    </div>
  );
}

function ProviderIcon({ provider }: { provider: SocialProvider }) {
  const paths = {
    google: 'M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.23c1.89-1.74 2.99-4.3 2.99-7.36ZM12 22c2.7 0 4.96-.9 6.61-2.41l-3.23-2.51c-.9.6-2.04.97-3.38.97-2.61 0-4.83-1.76-5.62-4.12H3.05v2.59A10 10 0 0 0 12 22ZM6.38 13.93A6 6 0 0 1 6.07 12c0-.67.11-1.32.31-1.93V7.48H3.05A10 10 0 0 0 2 12c0 1.61.38 3.14 1.05 4.52l3.33-2.59ZM12 5.95c1.47 0 2.78.51 3.82 1.51l2.86-2.86C16.95 2.99 14.7 2 12 2a10 10 0 0 0-8.95 5.48l3.33 2.59C7.17 7.71 9.39 5.95 12 5.95Z',
    github: 'M12 .8a11.2 11.2 0 0 0-3.54 21.83c.56.1.76-.24.76-.54v-2.08c-3.12.68-3.78-1.32-3.78-1.32-.51-1.3-1.24-1.65-1.24-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.15 1.72 1.15 1 1.72 2.63 1.22 3.27.94.1-.73.39-1.23.71-1.51-2.49-.28-5.11-1.25-5.11-5.54 0-1.22.44-2.22 1.15-3.01-.11-.28-.5-1.42.11-2.96 0 0 .94-.3 3.08 1.15a10.68 10.68 0 0 1 5.6 0c2.14-1.45 3.08-1.15 3.08-1.15.61 1.54.22 2.68.11 2.96.72.79 1.15 1.79 1.15 3.01 0 4.3-2.63 5.25-5.13 5.53.4.35.76 1.03.76 2.08v3.14c0 .3.2.65.77.54A11.2 11.2 0 0 0 12 .8Z',
  };
  return <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><path d={paths[provider]} /></svg>;
}

function LoginAvatar({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={styles.avatar}>
      {url && !failed ? (
        <Image unoptimized src={url} width={64} height={64} alt="Your profile photo" className={styles.profilePhoto} onError={() => setFailed(true)} referrerPolicy="no-referrer" />
      ) : (
        <UserRound size={30} strokeWidth={1.35} role="img" aria-label="Default profile avatar" className={styles.defaultAvatar} />
      )}
    </div>
  );
}

export default function AuthScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [sentPhone, setSentPhone] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [mode, setMode] = useState<AuthMode>('login');
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState<'email' | 'phone' | SocialProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const submissionRef = useRef(false);
  const avatarUrl = useMemo(() => mode === 'login' ? readLoginAvatar(email) : null, [email, mode]);
  const busy = pending !== null;

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (query.has('error') || hash.has('error')) {
      // OAuth callback errors are browser URL state unavailable during server rendering.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError('That sign-in could not be completed. Please try again or continue with email.');
      // Remove only failed OAuth parameters, leaving unrelated URL state intact.
      for (const key of ['error', 'error_code', 'error_description']) {
        query.delete(key);
        hash.delete(key);
      }
      window.history.replaceState(null, '', `${window.location.pathname}${query.size ? `?${query}` : ''}${hash.size ? `#${hash}` : ''}`);
    }
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timeout = setTimeout(() => setResendIn(value => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timeout);
  }, [resendIn]);

  const changeMode = (next: AuthMode) => {
    if (busy) return;
    setMode(next);
    setError(null);
    setSuccess(null);
    setPassword('');
    setShowPassword(false);
  };

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submissionRef.current) return;
    submissionRef.current = true;
    setPending(mode === 'phone' ? 'phone' : 'email');
    setError(null);
    setSuccess(null);
    const normalizedEmail = normalizeLoginEmail(email);
    try {
      if (mode === 'phone') {
        if (sentPhone) {
          await verifyPhoneCode(sentPhone, otp);
        } else {
          if (resendIn > 0) throw new Error(`Please wait ${resendIn} seconds before requesting another code.`);
          setSentPhone(await sendPhoneCode(phone));
          setResendIn(60);
          setSuccess('Code sent. Check your SMS messages.');
        }
      } else if (mode === 'reset') {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
          redirectTo: `${window.location.origin}/update-password`,
        });
        if (authError) throw authError;
        setSuccess('If an account exists for this email, you’ll receive a password reset link.');
      } else if (mode === 'login') {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
        if (authError) throw authError;
      } else {
        const { data, error: authError } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: { emailRedirectTo: `${window.location.origin}/` },
        });
        if (authError) throw authError;
        if (data.user?.identities?.length === 0) {
          setError('An account with this email already exists. Please log in instead.');
        } else if (!data.session) {
          setSuccess('Check your email to verify your account and get started.');
        }
      }
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Unable to connect. Please try again.');
    } finally {
      submissionRef.current = false;
      setPending(null);
    }
  };

  const handleSocialAuth = async (provider: SocialProvider) => {
    if (submissionRef.current) return;
    submissionRef.current = true;
    setPending(provider);
    setError(null);
    setSuccess(null);
    const label = providers.find((item) => item.id === provider)!.label;
    try {
      // Supabase's public settings prevent redirecting to an unconfigured provider.
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
        headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`${label} sign-in is unavailable right now. Please continue with email.`);
      const settings = await response.json();
      if (settings.external?.[provider] !== true) {
        throw new Error(`${label} sign-in isn’t available yet. Please continue with email.`);
      }
      const { data, error: authError } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/`, skipBrowserRedirect: true },
      });
      if (authError) throw authError;
      if (!data.url) throw new Error('Unable to start sign-in. Please try again.');
      window.location.assign(data.url);
      // Keep all actions disabled while leaving for the provider.
    } catch (authError) {
      setError(authError instanceof Error && authError.name !== 'TypeError' && authError.name !== 'TimeoutError'
        ? authError.message
        : `${label} sign-in could not connect. Please try again or continue with email.`);
      submissionRef.current = false;
      setPending(null);
    }
  };

  return (
    <main className={styles.page}>
      <SpaceBackground />
      <header className={styles.brand} aria-label="VOID">
        <Image src="/void%20logo%20white.png" alt="" width={30} height={30} />
        <span>VOID</span>
      </header>

      <div className={styles.content}>
        <section className={styles.card} aria-labelledby="auth-title">
          <LoginAvatar key={avatarUrl || 'default-profile'} url={avatarUrl} />
          <h1 id="auth-title" className={styles.title}>
            {mode === 'phone' ? 'Continue with phone' : mode === 'reset' ? 'Reset your password' : mode === 'signup' ? 'Create your account' : 'Welcome back'}
          </h1>
          {(mode === 'phone' || mode === 'reset') && <p className={styles.subtitle}>
            {mode === 'phone' ? 'We’ll send a sign-in code by SMS.' : 'We’ll send a reset link to your email.'}
          </p>}

          {error && <p className={styles.notice} role="alert" id="auth-error">{error}</p>}
          {success && <p className={styles.notice} role="status">{success}</p>}

          <form onSubmit={handleAuth} className={styles.form} aria-busy={busy} aria-describedby={error ? 'auth-error' : undefined}>
            {mode === 'phone' ? <>
              <div className={styles.field}>
                <label htmlFor="auth-phone">Phone number</label>
                <div className={styles.inputWrap}>
                  <Phone size={16} aria-hidden="true" className={styles.fieldIcon} />
                  <input id="auth-phone" name="phone" type="tel" autoComplete="tel" placeholder="+91 98765 43210" value={phone} required disabled={busy || Boolean(sentPhone)} onChange={event => { setPhone(event.target.value); setError(null); }} />
                </div>
              </div>
              {sentPhone && <div className={styles.field}>
                <label htmlFor="auth-otp">SMS code</label>
                <div className={styles.inputWrap}>
                  <LockKeyhole size={16} aria-hidden="true" className={styles.fieldIcon} />
                  <input id="auth-otp" name="otp" type="text" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="6-digit code" value={otp} required disabled={busy} onChange={event => { setOtp(event.target.value.replace(/\D/g, '')); setError(null); }} />
                </div>
                <div className={styles.labelRow}>
                  <button type="button" className={styles.textButton} disabled={busy} onClick={() => { setSentPhone(null); setOtp(''); setSuccess(null); setError(null); }}>Change number</button>
                  <button type="button" className={styles.textButton} disabled={busy || resendIn > 0} onClick={() => { setSentPhone(null); setOtp(''); setSuccess('Press Send SMS code to resend.'); }}>{resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}</button>
                </div>
              </div>}
            </> : <div className={styles.field}>
              <label htmlFor="auth-email">Email address</label>
              <div className={styles.inputWrap}>
                <Mail size={16} aria-hidden="true" className={styles.fieldIcon} />
                <input id="auth-email" name="email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} placeholder="you@example.com" value={email} onChange={(event) => { setEmail(event.target.value); setError(null); setSuccess(null); }} required disabled={busy} />
              </div>
            </div>}

            {mode !== 'reset' && mode !== 'phone' && (
              <div className={styles.field}>
                <div className={styles.labelRow}>
                  <label htmlFor="auth-password">Password</label>
                  {mode === 'login' && <button type="button" className={styles.textButton} disabled={busy} onClick={() => changeMode('reset')}>Forgot password?</button>}
                </div>
                <div className={styles.inputWrap}>
                  <LockKeyhole size={16} aria-hidden="true" className={styles.fieldIcon} />
                  <input id="auth-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} placeholder={mode === 'signup' ? 'At least 6 characters' : 'Enter your password'} minLength={mode === 'signup' ? 6 : undefined} value={password} onChange={(event) => { setPassword(event.target.value); setError(null); }} required disabled={busy} className={styles.passwordInput} />
                  <button type="button" className={styles.passwordToggle} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} disabled={busy} onClick={() => setShowPassword((current) => !current)}>
                    {showPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                  </button>
                </div>
              </div>
            )}

            <button type="submit" className={styles.primaryButton} disabled={busy}>
              {pending === 'email' || pending === 'phone' ? <><LoaderCircle size={17} className={styles.spinner} aria-hidden="true" /><span>{mode === 'reset' ? 'Sending reset link…' : 'Please wait…'}</span></> : <><span>{mode === 'phone' ? (sentPhone ? 'Verify and sign in' : 'Send SMS code') : mode === 'reset' ? 'Send reset link' : mode === 'signup' ? 'Create account with email' : 'Continue with email'}</span><ArrowRight size={17} aria-hidden="true" /></>}
            </button>
          </form>

          {mode !== 'reset' && mode !== 'phone' && (
            <>
              <div className={styles.divider}><span>or continue with</span></div>
              <div className={styles.providers} role="group" aria-label="Other sign-in options">
                {providers.map(({ id, label }) => (
                  <button key={id} type="button" className={styles.providerButton} aria-label={`Continue with ${label}`} disabled={busy} onClick={() => void handleSocialAuth(id)}>
                    {pending === id ? <LoaderCircle size={17} className={styles.spinner} aria-hidden="true" /> : <ProviderIcon provider={id} />}
                    <span>{label}</span>
                  </button>
                ))}
                <button type="button" className={styles.providerButton} aria-label="Continue with phone" disabled={busy} onClick={() => changeMode('phone')}><Phone size={17} aria-hidden="true" /><span>Phone</span></button>
              </div>
            </>
          )}

          <p className={styles.modeSwitch}>
            {mode === 'phone' ? 'Prefer email?' : mode === 'reset' ? 'Remember your password?' : mode === 'login' ? 'New to VOID?' : 'Already have an account?'}{' '}
            <button type="button" disabled={busy} className={styles.switchButton} onClick={() => changeMode(mode === 'login' ? 'signup' : 'login')}>
              {mode === 'phone' ? 'Continue with email' : mode === 'login' ? 'Sign up' : 'Log in'}
            </button>
          </p>
        </section>
      </div>

    </main>
  );
}
