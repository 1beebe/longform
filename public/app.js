// Longform: the whole front end. Every string from Buffer, the doc or the AI
// goes into the page as text, never as HTML.
(() => {
  const app = document.getElementById("app");
  const dockSlot = document.getElementById("dock-slot");
  const NAME = app.dataset.name || "Longform";

  const COLORS = { linkedin: "#2f5f8f", twitter: "#2b2b2b", threads: "#6b4a8a", instagram: "#b04a6a", bluesky: "#1d7bd8", mastodon: "#5b4bd6", facebook: "#3b5bb5", substack: "#e0691a" };
  const ROLE = { teaser: "Teaser", launch: "Launch post", pullquote: "Pull-quote", keyidea: "Key idea", followup: "Follow-up" };
  const ROLE_SHORT = { teaser: "teaser", launch: "launch", pullquote: "pull-quote", keyidea: "key idea", followup: "follow-up" };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const ERRORS = {
    denied: "Buffer sign-in was cancelled.",
    state: "That sign-in link expired or came from another browser. Try again.",
    expired: "That sign-in took too long. Try again.",
    signin: "Buffer didn't finish the sign-in. Try again.",
    "google-off": "Google sign-in isn't switched on yet. Use a share link for now.",
    "google-denied": "Google sign-in was cancelled.",
    "google-scope": "Google didn't give access to pick files. Connect again and leave the Drive box ticked.",
    google: "Google didn't finish the sign-in. Try again.",
  };

  let me = null; // the server's view: doc, plan, board
  const ui = { week: 0, picking: false, busy: "", error: "", notice: "", edits: {}, ask: null, move: null, placeholder: null, pickChannels: false, justSaved: null };

  // ---- small helpers ----
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "value") el.value = v;
      else if (k === "checked") el.checked = Boolean(v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
    return el;
  }
  const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const dow = (d) => (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;
  const short = (d) => `${MONTHS[+d.slice(5, 7) - 1]} ${+d.slice(8)}`;
  const longish = (d) => `${DOW[dow(d)]}, ${short(d)}`;
  const label = (svc) => ({ twitter: "X", linkedin: "LinkedIn", threads: "Threads", bluesky: "Bluesky", mastodon: "Mastodon", facebook: "Facebook", instagram: "Instagram", substack: "Substack" })[svc] || svc;
  const dot = (svc) => h("span", { class: "d", style: `background:${COLORS[svc] || "#888"}` });

  async function call(path, body) {
    const res = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let data = {};
    try { data = await res.json(); } catch { /* empty */ }
    if (res.status === 401 && data.google && me) { me.google = { ...(me.google || {}), connected: false }; }
    if (res.status === 401 && data.reconnect) { me = { signedIn: false }; ui.error = data.error || ""; render(); throw new Error("signed out"); }
    if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");
    return data;
  }

  // The plan's posts with this browser's unsaved edits on top.
  function cards() {
    const p = me && me.plan;
    if (!p) return [];
    return p.suggestions.map((s) => ({ ...s, ...(s.bufferId ? {} : ui.edits[s.slot] || {}) })).sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot);
  }
  function placeholder() {
    const p = me.plan.placeholder;
    return { ...p, ...(p.bufferId ? {} : ui.placeholder || {}) };
  }
  const edit = (slot, patch) => { ui.edits[slot] = { ...(ui.edits[slot] || {}), ...patch }; };

  // ---- Google Drive picker ----
  let gapiLoaded = null;
  function loadPicker() {
    if (gapiLoaded) return gapiLoaded;
    gapiLoaded = new Promise((resolve, reject) => {
      const tag = document.createElement("script");
      tag.src = "https://apis.google.com/js/api.js";
      tag.onload = () => window.gapi.load("picker", { callback: resolve, onerror: reject });
      tag.onerror = () => { gapiLoaded = null; reject(new Error("Google's file picker didn't load. Check your connection and try again.")); };
      document.head.append(tag);
    });
    return gapiLoaded;
  }

  async function useDoc(payload) {
    ui.busy = "doc"; ui.error = ""; render();
    try { await call("/api/doc", payload); ui.busy = ""; ui.edits = {}; ui.justSaved = null; await load(); suggestIfReady(); }
    catch (e) { ui.busy = ""; ui.error = e.message; render(); }
  }

  async function openPicker() {
    ui.error = "";
    try {
      const t = await call("/api/google/token", {});
      await loadPicker();
      const g = window.google.picker;
      const view = new g.DocsView(g.ViewId.DOCUMENTS).setMode(g.DocsViewMode.LIST).setIncludeFolders(false);
      new g.PickerBuilder()
        .addView(view)
        .setOAuthToken(t.accessToken)
        .setDeveloperKey(t.pickerKey)
        .setAppId(t.appId)
        .setOrigin(location.origin)
        .setTitle("Choose your draft")
        .setCallback((data) => {
          if (data.action === g.Action.PICKED && data.docs && data.docs[0]) useDoc({ fileId: data.docs[0].id });
        })
        .build()
        .setVisible(true);
    } catch (e) { ui.error = e.message; render(); }
  }

  function googleButton(label) {
    if (!me.google || !me.google.ready) return null;
    return me.google.connected
      ? h("button", { class: "btn", type: "button", disabled: ui.busy === "doc", onclick: openPicker }, ui.busy === "doc" ? "Reading…" : label || "Choose from Google Drive")
      : h("a", { class: "btn", href: "/google/connect" }, "Connect Google Docs");
  }

  const ago = (iso) => {
    const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (!(m >= 0)) return "";
    if (m < 2) return "edited just now";
    if (m < 60) return `edited ${m} minutes ago`;
    const hrs = Math.round(m / 60);
    if (hrs < 24) return `edited ${hrs} hour${hrs === 1 ? "" : "s"} ago`;
    const d = Math.round(hrs / 24);
    return `edited ${d} day${d === 1 ? "" : "s"} ago`;
  };

  // ---- screens ----
  function render() {
    const scrollY = window.scrollY;
    const focus = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.key;
    app.replaceChildren();
    dockSlot.replaceChildren();
    renderWho();
    if (!me || !me.signedIn) landing();
    else if (!me.doc) chooseDoc();
    else planner();
    if (focus) { const el = app.querySelector(`[data-key="${focus}"]`); if (el) el.focus(); }
    window.scrollTo(0, scrollY);
  }

  function renderWho() {
    const who = document.getElementById("who");
    who.replaceChildren();
    if (!me || !me.signedIn) return;
    if (me.orgs && me.orgs.length > 1) {
      who.append(h("select", { class: "pill", "aria-label": "Buffer organization", onchange: async (e) => { await call("/api/org", { id: e.target.value }); await load(); } },
        me.orgs.map((o) => h("option", { value: o.id, selected: o.id === me.organizationId }, o.name))));
    }
    const form = h("form", { method: "post", action: "/logout" }, h("button", { class: "linkish", type: "submit" }, "Sign out"));
    who.append(form);
  }

  function banners() {
    return [ui.error && h("p", { class: "banner", role: "alert" }, ui.error), ui.notice && h("p", { class: "banner ok", role: "status" }, ui.notice)].filter(Boolean);
  }

  function landing() {
    app.append(h("section", { class: "hero" },
      h("h1", null, "Plan your long-form"),
      h("p", { class: "lead" }, "Bring in your draft from Google Docs and your queue from Buffer. We find an open day to publish and suggest posts around it, pulled from what you wrote."),
      banners(),
      h("a", { class: "btn", href: "/connect" }, "Connect Buffer"),
      h("p", { class: "fine" }, "Nothing posts on its own. Suggestions save to Buffer as drafts you approve there."),
    ));
    app.append(h("ol", { class: "steps" },
      h("li", null, h("i", null, "1"), h("b", null, "Connect Buffer"), h("span", null, "We read what's already queued for the next few weeks.")),
      h("li", null, h("i", null, "2"), h("b", null, "Paste your Google Doc link"), h("span", null, "The draft you're about to publish, shared as “anyone with the link.”")),
      h("li", null, h("i", null, "3"), h("b", null, "Pick a day, keep the posts you like"), h("span", null, "They save as drafts on their dates, next to a placeholder for the piece itself.")),
    ));
  }

  function chooseDoc() {
    const url = h("input", { class: "field", type: "url", placeholder: "https://docs.google.com/document/d/…", "aria-label": "Google Doc link", "data-key": "doc-url" });
    const title = h("input", { class: "field", type: "text", placeholder: "Title (optional)", "aria-label": "Title" });
    const text = h("textarea", { class: "field", placeholder: "Paste the whole draft. Lines starting with # become sections.", "aria-label": "Draft text" });
    const google = me.google && me.google.ready;
    const linkForm = h("form", { class: "row", onsubmit: (e) => { e.preventDefault(); useDoc({ url: url.value }); } },
      url, h("button", { class: google ? "btn dark" : "btn", type: "submit", disabled: ui.busy === "doc" }, ui.busy === "doc" && !google ? "Reading…" : "Use this doc"));
    const linkHelp = h("p", null, "In Google Docs, click Share and set General access to \u201cAnyone with the link can view.\u201d Then copy the link and paste it here.");
    app.append(
      h("h1", null, "Plan your long-form"),
      h("p", { class: "lead" }, `Connected to Buffer${me.org ? ` (${me.org})` : ""}. Now the draft.`),
      ...banners(),
      h("section", { class: "card pick" },
        h("h2", null, "Choose your Google Doc"),
        google
          ? [h("p", null, me.google.connected
              ? "Pick the draft from your Drive. The app can open only the doc you pick, and it never changes it."
              : "Connect Google, then pick the draft from your Drive. The app can open only the doc you pick, and it never changes it."),
            h("div", { class: "row" }, googleButton()),
            me.google.connected ? h("p", { class: "hint" }, h("button", { class: "linkish", onclick: async () => { await call("/api/google/disconnect", {}); await load(); } }, "Disconnect Google")) : null,
            h("details", null, h("summary", null, "Use a share link instead"), linkHelp, linkForm)]
          : [linkHelp, linkForm],
        h("details", null, h("summary", null, "Paste the text instead"),
          h("form", { onsubmit: (e) => { e.preventDefault(); useDoc({ text: text.value, title: title.value }); } },
            h("div", { class: "row" }, title), h("div", { class: "row" }, text),
            h("div", { class: "row" }, h("button", { class: "btn dark", type: "submit", disabled: ui.busy === "doc" }, "Use this text")))),
      ),
    );
  }

  function planner() {
    const b = me.board;
    const p = me.plan;
    app.append(h("h1", null, "Plan your long-form"),
      h("p", { class: "lead" }, "Your draft from Google Docs, your queue from Buffer. Click any day on the calendar to make it the publish day."),
      ...banners());
    app.append(sources(b));
    if (!b) return;
    app.append(h("section", { class: "grid" }, calendarCard(b, p), side(b, p)));
    if (p) {
      if (ui.justSaved) app.append(doneCard());
      app.append(postsSection(b, p));
      dock(p);
    }
  }

  function sources(b) {
    const d = me.doc;
    const mins = Math.max(1, Math.round(d.words / 230));
    const queued = b ? b.queue.filter((q) => q.status !== "draft" && q.date >= b.today && q.date <= addDays(b.today, 28)).length : 0;
    const selected = b ? b.channels.filter((c) => c.selected) : [];
    const docCard = h("div", { class: "src" },
      h("div", { class: "ic g" }, "G"),
      h("div", { class: "body" },
        h("h3", null, d.title),
        h("p", null, [d.url ? "Google Doc" : "Pasted draft", d.modifiedTime ? ago(d.modifiedTime) : "", `${d.words.toLocaleString()} words`].filter(Boolean).join(" · ")),
        h("div", { class: "meta" }, d.url && h("span", { class: "chip ok" }, d.picked ? "Connected to Google" : "Read from your link"), h("span", { class: "chip" }, `${d.sections.length} section${d.sections.length === 1 ? "" : "s"}`), h("span", { class: "chip" }, `~${mins} min read`))),
      h("div", { class: "act" },
        d.picked && me.google && me.google.connected
          ? h("button", { class: "linkish", onclick: () => { if (!me.plan || confirm("Pick another doc? This clears the current plan.")) openPicker(); } }, ui.busy === "doc" ? "Reading…" : "Change doc")
          : h("button", { class: "linkish", onclick: () => { if (me.plan && !confirm("Change the doc? This clears the current plan.")) return; me.doc = null; me.plan = null; ui.edits = {}; render(); } }, "Change doc"),
        d.picked && me.google && me.google.connected ? [" · ", h("button", { class: "linkish", title: "Read the doc again from Google", onclick: () => { if (!me.plan || confirm("Read the doc again? This clears the current plan.")) useDoc({ fileId: d.fileId || "" }); } }, "Refresh")] : null),
    );
    const bufCard = h("div", { class: "src" },
      h("div", { class: "ic b" }, "B"),
      h("div", { class: "body" },
        h("h3", null, "Your Buffer queue"),
        h("p", null, b ? `${selected.length} channel${selected.length === 1 ? "" : "s"} · next 4 weeks` : "Loading…"),
        h("div", { class: "meta" }, h("span", { class: "chip ok" }, "Signed in with Buffer"), b && h("span", { class: "chip" }, `${queued} post${queued === 1 ? "" : "s"} queued`)),
        ui.pickChannels && b && channelPicker(b)),
      b && h("button", { class: "linkish act", onclick: () => { ui.pickChannels = !ui.pickChannels; render(); } }, ui.pickChannels ? "Done" : "Channels"),
    );
    return h("section", { class: "sources" }, docCard, bufCard);
  }

  function channelPicker(b) {
    const boxes = b.channels.map((c) => h("label", null, h("input", { type: "checkbox", value: c.id, checked: c.selected }), dot(c.service), `${c.name} · ${c.label}`));
    const skipped = b.skipped.length ? h("p", { class: "hint" }, `Left out because they need images or video: ${b.skipped.map((c) => `${c.name} (${c.label})`).join(", ")}.`) : null;
    return h("div", null,
      h("div", { class: "chan-pick" }, boxes),
      skipped,
      h("div", { class: "row" }, h("button", { class: "pill", onclick: async (e) => {
        const ids = [...e.target.closest(".body").querySelectorAll("input:checked")].map((i) => i.value);
        try { await call("/api/channels", { ids }); ui.pickChannels = false; await load(); if (me.plan && confirm("Plan the posts again for these channels?")) runSuggest(); }
        catch (err) { ui.error = err.message; render(); }
      } }, "Use these channels")));
  }

  // ---- calendar ----
  function itemsByDay(b, p) {
    const by = {};
    const add = (d, x) => { (by[d] = by[d] || []).push(x); };
    for (const q of b.queue) add(q.date, { kind: "q", q });
    if (p) {
      add(p.publishDate, { kind: "p" });
      for (const c of cards()) add(c.date, { kind: "s", c });
    }
    return by;
  }

  function chip(x, b, phone) {
    if (x.kind === "p") return h("div", { class: "ev p" }, "★ Publish long-form");
    if (x.kind === "q") {
      const ch = b.channels.find((c) => c.id === x.q.channelId);
      const svc = ch ? ch.service : "";
      const what = x.q.status === "draft" ? "Draft" : "Queued";
      const text = phone ? `${what} · ${ch ? ch.label : "Buffer"}${x.q.text ? `: ${x.q.text}` : ""}` : x.q.text || `${what} post`;
      return h("div", { class: "ev q", title: `${what}${ch ? ` on ${ch.label}` : ""}: ${x.q.text || ""}` }, dot(svc), h("span", null, text));
    }
    const c = x.c;
    const text = phone ? `Suggested · ${ROLE[c.role]} on ${label(c.service)}` : ROLE[c.role];
    const cls = `ev s${c.bufferId ? " done" : ""}${c.included === false ? " off" : ""}`;
    const inner = [dot(c.service), h("span", null, c.bufferId ? `✓ ${text}` : text)];
    // While picking a publish day the whole cell is a button, so the chip stays plain.
    if (ui.picking) return h("div", { class: cls, title: `${ROLE[c.role]} on ${label(c.service)}` }, ...inner);
    return h("button", { class: `${cls} jump`, type: "button", title: `Go to the ${ROLE[c.role].toLowerCase()} for ${label(c.service)}`, onclick: () => jumpTo(c.slot) }, ...inner);
  }

  function jumpTo(slot) {
    const el = document.getElementById(`post${slot}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
  }

  function startPicking() {
    ui.picking = true; ui.notice = ""; render();
    document.getElementById("calendar").scrollIntoView({ behavior: "smooth" });
  }

  async function setPublishDay(date) {
    ui.picking = false;
    if (!me.plan || date === me.plan.publishDate) { render(); return; }
    ui.busy = "day"; ui.error = "";
    try {
      // Unsaved date moves are dropped: the posts move with the new day.
      for (const k of Object.keys(ui.edits)) delete ui.edits[k].date;
      me = { ...me, ...(await call("/api/publish-day", { date })) };
    } catch (e) { ui.error = e.message; }
    ui.busy = "";
    render();
  }

  function calendarCard(b, p) {
    const by = itemsByDay(b, p);
    const start = addDays(b.rangeStart, ui.week * 7);
    const end = addDays(start, 27);
    const tomorrow = addDays(b.today, 1);
    const gapFrom = addDays(b.today, 3), gapTo = addDays(b.today, 30);
    const cells = [];
    for (let i = 0; i < 28; i++) {
      const d = addDays(start, i);
      const items = by[d] || [];
      const past = d < tomorrow;
      const open = !past && dow(d) < 5 && d >= gapFrom && d <= gapTo && !items.some((x) => x.kind === "q");
      const cls = ["day", past && "out", d === b.today && "today", open && "gap", p && d === p.publishDate && "pub"].filter(Boolean).join(" ");
      const n = d.slice(8) === "01" || i === 0 ? short(d) : String(+d.slice(8));
      const shown = items.sort((a, c) => "pqs".indexOf(a.kind) - "pqs".indexOf(c.kind));
      const kids = [h("span", { class: "n" }, n), ...shown.slice(0, 4).map((x) => chip(x, b)), shown.length > 4 ? h("div", { class: "ev more" }, `+${shown.length - 4} more`) : null];
      cells.push(p && !past && ui.picking
        ? h("button", { class: `${cls} pickable`, type: "button", "aria-label": `Publish on ${longish(d)}`, onclick: () => setPublishDay(d) }, kids)
        : h("div", { class: cls }, kids));
    }
    const maxWeek = 2;
    return h("div", { class: "card", id: "calendar" },
      h("div", { class: "cal-h" }, h("h2", null, h("span", { class: "wide" }, `${short(start)} to ${short(end)}`), h("span", { class: "narrow" }, `Today to ${short(b.rangeEnd)}`)),
        h("div", { class: "nav" },
          h("button", { type: "button", "aria-label": "Earlier weeks", disabled: ui.week <= 0, onclick: () => { ui.week--; render(); } }, "‹"),
          h("button", { type: "button", "aria-label": "Later weeks", disabled: ui.week >= maxWeek, onclick: () => { ui.week++; render(); } }, "›"))),
      h("div", { class: "legend" }, h("span", null, h("i", { class: "q" }), "Already in your Buffer"), h("span", null, h("i", { class: "s" }), "Suggested post"), h("span", null, h("i", { class: "p" }), "Publish the long-form")),
      h("div", { class: "cal" }, DOW.map((x) => h("div", { class: "dow" }, x)), cells),
      agenda(b, p, by),
      p ? h("div", { class: "why" }, h("span", { "aria-hidden": "true" }, "💡"),
        h("span", null, ...whyParts(p.reason)),
        ui.picking
          ? h("button", { class: "linkish mv", onclick: () => { ui.picking = false; render(); } }, "Cancel")
          : h("button", { class: "linkish mv", onclick: startPicking }, "Pick another day"))
        : h("p", { class: "hint" }, "Your queue for the next six weeks. Plan the launch to see a suggested publish day."),
      ui.picking ? h("p", { class: "hint picking", role: "status" }, "Click the day you want to publish on. The posts move with it.") : null,
      ui.busy === "day" ? h("p", { class: "hint" }, "Moving the plan…") : null,
    );
  }

  function whyParts(reason) {
    const i = reason.indexOf(". ");
    return i < 0 ? [h("b", null, reason)] : [h("b", null, reason.slice(0, i + 1)), reason.slice(i + 1)];
  }

  // Phone: a day-by-day list from today, with empty runs folded into one row.
  function agenda(b, p, by) {
    const rows = [];
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const a = run[0], z = run[run.length - 1];
      rows.push(h("div", { class: "ag" },
        h("div", { class: "dt" }, run.length > 1 ? `${DOW[dow(a)]}–${DOW[dow(z)]}` : DOW[dow(a)], h("b", null, run.length > 1 ? `${+a.slice(8)}–${+z.slice(8)}` : +a.slice(8))),
        h("div", { class: "list" }, h("span", { class: "gapt" }, "Nothing queued"))));
      run = [];
    };
    for (let d = b.today; d <= b.rangeEnd; d = addDays(d, 1)) {
      const items = by[d] || [];
      if (!items.length && !(p && d === p.publishDate)) { run.push(d); continue; }
      flush();
      const pub = p && d === p.publishDate;
      const kids = [h("div", { class: "dt" }, DOW[dow(d)], h("b", null, d.slice(8) === "01" ? short(d) : +d.slice(8))), h("div", { class: "list" }, items.map((x) => chip(x, b, true)))];
      rows.push(p && d > b.today && ui.picking ? h("button", { class: `ag${pub ? " pub" : ""} pickable`, type: "button", onclick: () => setPublishDay(d) }, kids) : h("div", { class: `ag${pub ? " pub" : ""}` }, kids));
    }
    flush();
    return h("div", { class: "agenda" }, rows);
  }

  // ---- side column ----
  function side(b, p) {
    const hits = {};
    if (p) for (const c of cards()) if (c.sectionIndex) (hits[c.sectionIndex] = hits[c.sectionIndex] || []).push(ROLE_SHORT[c.role]);
    const channels = new Set((p ? p.suggestions : []).map((s) => s.channelId));
    const scanning = ui.busy === "suggest";
    return h("aside", { class: "side" },
      h("div", { class: "card" },
        h("h2", null, "What's in the draft"),
        h("ul", { class: "outline" }, me.doc.sections.map((s) => h("li", { class: hits[s.index] ? "hit" : null }, h("span", null, s.heading), hits[s.index] ? h("small", null, [...new Set(hits[s.index])].join(", ")) : null))),
        h("div", { class: "stat" },
          h("span", null, h("b", null, me.doc.sections.length), "sections"),
          h("span", null, h("b", null, p ? p.suggestions.length : 0), "posts suggested"),
          h("span", null, h("b", null, p ? channels.size : b.channels.filter((c) => c.selected).length), "channels"))),
      h("div", { class: "card scan" },
        h("h2", null, scanning ? "Scanning your draft…" : p ? "Scanned your draft" : "Ready to scan"),
        h("p", null, "The AI reads the doc and picks the lines that can stand alone. Every suggestion quotes your own words, so you can check where it came from."),
        h("div", { class: `bar${scanning ? " run" : ""}` }, h("i", { style: p || scanning ? null : "width:0" })),
        !me.aiReady ? h("p", null, "The AI step isn't switched on for this server yet.")
          : !scanning && h("button", { class: "btn", onclick: () => { if (!p || confirm("Plan again? Posts you haven't saved will be replaced.")) runSuggest(); } }, p ? "Plan again" : "Find a day and suggest posts")));
  }

  // ---- suggested posts ----
  function postsSection(b, p) {
    const list = cards();
    const ph = placeholder();
    const intro = "Each one is pulled from a section of your draft and placed around the publish day. Edit anything and untick what you don't want. They save to Buffer as drafts on those dates, so nothing posts until you approve it there.";
    const items = [];
    let placed = false;
    for (const c of list) {
      if (!placed && c.date >= p.publishDate) { items.push(placeholderCard(b, p, ph)); placed = true; }
      items.push(postCard(b, p, c));
    }
    if (!placed) items.push(placeholderCard(b, p, ph));
    return h("section", null,
      h("div", { class: "sug-h" }, h("h2", null, "Posts to go with it"), h("p", null, intro),
        me.dropped ? h("p", { class: "hint" }, `${me.dropped} suggestion${me.dropped === 1 ? "" : "s"} didn't stick close enough to your words, so ${me.dropped === 1 ? "it was" : "they were"} left out.`) : null),
      h("div", { class: "posts" }, items));
  }

  function placeholderCard(b, p, ph) {
    const ch = b.channels.find((c) => c.id === ph.channelId);
    const saved = Boolean(ph.bufferId);
    return h("article", { class: `post main${ph.included ? "" : " off"}${saved ? " saved" : ""}` },
      h("div", { class: "inc" },
        h("input", { type: "checkbox", id: "inc-ph", checked: ph.included, disabled: saved, onchange: (e) => { ui.placeholder = { ...(ui.placeholder || {}), included: e.target.checked }; render(); } }),
        h("label", { for: "inc-ph" }, "Include"), h("span", { class: "when" }, `${longish(p.publishDate)} ★`)),
      h("div", { class: "for" }, ch && dot(ch.service), "Publish-day placeholder"),
      h("div", { class: "from" }, "You publish the piece by hand. This dated draft holds its place in your Buffer calendar and links back to the doc."),
      h("label", { class: "hint", for: "ph-ch" }, "Save it on"),
      h("select", { id: "ph-ch", disabled: saved, onchange: (e) => { ui.placeholder = { ...(ui.placeholder || {}), channelId: e.target.value }; render(); } },
        b.channels.map((c) => h("option", { value: c.id, selected: c.id === ph.channelId }, `${c.name} · ${c.label}`))),
      saved ? h("p", { class: "ok" }, "✓ Saved to Buffer") : null,
      ph.error ? h("p", { class: "err" }, ph.error) : null);
  }

  function postCard(b, p, c) {
    const saved = Boolean(c.bufferId);
    const limit = (me.limits || {})[c.service] || 500;
    const section = me.doc.sections.find((s) => s.index === c.sectionIndex);
    const counter = h("p", { class: `count${c.text.length > limit ? " over" : ""}` }, `${c.text.length} / ${limit}`);
    const area = h("textarea", { "aria-label": `${ROLE[c.role]} for ${label(c.service)}`, "data-key": `t${c.slot}`, readonly: saved, value: c.text,
      oninput: (e) => { edit(c.slot, { text: e.target.value }); counter.textContent = `${e.target.value.length} / ${limit}`; counter.className = `count${e.target.value.length > limit ? " over" : ""}`; } });
    const tools = [];
    if (!saved) {
      tools.push(h("button", { class: `pill${ui.ask === c.slot ? " on" : ""}`, onclick: () => { ui.ask = ui.ask === c.slot ? null : c.slot; ui.move = null; render(); } }, "Ask for changes"));
      tools.push(h("button", { class: `pill${ui.move === c.slot ? " on" : ""}`, onclick: () => { ui.move = ui.move === c.slot ? null : c.slot; ui.ask = null; render(); } }, "Move date"));
    }
    const asking = ui.ask === c.slot && !saved;
    const moving = ui.move === c.slot && !saved;
    const askInput = h("input", { type: "text", placeholder: "e.g. shorter, or use the line about…", "aria-label": "What should change", "data-key": `a${c.slot}`, maxlength: "300" });
    const busy = ui.busy === `revise${c.slot}`;
    return h("article", { id: `post${c.slot}`, class: `post${c.role === "launch" ? " main" : ""}${c.included === false ? " off" : ""}${saved ? " saved" : ""}` },
      h("div", { class: "inc" },
        h("input", { type: "checkbox", id: `inc${c.slot}`, checked: c.included !== false, disabled: saved, onchange: (e) => { edit(c.slot, { included: e.target.checked }); render(); } }),
        h("label", { for: `inc${c.slot}` }, "Include"),
        h("span", { class: "when" }, longish(c.date) + (c.date === p.publishDate ? " ★" : ""))),
      h("div", { class: "for" }, dot(c.service), `For ${label(c.service)} · ${ROLE[c.role]}`),
      h("div", { class: "from" }, c.sectionIndex ? `From section ${c.sectionIndex}${section ? ` (${section.heading})` : ""}: “${c.sourceQuote}”` : `From your whole draft: “${c.sourceQuote}”`),
      area, counter,
      c.role === "launch" && c.text.includes("[link]") ? h("p", { class: "hint" }, "Swap [link] for the piece's link once it's live, here or in Buffer.") : null,
      tools.length ? h("div", { class: "tools" }, tools) : null,
      asking ? h("form", { class: "ask", onsubmit: async (e) => {
        e.preventDefault();
        ui.busy = `revise${c.slot}`; ui.error = ""; render();
        try {
          const r = await call("/api/revise", { slot: c.slot, instruction: askInput.value, text: (ui.edits[c.slot] || {}).text });
          const i = me.plan.suggestions.findIndex((s) => s.slot === c.slot);
          me.plan.suggestions[i] = r.suggestion;
          if (ui.edits[c.slot]) delete ui.edits[c.slot].text;
          ui.ask = null;
        } catch (err) { ui.error = err.message; }
        ui.busy = ""; render();
      } }, askInput, h("button", { class: "pill on", type: "submit", disabled: busy }, busy ? "Working…" : "Change it")) : null,
      moving ? h("div", { class: "ask" }, h("input", { type: "date", "aria-label": "New date", value: c.date, min: addDays(me.board.today, 1), max: me.board.rangeEnd,
        onchange: (e) => { if (e.target.value) { edit(c.slot, { date: e.target.value }); ui.move = null; render(); } } })) : null,
      saved ? h("p", { class: "ok" }, "✓ Saved to Buffer as a draft") : null,
      c.error ? h("p", { class: "err" }, c.error) : null);
  }

  function ticked() {
    const list = cards().filter((c) => c.included !== false && !c.bufferId);
    const ph = placeholder();
    const dates = list.map((c) => c.date);
    if (ph.included && !ph.bufferId) dates.push(me.plan.publishDate);
    dates.sort();
    return { posts: list.length, total: list.length + (ph.included && !ph.bufferId ? 1 : 0), first: dates[0], last: dates[dates.length - 1] };
  }

  function dock(p) {
    const t = ticked();
    const saving = ui.busy === "save";
    const summary = t.total ? `${t.posts} post${t.posts === 1 ? "" : "s"}${placeholder().included && !placeholder().bufferId ? " and the placeholder" : ""} ticked, ${short(t.first)} to ${short(t.last)}` : "Everything ticked is saved";
    dockSlot.append(h("div", { class: "dock" },
      h("span", { class: "t" }, summary),
      h("span", { class: "sp" }),
      me.doc.url ? h("a", { class: "ghost", href: me.doc.url, target: "_blank", rel: "noopener" }, "Open the doc") : null,
      h("button", { class: "btn", disabled: !t.total || saving, onclick: save }, saving ? "Saving…" : `Save ${t.total} draft${t.total === 1 ? "" : "s"} to Buffer`)));
  }

  function doneCard() {
    const s = ui.justSaved;
    return h("section", { class: "card done", role: "status" },
      h("h2", null, s.failed ? `Saved ${s.saved}, ${s.failed} didn't go through` : `Saved ${s.saved} draft${s.saved === 1 ? "" : "s"} to Buffer`),
      h("p", null, s.failed ? "The ones that didn't save say why on their card. Fix them and save again." : "They're on their dates in your Buffer calendar as drafts. Nothing posts until you approve it there."),
      h("div", { class: "row" },
        h("a", { class: "btn", href: "https://publish.buffer.com/calendar", target: "_blank", rel: "noopener" }, "Open Buffer"),
        h("button", { class: "pill", onclick: async () => { if (!confirm("Start over with a new doc? The drafts in Buffer stay where they are.")) return; await call("/api/reset", {}); me.doc = null; me.plan = null; ui.edits = {}; ui.justSaved = null; render(); } }, "Plan another piece")));
  }

  async function save() {
    ui.busy = "save"; ui.error = ""; ui.notice = ""; render();
    try {
      const posts = me.plan.suggestions.filter((s) => !s.bufferId).map((s) => ({ slot: s.slot, ...(ui.edits[s.slot] || {}) }));
      const r = await call("/api/save", { posts, placeholder: ui.placeholder || {} });
      me = { ...me, ...r };
      ui.edits = {};
      ui.placeholder = null;
      ui.justSaved = { saved: r.saved, failed: r.failed };
    } catch (e) { ui.error = e.message; }
    ui.busy = "";
    render();
    const done = document.querySelector(".done, .banner");
    if (done) done.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function runSuggest() {
    ui.busy = "suggest"; ui.error = ""; ui.notice = ""; ui.justSaved = null; render();
    try {
      const r = await call("/api/suggest", {});
      me = { ...me, ...r };
      ui.edits = {}; ui.placeholder = null;
      focusWeek();
    } catch (e) { ui.error = e.message; }
    ui.busy = "";
    render();
  }

  function suggestIfReady() {
    if (me && me.signedIn && me.doc && !me.plan && me.aiReady && ui.busy !== "suggest") runSuggest();
  }

  // Show the weeks that hold the publish day.
  function focusWeek() {
    if (!me.plan || !me.board) return;
    const days = Math.round((Date.parse(`${me.plan.publishDate}T12:00:00Z`) - Date.parse(`${me.board.rangeStart}T12:00:00Z`)) / 86400000);
    ui.week = Math.max(0, Math.min(2, Math.floor(days / 7) - 1));
  }

  async function load() {
    try { me = await call("/api/me"); }
    catch (e) { if (!me) me = { signedIn: false }; ui.error = e.message; }
    focusWeek();
    render();
  }

  const q = new URLSearchParams(location.search);
  if (q.get("error")) { ui.error = ERRORS[q.get("error")] || "Sign-in didn't work. Try again."; history.replaceState(null, "", "/"); }
  const pickNow = q.get("pick") === "1";
  if (pickNow) history.replaceState(null, "", "/");
  load().then(() => { if (pickNow && me && me.google && me.google.connected && !me.doc) openPicker(); else suggestIfReady(); });
})();
