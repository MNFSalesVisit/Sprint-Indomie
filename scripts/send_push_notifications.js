// scripts/send_push_notifications.js
// Usage: node scripts/send_push_notifications.js
// Requires: npm install web-push @supabase/supabase-js dotenv

require('dotenv').config();
const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('Missing required environment variables.');
  process.exit(1);
}

// Configure web-push
webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  // Fetch all push subscriptions from your table (replace 'push_subscriptions' with your table name)
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('*');

  if (error) {
    console.error('Error fetching subscriptions:', error);
    process.exit(1);
  }

  if (!data || data.length === 0) {
    console.log('No subscriptions found.');
    return;
  }

  // Customize your notification payload
  const payload = JSON.stringify({
    title: 'Uplift Request',
    body: 'A new uplift request has been submitted.',
    url: '/admin/uplifts',
  });

  let sent = 0;
  for (const sub of data) {
    try {
      await webpush.sendNotification(sub.subscription, payload);
      sent++;
      console.log('Notification sent to:', sub.id || sub.subscription.endpoint);
    } catch (err) {
      console.error('Failed to send notification:', err);
    }
  }
  console.log(`Done. Sent ${sent} notifications.`);
}

main();
