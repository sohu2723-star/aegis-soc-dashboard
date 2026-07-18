---
name: Auth system
description: JWT + Google SSO login; env var patterns; what must be set on Render
---

## Login methods
1. Admin Key → POST /api/auth/admin-key → checks AEGIS_ADMIN_KEY env var
2. Google SSO → POST /api/auth/google → verifies Google ID token → checks ADMIN_EMAIL env var

## JWT
- Signed with SESSION_SECRET (must be set on Render)
- 24h expiry
- Payload: { role, method, email? }
- Stored in localStorage as `aegis_session`

## Env vars required on Render
- SESSION_SECRET — JWT signing secret
- ADMIN_EMAIL — allowed Google email (e.g. copy2723@gmail.com)
- GOOGLE_CLIENT_ID — public OAuth client ID (hardcoded fallback exists but env var preferred)
- AEGIS_ADMIN_KEY — already set

## Google Console
- Authorized JavaScript origins must include Vercel production URL
- No redirect URIs needed (popup/ID-token flow)
- GSI_LOGGER origin error is expected on Replit dev — only works on Vercel

## Security rules applied
- Error messages are generic: "Access denied" — never reveal the allowed email
- ADMIN_EMAIL stored in env var only, not in source code
- Source maps disabled in Vite production build (minify: "esbuild", sourcemap: false)

**Why:** Admin email in source code / error messages leaks who is authorised.
**How to apply:** Any new restricted resource check should return generic 403 with no identifying info.
