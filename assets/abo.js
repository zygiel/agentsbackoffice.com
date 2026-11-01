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

  window.ABO = { sb, $, $$, esc, fmtDate, fmtWhen, STATUS, QUEUE, OPEN_STATUSES, msg, audit, sessionState, requireSession, signOut, reverify, csv, download, fn };
})();
