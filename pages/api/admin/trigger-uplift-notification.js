// This endpoint is disabled in Vercel build due to Node-only dependencies (web-push).
// To send push notifications, use a separate Node.js script/server outside Vercel.
export default function handler(req, res) {
  res.status(501).json({ error: 'Push notification endpoint is disabled on Vercel. Use a Node.js server or script for web-push.' });
}
