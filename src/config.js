import 'dotenv/config';

const required = (name) => {
  const v = process.env[name];
  if (!v) {
    console.error(`❌ Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return v;
};

const strip = (s) => s.replace(/\/+$/, '');

export const config = {
  port: Number(process.env.PORT) || 4000,

  // ── Google AI (Gemini) ───────────────────────────────────────
  googleAiKey: required('GOOGLE_AI_API_KEY'),
  model: process.env.GOOGLE_AI_MODEL || 'gemini-3.8-flash',
  fallbackModel: process.env.GOOGLE_AI_FALLBACK_MODEL || 'gemini-3.1-flash-lite',

  // ── Campify API (server-to-server) ───────────────────────────
  campifyApiUrl: strip(required('CAMPIFY_API_URL')),

  // ── Frontend (used to build /campgrounds/:id links) ──────────
  clientUrl: strip(process.env.CLIENT_URL || 'http://localhost:5173'),

  // ── CORS allow-list ──────────────────────────────────────────
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // ── Timeouts & cache ─────────────────────────────────────────
  fetchTimeoutMs: 50_000,
  listCacheMs:    5 * 60 * 1000,
  detailCacheMs:  2 * 60 * 1000,

  // ── Conversation limits ──────────────────────────────────────
  maxHistory:      10,
  maxMessageChars: 1000,
  maxToolRounds:   4,
};
