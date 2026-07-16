---
name: Groq AI Features
description: How AI (Groq llama-3.3-70b) is wired into AEGIS — endpoints, storage, language choice, and fallback behavior.
---

## Architecture

- **Client**: `artifacts/api-server/src/lib/groq-client.ts` — thin fetch wrapper; model `llama-3.3-70b-versatile`; temperature 0.2; exports `askGroq({ system, user, maxTokens })` and `groqAvailable()`.
- **Routes**: `artifacts/api-server/src/routes/ai.ts` registered via `aiRouter` in `routes/index.ts`.

## Endpoints

| Method | Path | What it does |
|--------|------|-------------|
| GET | `/api/ai/status` | Check if key is configured |
| GET | `/api/ai/threat-analysis` | 24h aggregate → full threat briefing |
| POST | `/api/ai/defend` | Body: `{ip}` → attack history + recommendation for that IP |
| GET | `/api/ai/analyze-event/:id` | Single event explanation |

## Report Integration

`POST /api/reports/generate` calls Groq when key is set, stores AI text in the `summary` (text) column. Falls back silently to template summary on error. Returns `aiGenerated: true` flag in response.

## Language

All AI prompts specify **Burmese + English technical terms** mixed. System prompt references the lab topology (Ubuntu 10.10.10.10, pfSense 192.168.122.1, Kali 192.168.122.x).

## Frontend Surfaces

- **Reports page** (`reports.tsx`): "AI THREAT BRIEFING" card — calls `/api/ai/threat-analysis` on demand, shows stats + analysis text side-by-side.
- **Events page** (`events.tsx`): Bot icon column on each row → dialog calls `/api/ai/analyze-event/:id`.
- **Defense Center** (`defense.tsx`): "AI DEFENSE RECOMMENDATION" card — IP input + "Analyze IP" button → `/api/ai/defend`; quick-fill buttons from active blocks; "Block this IP" prefills the manual block form.

**Why:** No schema changes needed — `summary` is already `text` type (unlimited). AI features degrade gracefully if GROQ_API_KEY is absent (503 from API, UI shows error inline).
