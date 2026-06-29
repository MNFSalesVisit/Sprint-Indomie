import { adminSupabase, requireSuperAdmin } from '../../../../lib/adminAuth';

// Wraps a Supabase action link in our /auth/invite proxy page.
// The real Supabase URL is stored in the URL hash fragment (#) so that
// WhatsApp / Telegram link-preview bots never receive it (HTTP requests
// strip the fragment before leaving the browser), keeping the one-time
// token intact until the real user opens the link.
function wrapLink(actionLink) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://sprint-indomie-gd5w.vercel.app';
  const encoded = Buffer.from(actionLink).toString('base64');
  return `${siteUrl}/auth/invite#${encoded}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const actor = await requireSuperAdmin(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden' });

    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email is required' });

    const normalizedEmail = email.toLowerCase().trim();
    const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://sprint-indomie-gd5w.vercel.app';
    const redirectTo = `${BASE_URL}/reset-password`;

    // Always try 'recovery' first (works for users who already have a confirmed auth account).
    // Fall back to 'invite' only if recovery fails (user has no auth account yet).
    // This avoids the listUsers() pagination bug where >50 auth users causes false negatives.
    const { data: recoveryData, error: recoveryErr } = await adminSupabase.auth.admin.generateLink({
      type: 'recovery',
      email: normalizedEmail,
      options: { redirectTo },
    });

    if (!recoveryErr && recoveryData?.properties?.action_link) {
      return res.json({ link: wrapLink(recoveryData.properties.action_link) });
    }

    // No auth account yet — generate an invite link (also no email sent)
    const { data: inviteData, error: inviteErr } = await adminSupabase.auth.admin.generateLink({
      type: 'invite',
      email: normalizedEmail,
      options: { redirectTo },
    });
    if (inviteErr) return res.status(500).json({ error: inviteErr.message });
    return res.json({ link: wrapLink(inviteData.properties?.action_link) });

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
