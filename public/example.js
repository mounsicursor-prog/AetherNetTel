const STORE_KEY = "operationbrowser.aetherui.v2";

const HOME_URL = "https://search.brave.com/";
const SEARCH_URL = "https://search.brave.com/search?q=%s";

// Configuration des serveurs disponibles
const SERVERS = {
  auto: { name: "🌐 Auto (Local)", wisp: null, bare: null }, // Utilise location.host
  fr: { name: "🇫🇷 France", wisp: "wss://fr.aethernet.workers.dev/wisp/", bare: "https://fr.aethernet.workers.dev/bare/" },
  de: { name: "🇩🇪 Allemagne", wisp: "wss://de.aethernet.workers.dev/wisp/", bare: "https://de.aethernet.workers.dev/bare/" },
  us: { name: "🇺🇸 USA", wisp: "wss://us.aethernet.workers.dev/wisp/", bare: "https://us.aethernet.workers.dev/bare/" },
  uk: { name: "🇬🇧 UK", wisp: "wss://uk.aethernet.workers.dev/wisp/", bare: "https://uk.aethernet.workers.dev/bare/" },
  nl: { name: "🇳🇱 Pays-Bas", wisp: "wss://nl.aethernet.workers.dev/wisp/", bare: "https://nl.aethernet.workers.dev/bare/" },
};

// Récupère le serveur sélectionné
function getCurrentServer() {
  const saved = localStorage.getItem('selectedServer') || 'auto';
  return SERVERS[saved] || SERVERS.auto;
}

// Construit les URLs Wisp/Bare selon le serveur sélectionné
function getWispUrl() {
  const server = getCurrentServer();
  if (server.wisp) return server.wisp;
  return (location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/ws/stream/";  // masqué: /ws/stream/ au lieu de /wisp/
}

function getBareUrl() {
  const server = getCurrentServer();
  if (server.bare) return server.bare;
  return (location.protocol === "https:" ? "https" : "http") + "://" + location.host + "/api/v1/";  // masqué: /api/v1/ au lieu de /bare/
}

// Support navigateurs sans SharedWorker (WebView Android, iOS Safari)
let connection = null;
try {
  if (typeof SharedWorker !== 'undefined' && typeof BareMux !== 'undefined') {
    connection = new BareMux.BareMuxConnection("/workers/worker.js");  // masqué: /workers/ au lieu de /baremux/
    console.log('BareMux loaded');
  } else {
    console.warn('SharedWorker or BareMux not available');
  }
} catch (e) {
  console.warn('BareMux init error:', e);
  connection = null;
}

const els = {
  frame: document.getElementById("frame"),
  newtab: document.getElementById("newtab"),
  back: document.getElementById("btn-back"),
  fwd: document.getElementById("btn-fwd"),
  home: document.getElementById("btn-home"),
  tabsBtn: document.getElementById("btn-tabs"),
  tabsCount: document.getElementById("tabs-count"),
  menuBtn: document.getElementById("btn-menu"),
  bm: document.getElementById("btn-bm"),
  panel: document.getElementById("panel"),
  panelBody: document.getElementById("panel-body"),
  panelClose: document.getElementById("panel-close"),
  panelTabs: Array.from(document.querySelectorAll(".ptab")),
  addrLock: document.getElementById("addr-lock"),
  address: document.getElementById("address"),
  suggestions: document.getElementById("suggestions"),
  loadBar: document.getElementById("load-bar"),
  stDot: document.getElementById("st-dot"),
  stText: document.getElementById("st-text"),
  stProxy: document.getElementById("st-proxy"),
  ntInp: document.getElementById("nt-inp"),
  ntGrid: document.getElementById("nt-grid"),
  ntHist: document.getElementById("nt-hist"),
  ntFavGrid: document.getElementById("nt-fav-grid"),
  ntAddFav: document.getElementById("nt-add-fav"),
  serverSelect: document.getElementById("server-select"),
  menuOverlay: document.getElementById("menu-overlay"),
  menuClose: document.getElementById("menu-close"),
  menuReload: document.getElementById("menu-reload"),
  menuDownload: document.getElementById("menu-download"),
  menuBookmarks: document.getElementById("menu-bookmarks"),
  menuHistory: document.getElementById("menu-history"),
  menuSettings: document.getElementById("menu-settings"),
  tabsOverlay: document.getElementById("tabs-overlay"),
  tabsClose: document.getElementById("tabs-close"),
  tabsGrid: document.getElementById("tabs-grid"),
  tabsBtnNew: document.getElementById("tabs-btn-new"),
};

// Log des éléments manquants pour debug
console.log("DOM Elements check:");
Object.entries(els).forEach(([k, v]) => {
  if (!v) console.warn(`Missing element: ${k}`);
});

const DEFAULTS = {
  activeTabId: null,
  tabs: [],
  bookmarks: [
    { id: "b1", title: "Brave Search", url: "https://search.brave.com", folder: "Barre" },
    { id: "b2", title: "YouTube", url: "https://youtube.com", folder: "Barre" },
    { id: "b3", title: "GitHub", url: "https://github.com", folder: "Barre" },
    { id: "b4", title: "Wikipedia", url: "https://fr.wikipedia.org", folder: "Barre" },
  ],
  history: [],
  downloads: [],
  settings: { showBookmarks: true, transport: "epoxy" },
};

let state = null;
let panelMode = "history";
let loadBarTimer = null;
let sgIdx = -1;
let sgData = [];

function uid(prefix = "i") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escA(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;");
}
function domain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url || "";
  }
}
function fmtTime(ts) {
  const d = new Date(ts);
  const now = Date.now();
  const delta = (now - ts) / 1000;
  if (delta < 60) return `Il y a ${Math.floor(delta)}s`;
  if (delta < 3600) return `Il y a ${Math.floor(delta / 60)}min`;
  if (delta < 86400) return `Il y a ${Math.floor(delta / 3600)}h`;
  return d.toLocaleDateString("fr-FR");
}

