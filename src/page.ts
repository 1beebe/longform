const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// The mark: a page whose lines get shorter, like a long piece trimmed into posts.
const MARK = `<svg class="mark" viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="8" fill="var(--accent)"/><rect x="8" y="9" width="16" height="3" rx="1.5" fill="var(--accent-ink)"/><rect x="8" y="14.5" width="12" height="3" rx="1.5" fill="var(--accent-ink)"/><rect x="8" y="20" width="7" height="3" rx="1.5" fill="var(--accent-ink)"/></svg>`;

const DESCRIPTION = "Buffer can't publish long-form. Longform puts your article on your Buffer calendar and lines up short posts from it, saved as drafts.";
const SITE = "https://longform.lbeebe.com";

function shell(name: string, title: string, main: string, opts: { script?: boolean; nav?: string } = {}): string {
  const script = opts.script ?? true;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${DESCRIPTION}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(name)}">
<meta property="og:url" content="${SITE}/">
<meta property="og:title" content="${esc(name)}: your long-form piece, in your Buffer queue">
<meta property="og:description" content="${DESCRIPTION}">
<meta property="og:image" content="${SITE}/og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(name)}: a calendar of a Buffer queue with the long-form publish day starred and short posts placed on the open days around it.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(name)}: your long-form piece, in your Buffer queue">
<meta name="twitter:description" content="${DESCRIPTION}">
<meta name="twitter:image" content="${SITE}/og.jpg">
<meta name="theme-color" content="#f7f9fa" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0e1a1f" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/fonts/instrument-sans.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<a class="skip" href="#app">Skip to content</a>
<header class="top">
  <a class="brand" href="/">${MARK}<b>${esc(name)}</b></a>
  <span class="r" id="who">${opts.nav ?? ""}</span>
</header>
${main}
<footer class="foot"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><span>Made by L. Beebe, LLC</span><span>Not affiliated with Buffer or Google.</span></footer>
${script ? `<script src="/app.js" defer></script>` : ""}
</body>
</html>`;
}

// The landing page doubles as the first onboarding step. It is rendered on the
// server so a visitor sees it at once; app.js hides it for signed-in people.
// Lines marked VOICE are working copy for Ligaya to replace with her own words.
function landing(name: string, show: boolean): string {
  const n = esc(name);
  return `<div id="landing" class="landing"${show ? "" : " hidden"}>
<section class="l-hero" aria-labelledby="l-h1">
  <div class="l-wrap l-hero-grid">
    <div class="l-copy" data-enter>
      <!-- VOICE: headline and sub-line are working copy. -->
      <h1 id="l-h1">Launch planner for long&#8209;form writers</h1>
      <p class="l-sub">Pick your draft in Google Docs. ${n} finds a quiet day in your Buffer queue to publish it and lines up posts around that day, each one rephrased from your piece.</p>
      <div id="l-banners"></div>
      <div class="l-actions">
        <a class="btn" href="/connect">Connect Buffer</a>
        <a class="btn ghost" href="#how">See the three steps</a>
      </div>
      <p class="fine">Everything saves to Buffer as a draft. Nothing posts on its own.</p>
      <p class="fine">By connecting, you agree to the <a href="/terms">Terms</a> and <a href="/privacy">Privacy note</a>.</p>
    </div>
    <figure class="frame l-shot" data-enter style="--d:120ms">
      <div class="frame-bar" aria-hidden="true"><i></i><i></i><i></i><span>${n}</span></div>
      <picture>
        <source media="(max-width: 700px)" srcset="/shots/agenda.webp" width="780" height="1120">
        <img src="/shots/calendar.webp" width="1800" height="1095" alt="The ${n} planner: a four-week calendar of a Buffer queue with a suggested publish day marked by a star and suggested posts placed on the open days around it.">
      </picture>
    </figure>
  </div>
</section>

<section class="l-problem" aria-labelledby="l-problem-h">
  <div class="l-wrap">
    <!-- VOICE: the problem statement. Replace with how you'd say it. Ligaya named two problems:
         promoting the piece, and not seeing long-form pieces in the Buffer queue (covered in .l-queue below). -->
    <h2 id="l-problem-h">Writing the piece is half the work. <span>Getting it read is the other half.</span></h2>
    <p>Promoting a long piece means rereading your own draft, pulling lines for each channel and finding days your queue isn't already full. ${n} does that part, from what you already wrote.</p>
  </div>
