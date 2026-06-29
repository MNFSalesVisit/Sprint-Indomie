import { useState, useEffect } from 'react';

/**
 * /auth/invite — Bot-safe redirect wrapper for Supabase auth links.
 *
 * WHY THIS EXISTS:
 * Messaging apps (WhatsApp, Telegram, etc.) send a GET request to any URL you
 * share in order to generate a link preview.  Supabase invite/recovery action
 * links are one-time-use: the moment the WhatsApp bot visits
 *   https://<project>.supabase.co/auth/v1/verify?token=XXX&type=invite&...
 * Supabase marks that token as used.  When the real user taps the link a few
 * seconds later, Supabase says "expired or invalid".
 *
 * HOW THE FIX WORKS:
 * The backend wraps the Supabase action link as a base64-encoded URL hash:
 *   https://<app>/auth/invite#<base64(supabase_action_link)>
 *
 * HTTP bots NEVER receive the fragment (#...) — it is stripped before the
 * request leaves the browser.  So the bot hits /auth/invite and gets plain
 * HTML; it never learns about the Supabase URL, and the token stays intact.
 *
 * Additionally, we require an explicit button click before redirecting to the
 * Supabase verify URL.  This prevents modern messaging app WebViews that
 * execute JavaScript (e.g. WhatsApp in-app browser pre-loading) from
 * consuming the one-time token before the real user taps it.
 *
 * When the real user opens the link their browser:
 *   1. Loads this page (harmless HTML)
 *   2. Runs this script which reads window.location.hash
 *   3. Decodes the base64 to get the real Supabase verify URL
 *   4. User clicks "Continue" → redirected to Supabase verify → /reset-password
 */
export default function InvitePage() {
  const [supabaseUrl, setSupabaseUrl] = useState(null);
  const [invalid,     setInvalid]     = useState(false);

  useEffect(() => {
    const hash = window.location.hash;

    if (!hash || hash.length <= 1) {
      window.location.replace('/login');
      return;
    }

    try {
      const encoded = hash.slice(1); // strip leading '#'
      const url     = atob(encoded);

      // Basic sanity check — must be a Supabase URL
      if (!url.startsWith('https://') || !url.includes('supabase')) {
        window.location.replace('/login');
        return;
      }

      // Store the URL — only redirect when the user explicitly clicks
      setSupabaseUrl(url);
    } catch {
      // Malformed base64
      setInvalid(true);
    }
  }, []);

  const containerStyle = {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    gap: 16,
    color: '#64748b',
    fontFamily: 'system-ui, sans-serif',
    padding: '24px',
    textAlign: 'center',
  };

  if (invalid) {
    return (
      <div style={containerStyle}>
        <div style={{ fontSize: '2rem' }}>🔗</div>
        <p style={{ margin: 0, fontSize: '0.95rem', color: '#dc2626' }}>Invalid link.</p>
      </div>
    );
  }

  if (!supabaseUrl) {
    // Still decoding — show neutral loading state (no redirect yet)
    return (
      <div style={containerStyle}>
        <div style={{ fontSize: '2rem' }}>⏳</div>
        <p style={{ margin: 0, fontSize: '0.95rem' }}>Preparing your link…</p>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={{ fontSize: '2.5rem' }}>🔐</div>
      <p style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#1e293b' }}>
        Your secure link is ready
      </p>
      <p style={{ margin: 0, fontSize: '0.875rem', color: '#64748b', maxWidth: 320 }}>
        Tap the button below to continue to account setup.
      </p>
      <button
        onClick={() => window.location.replace(supabaseUrl)}
        style={{
          marginTop: 8,
          padding: '12px 32px',
          borderRadius: 8,
          border: 'none',
          background: '#7c3aed',
          color: '#fff',
          fontWeight: 600,
          fontSize: '0.95rem',
          cursor: 'pointer',
        }}
      >
        Continue →
      </button>
    </div>
  );
}
