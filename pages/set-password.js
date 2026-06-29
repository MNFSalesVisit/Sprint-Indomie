import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabaseClient';
import { useBranding } from '../lib/brandingContext';
import styles from '../styles/login.module.css';

export default function SetPasswordPage() {
  const router = useRouter();
  const { branding } = useBranding();

  // 'loading' | 'ready' | 'invalid' | 'done'
  const [status,          setStatus]          = useState('loading');
  const [userEmail,       setUserEmail]       = useState('');
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message,         setMessage]         = useState('');
  const [submitting,      setSubmitting]      = useState(false);

  const logoSrc     = branding.company_logo  || null;
  const systemName  = branding.system_name   || 'Sales Visit System';
  const companyName = branding.company_name  || '';
  const primary     = branding.theme_color   || '#7c3aed';
  const accent      = branding.accent_color  || '#06b6d4';
  const logoInitial = (companyName || systemName || 'S')[0].toUpperCase();

  useEffect(() => {
    // Parse the URL hash for invite / recovery tokens placed there by Supabase
    const hash   = typeof window !== 'undefined' ? window.location.hash : '';
    const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
    const type         = params.get('type');
    const accessToken  = params.get('access_token');
    const refreshToken = params.get('refresh_token') || '';

    let resolved = false;
    const resolve = (email) => {
      if (resolved) return;
      resolved = true;
      setUserEmail(email || '');
      setStatus('ready');
    };

    // Supabase JS (detectSessionInUrl: true by default) automatically exchanges
    // the hash tokens and fires onAuthStateChange
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (['SIGNED_IN', 'PASSWORD_RECOVERY', 'INITIAL_SESSION'].includes(event) && session?.user) {
        resolve(session.user.email || '');
      }
    });

    if (accessToken && ['invite', 'recovery'].includes(type)) {
      // Explicitly exchange the tokens — most reliable, bypasses detectSessionInUrl race condition
      supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(({ data, error }) => {
          if (!error && data?.session?.user) {
            resolve(data.session.user.email);
          }
        });
    }

    // Fallback: in case the event already fired before we subscribed,
    // or supabase processed the hash before this useEffect ran
    const timer = setTimeout(async () => {
      if (resolved) return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setStatus('invalid');
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        resolve(session.user.email || '');
      } else {
        setStatus('invalid');
      }
    }, 5000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirmPassword) { setMessage('Passwords do not match.'); return; }
    if (password.length < 6)          { setMessage('Password must be at least 6 characters.'); return; }

    setSubmitting(true);
    setMessage('');

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setMessage('Offline — cannot set password while offline.');
      setSubmitting(false);
      return;
    }

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setSubmitting(false);
      setMessage(error.message);
      return;
    }

    await supabase.auth.signOut();
    setStatus('done');
  };

  const brandHeader = (
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
        <div className={styles.smallMuted}>Set your password</div>
      </div>
    </div>
  );

  return (
    <div className={styles.authWrapper}>
      <div className={styles.authCard}>
        {brandHeader}

        {status === 'loading' && (
          <div style={{ textAlign: 'center', padding: '28px 0', color: '#64748b' }}>
            Verifying your link…
          </div>
        )}

        {status === 'invalid' && (
          <div className="alert alert-danger" style={{ marginTop: 8 }}>
            This link is invalid or has already expired. Please contact your administrator for a new invite.
          </div>
        )}

        {status === 'done' && (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>✅</div>
            <p style={{ color: '#16a34a', fontWeight: 600, marginBottom: 4 }}>Password set successfully!</p>
            <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: 20 }}>
              You can now sign in with your email and new password.
            </p>
            <button
              className={styles.btnSignIn}
              style={{ background: `linear-gradient(90deg, ${primary}, ${accent})` }}
              onClick={() => router.push('/login')}
            >
              Go to Sign In
            </button>
          </div>
        )}

        {status === 'ready' && (
          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label className="form-label">Email</label>
              <input
                className="form-control"
                type="email"
                value={userEmail}
                readOnly
                style={{ background: '#f8fafc', color: '#64748b' }}
              />
            </div>

            <div className="mb-3">
              <label className="form-label">New Password</label>
              <input
                type="password"
                className="form-control"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div className="mb-3">
              <label className="form-label">Confirm Password</label>
              <input
                type="password"
                className="form-control"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
              />
            </div>

            {message && (
              <div className="alert alert-danger" style={{ padding: '8px 12px', fontSize: '0.875rem' }}>
                {message}
              </div>
            )}

            <div className={styles.formActions}>
              <button
                type="submit"
                className={styles.btnSignIn}
                style={{ background: `linear-gradient(90deg, ${primary}, ${accent})` }}
                disabled={submitting}
              >
                {submitting ? 'Setting password…' : 'Set Password'}
              </button>
            </div>
          </form>
        )}
      </div>

      <footer className={styles.copyright}>
        Powered By Indomie
      </footer>
    </div>
  );
}
