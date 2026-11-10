/* Agents Back Office — shared browser helpers.
   The publishable key below is public by design; row-level security in the
   database is what protects the data. Nothing secret lives in this repo. */
(function () {
  const SUPABASE_URL = "https://jhyotatopfrjuhqjalpx.supabase.co";
  const SUPABASE_KEY = "sb_publishable_Evb1jKkBoBPKJxT7f_wtqQ_L7C-jsT4";
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" }
  });

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
  const fmtWhen = (d) => d ? new Date(d).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  const STATUS = { received: "Received", in_progress: "In progress", waiting_on_agent: "Waiting on you", with_brokerage: "With brokerage", closed: "Closed", cancelled: "Cancelled" };
  const QUEUE = { new: "New", in_progress: "In progress", waiting_on_agent: "Waiting on agent", done: "Done" };
  const OPEN_STATUSES = ["received", "in_progress", "waiting_on_agent", "with_brokerage"];

  function msg(el, text, kind) {
    if (!el) return;
    el.textContent = text || "";
    el.className = "msg" + (kind ? " " + kind : "");
    el.classList.toggle("hidden", !text);
  }

  // append a row to the audit log about the current user (RLS: actor must be me)
  async function audit(action, details, target) {
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      await sb.from("audit_log").insert({ actor: user.id, action, details: details || {}, target_type: target && target.type, target_id: target && target.id });
    } catch (e) { /* never block the UI on logging */ }
  }

  // Where does this session stand? Returns {session, profile, aal, needsEnrol, needsVerify}
  async function sessionState() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return { session: null };
    const { data: profile, error } = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
    const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    const { data: factors } = await sb.auth.mfa.listFactors();
    const verified = (factors && factors.totp) || [];
    const required = !profile || profile.mfa_required !== false;
    const at2 = aal && aal.currentLevel === "aal2";
    return {
      session, profile, aal, factors,
      disabled: !!(profile && profile.disabled),
      needsEnrol: required && verified.length === 0,
      needsVerify: !at2 && verified.length > 0,
      ready: !!profile && !profile.disabled && (at2 || !required)
    };
  }

  // Guard for portal pages: send to /login/ unless the session is complete.
  async function requireSession(opts) {
    const st = await sessionState();
    if (!st.session || !st.ready) { location.replace("/login/" + (st.session ? "#continue" : "")); return null; }
    if (opts && opts.admin && st.profile.role !== "admin") { location.replace("/app/"); return null; }
    return st;
  }

  async function signOut(everywhere) {
    await audit(everywhere ? "sign_out_all" : "sign_out");
    await sb.auth.signOut({ scope: everywhere ? "global" : "local" });
    location.replace("/login/");
  }

  // A fresh second-factor check (used before an export). Resolves true on success.
  async function reverify(code) {
    const { data: factors, error } = await sb.auth.mfa.listFactors();
    if (error) throw error;
    const f = (factors.totp || [])[0];
    if (!f) throw new Error("No authenticator is enrolled on this account.");
    const ch = await sb.auth.mfa.challenge({ factorId: f.id });
    if (ch.error) throw ch.error;
    const v = await sb.auth.mfa.verify({ factorId: f.id, challengeId: ch.data.id, code });
    if (v.error) throw v.error;
    return true;
  }

  function csv(rows, cols) {
    const q = (v) => { const s = String(v == null ? "" : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return [cols.map(c => q(c.label)).join(",")].concat(rows.map(r => cols.map(c => q(typeof c.get === "function" ? c.get(r) : r[c.key])).join(","))).join("\r\n");
  }
  function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: type || "text/csv;charset=utf-8" }));
    a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // call an edge function with the user's token
  async function fn(name, body) {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(SUPABASE_URL + "/functions/v1/" + name, {
      method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + (session ? session.access_token : ""), "apikey": SUPABASE_KEY },
      body: JSON.stringify(body || {})
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ("Request failed (" + r.status + ")"));
    return j;
  }

  // ---- packet versions: the builder's answers, labelled from the form catalog, and what changed since the version before
  let CATP = null;
  async function catalog() {
    if (CATP) return CATP;
    try { CATP = JSON.parse(await catText("catalog.json")); } catch (e) { CATP = { forms: {}, shared: [] }; }
    return CATP;
  }
  // one file of the form catalog from the PRIVATE bucket "catalog" (catalog.json, text/<form>.md, text/<form>.ctx.json); the session is the key
  async function catText(path) {
    const { data, error } = await sb.storage.from("catalog").download(path);
    if (error) throw error;
    return await data.text();
  }
  const ACR = new Set(["FHA", "VA", "USDA", "RPCD", "HOA", "TRR", "LLC", "ID", "OREC", "PMI", "HUD", "EPA", "MLS", "US", "U.S."]);
  const SMALL = new Set(["of", "and", "to", "the", "or", "for", "a", "an", "in", "on", "with", "by", "at", "not", "as", "from"]);
  function tcase(s) { if (!s || s !== s.toUpperCase()) return s || ""; return s.toLowerCase().split(/(\s+|—|-|\/)/).map((w, i) => { const u = w.toUpperCase(); if (ACR.has(u)) return u; if (!/^[a-z]/.test(w)) return w; if (i > 0 && SMALL.has(w)) return w; return w[0].toUpperCase() + w.slice(1); }).join(""); }
  const ROLE_ONE = { buyers: "Buyer", sellers: "Seller", tenants: "Tenant", landlords: "Landlord" };
  // answers -> ordered sections of {key, label, value}; key is stable across versions so versions can be compared
  function flattenPacket(a, cat) {
    const out = []; if (!a || typeof a !== "object") return out;
    const sec = (title) => { const s = { title, rows: [] }; out.push(s); return s; };
    const shared = a.shared || {}; const seen = new Set();
    for (const g of cat.shared || []) {
      const s = { title: g.group, rows: [] };
      for (const f of g.fields || []) { if (shared[f.key] === undefined || shared[f.key] === "") continue; seen.add(f.key); s.rows.push({ key: "shared:" + f.key, label: f.label || f.key, value: String(shared[f.key]) }); }
      if (s.rows.length) out.push(s);
    }
    const rest = Object.keys(shared).filter(k => !seen.has(k) && shared[k] !== "");
    if (rest.length) { const s = sec("General information (other)"); rest.forEach(k => s.rows.push({ key: "shared:" + k, label: k, value: String(shared[k]) })); }
    if (a.agent) { const s = sec("Agent"); for (const [k, lab] of [["name", "Name"], ["license", "License"], ["phone", "Phone"], ["email", "Email"], ["side", "Side"]]) if (a.agent[k]) s.rows.push({ key: "agent:" + k, label: lab, value: String(a.agent[k]) }); if (!s.rows.length) out.pop(); }
    if (a.parties) { const s = sec("Parties"); for (const [list, people] of Object.entries(a.parties)) (people || []).forEach((p, i) => { const v = [p.name, p.phone, p.email].filter(Boolean).join(" · "); if (v) s.rows.push({ key: "party:" + list + ":" + i, label: (ROLE_ONE[list] || list) + " " + (i + 1), value: v }); }); if (!s.rows.length) out.pop(); }
    const forms = a.forms || {};
    for (const [fid, f] of Object.entries(forms)) {
      const cf = (cat.forms || {})[fid]; const title = tcase((cf && cf.title) || (f && f.title) || fid);
      const s = sec(title + (f && f.edition ? " · edition " + f.edition : ""));
      const vals = (f && f.values) || (typeof f === "object" ? f : {});
      for (const [fieldId, v] of Object.entries(vals)) {
        const def = cf && (cf.fields || []).find(x => x.fieldId === fieldId);
        let label = def ? def.label : fieldId; if (def && def.group && def.group !== label && def.group !== cf.title) label = def.group + " — " + label;
        let value = v === true ? "☑" : (v === false ? "☐" : String(v)); if (def && def.unit && v !== true && v !== false) value = (def.unit === "$" ? "$ " : "") + value + (def.unit !== "$" ? " " + def.unit : "");
        s.rows.push({ key: "form:" + fid + ":" + fieldId, label, value });
      }
      if (!s.rows.length) s.rows.push({ key: "form:" + fid + ":_", label: "(no fields filled)", value: "" });
    }
    return out;
  }
  function diffPacket(cur, prev) {
    const flat = (secs) => { const m = {}; secs.forEach(s => s.rows.forEach(r => { m[r.key] = { ...r, section: s.title }; })); return m; };
    const a = flat(cur), b = flat(prev); const rows = [];
    for (const k of Object.keys(a)) { if (!(k in b)) rows.push({ kind: "added", ...a[k] }); else if (a[k].value !== b[k].value) rows.push({ kind: "changed", ...a[k], was: b[k].value }); }
    for (const k of Object.keys(b)) if (!(k in a)) rows.push({ kind: "removed", ...b[k] });
    return rows;
  }
  // HTML for one version's answers; with prevAnswers, a "what changed" card comes first
  async function renderPacket(answers, prevAnswers, prevNo) {
    const cat = await catalog();
    const secs = flattenPacket(answers, cat);
    let html = "";
    if (prevAnswers) {
      const d = diffPacket(secs, flattenPacket(prevAnswers, cat));
      html += `<div class="card flat"><p class="eyebrow">Changes from version ${esc(prevNo)}</p>` + (d.length ? `<dl class="kv">${d.map(r => `<dt>${esc(r.section)} · ${esc(r.label)}</dt><dd>${r.kind === "added" ? "added: " + esc(r.value) : r.kind === "removed" ? "removed (was " + esc(r.value) + ")" : esc(r.was) + " → " + esc(r.value)}</dd>`).join("")}</dl>` : '<p class="muted small" style="margin:0">No field changed; the forms list or a resend only.</p>') + "</div>";
    }
    if (!secs.length) return html + '<p class="muted small">No answers stored.</p>';
    return html + secs.map(s => `<h3>${esc(s.title)}</h3><dl class="kv">${s.rows.map(r => `<dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd>`).join("")}</dl>`).join("");
  }

  window.ABO = { sb, $, $$, esc, fmtDate, fmtWhen, STATUS, QUEUE, OPEN_STATUSES, msg, audit, sessionState, requireSession, signOut, reverify, csv, download, fn, renderPacket, diffPacket, flattenPacket, catalog, catText };
})();
