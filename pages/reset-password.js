import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabaseClient';
import { useBranding } from '../lib/brandingContext';
import styles from '../styles/login.module.css';

export default function ResetPasswordPage() {
  const router = useRouter();
  const { branding } = useBranding();

  // 'loading' | 'ready' | 'invalid' | 'done'
  const [status,          setStatus]          = useState('loading');
  const [userEmail,       setUserEmail]       = useState('');
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message,         setMessage]         = useState('');
  const [submitting,      setSubmitting]      = useState(false);
  const [errorDetail,     setErrorDetail]     = useState('');
  // 'invite' = new user setting password | 'recovery' = existing user resetting password
  const [flowType,        setFlowType]        = useState('invite');

  const logoSrc     = branding.company_logo  || null;
  const systemName  = branding.system_name   || 'Sales Visit System';
  const companyName = branding.company_name  || '';
  const primary     = branding.theme_color   || '#7c3aed';
  const accent      = branding.accent_color  || '#06b6d4';
  const logoInitial = (companyName || systemName || 'S')[0].toUpperCase();

  useEffect(() => {
    const hash   = typeof window !== 'undefined' ? window.location.hash : '';
    const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
    const type         = params.get('type');
    const accessToken  = params.get('access_token');
    const refreshToken = params.get('refresh_token') || '';
    const errorDesc    = params.get('error_description');

    // Supabase puts error details in the hash when a link is expired/invalid/not-whitelisted
    if (errorDesc) {
      setErrorDetail(decodeURIComponent(errorDesc.replace(/\+/g, ' ')));
      setStatus('invalid');
      return;
    }

    // Track whether this is a password reset or a first-time account setup
    if (type) setFlowType(type === 'recovery' ? 'recovery' : 'invite');

    let resolved = false;
    const resolve = (email) => {
      if (resolved) return;
      resolved = true;
      setUserEmail(email || '');
      setStatus('ready');
    };

    // 1) Listen for auth state change (may already have fired — covered by setSession/getSession below)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY') && session?.user) {
        resolve(session.user.email);
      }
    });

    // 2) Explicitly set the session with the tokens from the hash — most reliable approach,
    //    bypasses the detectSessionInUrl race condition entirely.
    //    Only runs if tokens are still present (supabase-js hasn't cleared the hash yet).
    const validTypes = ['invite', 'recovery', 'signup'];
    if (accessToken && validTypes.includes(type)) {
      supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(({ data, error }) => {
          if (!error && data?.session?.user) {
            resolve(data.session.user.email);
          }
        });
    }

    // 3) Immediately check getSession — handles the case where supabase-js v2 already
    //    processed and cleared the URL hash via detectSessionInUrl before this useEffect ran.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user && !resolved) {
        resolve(session.user.email || '');
      }
    });

    // 4) Final fallback after 5s
    const timer = setTimeout(async () => {
      if (resolved) return;
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        resolve(session.user.email);
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
      setMessage('You appear to be offline. Please connect to the internet and try again.');
      setSubmitting(false);
      return;
    }

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setSubmitting(false);
      // Surface a friendly message for common token errors
      if (error.message?.toLowerCase().includes('expired') || error.message?.toLowerCase().includes('invalid')) {
        setMessage('This link has expired or is no longer valid. Please ask your administrator for a new invite link.');
      } else {
        setMessage(error.message);
      }
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
        <div className={styles.smallMuted}>{flowType === 'recovery' ? 'Password Reset' : 'Account Setup'}</div>
      </div>
    </div>
  );

  return (
    <div className={styles.authWrapper}>
      <div className={styles.authCard}>
        {brandHeader}

        {/* ── Verifying ── */}
        {status === 'loading' && (
          <div style={{ textAlign: 'center', padding: '32px 0', color: '#64748b' }}>
            <div style={{ fontSize: '2rem', marginBottom: 10 }}>⏳</div>
            Verifying your link…
          </div>
        )}

        {/* ── Invalid / Expired ── */}
        {status === 'invalid' && (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 10 }}>🔗</div>
            <p style={{ color: '#dc2626', fontWeight: 700, fontSize: '1rem', marginBottom: 8 }}>
              Link invalid or expired
            </p>
            <p style={{ color: '#64748b', fontSize: '0.875rem', marginBottom: 12, lineHeight: 1.6 }}>
              This link is invalid, has already been used, or has expired.<br />
              Please contact your administrator to request a new invite link.
            </p>
            {errorDetail && (
              <p style={{
                background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
                color: '#b91c1c', fontSize: '0.78rem', padding: '8px 12px',
                marginBottom: 16, textAlign: 'left', wordBreak: 'break-word',
              }}>
                <strong>Details:</strong> {errorDetail}
              </p>
            )}
            <button
              className={styles.btnSignIn}
              style={{ background: `linear-gradient(90deg, ${primary}, ${accent})` }}
              onClick={async () => { try { await supabase.auth.signOut(); } catch {} router.push('/login'); }}
            >
              Back to Sign In
            </button>
          </div>
        )}

        {/* ── Success / Done ── */}
        {status === 'done' && (
          <div style={{ padding: '8px 0' }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: '2.8rem', marginBottom: 8 }}>✅</div>
              <p style={{ color: '#16a34a', fontWeight: 700, fontSize: '1.05rem', marginBottom: 4 }}>
                {flowType === 'recovery' ? 'Password reset successfully!' : 'Account activated successfully!'}
              </p>
              <p style={{ color: '#64748b', fontSize: '0.875rem' }}>
                {flowType === 'recovery'
                  ? 'Your password has been updated. You can now sign in.'
                  : 'Your password has been set. You can now sign in.'}
              </p>
            </div>

            {/* PWA Install Instructions */}
            <div style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 12,
              padding: '16px 18px',
              marginBottom: 20,
            }}>
              <p style={{
                fontWeight: 600,
                color: '#1e293b',
                fontSize: '0.85rem',
                marginBottom: 12,
                marginTop: 0,
              }}>
                📲 Install the app for the best experience:
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <div style={{ fontSize: '0.8rem', color: '#475569', lineHeight: 1.5 }}>
                  <strong>📱 Android:</strong> Tap the browser menu <strong>(⋮)</strong> → <em>Add to Home Screen</em>
                </div>
                <div style={{ fontSize: '0.8rem', color: '#475569', lineHeight: 1.5 }}>
                  <strong>🍎 iPhone:</strong> Tap Share <strong>(⎙)</strong> → <em>Add to Home Screen</em>
                </div>
                <div style={{ fontSize: '0.8rem', color: '#475569', lineHeight: 1.5 }}>
                  <strong>💻 Desktop:</strong> Click the install icon <strong>(⊕)</strong> in the address bar
                </div>
              </div>
            </div>

            <button
              className={styles.btnSignIn}
              style={{ background: `linear-gradient(90deg, ${primary}, ${accent})` }}
              onClick={() => router.push('/login')}
            >
              Go to Sign In →
            </button>
          </div>
        )}

        {/* ── Password Form ── */}
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
              <label className="form-label">{flowType === 'recovery' ? 'New Password' : 'Set Password'}</label>
              <input
                type="password"
                className="form-control"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoFocus
                minLength={6}
                placeholder="Minimum 6 characters"
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
                placeholder="Re-enter your password"
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
                {submitting
                  ? (flowType === 'recovery' ? 'Resetting password…' : 'Activating account…')
                  : (flowType === 'recovery' ? 'Reset Password' : 'Activate Account')}
              </button>
            </div>
          </form>
        )}

        <footer className={styles.copyright} style={{ marginTop: 16 }}>
          Powered By Indomie
        </footer>
      </div>
    </div>
  );
}
