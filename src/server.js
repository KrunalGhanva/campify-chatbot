import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { answer } from './chat.js';

const app = express();
app.set('trust proxy', 1); // Render sits behind a load-balancer proxy

// ── Security middleware ───────────────────────────────────────
app.use(helmet());

app.use(
  cors({
    origin(origin, cb) {
      // Allow server-to-server (no Origin header) and listed origins
      if (!origin || config.allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error('Not allowed by CORS'));
    },
    methods: ['POST', 'GET', 'OPTIONS'],
  })
);

// 20 KB body limit — enough for 10 × 1000-char messages + overhead
app.use(express.json({ limit: '20kb' }));

// ── Health check ──────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }));

// ── Rate limiter: 12 requests / 60 s / IP ────────────────────
const chatLimiter = rateLimit({
  windowMs: 60_000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  handler(_req, res) {
    res.status(429).json({
      error: "You're sending messages too fast — please wait a minute and try again. 🏕️",
    });
  },
});

// ── Input validation ──────────────────────────────────────────
function validate(body) {
  const { messages, campgroundId } = body || {};

  if (!Array.isArray(messages) || !messages.length) {
    return { error: 'messages[] is required and must be a non-empty array.' };
  }

  // Strip to the last `maxHistory` messages, keep only valid role/content pairs
  const clean = messages
    .slice(-config.maxHistory)
    .filter(
      (m) =>
        m &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.trim().length > 0
    )
    .map((m) => ({ role: m.role, content: m.content.slice(0, config.maxMessageChars) }));

  // Conversation must start with a user turn
  while (clean.length && clean[0].role !== 'user') clean.shift();

  if (!clean.length) return { error: 'Conversation must contain at least one user message.' };
  if (clean[clean.length - 1].role !== 'user') {
    return { error: 'Last message must be from the user.' };
  }

  // Optional campgroundId: must be a 24-hex MongoDB ObjectId
  const id =
    typeof campgroundId === 'string' && /^[a-f0-9]{24}$/i.test(campgroundId)
      ? campgroundId.toLowerCase()
      : undefined;

  return { clean, id };
}

// ── Chat endpoint ─────────────────────────────────────────────
app.post('/api/chat', chatLimiter, async (req, res) => {
  const { clean, id, error } = validate(req.body);
  if (error) return res.status(400).json({ error });

  try {
    const reply = await answer(clean, { campgroundId: id });
    res.json({ reply });
  } catch (e) {
    // Log the status code if available (Anthropic SDK errors have .status)
    console.error('Chat error:', e.status || '', e.message);
    res
      .status(502)
      .json({ error: 'Trailie is unavailable right now. Please try again in a moment.' });
  }
});

// ── Global error handler ──────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }
  // Never leak stack traces to the client
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error.' });
});

app.listen(config.port, () =>
  console.log(`🏕️  Campify chatbot (Trailie) listening on :${config.port}`)
);