function setStatus(txt, dot = "g", pulse = false) {
  els.stText.textContent = txt || "";
  els.stDot.className = "st-dot" + (dot ? " " + dot : "") + (pulse ? " pulse" : "");
}
function setAddrSec(url) {
  if (!url || url === "about:newtab") {
    els.addrLock.textContent = "";
    els.addrLock.className = "";
    return;
  }
  if (url.startsWith("https://")) {
    els.addrLock.textContent = "🔒";
    els.addrLock.className = "https";
  } else {
    els.addrLock.textContent = "⚠️";
    els.addrLock.className = "http";
  }
}
function setLoadBar(pct) {
  if (loadBarTimer) clearTimeout(loadBarTimer);
  els.loadBar.classList.remove("done", "go");
  if (pct >= 100) {
    els.loadBar.style.width = "100%";
    els.loadBar.classList.add("done");
    loadBarTimer = setTimeout(() => (els.loadBar.style.width = "0"), 700);
    return;
  }
  els.loadBar.style.width = `${pct}%`;
  if (pct > 0 && pct < 100) els.loadBar.classList.add("go");
}

function normalizeUrl(raw) {
  const v = String(raw || "").trim();
  if (!v) return "about:newtab";
  if (v === "about:newtab" || v === "about:blank") return "about:newtab";
  if (/^about:/i.test(v)) return v.toLowerCase();
  if (/^[a-z]+:\/\//i.test(v)) return v;
  if (v.includes(".") && !v.includes(" ")) return "https://" + v;
  return SEARCH_URL.replace("%s", encodeURIComponent(v));
}
function titleFromUrl(url) {
  if (!url || url === "about:newtab") return "Nouvel onglet";
  return domain(url) || "Page";
}

function loadState() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
  } catch (e) {
    console.warn("localStorage non disponible:", e);
    saved = null;
  }
  state = {
    ...DEFAULTS,
    ...(saved || {}),
    settings: { ...DEFAULTS.settings, ...((saved && saved.settings) || {}) },
  };
  if (!Array.isArray(state.tabs) || state.tabs.length === 0) {
    const t = newTabModel("about:newtab");
    state.tabs = [t];
    state.activeTabId = t.id;
  }
  if (!state.tabs.some((t) => t.id === state.activeTabId)) state.activeTabId = state.tabs[0].id;
}
function saveState() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

function newTabModel(url) {
  const norm = normalizeUrl(url);
  return {
    id: uid("tab"),
    title: titleFromUrl(norm),
    url: norm,
    history: [norm],
    historyIndex: 0,
    transport: state?.settings?.transport || "epoxy",
    loading: false,
  };
}
function getTab(id = state.activeTabId) {
  return state.tabs.find((t) => t.id === id);
}
function activeTab() {
  return getTab(state.activeTabId);
}
function pushGlobalHistory(url, title) {
  if (!url || url === "about:newtab") return;
  const last = state.history[0];
  if (last && last.url === url && Date.now() - last.time < 8000) return;
  state.history.unshift({ id: uid("h"), url, title: title || domain(url), time: Date.now() });
  state.history = state.history.slice(0, 800);
}

