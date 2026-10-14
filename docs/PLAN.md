# Campify Chatbot – Project Analysis & Plan

## 1. What I found in your projects

**Backend (`campify-development`)** – Node/Express 4 + MongoDB (Mongoose 7), session auth (Passport), Cloudinary images, Mapbox geocoding. Deployed on Render (`campify-p9y9.onrender.com`).
- `Campground`: `title, location, price (USD/night), description, images[], geometry (GeoJSON point), author, reviews[]`
- `Review`: `body, rating (1-5), author, images[], timestamps`
- Public read endpoints (no login needed):
  - `GET /api/campgrounds` -> all campgrounds (reviews are only ids)
  - `GET /api/campgrounds/:id` -> one campground with populated reviews + review authors
- CORS only allows `CLIENT_ORIGIN` -> a browser can't call it from another origin, but a server-to-server call from the chatbot is fine.

**Frontend (`campify-client`)** – React 19 + Vite + React Router 7 + Bootstrap 5, design tokens in `index.css` (alpine green / slate / orange). Routes: `/`, `/campgrounds`, `/campgrounds/:id`, admin panel. Hosted on Vercel (`vercel.json` rewrites `/api` to Render).

## 2. Decisions

| Question | Decision | Why |
|---|---|---|
| Separate repo? | Yes: `campify-chatbot` (Node/Express) | Your request; independent deploy, API key stays off the browser |
| Touch existing backend? | **No changes** | Chatbot reads the two public endpoints |
| How does the bot know about campgrounds? | **LLM tool-calling** (`search_campgrounds`, `get_campground_details`) | Always live data, no vector DB / re-indexing, no hallucinated places. Your dataset is small enough to search in memory |
| Reviews & guidance | Tool returns avg rating, count, latest 8 reviews -> LLM summarises. General camping tips come from the model but are labelled "general advice" | Honest, grounded answers |
| Memory | Stateless: browser sends last 10 messages | No DB needed on Render free tier |
| Model | Claude (`claude-haiku-5-5` default, env-configurable) | Fast + cheap for chat |
| Safety | Rate limit (12/min/IP), CORS allow-list, input caps, helmet, reviews treated as untrusted data (prompt-injection guard), API key server-side only | Public endpoint that costs money |

## 3. Architecture

```
React widget (Vercel)  --POST /api/chat-->  campify-chatbot (Render)
                                               |  Claude + tools
                                               +--GET /api/campgrounds, /:id--> Campify API (Render) --> MongoDB
```

## 4. Phases

1. **Phase 1 (done in this repo):** chat endpoint, 2 tools, cache, guardrails, floating widget, Render config.
2. **Phase 2 (optional):** streaming (SSE) responses; "Ask about this campground" button on the detail page; save chat feedback (thumbs up/down).
3. **Phase 3 (optional):** if you grow to hundreds of campgrounds, add embeddings search; add weather/season data API; personalised answers for logged-in users.

## 5. Gotchas to know
- **Render free tier sleeps.** Both services cold-start (~30-50 s). The chatbot waits up to 50 s for the Campify API, and the first message may be slow. Use a free uptime pinger on `/health` if needed.
- Prices are shown as USD because your UI uses `$`.
- The seed data uses fake/random descriptions; answers are only as good as the descriptions and reviews users write.
- Keep the `ANTHROPIC_API_KEY` only in Render env vars, never in the client.
