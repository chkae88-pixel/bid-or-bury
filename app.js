const KEY = "bid-or-bury-v1";
const FILTERS = ["hot", "new", "offered", "fight", "idea", "repo", "app"];

function load() {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch (e) {}
  }
  return {
    listings: (window.BB_SEED || []).slice(),
    votes: {},
    mine: {},
    watchers: [],
    offers: [],
    watched: {}
  };
}

let S = load();
function save() { localStorage.setItem(KEY, JSON.stringify(S)); }

function $(sel, root) { return (root || document).querySelector(sel); }
function route() {
  const h = (location.hash || "#/").replace(/^#/, "");
  const parts = h.split("/").filter(Boolean);
  return { parts, path: parts[0] || "feed", id: parts[1] || "" };
}

function scores(id) {
  const v = S.votes[id] || { good: 0, trash: 0 };
  return { good: v.good || 0, trash: v.trash || 0, net: (v.good || 0) - (v.trash || 0), total: (v.good || 0) + (v.trash || 0) };
}
function offersFor(id) { return S.offers.filter(o => o.listingId === id); }
function listing(id) { return S.listings.find(x => x.id === id); }
function canOffer(item) { return item && item.type !== "idea"; }
function askLabel(item) {
  if (item.ask === "open") return "open to offers";
  if (item.ask === "vote-only") return "vote only";
  if (typeof item.ask === "number") return item.ask === 0 ? "not for sale" : "$" + item.ask;
  return String(item.ask || "");
}
function tweetUrl(item) {
  const text = "Good or trash: " + item.title + "\n" + item.pitch.slice(0, 140);
  const url = location.origin + location.pathname + "#/l/" + item.id;
  return "https://x.com/intent/tweet?text=" + encodeURIComponent(text) + "&url=" + encodeURIComponent(url);
}
function escape(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&", "<": "<", ">": ">", '"': """, "'": "&#39;" }[c]));
}
function host(link) {
  try { return new URL(link).host.replace(/^www\./, ""); } catch (e) { return ""; }
}

function vote(id, side) {
  const prev = S.mine[id];
  if (!S.votes[id]) S.votes[id] = { good: 0, trash: 0 };
  if (prev === side) return;
  if (prev) S.votes[id][prev] = Math.max(0, S.votes[id][prev] - 1);
  S.votes[id][side] += 1;
  S.mine[id] = side;
  save();
  render();
}

function addWatch(id, email) {
  S.watchers.push({ email: email.trim().toLowerCase(), listingId: id, ts: Date.now() });
  S.watched[id] = true;
  save();
  render();
}
function addOffer(id, email, amount, note) {
  const item = listing(id);
  if (!canOffer(item)) return;
  S.offers.push({
    email: email.trim().toLowerCase(),
    listingId: id,
    amount: Number(amount),
    note: note.trim(),
    ts: Date.now()
  });
  save();
  render();
}
function addListing(payload) {
  const n = S.listings.length + 1;
  const item = {
    id: "bb-" + String(n).padStart(3, "0") + "-" + Date.now().toString(36),
    type: payload.type,
    title: payload.title.trim(),
    pitch: payload.pitch.trim().slice(0, 280),
    category: payload.category.trim() || "uncat",
    link: payload.link.trim() || null,
    ask: payload.ask === "open" || payload.ask === "vote-only" ? payload.ask : (Number(payload.ask) || "open"),
    submitter: payload.email.trim().toLowerCase(),
    created: new Date().toISOString().slice(0, 10),
    house: false
  };
  S.listings.unshift(item);
  save();
  location.hash = "#/l/" + item.id;
}

function sorted(filter, q) {
  let list = S.listings.slice();
  if (filter === "idea" || filter === "repo" || filter === "app") list = list.filter(x => x.type === filter);
  if (q) {
    const s = q.toLowerCase();
    list = list.filter(x => (x.title + " " + x.pitch + " " + x.category).toLowerCase().includes(s));
  }
  if (filter === "new") list.sort((a, b) => (b.created || "").localeCompare(a.created || "") || b.id.localeCompare(a.id));
  else if (filter === "offered") list.sort((a, b) => offersFor(b.id).length - offersFor(a.id).length || scores(b.id).net - scores(a.id).net);
  else if (filter === "fight") list.sort((a, b) => {
    const A = scores(a.id), B = scores(b.id);
    const close = Math.min(B.good, B.trash) - Math.min(A.good, A.trash);
    return close || B.total - A.total;
  });
  else list.sort((a, b) => scores(b.id).net - scores(a.id).net || scores(b.id).total - scores(a.id).total);
  return list;
}

function voteBar(item) {
  const sc = scores(item.id);
  const mine = S.mine[item.id];
  return `<div class="actions">
    <button class="btn bid ${mine === "good" ? "on" : ""}" data-vote="good" data-id="${item.id}">Good</button>
    <button class="btn bury ${mine === "trash" ? "on" : ""}" data-vote="trash" data-id="${item.id}">Trash</button>
    <span class="score">${sc.net >= 0 ? "+" : ""}${sc.net} · ${sc.good} good · ${sc.trash} trash · ${offersFor(item.id).length} offers</span>
  </div>`;
}

function watchForm(item) {
  if (!S.mine[item.id]) return "";
  if (S.watched[item.id]) return `<p class="note ok">You’ll get pinged if this moves. That’s the whole deal.</p>`;
  return `<form class="watch" data-watch="${item.id}">
    <label>Ping me if someone bids or the score flips.</label>
    <input type="email" name="email" required placeholder="you@email.com" autocomplete="email">
    <label class="consent"><input type="checkbox" name="ok" required> Email me about this listing. We store email, listing, timestamp. We don’t sell the list.</label>
    <button class="btn" type="submit">Watch</button>
  </form>`;
}

function offerForm(item) {
  if (!canOffer(item)) return `<p class="note">Ideas don’t take offers. Bid on a repo or a live app.</p>`;
  const mine = S.offers.filter(o => o.listingId === item.id);
  const done = mine.length ? `<p class="note ok">Sent. They have your email. We don’t sit in the middle.${item.house ? " HOUSE seed — captured on this device for the experiment." : ""}</p>` : "";
  return `${done}<form class="offer" data-offer="${item.id}">
    <label>I’d pay</label>
    <div class="row">
      <input type="number" name="amount" min="1" step="1" required placeholder="400">
      <input type="email" name="email" required placeholder="you@email.com" autocomplete="email">
    </div>
    <textarea name="note" rows="3" maxlength="280" required placeholder="One sentence. Why this, why now."></textarea>
    <label class="consent"><input type="checkbox" name="ok" required> Email me about this listing. We store email, listing, amount, timestamp. We don’t sell the list.</label>
    <button class="btn bid" type="submit">Send offer</button>
    ${item.house ? `<p class="note">HOUSE seed. Offer stays in your browser until Desk export.</p>` : ""}
  </form>`;
}

function card(item) {
  const link = item.link ? `<a href="${escape(item.link)}" target="_blank" rel="noopener">${escape(host(item.link) || "open")}</a>` : "no link";
  return `<article class="card" id="${item.id}">
    <div class="meta">
      <span class="badge ${item.type}">${item.type}</span>
      <span>${escape(item.category)}</span>
      <span>${escape(askLabel(item))}</span>
      <span>${escape(item.submitter)}</span>
      <span>${link}</span>
    </div>
    <h2><a href="#/l/${item.id}">${escape(item.title)}</a></h2>
    <p class="pitch">${escape(item.pitch)}</p>
    ${voteBar(item)}
    ${S.mine[item.id] ? watchForm(item) : ""}
  </article>`;
}

function feedView(filter) {
  const q = ($("#q") && $("#q").value) || "";
  const list = sorted(filter, q);
  const chips = FILTERS.map(f => `<button class="chip ${f === filter ? "on" : ""}" data-filter="${f}">${f}</button>`).join("");
  return `<div class="filters">${chips}</div>
    <input class="search" id="q" placeholder="Search titles, pitches, categories" value="${escape(q)}">
    ${list.length ? list.map(card).join("") : `<div class="empty">Nothing to bury yet. Submit one or wait — this is a junkyard, not a conference.</div>`}`;
}

function detailView(id) {
  const item = listing(id);
  if (!item) return `<div class="empty">That listing is gone.</div>`;
  const sc = scores(id);
  const link = item.link ? `<p><a href="${escape(item.link)}" target="_blank" rel="noopener">${escape(item.link)}</a></p>` : "";
  return `<article class="detail">
    <div class="meta">
      <span class="badge ${item.type}">${item.type}</span>
      <span>${escape(item.category)}</span>
      <span>${escape(askLabel(item))}</span>
      <span>${item.house ? "HOUSE seed" : escape(item.submitter)}</span>
      <span>${item.created}</span>
    </div>
    <h1>${escape(item.title)}</h1>
    <p class="lead pitch">${escape(item.pitch)}</p>
    ${link}
    ${voteBar(item)}
    ${sc.total === 0 ? `<p class="note">Nobody has called it yet.</p>` : ""}
    ${watchForm(item)}
    ${offerForm(item)}
    <div class="actions" style="margin-top:16px">
      <a class="btn ghost" href="${tweetUrl(item)}" target="_blank" rel="noopener">Post to X</a>
      <a class="btn ghost" href="#/c/${item.id}">Share card</a>
      <a class="btn ghost" href="#/">Back to feed</a>
    </div>
  </article>`;
}

function shareView(id) {
  const item = listing(id);
  if (!item) return `<div class="empty">Missing card.</div>`;
  const sc = scores(id);
  return `<div class="share">
    <div class="box">
      <div class="meta" style="justify-content:center"><span class="badge ${item.type}">${item.type}</span></div>
      <p class="note">Good or trash?</p>
      <h1>${escape(item.title)}</h1>
      <p class="pitch">${escape(item.pitch)}</p>
      <p class="score">${sc.net >= 0 ? "+" : ""}${sc.net} net · ${sc.good} good · ${sc.trash} trash</p>
      <div class="actions" style="justify-content:center;margin-top:18px">
        <a class="btn bid" href="#/l/${item.id}">Vote</a>
        <a class="btn ghost" href="${tweetUrl(item)}" target="_blank" rel="noopener">Post to X</a>
      </div>
    </div>
  </div>`;
}

function submitView() {
  return `<h1 class="detail">Dump it in 90 seconds</h1>
    <p class="note">Idea = vote only. Repo or live app = can take an offer. No password. Email is how a bidder reaches you.</p>
    <form class="form" id="submit-form">
      <div class="row">
        <select name="type" required>
          <option value="idea">Idea</option>
          <option value="repo">Repo</option>
          <option value="app">Live app</option>
        </select>
        <input name="category" placeholder="category (ecom, local, saas)" maxlength="32">
      </div>
      <input name="title" required maxlength="80" placeholder="Title">
      <textarea name="pitch" required maxlength="280" rows="4" placeholder="280 characters. Problem, who it is for, why now."></textarea>
      <input name="link" placeholder="https:// — required for repo and app">
      <div class="row">
        <select name="ask">
          <option value="vote-only">Vote only</option>
          <option value="open">Open to offers</option>
        </select>
        <input name="price" type="number" min="1" placeholder="or named price $">
        <input name="email" type="email" required placeholder="your email" autocomplete="email">
      </div>
      <label class="consent"><input type="checkbox" name="ok" required> Email me about this listing. We store email, listing, amount, timestamp. We don’t sell the list.</label>
      <button class="btn bid" type="submit">Publish</button>
    </form>`;
}

function operatorView() {
  const ext = S.listings.filter(x => !x.house);
  const watch = S.watchers.length;
  const offers = S.offers.length;
  const votes = Object.keys(S.mine).length;
  return `<h1 class="detail">Desk</h1>
    <p class="note">Votes are atmosphere. Actors are the list. House seeds do not count as demand.</p>
    <div class="stats">
      <div class="stat"><b>${votes}</b><span>local votes</span></div>
      <div class="stat"><b>${watch}</b><span>watchers</span></div>
      <div class="stat"><b>${offers}</b><span>offers</span></div>
      <div class="stat"><b>${ext.length}</b><span>external listings</span></div>
    </div>
    <div class="actions">
      <button class="btn" id="export">Export JSON</button>
      <button class="btn ghost" id="reset">Reset this browser</button>
    </div>
    <p class="note">${watch + offers === 0 ? "No actors yet. Votes without emails are atmosphere." : "Export and keep the file. This MVP has no server."}</p>`;
}

function privacyView() {
  return `<h1 class="detail">Privacy</h1>
    <p class="pitch">This MVP stores data in your browser only.</p>
    <p class="note">What: email, listing id, offer amount, one-sentence note, timestamp, your votes.</p>
    <p class="note">Why: so an operator can reach watchers and bidders if the experiment lives.</p>
    <p class="note">We do not sell the list.</p>
    <p class="note">There is no account. There is no password.</p>
    <p class="note">Delete: use Reset on Desk, or clear site data in your browser.</p>
    <p class="note">HOUSE seeds are demonstration inventory, not live sales of other people’s products.</p>
    <p class="note">If this gets a server later, consent stays the same checkbox.</p>`;
}

function render() {
  const r = route();
  const app = $("#app");
  if (!app) return;
  if (r.path === "l") app.innerHTML = detailView(r.id);
  else if (r.path === "c") app.innerHTML = shareView(r.id);
  else if (r.path === "submit") app.innerHTML = submitView();
  else if (r.path === "operator" || r.path === "desk") app.innerHTML = operatorView();
  else if (r.path === "privacy") app.innerHTML = privacyView();
  else app.innerHTML = feedView(FILTERS.includes(r.path) ? r.path : "hot");
  bind();
}

function bind() {
  document.querySelectorAll("[data-vote]").forEach(btn => {
    btn.onclick = () => vote(btn.dataset.id, btn.dataset.vote);
  });
  document.querySelectorAll("[data-filter]").forEach(btn => {
    btn.onclick = () => { location.hash = "#/" + btn.dataset.filter; };
  });
  const q = $("#q");
  if (q) q.oninput = () => {
    const r = route();
    const f = FILTERS.includes(r.path) ? r.path : "hot";
    $("#app").innerHTML = feedView(f);
    const nq = $("#q"); if (nq) { nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); }
    bind();
  };
  document.querySelectorAll("form[data-watch]").forEach(f => {
    f.onsubmit = e => {
      e.preventDefault();
      if (!f.ok.checked) return;
      addWatch(f.dataset.watch, f.email.value);
    };
  });
  document.querySelectorAll("form[data-offer]").forEach(f => {
    f.onsubmit = e => {
      e.preventDefault();
      if (!f.ok.checked) return;
      addOffer(f.dataset.offer, f.email.value, f.amount.value, f.note.value);
    };
  });
  const sub = $("#submit-form");
  if (sub) sub.onsubmit = e => {
    e.preventDefault();
    const type = sub.type.value;
    const link = sub.link.value.trim();
    if ((type === "repo" || type === "app") && !link) {
      alert("Repo and live app need a link.");
      return;
    }
    if (type === "idea" && sub.ask.value === "open") {
      alert("Ideas don’t take offers. Publish as vote only.");
      return;
    }
    addListing({
      type,
      title: sub.title.value,
      pitch: sub.pitch.value,
      category: sub.category.value,
      link,
      ask: sub.price.value ? Number(sub.price.value) : sub.ask.value,
      email: sub.email.value
    });
  };
  const exp = $("#export");
  if (exp) exp.onclick = () => {
    const blob = new Blob([JSON.stringify({
      exported: new Date().toISOString(),
      watchers: S.watchers,
      offers: S.offers,
      listings: S.listings.filter(x => !x.house),
      votes: S.votes
    }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "bid-or-bury-export.json";
    a.click();
  };
  const reset = $("#reset");
  if (reset) reset.onclick = () => {
    if (!confirm("Clear votes, watchers, offers, and local submissions on this device?")) return;
    localStorage.removeItem(KEY);
    S = load();
    render();
  };
}

window.addEventListener("hashchange", render);
window.addEventListener("DOMContentLoaded", render);
if (document.readyState !== "loading") render();