</section>

<section class="l-how" id="how" aria-labelledby="l-how-h">
  <div class="l-wrap">
    <h2 id="l-how-h">How it works, in three steps</h2>
    <ol class="l-steps">
      <li>
        <figure class="frame"><img src="/shots/step-queue.webp" width="1200" height="759" loading="lazy" alt="Two cards: a Google Doc with its word count and sections, and the Buffer queue with four channels and eleven posts queued."></figure>
        <span class="num">1</span>
        <h3>Connect Buffer</h3>
        <p>It reads the next six weeks of your queue, so it can see which days are already busy.</p>
      </li>
      <li>
        <figure class="frame"><img src="/shots/step-doc.webp" width="1200" height="759" loading="lazy" alt="The draft step: a Choose from Google Drive button, with options to use a share link or paste the text instead."></figure>
        <span class="num">2</span>
        <h3>Choose your draft in Google Docs</h3>
        <p>Pick it in Google's file picker. The app can open only that doc, and it never edits it.</p>
      </li>
      <li>
        <figure class="frame"><img src="/shots/step-posts.webp" width="1200" height="759" loading="lazy" alt="Suggested post cards, each with its date, channel, the line from the draft it came from, and an editable text box."></figure>
        <span class="num">3</span>
        <h3>Keep the posts you like</h3>
        <p>Edit, move or untick any post, then save. They land in Buffer as drafts on their dates.</p>
      </li>
    </ol>
  </div>
</section>

<section class="l-queue" aria-labelledby="l-queue-h">
  <div class="l-wrap l-queue-grid">
    <div class="l-stack">
      <figure class="frame"><img src="/shots/pubweek.webp" width="1400" height="682" loading="lazy" alt="The planner calendar with the long-form piece starred on its publish day, between posts already in the Buffer queue and the suggested posts."></figure>
      <figure class="frame"><img src="/shots/placeholder.webp" width="700" height="494" loading="lazy" alt="The publish-day placeholder card: a dated draft saved on a chosen Buffer channel that holds the piece's place and links back to the doc."></figure>
    </div>
    <div>
      <h2 id="l-queue-h">Your long-form piece, in your Buffer queue</h2>
      <p>On publish day, ${n} saves a dated draft to Buffer that names the piece and links to your doc. Your social posts and your article show up on one calendar.</p>
      <p class="note"><b>It's a placeholder, not a post.</b> Buffer won't publish it. You still publish the article yourself on LinkedIn, Substack or your newsletter.</p>
    </div>
  </div>
</section>

<section class="l-own" aria-labelledby="l-own-h">
  <div class="l-wrap l-own-grid">
    <div>
      <h2 id="l-own-h">Every post comes from your draft.</h2>
      <p>Posts only summarize or rephrase what your piece says. A second check throws out any post that adds an opinion, a number or an experience your draft doesn't have.</p>
      <ul class="l-facts">
        <li>Each post shows the line it came from.</li>
        <li>Nothing publishes until you approve it in Buffer.</li>
        <li>Signing out deletes your draft and plan.</li>
      </ul>
    </div>
    <figure class="frame"><img src="/shots/post.webp" width="742" height="896" loading="lazy" alt="One suggested post for LinkedIn, with the quoted line from the draft above the rephrased text."></figure>
  </div>
</section>

<section class="l-close" aria-labelledby="l-close-h">
  <div class="l-wrap">
    <h2 id="l-close-h">Plan the launch of your next piece</h2>
    <p>Sign in with Buffer, then pick your draft. No draft handy? You can try it on a sample piece.</p>
    <a class="btn" href="/connect">Connect Buffer</a>
    <p class="fine">By connecting, you agree to the <a href="/terms">Terms</a> and <a href="/privacy">Privacy note</a>.</p>
  </div>
</section>
</div>`;
}

export function appPage(name: string, signedOut = false): string {
  const nav = signedOut ? `<a class="btn small" href="/connect">Connect Buffer</a>` : "";
  return shell(name, `${name} · plan the launch of your long-form`,
    `${landing(name, signedOut)}<main id="app" data-name="${esc(name)}"${signedOut ? " hidden" : ""}><p class="loading">Loading…</p></main><div id="dock-slot"></div>`,
    { nav });
}

export function privacyPage(name: string): string {
  const n = esc(name);
  return shell(name, `Privacy · ${name}`, `<main class="prose">
