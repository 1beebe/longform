# Longform

Plan a long-form piece around your Buffer queue. Connect Buffer and pick your draft in Google Docs; Longform finds an open day to publish, suggests supporting posts that summarize or rephrase your draft, and saves the ones you keep to Buffer as dated drafts, next to a publish-day placeholder that links back to the doc. Nothing publishes on its own.

**Try it at [longform.lbeebe.com](https://longform.lbeebe.com).** Connect Buffer and pick a draft. No draft handy? Use the sample piece, Thoreau's public-domain essay "Walking".

This README is for people reviewing how it works and for builders running their own copy.

## How it works

- **Sign-in:** Buffer OAuth 2.0 with PKCE (S256), scopes `account:read posts:read posts:write offline_access`. Tokens, the doc text and the plan are AES-GCM encrypted in KV for up to 30 days; signing out deletes them.
- **Doc:** Connect Google (OAuth with PKCE, scope `drive.file` only) and pick the draft in Google's file picker; the server reads it through the Drive export as HTML, and h1 to h3 become sections. `drive.file` means the app can open only files the person picks. Fallbacks: a link shared as "anyone with the link can view", pasted text, or the bundled sample piece. Without the Google settings the app shows only the fallbacks.
- **Queue:** scheduled posts and dated drafts for six weeks from this Monday, via `posts(input: { filter: { status, dueAt: { start, end } } })`. Falls back to paging by status if the date filter is ever refused.
- **Gap finder** (`src/plan.ts`, no AI): scores days 3 to 30 days out by posts that day and the two days either side, Tuesday to Thursday first, weekends last. Places two teasers before, the launch post on the day, a pull-quote and key idea after, and a follow-up a week later, never two on one channel on one day. The "why" sentence is written from the queue data. Click a day on the calendar to jump to it, or drag the ★ to move the publish day; unsaved posts move with it.
- **Suggestions** (`src/suggest.ts`): Claude Sonnet via MindStudio (`MINDSTUDIO_API_KEY`) or the Anthropic API (`ANTHROPIC_API_KEY`). Posts may only summarize or rephrase the draft, and speak as its author, never about "the writer" or "the author" (a public-domain piece is attributed by name). The guard (`src/guard.ts`) checks that the supporting quote appears in the doc, rejects bare excerpts, and rejects posts that add numbers, first person or questions the draft doesn't have, stock takeaways ("the lesson", "here's the thing"), or too many content words the draft never uses. Posts that pass then go through a second model call that flags any claim, opinion, experience, takeaway or question the draft doesn't support. A failing post is retried once with the reason, then dropped. "Ask for changes" runs through the same guard.
- **Save:** one `createPost` per ticked card with `mode: customScheduled`, `dueAt` in the account timezone and `saveToDraft: true`, plus a publish-day placeholder draft on the channel you pick (Substack first, then LinkedIn). The done screen links to each channel's drafts in Buffer. A saved draft you later delete in Buffer goes back to unsaved in the plan.
- Guard rails: 20 model calls per person an hour, 400 app-wide a day (`DAILY_MODEL_CALLS`).
- Security: Buffer and Google OAuth both use PKCE with a `state` pinned to the browser by a short-lived cookie; the session cookie is HttpOnly, Secure and SameSite=Lax; every POST must come from the app's own origin; a different Buffer account signing in on the same browser starts a new session. Pages send a CSP, HSTS, `nosniff`, `frame-ancestors 'none'` and a Permissions-Policy.

## Setup

1. **Buffer:** the app client "Longform" exists (redirect `https://longform.lbeebe.com/callback`). Its client ID is in `wrangler.toml`.
2. **Cloudflare:** create a KV namespace (e.g. `longform-sessions`) and put its id in `wrangler.toml`. Create a Worker from this repo, add the custom domain `longform.lbeebe.com`, and set the secrets `BUFFER_CLIENT_SECRET`, `TOKEN_KEY` (`openssl rand -base64 32`) and `MINDSTUDIO_API_KEY` (or `ANTHROPIC_API_KEY`).
3. **Google (optional, turns on the picker):** in a Google Cloud project, enable the Google Drive API and Google Picker API; set up the OAuth consent screen (External, scope `.../auth/drive.file`); create an OAuth client of type Web application with redirect `https://longform.lbeebe.com/google/callback` and JavaScript origin `https://longform.lbeebe.com`; create an API key restricted to the Picker API and that site. Put the client ID and the project number in `wrangler.toml` (`GOOGLE_CLIENT_ID`, `GOOGLE_APP_ID`), and the client secret and API key in Cloudflare as secrets (`GOOGLE_CLIENT_SECRET`, `GOOGLE_PICKER_KEY`).
4. `npm install && npm run check`, then deploy.

`npm run preview` serves the front end on :8788 with fixture data (no Buffer, no AI) for layout work. `STATE=out` shows the landing page, `STATE=nodoc` the draft step, and `DEMO=1` swaps the bracketed fixtures for a public-domain draft (Thoreau's "Walking"). The landing page's screenshots in `public/shots/` are taken from `DEMO=1`, so they show the real app without anyone's private queue or writing.

Made by Ligaya Beebe (L. Beebe, LLC). Not affiliated with Buffer or Google.
