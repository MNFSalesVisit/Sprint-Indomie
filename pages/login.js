import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabaseClient';
import { useBranding } from '../lib/brandingContext';
import styles from '../styles/login.module.css';

export default function LoginPage() {
  const router = useRouter();
  const { branding } = useBranding();
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const logoSrc     = branding.company_logo  || null;
  const systemName  = branding.system_name   || 'Sales Visit System';
  const companyName = branding.company_name  || '';
  const primary     = branding.theme_color   || '#7c3aed';
  const accent      = branding.accent_color  || '#06b6d4';
  const logoInitial = (companyName || systemName || 'S')[0].toUpperCase();

  useEffect(() => {
    // If user is already logged in, route them to their portal directly.
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.access_token) return;
      try {
        const res  = await fetch('/api/admin/check', { headers: { Authorization: `Bearer ${session.access_token}` } });
        const body = await res.json();
        if      (body.role === 'Super Admin') router.push('/super-admin');
        else if (body.role === 'Admin')       router.push('/admin');
        else if (body.role === 'Manager')     router.push('/manager');
        else if (body.role === 'Salesperson') router.push('/sales');
      } catch { /* ignore — let them use the login form */ }
    });
  }, []);

  const signIn = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    const input = emailOrUsername.trim();
    let loginEmail = input;

    // If input has no @, treat it as a username and resolve to email
    if (!input.includes('@')) {
      try {
        const res = await fetch('/api/auth/lookup-username', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: input }),
        });
        const body = await res.json();
        if (!res.ok) {
          setLoading(false);
          setMessage(body.error || 'User not found');
          return;
        }
        loginEmail = body.email;
      } catch {
        setLoading(false);
        setMessage('Could not reach the server. Please try again.');
        return;
      }
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
    if (error) {
      setLoading(false);
      setMessage(error.message);
      return;
    }
    // Persist a cached offline copy of the authenticated user for offline mode.
    try {
      const offlineUser = data?.session?.user ?? null;
      if (offlineUser && typeof window !== 'undefined') {
        localStorage.setItem('offline_user', JSON.stringify(offlineUser));
        console.debug('login -> saved offline_user', offlineUser, 'online:', navigator.onLine);
      }
    } catch (e) {
      console.debug('login -> failed saving offline_user', e);
    }
    // check role and redirect
    const token = data.session?.access_token;
    const res = await fetch('/api/admin/check', { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json();
    setLoading(false);
    if (body.role === 'Super Admin') router.push('/super-admin');
    else if (body.role === 'Admin') router.push('/admin');
    else if (body.role === 'Manager') router.push('/manager');
    else router.push('/sales');
  };

  return (
    <div className={styles.authWrapper}>
      <div className={styles.authCard}>
        {/* Brand header */}
        <div className={styles.brand}>
          <div
            className={styles.logo}
            style={{ background: logoSrc ? 'transparent' : `linear-gradient(135deg, ${primary}, ${accent})` }}
          >
            {logoSrc
              ? <img src={logoSrc} alt="logo" className={styles.logoImg} />
              : <span className={styles.logoInitial}>{logoInitial}</span>
            }
          </div>
          <div>
            <h4 style={{ margin: 0 }}>{systemName}</h4>
            {companyName && <div className={styles.companyName}>{companyName}</div>}
            <div className={styles.smallMuted}>Sign in to your account</div>
          </div>
        </div>

        <form onSubmit={signIn}>
          <div className="mb-3">
            <label className="form-label">Email or Username</label>
            <input className="form-control" type="text" value={emailOrUsername} onChange={(e) => setEmailOrUsername(e.target.value)} required autoComplete="username" />
          </div>
          <div className="mb-3">
            <label className="form-label">Password</label>
            <div className={styles.passwordWrap}>
              <input
                type={showPassword ? 'text' : 'password'}
                className="form-control"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className={styles.pwdToggle}
                onClick={() => setShowPassword(s => !s)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
                    <circle cx="12" cy="12" r="3" />
                    <line x1="2" y1="2" x2="22" y2="22" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>
          <div className={styles.formActions}>
            <button
              type="submit"
              className={styles.btnSignIn}
              style={{ background: `linear-gradient(90deg, ${primary}, ${accent})` }}
              disabled={loading}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </form>

        {message && <div className="alert alert-info" style={{ marginTop: 12 }}>{message}</div>}
      </div>
      <footer className={styles.copyright}>
        Powered By Indomie
      </footer>
    </div>
  );
}
