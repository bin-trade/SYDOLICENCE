(function () {
  const cfg = window.PILOT_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const S = { rows: [], filter: "", drafts: {}, loading: false, saving: false, lastAlert: "" };
  const REFRESH_MS = 30000, TIMEOUT_MS = 20000;
  let deferredInstall = null;

  // URL enregistrée par l'utilisateur : valable seulement pour la version de config courante.
  try {
    const s = JSON.parse(localStorage.getItem("sydonia-pilot-config") || "null");
    if (s && s.apiUrl && s.configVersion === cfg.configVersion) cfg.apiUrl = s.apiUrl;
  } catch (_) {}

  /* ---------- Utilitaires ---------- */
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const p2 = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  function toDate(v) {
    if (!v) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
    const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const fmtDate = (v) => { const d = toDate(v); return d ? `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}` : (v || "—"); };
  const compactPc = (v) => { const t = String(v || "—"); return t.length > 22 ? `${t.slice(0, 10)}…${t.slice(-10)}` : t; };
  const configured = (x) => Boolean(x.license_code_configured);
  const isCode = (c) => /^\d{6}$/.test(c);

  function toast(msg, type) {
    if (!msg) return;
    $("message").textContent = msg;
    const t = document.createElement("div");
    t.className = "toast " + (type || ""); t.textContent = msg; $("toasts").appendChild(t);
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 300); }, type === "error" ? 6000 : 3500);
  }
  function setState(text, kind) {
    const s = $("state"); s.textContent = text; s.className = "state " + (kind || "");
    $("dot").className = "dot" + (kind === "ok" ? " on" : "");
  }
  const openDialog = (d) => { if (!d.open) d.showModal(); };

  /* ---------- API Apps Script ---------- */
  // Lecture : GET ; écriture : POST text/plain (requête « simple », sans pré-vérification CORS).
  // Jamais de requête opaque (mode CORS standard) : la réponse JSON doit rester lisible. Apps Script redirige vers
  // script.googleusercontent.com : fetch suit la redirection (redirect: "follow").
  async function api(action, data) {
    if (!cfg.apiUrl) throw new Error("URL du pilote non configurée.");
    const params = Object.assign({ action }, data || {});
    const post = data && ["listInstallations", "getInstallation", "updateLicense", "updateContact"].includes(action);
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let res, raw;
    try {
      const url = post ? cfg.apiUrl : cfg.apiUrl + "?" + new URLSearchParams(Object.assign({ _t: Date.now() }, params));
      const init = post
        ? { method: "POST", redirect: "follow", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(params), signal: ctl.signal }
        : { method: "GET", redirect: "follow", signal: ctl.signal };
      res = await fetch(url, init);
      raw = await res.text();
    } catch (e) {
      console.error("[SYDONIA] appel Apps Script impossible :", action, e);
      if (e && e.name === "AbortError") throw new Error("Le serveur n'a pas répondu. Vérifiez la connexion et réessayez.");
      throw new Error(navigator.onLine
        ? "Impossible de joindre le pilote (réseau, CORS ou déploiement Apps Script non public). Détail : " + ((e && e.message) || e)
        : "Hors connexion.");
    } finally { clearTimeout(to); }
    let json;
    try { json = JSON.parse(raw); } catch (e) {
      console.error("[SYDONIA] réponse non JSON (HTTP " + res.status + ") :", String(raw).slice(0, 300));
      throw new Error("Réponse invalide du pilote (HTTP " + res.status + "). Vérifiez l'URL /exec et que le déploiement Apps Script est à jour et public.");
    }
    if (!res.ok) { console.error("[SYDONIA] HTTP", res.status, json); throw new Error("Erreur réseau (" + res.status + ")"); }
    return json;
  }
  const chk = (r) => { if (!r || !r.ok) throw new Error((r && (r.message || r.error)) || "Erreur du pilote."); return r; };
  const adminToken = () => { try { return sessionStorage.getItem("sydonia-admin-token") || ""; } catch (_) { return ""; } };

  /* ---------- Rendu ---------- */
  function render() {
    const q = $("search").value.trim().toLowerCase(), f = S.filter;
    const rows = S.rows.filter((x) => (!f || (f === "CONFIGURE") === configured(x)) && [x.company_name, x.machine_fingerprint, x.pc_id].join(" ").toLowerCase().includes(q));
    $("rows").innerHTML = rows.map((x) => {
      const c = configured(x);
      const pc = esc(x.pc_id || x.machine_fingerprint), draft = S.drafts[x.pc_id] != null ? S.drafts[x.pc_id] : "";
      const status = String(x.license_status || "EN_ATTENTE").toUpperCase();
      return `<tr class="inst">
        <td class="c-school"><b>${esc(x.company_name || "Entreprise non renseignée")}</b><small>${esc(status)}</small></td>
        <td class="c-pc"><code title="${pc}">${esc(compactPc(x.pc_id))}</code></td>
        <td class="c-code"><code class="license-code" title="Dernier code enregistré">${esc(x.license_code || "—")}</code></td>
        <td class="c-seen" data-label="Dernier contact">${esc(fmtDate(x.last_seen_at))}</td>
        <td class="c-state"><span class="badge ${status === "ACTIF" && c ? "ok" : "warn"}">${status === "ACTIF" && c ? "ACTIF" : status}</span></td>
        <td class="c-act"><button class="btn sec edit" type="button" data-pc="${pc}">Modifier le code</button></td></tr>`;
    }).join("") || `<tr class="none"><td class="empty" colspan="6"><b>Aucune installation à afficher</b><br>Modifiez la recherche ou actualisez la liste.</td></tr>`;
    $("total").textContent = S.rows.length;
    $("active").textContent = S.rows.filter(configured).length;
    $("pending").textContent = S.rows.filter((x) => !configured(x)).length;
    $("count").textContent = S.rows.length ? `${rows.length} installation${rows.length > 1 ? "s" : ""} affichée${rows.length > 1 ? "s" : ""}` : "Aucune donnée chargée";
  }

  function alerts() {
    const p = S.rows.filter((x) => !configured(x));
    if (!p.length) { S.lastAlert = ""; return; }
    const key = p.map((x) => x.pc_id).sort().join("|");
    if (key === S.lastAlert) return;
    S.lastAlert = key;
    const m = `Alerte licence : ${p.length} installation${p.length > 1 ? "s" : ""} en attente`;
    toast(m);
    if (typeof Notification !== "undefined" && Notification.permission === "granted") { try { new Notification("SYDONIA Control", { body: m }); } catch (_) {} }
  }

  async function load(silent) {
    if (!cfg.apiUrl) { setState("Connexion non configurée"); if (!silent) openDialog($("configDialog")); return; }
    if (S.loading) return;
    S.loading = true; $("refresh").setAttribute("aria-busy", "true");
    if (!silent) setState("Synchronisation…");
    try {
      const token = adminToken();
      if (!token) throw new Error("Saisissez le jeton administrateur dans Configuration.");
      const [r, c] = await Promise.all([api("listInstallations", { admin_token: token }), api("contact").catch((e) => { console.warn("[SYDONIA] contact indisponible :", e.message); return null; })]);
      chk(r);
      S.rows = r.installations || [];
      if (!$("configDialog").open) $("supportPhone").value = (c && c.support_phone) || "";
      setState("Pilote connecté", "ok"); render(); alerts();
    } catch (e) {
      setState(navigator.onLine ? "Connexion indisponible" : "Hors connexion", "error");
      if (!silent) toast(e.message, "error");
      throw e;
    } finally { S.loading = false; $("refresh").removeAttribute("aria-busy"); }
  }
  const reload = (silent) => load(silent).catch(() => {});

  $("rows").addEventListener("click", (e) => { const b = e.target.closest(".edit"); if (b) openEdit(b.dataset.pc); });

  /* ---------- Fenêtre « Gérer l'accès » ---------- */
  const form = $("editForm"), btn = $("save-edit"), lbl = btn.querySelector(".lbl"), fb = $("feedback");
  let initialCode = "";
  function setBtn(s) { btn.dataset.s = s || ""; lbl.textContent = { saving: "Enregistrement…", success: "Accès enregistré", error: "Réessayer" }[s] || "Enregistrer l'accès"; }
  function setFb(type, text) { fb.hidden = !text; fb.className = "feedback " + type; fb.textContent = text || ""; }
  const lock = (v) => form.querySelectorAll("input,button").forEach((el) => { if (el !== btn) el.disabled = v; });
  function updateEdit() {
    if (S.saving) return;
    const ok = isCode($("editCode").value.trim()), out = [];
    if (ok && $("editCode").value.trim() !== initialCode) out.push(`<div><em>Code de licence</em><s>${esc(initialCode || "non configuré")}</s><span>→</span><b>${esc($("editCode").value.trim())}</b></div>`);
    $("diff").innerHTML = out.join(""); btn.disabled = !ok; setBtn("");
  }
  function openEdit(pc) {
    const x = S.rows.find((r) => r.pc_id === pc); if (!x) return;
    $("editSchool").value = ""; $("editPc").value = pc;
    $("editIdentity").innerHTML = `<b>${esc(x.company_name || "Entreprise non renseignée")}</b><span>${esc(pc)}</span>`;
    initialCode = ""; $("editCode").value = "";
    setFb("", ""); updateEdit(); openDialog($("editDialog"));
  }
  $("editCode").addEventListener("input", () => { $("editCode").value = $("editCode").value.replace(/\D/g, "").slice(0, 6); updateEdit(); });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = $("editCode").value.trim(); if (S.saving || !isCode(code)) return;
    S.saving = true; lock(true); btn.disabled = true; setBtn("saving"); setFb("busy", "Application des changements en cours…");
    try {
      chk(await api("updateLicense", { pc_id: $("editPc").value, license_code: code, admin_token: adminToken() }));
      delete S.drafts[$("editPc").value];
      setBtn("success"); setFb("ok", "Changements appliqués. Le registre est à jour."); toast("Accès enregistré.", "ok"); reload(true);
      setTimeout(() => { S.saving = false; lock(false); $("editDialog").close(); }, 1000);
    } catch (err) {
      S.saving = false; lock(false); btn.disabled = false; setBtn("error"); setFb("error", err.message); toast("Échec de l'enregistrement", "error");
    }
  });

  /* ---------- Fenêtre « Connexion » ---------- */
  $("settings").onclick = () => {
    $("apiUrl").value = cfg.apiUrl || "";
    try { $("adminToken").value = sessionStorage.getItem("sydonia-admin-token") || ""; } catch (_) {}
    openDialog($("configDialog"));
    api("contact").then((c) => { $("supportPhone").value = (c && c.support_phone) || ""; }).catch(() => {});
  };
  $("configForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = $("apiUrl").value.trim(), token = $("adminToken").value.trim(); if (!url || !token) return;
    cfg.apiUrl = url;
    try { localStorage.setItem("sydonia-pilot-config", JSON.stringify({ apiUrl: url, configVersion: cfg.configVersion })); } catch (_) {}
    try { sessionStorage.setItem("sydonia-admin-token", token); } catch (_) {}
    try {
      chk(await api("updateContact", { support_phone: $("supportPhone").value.trim() }));
      $("configDialog").close(); toast("Configuration enregistrée.", "ok"); reload(false);
    } catch (err) { toast("Échec de l'enregistrement : " + err.message, "error"); }
  });

  // Boutons Annuler / × : ferment sans déclencher l'enregistrement.
  document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => { if (!S.saving) b.closest("dialog").close(); }));
  document.querySelectorAll("dialog").forEach((d) => d.addEventListener("cancel", (e) => { if (S.saving) e.preventDefault(); }));

  /* ---------- Filtres, actualisation, installation ---------- */
  $("search").oninput = render;
  $("chips").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-f]"); if (!b) return;
    S.filter = b.dataset.f;
    $("chips").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    render();
  });
  $("refresh").onclick = () => reload(false);

  const standalone = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone;
  if (standalone) $("install").hidden = true;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstall = e; });
  window.addEventListener("appinstalled", () => { deferredInstall = null; $("install").hidden = true; });
  $("install").onclick = async () => {
    if (!deferredInstall) { toast("Ouvrez le menu du navigateur, puis « Ajouter à l'écran d'accueil » ou « Installer l'application »."); return; }
    deferredInstall.prompt();
    const r = await deferredInstall.userChoice;
    if (r.outcome === "accepted") toast("Installation de SYDONIA Control en cours.", "ok");
    deferredInstall = null;
  };

  // Rafraîchissement auto : jamais pendant une saisie ou une fenêtre ouverte.
  setInterval(() => {
    const a = document.activeElement;
    if (document.hidden || !navigator.onLine || document.querySelector("dialog[open]")) return;
    reload(true);
  }, REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) reload(true); });
  window.addEventListener("online", () => reload(true));
  window.addEventListener("offline", () => setState("Hors connexion", "error"));

  // Service worker : enregistrement + mise à jour automatique (rechargement unique quand une nouvelle version prend la main).
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
    navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" }).then((reg) => {
      const check = () => reg.update().catch(() => {});
      document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
      setInterval(check, 30 * 60 * 1000);
    }).catch((e) => console.error("[SYDONIA] service worker non enregistré :", e));
  }
  render(); reload(false);
})();
