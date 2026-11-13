const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const MARK = `<svg class="mark" viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="5" width="26" height="23" rx="6" fill="#4f46e5"/><rect x="3" y="5" width="26" height="7" rx="3" fill="#1b2133"/><rect x="9" y="17" width="6" height="6" rx="1.5" fill="#fff"/></svg>`;

function shell(name: string, title: string, main: string, script = true): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="Plan your long-form piece around your Buffer queue, with posts pulled from your own draft.">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/app.css">
</head>
<body>
<header class="top">
  <a class="brand" href="/">${MARK}<b>${esc(name)}</b><span class="ctx">Long-form planner</span></a>
  <span class="r" id="who"></span>
</header>
${main}
<footer class="foot"><a href="/privacy">Privacy</a><span>Not affiliated with Buffer or Google.</span></footer>
${script ? `<script src="/app.js" defer></script>` : ""}
</body>
</html>`;
}

export function appPage(name: string): string {
  return shell(name, `${name} · plan your long-form`, `<main id="app" data-name="${esc(name)}"><p class="loading">Loading…</p></main><div id="dock-slot"></div>`);
}

export function privacyPage(name: string): string {
  return shell(name, `Privacy · ${name}`, `<main class="prose">
<h1>Privacy</h1>
<p>${esc(name)} is run by L. Beebe, LLC. It reads your Buffer queue and a Google Doc you choose, suggests posts from your draft, and saves the ones you approve to Buffer as drafts. It never publishes anything.</p>
<h2>What it keeps</h2>
<p>Your Buffer sign-in tokens, the doc's text and your current plan are stored encrypted for up to 30 days so you can come back to the plan. Signing out deletes them. Your queue is read from Buffer each time and isn't stored.</p>
<h2>Who sees your draft</h2>
<p>To suggest posts, the doc's text is sent to an AI model (Anthropic's Claude, reached directly or through MindStudio). It isn't shared with anyone else or sold.</p>
<h2>Your Google Doc</h2>
<p>If you connect Google, the app asks only for permission to open files you pick in Google's file picker. It can't see the rest of your Drive, and it never changes the doc. Signing out disconnects Google. You can also paste a link to a doc shared as "anyone with the link can view", or paste the text.</p>
<h2>Questions</h2>
<p>Write to L. Beebe, LLC through <a href="https://lbeebe.com">lbeebe.com</a>.</p>
<p><a href="/">Back to the planner</a></p>
</main>`, false);
}
