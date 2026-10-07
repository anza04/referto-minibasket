/* Salvataggio locale (localStorage + IndexedDB) e sincronizzazione con Google Drive */
(function () {
  'use strict';

  // ---------- partite (localStorage) ----------
  const GAME_PREFIX = 'mb.game.';
  const Games = {
    list() {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(GAME_PREFIX)) {
          try { out.push(JSON.parse(localStorage.getItem(k))); } catch (e) { /* ignora */ }
        }
      }
      return out.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
    },
    get(id) {
      try { return JSON.parse(localStorage.getItem(GAME_PREFIX + id)); } catch (e) { return null; }
    },
    save(game) {
      game.updated = new Date().toISOString();
      localStorage.setItem(GAME_PREFIX + game.id, JSON.stringify(game));
    },
    remove(id) { localStorage.removeItem(GAME_PREFIX + id); }
  };

  // ---------- impostazioni ----------
  const SETTINGS_KEY = 'mb.settings';
  const DEFAULTS = { cloud: 'none', clientId: '', folder: '', folderName: '', variant: 'std', segnapunti: '', autoJson: true };
  const Settings = {
    get() {
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch (e) { /* impostazioni illeggibili */ }
      const s = Object.assign({}, DEFAULTS, saved);
      // valori della società (js/config.js) usati quando sul dispositivo non è stato impostato nulla
      const C = window.MB_CONFIG || {};
      if (!('cloud' in saved) && C.cloud) s.cloud = C.cloud;
      if (!s.clientId && C.googleClientId) s.clientId = C.googleClientId;
      if (!s.folder && C.driveFolder) { s.folder = C.driveFolder; s.folderName = s.folderName || C.driveFolderName || ''; }
      return s;
    },
    set(patch) {
      const s = Object.assign(Settings.get(), patch);
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
      return s;
    }
  };

  // ---------- IndexedDB (coda di caricamento + cartella locale) ----------
  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((res, rej) => {
        const r = indexedDB.open('minibasket-referti', 1);
        r.onupgradeneeded = () => {
          r.result.createObjectStore('queue', { keyPath: 'name' });
          r.result.createObjectStore('kv');
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
        // se il browser blocca il database (es. altra scheda aperta) non restare in attesa per sempre
        setTimeout(() => rej(new Error('Archivio del browser non disponibile')), 5000);
      });
      dbp.catch(() => { dbp = null; });
    }
    return dbp;
  }
  async function tx(store, mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const s = t.objectStore(store);
      const out = fn(s);
      t.oncomplete = () => res(out && 'result' in out ? out.result : out);
      t.onerror = () => rej(t.error);
    });
  }
  const IDB = {
    put: (store, val, key) => tx(store, 'readwrite', s => s.put(val, key)),
    get: (store, key) => tx(store, 'readonly', s => s.get(key)),
    del: (store, key) => tx(store, 'readwrite', s => s.delete(key)),
    all: store => tx(store, 'readonly', s => s.getAll())
  };

  // ---------- Cloud ----------
  const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
  let token = null, tokenExp = 0, gisLoading = null, syncing = false;
  // accesso Google ricordato fino alla scadenza (circa 1 ora), anche dopo un ricaricamento della pagina
  const TOKEN_KEY = 'mb.googleToken', CONSENT_KEY = 'mb.googleConsent';
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
    if (t && t.exp > Date.now() + 60000) { token = t.token; tokenExp = t.exp; }
  } catch (e) { /* nessun accesso salvato */ }
  function saveToken() {
    try { if (token) localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, exp: tokenExp })); else localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignora */ }
  }

  function emit(detail) { window.dispatchEvent(new CustomEvent('mb-sync', { detail })); }

  function parseFolderId(s) {
    s = (s || '').trim();
    const m = /\/folders\/([A-Za-z0-9_-]+)/.exec(s) || /[?&]id=([A-Za-z0-9_-]+)/.exec(s);
    return m ? m[1] : s;
  }

  function loadGis() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    if (!gisLoading) {
      gisLoading = new Promise((res, rej) => {
        const sc = document.createElement('script');
        sc.src = 'https://accounts.google.com/gsi/client';
        sc.async = true;
        sc.onload = () => res();
        sc.onerror = () => { gisLoading = null; rej(new Error('Impossibile caricare Google Identity (sei online?)')); };
        document.head.appendChild(sc);
      });
    }
    return gisLoading;
  }

  async function getToken(interactive) {
    if (token && Date.now() < tokenExp - 60000) return token;
    if (!interactive) return null;
    const st = Settings.get();
    if (!st.clientId) throw new Error('Client ID Google non configurato (Impostazioni).');
    if (location.protocol === 'file:') throw new Error('Per Google Drive l\'app deve essere aperta da http(s):// (vedi LEGGIMI).');
    await loadGis();
    return new Promise((res, rej) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: st.clientId, scope: DRIVE_SCOPE,
        callback: r => {
          if (r.error) return rej(new Error('Accesso Google negato: ' + r.error));
          token = r.access_token; tokenExp = Date.now() + (r.expires_in || 3600) * 1000;
          saveToken();
          try { localStorage.setItem(CONSENT_KEY, '1'); } catch (e) { /* ignora */ }
          res(token);
        },
        error_callback: e => rej(new Error('Accesso Google annullato: ' + (e && e.type || '')))
      });
      // dopo il primo consenso basta un tocco: niente più schermata di autorizzazione
      let consented = false;
      try { consented = localStorage.getItem(CONSENT_KEY) === '1'; } catch (e) { /* ignora */ }
      client.requestAccessToken({ prompt: consented ? '' : 'consent' });
    });
  }

  async function driveFetch(url, opts) {
    const r = await fetch(url, Object.assign({}, opts, { headers: Object.assign({ Authorization: 'Bearer ' + token }, (opts && opts.headers) || {}) }));
    if (r.status === 401) { token = null; saveToken(); throw new Error('Sessione Google scaduta: premi "Sincronizza".'); }
    if (!r.ok) throw new Error('Google Drive: ' + r.status + ' ' + (await r.text()).slice(0, 200));
    return r.json();
  }

  async function driveUpsert(item, folderId) {
    const q = `name='${item.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed=false`;
    const found = await driveFetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id)&q=' + encodeURIComponent(q));
    if (found.files && found.files.length) {
      return driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${found.files[0].id}?uploadType=media&supportsAllDrives=true`, {
        method: 'PATCH', headers: { 'Content-Type': item.mime }, body: item.blob
      });
    }
    const boundary = 'mb' + Math.random().toString(36).slice(2);
    const meta = { name: item.name, parents: [folderId], mimeType: item.mime };
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
      `--${boundary}\r\nContent-Type: ${item.mime}\r\n\r\n`, item.blob, `\r\n--${boundary}--`
    ]);
    return driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true', {
      method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body
    });
  }

  async function folderHandle(interactive) {
    const h = await IDB.get('kv', 'dir');
    if (!h) return null;
    let perm = await h.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted' && interactive) perm = await h.requestPermission({ mode: 'readwrite' });
    return perm === 'granted' ? h : null;
  }

  const Cloud = {
    parseFolderId,
    supportsFolder: () => 'showDirectoryPicker' in window,
    async pickFolder() {
      const h = await window.showDirectoryPicker({ mode: 'readwrite', id: 'referti-minibasket' });
      await IDB.put('kv', h, 'dir');
      Settings.set({ cloud: 'folder', folderName: h.name });
      return h.name;
    },
    async connectDrive() {
      await getToken(true);
      const st = Settings.get();
      const id = parseFolderId(st.folder);
      if (!id) throw new Error('Indica la cartella di Google Drive.');
      const f = await driveFetch(`https://www.googleapis.com/drive/v3/files/${id}?supportsAllDrives=true&fields=id,name,mimeType`);
      if (f.mimeType !== 'application/vnd.google-apps.folder') throw new Error('L\'ID indicato non è una cartella.');
      Settings.set({ folderName: f.name });
      return f.name;
    },
    isConnected() {
      const st = Settings.get();
      if (st.cloud === 'drive') return !!(token && Date.now() < tokenExp - 60000);
      return st.cloud === 'folder';
    },
    async pending() { try { return (await IDB.all('queue')).length; } catch (e) { return 0; } },
    async pendingNames() { try { return (await IDB.all('queue')).map(x => x.name); } catch (e) { return []; } },

    // aggiunge un file alla coda (sostituisce versioni precedenti con lo stesso nome) e prova a inviarlo
    async save(name, blob, mime) {
      const st = Settings.get();
      if (st.cloud === 'none') return { queued: false };
      await IDB.put('queue', { name, blob, mime, at: Date.now() });
      emit({ state: 'queued', pending: await Cloud.pending() });
      Cloud.sync(false).catch(() => { });
      return { queued: true };
    },

    async sync(interactive) {
      if (syncing) return;
      const st = Settings.get();
      if (st.cloud === 'none') return;
      const items = await IDB.all('queue');
      if (!items.length) { emit({ state: 'ok', pending: 0 }); return; }
      if (!navigator.onLine && st.cloud === 'drive') { emit({ state: 'offline', pending: items.length }); return; }
      syncing = true;
      emit({ state: 'syncing', pending: items.length });
      try {
        if (st.cloud === 'drive') {
          const t = await getToken(interactive);
          if (!t) { emit({ state: 'auth', pending: items.length }); return; }
          const folderId = parseFolderId(st.folder);
          for (const it of items) { await driveUpsert(it, folderId); await IDB.del('queue', it.name); }
        } else if (st.cloud === 'folder') {
          const h = await folderHandle(interactive);
          if (!h) { emit({ state: 'auth', pending: items.length }); return; }
          for (const it of items) {
            const fh = await h.getFileHandle(it.name, { create: true });
            const w = await fh.createWritable();
            await w.write(it.blob); await w.close();
            await IDB.del('queue', it.name);
          }
        }
        emit({ state: 'ok', pending: await Cloud.pending() });
      } catch (e) {
        emit({ state: 'error', error: e.message, pending: await Cloud.pending() });
        if (interactive) throw e;
      } finally { syncing = false; }
    }
  };

  window.addEventListener('online', () => Cloud.sync(false).catch(() => { }));

  window.MB_STORE = { Games, Settings, IDB, Cloud };
})();