async function setTransport(mode) {
  if (!connection) return;
  const bareUrl = getBareUrl();
  const wispUrl = getWispUrl();
  if (mode === "bare") return connection.setTransport("/modules/index.mjs", [bareUrl]);  // masqué: /modules/
  return connection.setTransport("/transport/index.mjs", [{ wisp: wispUrl }]);  // masqué: /transport/
}
async function ensureTransport(mode) {
  if (!connection) return;
  if (await connection.getTransport()) return;
  await setTransport(mode);
}
function toProxiedUrl(url) {
  return __uv$config.prefix + __uv$config.encodeUrl(url);
}

function renderTabs() {
  // Render tabs in the overlay grid (Chrome mobile style)
  if (!els.tabsGrid) return;
  els.tabsGrid.innerHTML = state.tabs
    .map((t) => {
      const active = t.id === state.activeTabId;
      const domainStr = domain(t.url);
      return `
        <div class="tab-card ${active ? "active" : ""} ${t.loading ? "tab-card-loading" : ""}" data-id="${t.id}">
          <button class="tab-card-close" data-close="1">✕</button>
          <div class="tab-card-icon">${t.loading ? "⏳" : "🌐"}</div>
          <div class="tab-card-title">${esc(t.title)}</div>
          <div class="tab-card-url">${esc(domainStr)}</div>
        </div>`;
    })
    .join("");
}
function renderFavorites() {
  if (!els.ntFavGrid) return;
  const items = state.bookmarks.filter((b) => b.folder === "Barre").slice(0, 12);
  els.ntFavGrid.innerHTML = items
    .map(
      (b) => `
      <div class="nt-fav-item" data-url="${escA(b.url)}" data-id="${b.id}">
        <button class="nt-fav-delete" data-del="${b.id}">✕</button>
        <div class="nt-fav-icon">⭐</div>
        <div class="nt-fav-lbl">${esc(b.title)}</div>
      </div>`
    )
    .join("");
}

function addFavoriteFromCurrent() {
  const t = activeTab();
  if (!t || t.url === "about:newtab" || !t.url.startsWith("http")) {
    alert("Impossible d'ajouter cette page aux favoris");
    return;
  }
  const exists = state.bookmarks.some((b) => b.url === t.url);
  if (exists) {
    alert("Cette page est déjà dans vos favoris");
    return;
  }
  state.bookmarks.unshift({
    id: uid("bm"),
    title: t.title,
    url: t.url,
    folder: "Barre"
  });
  saveState();
  renderFavorites();
  updateBmBtn();
  alert("Ajouté aux favoris !");
}

function deleteFavorite(id) {
  const idx = state.bookmarks.findIndex((b) => b.id === id);
  if (idx >= 0) {
    state.bookmarks.splice(idx, 1);
    saveState();
    renderFavorites();
    updateBmBtn();
  }
}
function updateBmBtn() {
  const t = activeTab();
  const on = t && state.bookmarks.some((b) => b.url === t.url);
  els.bm.textContent = on ? "★" : "☆";
  els.bm.classList.toggle("bm-on", !!on);
}

function renderAll() {
  renderTabs();
  renderFavorites();
  if (els.panel.classList.contains("open")) renderPanel();
  const t = activeTab();
  els.address.value = t.url === "about:newtab" ? "" : t.url;
  // Update tabs count badge
  els.tabsCount.textContent = state.tabs.length;
  els.back.classList.toggle("off", t.historyIndex <= 0);
  els.fwd.classList.toggle("off", t.historyIndex >= t.history.length - 1);
  // Transport setting is now in settings panel only
  setAddrSec(t.url);
  updateBmBtn();
}

function showNewTab() {
  els.frame.style.display = "none";
  els.newtab.style.display = "flex";
  setStatus("Prêt", "g");
  setLoadBar(100);
  renderNewTab();
}
let loadTimeout = null;
let iframeBlocked = false;

// Détecte si l'iframe est bloquée
function checkIframeBlocked(url) {
  // Si pas de SharedWorker, l'iframe sera probablement bloquée
  if (!connection) {
    console.warn("No SharedWorker - iframe likely blocked for:", url);
    iframeBlocked = true;
    showIframeBlockedMessage(url);
  }
}