<h1>Privacy</h1>
<p>Last updated November 13, 2026. ${n} is run by L. Beebe, LLC. It reads your Buffer queue and a draft you choose, suggests posts from your draft, and saves the ones you approve to Buffer as drafts. It never publishes or schedules anything.</p>
<h2>What it keeps</h2>
<p>Your Buffer sign-in tokens, the draft's text and your current plan are stored encrypted for up to 30 days so you can come back to the plan. Signing out deletes them. Your queue is read from Buffer each time and isn't stored. To keep usage fair, your session also holds the times of your AI requests in the last hour, and the app keeps one daily count of AI requests for everyone, with no account attached, which expires after two days.</p>
<h2>What it does with your Buffer account</h2>
<p>It reads your account, channels and the next six weeks of scheduled posts and drafts, and it creates dated drafts only for the posts you tick, plus one placeholder draft on publish day. It never publishes, schedules or deletes anything in Buffer.</p>
<h2>Who sees your draft</h2>
<p>To suggest posts, the draft's text is sent to an AI model (Anthropic's Claude, reached directly or through MindStudio). The app runs on Cloudflare. Your draft isn't shared with anyone else or sold.</p>
<h2>Your Google Doc</h2>
<p>If you connect Google, the app asks only for permission to open files you pick in Google's file picker. It can't see the rest of your Drive, and it never changes the doc. Signing out disconnects Google. You can also paste a link to a doc shared as "anyone with the link can view", paste the text, or try the sample piece.</p>
<h2>Questions and deletion</h2>
<p>Sign out to delete what the app keeps. For anything else, write to L. Beebe, LLC through <a href="https://lbeebe.com">lbeebe.com</a>. See also the <a href="/terms">Terms</a>.</p>
<p><a href="/">Back to the planner</a></p>
</main>`, { script: false });
}

export function termsPage(name: string): string {
  const n = esc(name);
  return shell(name, `Terms · ${name}`, `<main class="prose">
<h1>Terms of use</h1>
<p>Last updated November 13, 2026. ${n} is run by Ligaya Beebe through L. Beebe, LLC, in Florida. It's built on the Buffer API, but it isn't made by, affiliated with or endorsed by Buffer or Google.</p>
<h2>Agreeing to these terms</h2>
<p>By connecting Buffer, you agree to these terms and to the <a href="/privacy">Privacy note</a>, which says what the app keeps and for how long. If you don't agree, don't connect. You need to be 18 or older, or the age of majority where you live.</p>
<h2>Your writing stays yours</h2>
<p>You own your draft and the posts made from it. You let the app process your draft only to run the service: to send it to the AI services named on the Privacy note, and to save the posts you choose to your own Buffer account. Only use drafts you have the right to share.</p>
<h2>AI suggestions are yours to check</h2>
<p>Suggested posts are AI-assisted. They're limited to summarizing or rephrasing your draft, and they can still get things wrong. Read every post before you publish it. You're responsible for what you publish. The app saves drafts to Buffer and never publishes or schedules anything for you.</p>
<h2>Using it fairly</h2>
<p>Don't use the app to break the law, harass anyone, infringe someone else's rights, send spam, or attack or overload the service. Don't try to get around its usage limits. Your use of Buffer, Google and each social network also follows their own terms.</p>
<h2>Other services</h2>
<p>The app relies on Buffer, Google, MindStudio and Anthropic, and on Cloudflare to host it. Each has its own terms, and the app can only be as available as they are.</p>
<h2>No guarantees</h2>
<p>${n} is free and provided as is, without warranties of any kind. It has usage limits, and it may change, pause or end at any time. Access may be suspended for anyone who misuses it.</p>
<h2>Limits on liability</h2>
<p>As far as the law allows, L. Beebe, LLC isn't liable for indirect or consequential losses, lost data or lost profits, or for anything you publish. Its total liability for any claim is limited to fifty US dollars.</p>
<h2>Changes</h2>
<p>If these terms change, the date at the top changes too. Using the app after a change means you accept the new terms.</p>
<h2>Law and contact</h2>
<p>These terms are governed by the laws of Florida, USA. For questions, write to L. Beebe, LLC through <a href="https://lbeebe.com">lbeebe.com</a>.</p>
<p><a href="/">Back to the planner</a></p>
</main>`, { script: false });
}
