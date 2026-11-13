# Longform

Plan a long-form piece around your Buffer queue. Paste a Google Doc link and connect Buffer; Longform finds an open day to publish, suggests supporting posts pulled from your own sentences, and saves the ones you keep to Buffer as dated drafts, next to a publish-day placeholder that links back to the doc. Nothing publishes on its own.

Working name. Separate product from The Interviewer.

## How it works

- **Sign-in:** Buffer OAuth 2.0 with PKCE (S256), scopes `account:read posts:read posts:write offline_access`. Tokens, the doc text and the plan are AES-GCM encrypted in KV for up to 30 days; signing out deletes them.
- **Doc:** a Google Docs link shared as "anyone with the link can view" (or a "Publish to the web" link), read through Google's HTML export. h1 to h3 become sections. There's a paste-the-text fallback. Google sign-in is a later step.
- **Queue:** scheduled posts and dated drafts for six weeks from this Monday, via `posts(input: { filter: { status, dueAt: { start, end } } })`. Falls back to paging by status if the date filter is ever refused.
- **Gap finder** (`src/plan.ts`, no AI): scores days 3 to 30 days out by posts that day and the two days either side, Tuesday to Thursday first, weekends last. Places two teasers before, the launch post on the day, a pull-quote and key idea after, and a follow-up a week later, never two on one channel on one day. The "why" sentence is written from the queue data.
- **Suggestions** (`src/suggest.ts`): Claude Sonnet via MindStudio (`MINDSTUDIO_API_KEY`) or the Anthropic API (`ANTHROPIC_API_KEY`). The own-words guard (`src/guard.ts`) requires the source quote to appear in the doc word for word and at least 65% of the post's 3-word sequences to come from the doc. A failing post is retried once with "stay closer", then dropped. "Ask for changes" runs through the same guard.
- **Save:** one `createPost` per ticked card with `mode: customScheduled`, `dueAt` in the account timezone and `saveToDraft: true`, plus a publish-day placeholder draft on the channel you pick (Substack first, then LinkedIn).
- Guard rails: 20 model calls per person an hour, 400 app-wide a day (`DAILY_MODEL_CALLS`).

## Setup

1. **Buffer:** the app client "Longform" exists (redirect `https://longform.lbeebe.com/callback`). Its client ID is in `wrangler.toml`.
2. **Cloudflare:** create a KV namespace (e.g. `longform-sessions`) and put its id in `wrangler.toml`. Create a Worker from this repo, add the custom domain `longform.lbeebe.com`, and set the secrets `BUFFER_CLIENT_SECRET`, `TOKEN_KEY` (`openssl rand -base64 32`) and `MINDSTUDIO_API_KEY` (or `ANTHROPIC_API_KEY`).
3. `npm install && npm run check`, then deploy.

`npm run preview` serves the front end on :8788 with fixture data (no Buffer, no AI) for layout work.

Not affiliated with Buffer or Google.