function showIframeBlockedMessage(url) {
  const domainStr = domain(url);
  // Créer un overlay si pas déjà présent
  let overlay = document.getElementById('iframe-blocked-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'iframe-blocked-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:999;display:flex;align-items:center;justify-content:center;flex-direction:column;padding:24px;';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div style="color:white;text-align:center;max-width:300px;">
      <div style="font-size:48px;margin-bottom:16px;">🔒</div>
      <div style="font-size:18px;font-weight:600;margin-bottom:8px;">${domainStr}</div>
      <div style="font-size:14px;color:#aaa;margin-bottom:24px;">Ce site bloque l'affichage dans l'application</div>
      <button id="open-external-btn" style="background:var(--accent);color:white;border:none;padding:12px 24px;border-radius:8px;font-size:16px;font-weight:500;cursor:pointer;width:100%;margin-bottom:12px;">Ouvrir dans navigateur</button>
      <button id="close-overlay-btn" style="background:transparent;color:#aaa;border:1px solid #555;padding:12px 24px;border-radius:8px;font-size:14px;cursor:pointer;width:100%;">Retour</button>
    </div>
  `;
  overlay.style.display = 'flex';
  
  document.getElementById('open-external-btn').onclick = () => {
    window.open(url, '_blank');
    overlay.style.display = 'none';
  };
  document.getElementById('close-overlay-btn').onclick = () => {
    overlay.style.display = 'none';
    showNewTab();
  };
}

async function loadFrameUrl(url, mode) {
  if (!url || url === "about:newtab") return showNewTab();
  els.newtab.style.display = "none";
  els.frame.style.display = "block";
  setStatus("Chargement…", "y", true);
  setLoadBar(15);
  
  // Clear any existing timeout
  if (loadTimeout) clearTimeout(loadTimeout);
  iframeBlocked = false;
  
  // Masquer l'overlay de blocage s'il existe
  const overlay = document.getElementById('iframe-blocked-overlay');
  if (overlay) overlay.style.display = 'none';
  
  // Set a timeout to detect slow/blocked loads
  loadTimeout = setTimeout(() => {
    setStatus("Chargement lent...", "y");
    console.warn("Page load timeout - possible iframe blocking");
    checkIframeBlocked(url);
  }, 5000);
  
  // Fallback: pas de proxy UV ou pas de SharedWorker = chargement direct
  if (!window.__uv$config || !connection) {
    els.stProxy.style.display = "none";
    els.frame.src = url;
    // Vérifier rapidement si chargé
    setTimeout(() => {
      try {
        // Si on ne peut pas accéder à contentDocument, l'iframe est bloquée
        const doc = els.frame.contentDocument || els.frame.contentWindow?.document;
        if (!doc || doc.body?.innerHTML === '') {
          checkIframeBlocked(url);
        }
      } catch (e) {
        // Erreur = iframe cross-origin bloquée
        checkIframeBlocked(url);
      }
    }, 3000);
    return;
  }
  try {
    await ensureTransport(mode);
    els.stProxy.style.display = "";
    els.frame.src = toProxiedUrl(url);
  } catch (e) {
    console.warn("Proxy failed, using direct:", e);
    els.stProxy.style.display = "none";
    els.frame.src = url;
  }
}

async function selectTab(id) {
  if (!getTab(id)) return;
  state.activeTabId = id;
  saveState();
  renderAll();
  const t = activeTab();
  await loadFrameUrl(t.url, t.transport);
}
async function createTab(url = "about:newtab") {
  const t = newTabModel(url);
  state.tabs.push(t);
  state.activeTabId = t.id;
  saveState();
  renderAll();
  await loadFrameUrl(t.url, t.transport);
}
async function closeTab(id) {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  state.tabs.splice(idx, 1);
  if (!state.tabs.length) state.tabs.push(newTabModel("about:newtab"));
  if (!state.tabs.some((t) => t.id === state.activeTabId)) state.activeTabId = state.tabs[0].id;
  saveState();
  renderAll();
  await loadFrameUrl(activeTab().url, activeTab().transport);
}
async function navigate(raw) {
  const t = activeTab();
  const url = normalizeUrl(raw);
  t.url = url;
  t.title = titleFromUrl(url);
  t.loading = url !== "about:newtab";
  t.history = t.history.slice(0, t.historyIndex + 1);
  t.history.push(url);
  t.historyIndex = t.history.length - 1;
  pushGlobalHistory(url, t.title);
  saveState();
  renderAll();
  await loadFrameUrl(t.url, t.transport);
}
async function goBack() {
  const t = activeTab();
  if (t.historyIndex <= 0) return;
  t.historyIndex -= 1;
  t.url = t.history[t.historyIndex];
  saveState();
  renderAll();
  await loadFrameUrl(t.url, t.transport);
}
async function goForward() {
  const t = activeTab();
  if (t.historyIndex >= t.history.length - 1) return;
  t.historyIndex += 1;
  t.url = t.history[t.historyIndex];
  saveState();
  renderAll();
  await loadFrameUrl(t.url, t.transport);
}

function toggleBookmark() {
  const t = activeTab();
  if (!t) return;
  const idx = state.bookmarks.findIndex((b) => b.url === t.url);
  if (idx >= 0) state.bookmarks.splice(idx, 1);
  else state.bookmarks.unshift({ id: uid("bm"), title: t.title, url: t.url, folder: "Barre" });
  saveState();
  renderFavorites();
  updateBmBtn();
}

function openDownloadForCurrent() {
  const t = activeTab();
  if (t.url === "about:newtab") return;
  const href = "/download?" + new URLSearchParams({ url: t.url }).toString();
  window.open(href, "_blank", "noopener,noreferrer");
  state.downloads.unshift({ id: uid("d"), url: t.url, title: t.title, time: Date.now(), href });
  state.downloads = state.downloads.slice(0, 400);
  saveState();
}

function togglePanel() {
  els.panel.classList.toggle("open");
  els.panelBtn.classList.toggle("on", els.panel.classList.contains("open"));
  if (els.panel.classList.contains("open")) renderPanel();
}
function switchPanel(mode) {
  panelMode = mode;
  els.panelTabs.forEach((t) => t.classList.toggle("on", t.dataset.p === mode));
  renderPanel();
}

function buildPanelHistory() {
  if (!state.history.length) return `<div class="empty-st"><div class="empty-st-ic">🕐</div>Aucun historique</div>`;
  return `
    <div class="pc">
      <div class="pc-h">
        <span class="pc-title">Historique</span>
        <button class="btn btn-xs btn-d" id="clear-history">Tout vider</button>
      </div>
      <div>
        ${state.history
          .slice(0, 80)
          .map(
            (h) => `
          <div class="pi" data-nav="${escA(h.url)}">
            <div class="pi-ic">🕐</div>
            <div class="pi-body">
              <div class="pi-title">${esc(h.title || domain(h.url))}</div>
              <div class="pi-sub">${esc(h.url)}</div>
            </div>
            <div class="pi-time">${esc(fmtTime(h.time))}</div>
          </div>`
          )
          .join("")}
      </div>
    </div>`;
}
function buildPanelBookmarks() {
  if (!state.bookmarks.length) return `<div class="empty-st"><div class="empty-st-ic">☆</div>Aucun favori</div>`;
  return `
    <div class="pc">
      <div class="pc-h"><span class="pc-title">Favoris</span></div>
      <div>
        ${state.bookmarks
          .slice(0, 120)
          .map(
            (b) => `
          <div class="pi" data-nav="${escA(b.url)}">
            <div class="pi-ic">☆</div>
            <div class="pi-body">
              <div class="pi-title">${esc(b.title)}</div>
              <div class="pi-sub">${esc(b.url)}</div>
            </div>
            <div class="pi-time"></div>
          </div>`
          )
          .join("")}
      </div>
    </div>`;
}
function buildPanelDownloads() {
  if (!state.downloads.length)
    return `<div class="empty-st"><div class="empty-st-ic">⬇</div>Aucun téléchargement</div>`;
  return `
    <div class="pc">
      <div class="pc-h">
        <span class="pc-title">Téléchargements</span>
        <button class="btn btn-xs btn-d" id="clear-downloads">Tout vider</button>
      </div>
      <div>
        ${state.downloads
          .slice(0, 120)
          .map(
            (d) => `
          <div class="pi" data-open="${escA(d.href || "")}">
            <div class="pi-ic">⬇</div>
            <div class="pi-body">
              <div class="pi-title">${esc(d.title || domain(d.url))}</div>
              <div class="pi-sub">${esc(d.url)}</div>
            </div>
            <div class="pi-time">${esc(fmtTime(d.time))}</div>
          </div>`
          )
          .join("")}
      </div>
    </div>`;
}
function buildPanelSettings() {
  return `
    <div class="pc">
      <div class="pc-h"><span class="pc-title">Réglages</span></div>
      <div style="padding:12px 14px; display:flex; gap:10px; flex-direction:column;">
        <label style="font-size:10.5px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;">Barre de favoris</label>
        <select id="st-bm" style="width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:6px 9px;border-radius:var(--r);font-size:12px;outline:none;">
          <option value="1" ${state.settings.showBookmarks ? "selected" : ""}>Afficher</option>
          <option value="0" ${!state.settings.showBookmarks ? "selected" : ""}>Masquer</option>
        </select>
        <label style="font-size:10.5px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;">Transport</label>
        <select id="st-transport" style="width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:6px 9px;border-radius:var(--r);font-size:12px;outline:none;">
          <option value="epoxy" ${state.settings.transport === "epoxy" ? "selected" : ""}>Epoxy (wisp)</option>
          <option value="bare" ${state.settings.transport === "bare" ? "selected" : ""}>Bare</option>
        </select>
        <div style="display:flex; gap:8px; margin-top:8px;">
          <button class="btn btn-p" id="save-settings">Enregistrer</button>
          <button class="btn btn-d" id="wipe-all">Tout effacer</button>
        </div>
      </div>
    </div>`;
}
function renderPanel() {
  if (panelMode === "history") els.panelBody.innerHTML = buildPanelHistory();
  else if (panelMode === "bookmarks") els.panelBody.innerHTML = buildPanelBookmarks();
  else if (panelMode === "downloads") els.panelBody.innerHTML = buildPanelDownloads();
  else els.panelBody.innerHTML = buildPanelSettings();
}

function showSug(q) {
  const q2 = String(q || "").trim();
  if (!q2) return hideSug();
  const items = [
    {
      icon: "🌐",
      title: q2.includes(".") || q2.startsWith("http") ? `Aller sur ${q2}` : `Rechercher "${q2}"`,
      url: normalizeUrl(q2),
      badge: "Go",
    },
  ];
  for (const b of state.bookmarks.filter((b) => (b.title + b.url).toLowerCase().includes(q2.toLowerCase())).slice(0, 3)) {
    items.push({ icon: "☆", title: b.title, url: b.url, badge: "Favori" });
  }
  for (const h of state.history.filter((h) => (h.title + h.url).toLowerCase().includes(q2.toLowerCase())).slice(0, 4)) {
    items.push({ icon: "🕐", title: h.title || domain(h.url), url: h.url, badge: "Historique" });
  }
  sgData = items.slice(0, 8);
  sgIdx = -1;
  els.suggestions.innerHTML = sgData
    .map(
      (it, i) => `
      <div class="sg" data-i="${i}">
        <div class="sg-ic">${esc(it.icon)}</div>
        <div class="sg-body">
          <div class="sg-title">${esc(it.title)}</div>
          <div class="sg-url">${esc(it.url)}</div>
        </div>
        <span class="sg-tag">${esc(it.badge || "")}</span>
      </div>`
    )
    .join("");
  els.suggestions.style.display = "block";
}
function hideSug() {
  els.suggestions.style.display = "none";
  els.suggestions.innerHTML = "";
  sgData = [];
  sgIdx = -1;
}
function sgNav(e) {
  if (els.suggestions.style.display === "none") return;
  const items = els.suggestions.querySelectorAll(".sg");
  if (!items.length) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    sgIdx = Math.min(sgIdx + 1, items.length - 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    sgIdx = Math.max(sgIdx - 1, 0);
  } else if (e.key === "Enter" && sgIdx >= 0) {
    e.preventDefault();
    navigate(sgData[sgIdx].url);
    hideSug();
    return;
  } else {
    return;
  }
  items.forEach((el, i) => el.classList.toggle("hi", i === sgIdx));
  if (sgIdx >= 0 && sgData[sgIdx]) els.address.value = sgData[sgIdx].url;
}

function renderNewTab() {
  // Render favorites on new tab page
  renderFavorites();
  
  const shortcuts = [
    { label: "Brave", url: "https://search.brave.com", icon: "🦁" },
    { label: "YouTube", url: "https://youtube.com", icon: "▶️" },
    { label: "GitHub", url: "https://github.com", icon: "🐙" },
    { label: "Wikipedia", url: "https://fr.wikipedia.org", icon: "📚" },
  ];
  els.ntGrid.innerHTML = shortcuts
    .map(
      (s) => `
      <div class="nt-sc" data-nav="${escA(s.url)}">
        <div class="nt-sc-ic">${esc(s.icon)}</div>
        <div class="nt-sc-lbl">${esc(s.label)}</div>
      </div>`
    )
    .join("");
  if (!state.history.length) {
    els.ntHist.innerHTML = `<div style="padding:20px;text-align:center;font-size:12px;color:var(--text3)">Aucune visite récente</div>`;
    return;
  }
  els.ntHist.innerHTML = state.history
    .slice(0, 6)
    .map(
      (h) => `
      <div class="nt-row" data-nav="${escA(h.url)}">
        <div class="nt-row-ic">🕐</div>
        <div class="nt-row-body">
          <div class="nt-row-title">${esc(h.title || domain(h.url))}</div>
          <div class="nt-row-url">${esc(h.url)}</div>
        </div>
        <div class="nt-row-time">${esc(fmtTime(h.time))}</div>
      </div>`
    )
    .join("");
}

function hardenFrameSameTab() {
  try {
    const win = els.frame.contentWindow;
    const doc = els.frame.contentDocument;
    if (!win || !doc) return;
    let base = doc.querySelector("base[data-operationbrowser='1']");
    if (!base) {
      base = doc.createElement("base");
      base.setAttribute("data-operationbrowser", "1");
      doc.head?.prepend(base);
    }
    base.setAttribute("target", "_self");
    const openImpl = (url) => {
      try {
        if (typeof url === "string" && url) win.location.href = url;
      } catch {}
      return win;
    };
    try {
      Object.defineProperty(win, "open", { value: openImpl, configurable: true, writable: true });
    } catch {
      win.open = openImpl;
    }
  } catch {
    // ignore
  }
}

els.frame.addEventListener("load", () => {
  setStatus("Terminé", "g");
  setLoadBar(100);
  const t = activeTab();
  if (t) t.loading = false;
  hardenFrameSameTab();
  pushGlobalHistory(activeTab().url, activeTab().title);
  saveState();
  renderTabs();
  renderNewTab();
});

// Wiring
els.back.addEventListener("click", goBack);
els.fwd.addEventListener("click", goForward);
// Reload is now in menu overlay
els.home.addEventListener("click", () => navigate(HOME_URL));
els.bm.addEventListener("click", toggleBookmark);
// Download is now in menu overlay
// Panel is opened via menu
els.panelClose.addEventListener("click", togglePanel);
// Transport selector is now in settings panel

// Favorites grid on new tab page
els.ntFavGrid?.addEventListener("click", (e) => {
  const favEl = e.target.closest(".nt-fav-item");
  if (!favEl) return;
  const delBtn = e.target.closest(".nt-fav-delete");
  if (delBtn) {
    const id = delBtn.dataset.del;
    deleteFavorite(id);
    return;
  }
  navigate(favEl.dataset.url);
});

// Add favorite button on new tab page
els.ntAddFav?.addEventListener("click", addFavoriteFromCurrent);

// Server selector
els.serverSelect?.addEventListener("change", (e) => {
  const selected = e.target.value;
  localStorage.setItem('selectedServer', selected);
  console.log('Server changed to:', selected, SERVERS[selected]?.name);
  // Reconnect with new server
  if (connection) {
    connection.setTransport("/transport/index.mjs", [{ wisp: getWispUrl() }]).catch(console.error);  // masqué: /transport/
  }
  alert('Serveur changé vers: ' + (SERVERS[selected]?.name || selected) + '\nRechargez la page pour appliquer.');
});

// Set initial value
if (els.serverSelect) {
  const saved = localStorage.getItem('selectedServer') || 'auto';
  els.serverSelect.value = saved;
}

els.panelTabs.forEach((el) => el.addEventListener("click", () => switchPanel(el.dataset.p)));
els.panelBody.addEventListener("click", (e) => {
  const nav = e.target.closest("[data-nav]");
  if (nav) return void navigate(nav.dataset.nav);
  const open = e.target.closest("[data-open]");
  if (open?.dataset.open) return void window.open(open.dataset.open, "_blank", "noopener,noreferrer");
  if (e.target?.id === "clear-history") {
    state.history = [];
    saveState();
    renderPanel();
    renderNewTab();
  }
  if (e.target?.id === "clear-downloads") {
    state.downloads = [];
    saveState();
    renderPanel();
  }
  if (e.target?.id === "save-settings") {
    state.settings.showBookmarks = document.getElementById("st-bm").value === "1";
    state.settings.transport = document.getElementById("st-transport").value;
    activeTab().transport = state.settings.transport;
    // Transport selector updated in settings panel
    saveState();
    renderAll();
  }
  if (e.target?.id === "wipe-all") {
    if (!confirm("Tout effacer ?")) return;
    localStorage.removeItem(STORE_KEY);
    loadState();
    renderAll();
    showNewTab();
  }
});

els.address.addEventListener("keydown", (e) => {
  if (e.key === "Enter") return void navigate(els.address.value);
  sgNav(e);
});
els.address.addEventListener("input", (e) => showSug(e.target.value));
document.addEventListener("click", (e) => {
  if (!e.target.closest("#addr-wrap")) hideSug();
});
els.suggestions.addEventListener("mousedown", (e) => {
  const row = e.target.closest(".sg");
  if (!row) return;
  const i = parseInt(row.dataset.i, 10);
  if (sgData[i]) navigate(sgData[i].url);
  hideSug();
});

els.ntInp.addEventListener("keydown", (e) => {
  if (e.key === "Enter") navigate(els.ntInp.value);
});
// Menu overlay events
function openMenu() {
  els.menuOverlay.classList.add("visible");
}
function closeMenu() {
  els.menuOverlay.classList.remove("visible");
}

els.menuBtn.addEventListener("click", openMenu);
els.menuClose.addEventListener("click", closeMenu);
els.menuOverlay.addEventListener("click", (e) => {
  if (e.target === els.menuOverlay) closeMenu();
});

els.menuReload.addEventListener("click", () => {
  closeMenu();
  loadFrameUrl(activeTab().url, activeTab().transport);
});

els.menuDownload.addEventListener("click", () => {
  closeMenu();
  openDownloadForCurrent();
});

els.menuBookmarks.addEventListener("click", () => {
  closeMenu();
  switchPanel("bookmarks");
  togglePanel();
});

els.menuHistory.addEventListener("click", () => {
  closeMenu();
  switchPanel("history");
  togglePanel();
});

els.menuSettings.addEventListener("click", () => {
  closeMenu();
  switchPanel("settings");
  togglePanel();
});

// Tabs overlay functions
function openTabsOverlay() {
  renderTabs();
  els.tabsOverlay.classList.add("visible");
}
function closeTabsOverlay() {
  els.tabsOverlay.classList.remove("visible");
}

// Tabs button - open tabs overlay (Chrome mobile style)
els.tabsBtn.addEventListener("click", openTabsOverlay);
els.tabsClose.addEventListener("click", closeTabsOverlay);
els.tabsOverlay.addEventListener("click", (e) => {
  if (e.target === els.tabsOverlay) closeTabsOverlay();
});

// Tab card clicks
els.tabsGrid.addEventListener("click", (e) => {
  const card = e.target.closest(".tab-card");
  if (!card) return;
  const id = card.dataset.id;
  if (e.target?.dataset?.close === "1") {
    closeTab(id);
    renderTabs();
    return;
  }
  closeTabsOverlay();
  selectTab(id);
});

// New tab button in overlay
els.tabsBtnNew.addEventListener("click", () => {
  closeTabsOverlay();
  createTab("about:newtab");
});

els.ntGo?.addEventListener("click", () => navigate(els.ntInp.value));
els.newtab?.addEventListener("click", (e) => {
  const nav = e.target.closest("[data-nav]");
  if (nav) navigate(nav.dataset.nav);
});

// Allow parent frames (AetherOS) to request navigation.
window.addEventListener("message", async (event) => {
  try {
    const data = event && event.data;
    if (!data || typeof data !== "object") return;
    if (data.type !== "AETHER_OPEN_URL") return;
    const raw = String(data.url || "").trim();
    if (!raw) return;
    try {
      event.source?.postMessage({ type: "AETHER_OPEN_URL_ACK", ok: true, url: raw }, "*");
    } catch {}
    await navigate(raw);
  } catch {}
});

async function boot() {
  try {
    console.log("Boot starting...");
    loadState();
    console.log("State loaded, tabs:", state.tabs.length);
    renderAll();
    renderNewTab();
    showNewTab();
    setStatus("Prêt", "g");
    console.log("Boot complete");

    const params = new URLSearchParams(location.search || "");
    let initial = String(params.get("url") || "").trim();
    try {
      const decoded = decodeURIComponent(initial);
      if (/^https?:\/\//i.test(decoded) || /^about:/i.test(decoded)) initial = decoded;
    } catch {}
    if (initial) await navigate(initial);
  } catch (e) {
    console.error("Boot error:", e);
    alert("Erreur de démarrage: " + e.message);
  }
}

// Attendre que le DOM soit prêt
document.addEventListener("DOMContentLoaded", boot);
﻿
