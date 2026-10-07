/* Referto Minibasket - interfaccia */
(function () {
  'use strict';
  const R = window.MB_RULES, E = window.MB_ENGINE, X = window.MB_XLSX;
  const { Games, Settings, Cloud } = window.MB_STORE;
  const other = E.other;

  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = $('#app');

  let view = 'home';
  let game = null, st = null;   // partita aperta e stato calcolato
  let wiz = null;               // procedura guidata nuova partita
  let form = null;              // { game, isNew } modulo dati gara
  let modalHandlers = null;

  // ---------------------------------------------------------------- util
  function toast(msg, ms) {
    const t = $('#toast');
    t.innerHTML = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), ms || 3500);
  }
  function fmtClock(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return d ? `${d}/${m}/${y}` : iso;
  }
  function plabel(team, id) {
    const p = game.teams[team].players.find(x => x.id === id);
    return p ? `#${esc(p.number)} ${esc(p.name)}` : '?';
  }
  function teamName(t, g) { return (g || game).teams[t].name || `Squadra ${t}`; }
  function slug(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  }
  function baseName(g) {
    const rules = E.rulesOf(g);
    return ['Referto', g.info.data || '', slug(rules.categoryName), slug(rules.name), slug(teamName('A', g)) + '-vs-' + slug(teamName('B', g)), g.info.gara ? 'gara' + slug(g.info.gara) : '']
      .filter(Boolean).join('_');
  }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
  function setPath(obj, path, val) {
    const ks = path.split('.'); const last = ks.pop();
    const tgt = ks.reduce((o, k) => o[k], obj);
    tgt[last] = val;
  }
  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.45].forEach(t0 => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 880; o.type = 'square';
        g.gain.setValueAtTime(0.25, ctx.currentTime + t0); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t0 + 0.4);
        o.connect(g); g.connect(ctx.destination); o.start(ctx.currentTime + t0); o.stop(ctx.currentTime + t0 + 0.4);
      });
    } catch (e) { /* audio non disponibile */ }
    if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
  }

  // ---------------------------------------------------------------- modale
  function openModal({ title, body, foot, wide, handlers }) {
    modalHandlers = handlers || {};
    $('#modalRoot').innerHTML = `
      <div class="modal-backdrop" data-act="__backdrop">
        <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
          <div class="modal-head"><h2>${title}</h2><button class="btn small ghost" data-act="__close" aria-label="Chiudi">✕</button></div>
          <div class="modal-body">${body}</div>
          ${foot ? `<div class="modal-foot">${foot}</div>` : ''}
        </div>
      </div>`;
  }
  function setModalBody(html) { const b = $('#modalRoot .modal-body'); if (b) b.innerHTML = html; }
  function closeModal() { $('#modalRoot').innerHTML = ''; modalHandlers = null; }
  function confirmModal(title, html, okLabel, onOk, danger) {
    openModal({
      title, body: html,
      foot: `<button class="btn" data-act="__close">Annulla</button><button class="btn ${danger ? 'danger' : 'primary'}" data-act="ok">${okLabel || 'Conferma'}</button>`,
      handlers: { ok: () => { closeModal(); onOk(); } }
    });
  }

  // ---------------------------------------------------------------- partita: persistenza ed eventi
  function recompute() { st = E.compute(game); }
  function persist() { Games.save(game); }
  function addEvents(evs) {
    const grp = E.uid();
    const clk = clockRemaining();
    evs.forEach(e => {
      e.id = E.uid(); e.grp = grp;
      if (e.period === undefined) e.period = st.period;
      e.clock = fmtClock(clk);
      e.at = Date.now();
      game.events.push(e);
    });
    recompute(); persist();
  }
  function undoLast() {
    if (!game.events.length) return;
    const g = game.events[game.events.length - 1].grp;
    const removed = game.events.filter(e => e.grp === g);
    game.events = game.events.filter(e => e.grp !== g);
    recompute(); persist();
    toast('Annullato: ' + removed.map(describe).join(' · '));
    render();
  }
  function openGame(id) {
    game = Games.get(id);
    if (!game) { toast('Partita non trovata'); return; }
    recompute();
    view = st.finished ? 'summary' : 'game';
    render();
  }

  // ---------------------------------------------------------------- cronometro
  function periodMs() { return (st ? st.rules.minutes : 0) * 60000; }
  function clockRemaining() {
    if (!game) return 0;
    const c = game.clock;
    const base = c.remaining == null ? periodMs() : c.remaining;
    return c.running ? Math.max(0, base - (Date.now() - c.startedAt)) : base;
  }
  function clockStart() {
    if (!st.inPeriod) { toast('Avvia prima il periodo.'); return; }
    if (clockRemaining() <= 0) { toast('Tempo scaduto: chiudi il periodo o regola il cronometro.'); return; }
    game.clock.remaining = clockRemaining();
    game.clock.startedAt = Date.now(); game.clock.running = true; persist(); updateClock();
  }
  function clockPause() {
    if (!game.clock.running) return;
    game.clock.remaining = clockRemaining(); game.clock.running = false; persist(); updateClock();
  }
  function updateClock() {
    const el = $('#clock');
    if (!el || !game) return;
    const ms = clockRemaining();
    el.textContent = fmtClock(ms);
    el.classList.toggle('running', game.clock.running);
    el.classList.toggle('zero', ms <= 0);
    const b = $('#clockBtn');
    if (b) b.textContent = game.clock.running ? '⏸ Pausa' : '▶ Avvia';
    const br = $('#breakTimer');
    if (br) {
      const left = (game.clock.breakUntil || 0) - Date.now();
      br.textContent = left > 0 ? `Intervallo: ${fmtClock(left)}` : '';
      if (left <= 0 && game.clock.breakUntil) { game.clock.breakUntil = null; persist(); beep(); }
    }
    if (game.clock.running && ms <= 0) {
      game.clock.running = false; game.clock.remaining = 0; persist();
      beep();
      toast(`<b>Fine del ${R.periodName(st.period)}!</b> Premi «Fine tempo» per chiudere il periodo.`, 6000);
      render();
    }
  }
  setInterval(() => { if (view === 'game') updateClock(); }, 250);

  // ---------------------------------------------------------------- descrizione eventi
  function describe(e) {
    switch (e.type) {
      case 'score': return `${e.foulPoint ? 'Punto su fallo' : e.pts === 2 ? 'Canestro' : 'Tiro libero'} ${plabel(e.team, e.player)} (+${e.pts})`;
      case 'foul': return e.coach != null ? `Fallo tecnico al ${e.coach + 1}° Istruttore` : `Fallo ${e.kind} ${plabel(e.team, e.player)}`;
      case 'timeout': return 'Time-out';
      case 'sub': return !e.in ? `Esce ${plabel(e.team, e.out)} senza sostituto` : `Sostituzione: esce ${plabel(e.team, e.out)}, entra ${plabel(e.team, e.in)}${e.reason === 'injury' ? ' (infortunio)' : e.reason === 'exclusion' ? ' (esclusione)' : ''}`;
      case 'periodStart': return `Inizio ${R.periodName(e.period)}`;
      case 'periodEnd': return `Fine ${R.periodName(e.period)}`;
      case 'spareggio': return `Gara/spareggio vinta da ${esc(teamName(e.winner))}`;
      case 'forfeit': return `Sconfitta a tavolino: ${esc(teamName(e.loser))}`;
      default: return e.type;
    }
  }

  function ownerFooter() {
    return `<footer class="owner"><img src="icons/logo-senna.png" alt="" width="40" height="40"><span>App di proprietà della <b>Polisportiva Senna</b></span></footer>`;
  }

  // ================================================================= HOME
  function renderHome() {
    const games = Games.list();
    const items = games.map(g => {
      let s; try { s = E.compute(g); } catch (e) { return ''; }
      const rules = s.rules;
      const status = s.finished ? '<span class="badge done">Terminata</span>' : s.started ? '<span class="badge live">In corso</span>' : '<span class="badge">Da iniziare</span>';
      return `<div class="card game-item">
        <div>
          <div class="row">${status}<small>${esc(fmtDate(g.info.data))} ${esc(g.info.ora)} · ${esc(rules.categoryName)} · ${esc(rules.name)}</small></div>
          <h3 style="margin:.35rem 0">${esc(teamName('A', g))} – ${esc(teamName('B', g))}</h3>
          <div class="row">
            <button class="btn small primary" data-act="openGame" data-id="${g.id}">Apri</button>
            <button class="btn small" data-act="openSummary" data-id="${g.id}">Referto / Esporta</button>
            <button class="btn small danger" data-act="deleteGame" data-id="${g.id}">Elimina</button>
          </div>
        </div>
        <div class="score">${s.started ? `${s.final.A} – ${s.final.B}` : ''}</div>
      </div>`;
    }).join('');
    const set = Settings.get();
    app.innerHTML = `
      <div class="card hero">
        <div class="hero-brand">
          <img src="icons/logo-senna.png" alt="Polisportiva Senna" class="hero-logo">
          <div>
            <h1>Referto Minibasket</h1>
            <p class="muted">Polisportiva Senna · segnapunti elettronico con le regole FIP 2026/2027 e compilazione del referto ufficiale.</p>
          </div>
        </div>
        <div class="row">
          <button class="btn big primary" data-act="newGame">+ Nuova partita</button>
          <button class="btn" data-act="importJson">Importa backup</button>
        </div>
      </div>
      ${set.cloud === 'none' ? `<div class="notice info">I dati sono salvati su questo dispositivo. Per salvarli anche su Google Drive configura la cartella in <a href="#" data-act="goSettings">Impostazioni</a>.</div>` : ''}
      <h2 style="margin-top:18px">Partite</h2>
      ${items || '<p class="muted">Nessuna partita salvata.</p>'}
      ${ownerFooter()}
      <input type="file" id="importFile" accept=".json,application/json" class="hidden">`;
  }

  // ================================================================= NUOVA PARTITA (procedura guidata)
  function renderWizard() {
    const steps = ['Categoria', 'Modalità', 'Dati gara e squadre'];
    const idx = { cat: 0, mode: 1, form: 2 }[wiz.step];
    const head = `<div class="steps">${steps.map((s, i) => `<span class="${i === idx ? 'on' : ''}">${i + 1}. ${s}</span>`).join('')}</div>`;
    if (wiz.step === 'cat') {
      const groups = [
        ['Easybasket', ['pulcini', 'paperine']],
        ['Scoiattoli / Libellule', ['scoiattoli_small', 'scoiattoli_big', 'libellule_small', 'libellule_big']],
        ['Aquilotti / Gazzelle', ['aquilotti_small', 'aquilotti_big', 'gazzelle_small', 'gazzelle_big', 'aquilotti_open', 'gazzelle_open']],
        ['Esordienti', ['esordienti_m', 'esordienti_f', 'esordienti_m_open', 'esordienti_f_open']]
      ];
      app.innerHTML = `${head}<div class="card"><h1>Qual è la categoria della gara?</h1>
        ${groups.map(([g, ids]) => `<div class="group-title">${g}</div><div class="grid cols-3">${ids.map(id => {
          const c = R.category(id);
          return `<button class="choice ${c.modes.length ? '' : 'disabled'}" data-act="pickCat" data-id="${id}"><b>${esc(c.name)}</b><small>Nati nel ${esc(c.years)}</small></button>`;
        }).join('')}</div>`).join('')}
        <div class="row" style="margin-top:14px"><button class="btn" data-act="goHome">Annulla</button></div></div>`;
    } else if (wiz.step === 'mode') {
      const c = R.category(wiz.categoryId);
      app.innerHTML = `${head}<div class="card"><h1>${esc(c.name)}: modalità di gioco</h1>
        <p class="muted">Modalità previste dal regolamento per questa categoria.</p>
        <div class="grid cols-2">${c.modes.map(m => {
          const r = R.effectiveRules(c.id, m);
          return `<button class="choice" data-act="pickMode" data-id="${m}"><b>${esc(r.name)}</b>
            <small>${r.periods} periodi da ${r.minutes}' · ${r.minPlayers}-${r.maxPlayers} giocatori · limite falli ${r.foulLimit} · ${r.freeThrows ? 'tiri liberi' : 'no tiri liberi'}${r.timeoutsPerPeriod ? ' · 1 time-out per periodo' : ''}</small>
            <small>${r.clock === 'effective' ? 'Tempo effettivo' : 'Cronometro continuo'} · ${r.drawAllowed ? 'pareggio ammesso' : 'pareggio non ammesso (spareggio)'}</small></button>`;
        }).join('')}</div>
        <div class="row" style="margin-top:14px"><button class="btn" data-act="wizBack">Indietro</button></div></div>`;
    } else {
      app.innerHTML = head + renderForm();
    }
  }

  // ----- modulo dati gara / squadre (usato anche per modificare una partita esistente)
  function renderForm() {
    const g = form.game;
    const rules = E.rulesOf(g);
    const started = g.events.length > 0;
    const inp = (path, label, type, extra) => `<label class="field">${label}<input type="${type || 'text'}" data-bind="${path}" value="${esc(getPath(g, path))}" ${extra || ''}></label>`;
    const team = t => {
      const tm = g.teams[t];
      const rows = tm.players.map((p, i) => `<tr>
          <td class="num"><input type="text" inputmode="numeric" data-bind="teams.${t}.players.${i}.number" value="${esc(p.number)}" aria-label="Numero maglia"></td>
          <td><input type="text" data-bind="teams.${t}.players.${i}.name" value="${esc(p.name)}" aria-label="Cognome e nome"></td>
          <td class="num"><input type="text" inputmode="numeric" maxlength="4" data-bind="teams.${t}.players.${i}.year" value="${esc(p.year || '')}" placeholder="2016" aria-label="Anno di nascita"></td>
          <td class="act"><button class="btn small ghost" data-act="delPlayer" data-team="${t}" data-i="${i}" aria-label="Rimuovi">✕</button></td></tr>`).join('');
      return `<div class="card team-head-${t}">
        <h2>Squadra "${t}"</h2>
        <div class="grid cols-2">${inp(`teams.${t}.name`, 'Nome squadra')}${inp(`teams.${t}.color`, 'Colore maglia')}</div>
        <div class="grid cols-2" style="margin-top:8px">
          ${inp(`teams.${t}.coaches.0.name`, '1° Istruttore')}${inp(`teams.${t}.coaches.0.card`, 'N° tessera 1° Istruttore')}
          ${inp(`teams.${t}.coaches.1.name`, '2° Istruttore')}${inp(`teams.${t}.coaches.1.card`, 'N° tessera 2° Istruttore')}
        </div>
        <div class="row between" style="margin-top:12px">
          <h3 style="margin:0">Giocatori <small id="cnt${t}">${countLabel(tm.players.length, rules)}</small></h3>
          <div class="row"><button class="btn small" data-act="pastePlayers" data-team="${t}">Incolla elenco</button>
          <button class="btn small primary" data-act="addPlayer" data-team="${t}" ${tm.players.length >= 12 ? 'disabled' : ''}>+ Giocatore</button></div>
        </div>
        <table class="roster"><thead><tr><th>N°</th><th>Nome e cognome</th><th>Anno</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      </div>`;
    };
    return `
      <div class="card">
        <h1>${esc(rules.categoryName)} · ${esc(rules.name)}</h1>
        <details><summary>Regole applicate</summary><ul class="rules">${rules.notes.concat(R.GENERAL_NOTES).map(n => `<li>${esc(n)}</li>`).join('')}
          ${rules.highHoop ? '<li>Canestro ad altezza 3,05 m (Esordienti).</li>' : ''}</ul></details>
      </div>
      <div class="card">
        <h2>Dati gara</h2>
        <div class="grid cols-3">
          ${inp('info.girone', 'Girone')}${inp('info.gara', 'Gara n°')}${inp('info.data', 'Data', 'date')}${inp('info.ora', 'Ora', 'time')}
          ${inp('info.campo', 'Campo di gioco')}${inp('info.arbitri', 'Arbitri / Miniarbitro')}${inp('info.segnapunti', 'Segnapunti')}${inp('info.cronometrista', 'Cronometrista')}${inp('info.dae', 'Addetto DAE (defibrillatore)')}
          <label class="field">Modello di referto
            <select data-bind="templateVariant">
              <option value="std" ${g.templateVariant !== 'int' ? 'selected' : ''}>Standard</option>
              <option value="int" ${g.templateVariant === 'int' ? 'selected' : ''}>Con intestazione FIP</option>
            </select></label>
        </div>
      </div>
      <div class="grid cols-2">${team('A')}${team('B')}</div>
      <div class="row between card">
        <button class="btn" data-act="${form.isNew ? 'wizBack' : 'formCancel'}">${form.isNew ? 'Indietro' : 'Chiudi'}</button>
        <button class="btn big primary" data-act="formSubmit">${form.isNew ? 'Crea partita' : (started ? 'Salva e torna alla partita' : 'Salva')}</button>
      </div>`;
  }
  function countLabel(n, rules) {
    const ok = n >= rules.minPlayers && n <= rules.maxPlayers;
    return `<span style="color:var(${ok ? '--ok' : '--warn'})">${n} (min ${rules.minPlayers}, max ${rules.maxPlayers})</span>`;
  }
  function playerUsed(g, team, id) {
    return g.events.some(e => e.team === team && (e.player === id || e.in === id || e.out === id)) ||
      g.events.some(e => e.type === 'periodStart' && e.lineups && e.lineups[team] && (e.lineups[team].group.includes(id) || e.lineups[team].court.includes(id)));
  }
  function submitForm() {
    const g = form.game;
    const rules = E.rulesOf(g);
    const errs = [], warns = [];
    E.TEAMS.forEach(t => {
      const tm = g.teams[t];
      tm.players = tm.players.filter(p => p.name.trim() || String(p.number).trim() || playerUsed(g, t, p.id));
      if (!tm.name.trim()) errs.push(`Indica il nome della squadra "${t}".`);
      if (tm.players.length < rules.onCourt) errs.push(`Squadra "${t}": servono almeno ${rules.onCourt} giocatori.`);
      if (tm.players.length > 12) errs.push(`Squadra "${t}": massimo 12 giocatori sul referto.`);
      const nums = tm.players.map(p => String(p.number).trim());
      if (nums.some(n => !n)) errs.push(`Squadra "${t}": indica il numero di maglia di tutti i giocatori.`);
      const dup = nums.filter((n, i) => n && nums.indexOf(n) !== i);
      if (dup.length) errs.push(`Squadra "${t}": numeri di maglia duplicati (${[...new Set(dup)].join(', ')}).`);
      if (tm.players.length < rules.minPlayers) warns.push(`Squadra "${t}": ${tm.players.length} giocatori, il minimo è ${rules.minPlayers}: la gara si può giocare ma il risultato non ha efficacia per la classifica (pro-forma).`);
      if (tm.players.length > rules.maxPlayers) errs.push(`Squadra "${t}": massimo ${rules.maxPlayers} giocatori per questa modalità.`);
      if (!tm.coaches[0].name.trim() && !tm.coaches[1].name.trim()) warns.push(`Squadra "${t}": senza almeno un Istruttore tesserato la gara non può essere disputata.`);
    });
    if (errs.length) {
      render();
      openModal({ title: 'Controlla i dati', body: errs.map(e => `<div class="notice error">${esc(e)}</div>`).join(''), foot: '<button class="btn primary" data-act="__close">OK</button>' });
      return;
    }
    const go = () => {
      Games.save(g);
      game = g; recompute();
      const s = Settings.get();
      if (g.info.segnapunti && !s.segnapunti) Settings.set({ segnapunti: g.info.segnapunti });
      form = null; wiz = null;
      view = 'game'; render();
    };
    if (warns.length) confirmModal('Attenzione', warns.map(w => `<div class="notice warn">${esc(w)}</div>`).join(''), 'Prosegui comunque', go);
    else go();
  }
  function pastePlayers(t) {
    openModal({
      title: `Incolla elenco squadra "${t}"`,
      body: `<p class="muted">Una riga per giocatore, con numero, nome e (facoltativo) anno di nascita (es. <code>7 Mario Rossi 2016</code> oppure <code>Mario Rossi;7</code>). I giocatori verranno aggiunti in fondo all'elenco.</p><textarea id="pasteArea" rows="10"></textarea>`,
      foot: '<button class="btn" data-act="__close">Annulla</button><button class="btn primary" data-act="ok">Aggiungi</button>',
      handlers: {
        ok: () => {
          const lines = $('#pasteArea').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
          const tm = form.game.teams[t];
          lines.forEach(l => {
            if (tm.players.length >= 12) return;
            let year = '';
            const ym = /[\s;,	]+((?:19|20)\d\d)$/.exec(l);
            if (ym) { year = ym[1]; l = l.slice(0, ym.index).trim(); }
            let m = /^(\d{1,3})[\s;,.\-\t]+(.+)$/.exec(l), number = '', name = l;
            if (m) { number = m[1]; name = m[2]; }
            else if ((m = /^(.+?)[\s;,\t]+(\d{1,3})$/.exec(l))) { name = m[1]; number = m[2]; }
            tm.players.push({ id: E.uid(), number, name: name.trim(), year });
          });
          closeModal(); render();
        }
      }
    });
  }

  // ================================================================= PARTITA
  function renderGame() {
    const rules = st.rules;
    const p = st.period;
    const A = st.teams.A, B = st.teams.B;
    const curA = p >= 0 ? A.periodScore[p] : 0, curB = p >= 0 ? B.periodScore[p] : 0;
    let phase = '';
    if (st.finished) {
      phase = `<button class="btn big accent" data-act="toSummary">Partita terminata – Referto ed esportazione</button>`;
    } else if (st.inPeriod) {
      phase = `<button class="btn big accent" data-act="endPeriod">Fine ${R.periodName(p)}</button>`;
    } else if (st.allPeriodsPlayed) {
      phase = `<button class="btn big accent" data-act="toSummary">${st.needsSpareggio ? 'Parità: gara/spareggio' : 'Vai al referto'}</button>`;
    } else {
      phase = `<button class="btn big primary" data-act="startPeriod">Inizia ${R.periodName(p + 1)}</button><span id="breakTimer" class="badge live" style="align-self:center"></span>`;
    }
    const ppRow = st.periodPoints.map((x, i) => x ? `${i + 1}°: ${x[0]}-${x[1]}` : '').filter(Boolean).join(' · ');
    app.innerHTML = `
      <div class="scoreboard">
        <div class="sb-team A"><div class="sb-name">${esc(teamName('A'))}</div><div class="sb-score">${curA}</div><div class="sb-sub">punti nel periodo</div></div>
        <div class="sb-mid">
          <div class="period-label">${p >= 0 ? R.periodName(p) : 'Pre-partita'} <small class="muted">/ ${rules.periods}</small></div>
          <div class="clock" id="clock">${fmtClock(clockRemaining())}</div>
          <div class="clock-ctrls">
            <button class="btn small primary" id="clockBtn" data-act="clockToggle" ${st.inPeriod ? '' : 'disabled'}>${game.clock.running ? '⏸ Pausa' : '▶ Avvia'}</button>
            <button class="btn small" data-act="clockEdit" ${st.inPeriod ? '' : 'disabled'} title="Regola cronometro">⏱</button>
          </div>
          <div class="pp-line">Partita <b>${st.final.A} – ${st.final.B}</b> · progressivo ${st.totals.A}-${st.totals.B}</div>
          ${ppRow ? `<div class="pp-line">${ppRow}</div>` : ''}
        </div>
        <div class="sb-team B"><div class="sb-name">${esc(teamName('B'))}</div><div class="sb-score">${curB}</div><div class="sb-sub">punti nel periodo</div></div>
      </div>
      <div class="phase-bar">${phase}</div>
      ${!st.inPeriod && !st.started ? `<div class="notice info">${rules.clock === 'effective' ? '<b>Tempo effettivo</b>: ferma il cronometro a ogni fischio del Miniarbitro.' : '<b>Cronometro continuo</b>: si ferma solo per falli' + (rules.timeoutsPerPeriod ? ', time-out' : '') + ' o su indicazione del Miniarbitro.'} Tocca un giocatore in campo per registrare canestri e falli.</div>` : ''}
      <div class="teams">${teamPanel('A')}${teamPanel('B')}</div>
      <div class="card" style="margin-top:12px">
        <div class="row between"><h3 style="margin:0">Cronologia</h3>
          <div class="row"><button class="btn small" data-act="undo" ${game.events.length ? '' : 'disabled'}>↶ Annulla ultima azione</button>
          <button class="btn small" data-act="editInfo">Dati gara</button>
          <button class="btn small" data-act="toSummary">Referto</button></div></div>
        <div class="log">${game.events.slice().reverse().map(e => `<div class="log-item"><span class="t">${e.type === 'periodStart' || e.type === 'periodEnd' ? '' : esc(e.clock || '')} ${e.period != null && e.period >= 0 ? (e.period + 1) + '°' : ''}</span><span class="dot ${e.team || 'N'}"></span><span class="txt">${describe(e)}</span>${['score', 'foul', 'timeout'].includes(e.type) && game.events.filter(x => x.grp === e.grp).length === 1 ? `<button class="btn small ghost" data-act="delEvent" data-id="${e.id}" aria-label="Elimina">✕</button>` : ''}</div>`).join('') || '<p class="muted">Nessun evento.</p>'}</div>
      </div>`;
    updateClock();
  }

  function teamPanel(t) {
    const rules = st.rules, T = st.teams[t], p = st.period;
    const tm = game.teams[t];
    const court = st.inPeriod ? T.court : [];
    const ordered = tm.players.map(x => T.players[x.id]);
    const onCourt = court.map(id => T.players[id]).filter(Boolean);
    const bench = ordered.filter(x => !court.includes(x.id));
    const btn = (pl, isCourt) => {
      const fouls = Array.from({ length: rules.foulLimit }, (_, i) => `<i class="${i < pl.fouls.length ? 'on' : ''}"></i>`).join('');
      const k = E.periodsPlayed(pl, rules);
      return `<button class="pbtn ${isCourt ? 'court' : 'bench'} ${pl.out || pl.injured ? 'out' : ''}" data-act="player" data-team="${t}" data-id="${pl.id}">
        <span class="pnum">${esc(pl.number)}</span><span class="pname">${esc(pl.name)}</span>
        <span class="pmeta"><span class="fouls" title="Falli">${fouls}</span><span>${k} per.</span>${pl.out ? `<b style="color:var(--err)">${pl.out === 'falli' ? 'ESCLUSO' : 'ESPULSO'}</b>` : pl.injured ? '<b>INF.</b>' : ''}</span>
        <span class="ppts">${pl.points}</span></button>`;
    };
    const tfoul = p >= 0 ? T.teamFouls[p] : 0;
    const to = p >= 0 ? T.timeouts[p] : 0;
    const coachInfo = T.coaches.map((c, i) => c.techs ? `${i + 1}° Istr.: ${'T'.repeat(c.techs)}${c.expelled ? ' (espulso)' : ''}` : '').filter(Boolean).join(' · ');
    return `<section class="team-panel ${t}">
      <h3><span>${esc(teamName(t))}</span><span style="font-variant-numeric:tabular-nums">${T.total} pt</span></h3>
      <div class="team-stats">
        <span class="badge ${rules.bonus && tfoul >= rules.bonus ? 'bonus' : ''}">Falli squadra nel periodo: ${tfoul}${rules.bonus && tfoul >= rules.bonus ? ' – BONUS' : ''}</span>
        ${rules.timeoutsPerPeriod ? `<span class="badge">Time-out: ${to}/${rules.timeoutsPerPeriod}</span>` : ''}
        ${coachInfo ? `<span class="badge">${esc(coachInfo)}</span>` : ''}
      </div>
      ${st.inPeriod ? `<div class="sub-title">In campo</div><div class="players">${onCourt.map(x => btn(x, true)).join('') || '<small class="muted">Nessuno</small>'}</div>` : ''}
      ${st.inPeriod && rules.subs === 'group' ? `
        <div class="sub-title">Panchina – gruppo del periodo (cambi ammessi)</div>
        <div class="players">${bench.filter(x => T.group.includes(x.id)).map(x => btn(x, false)).join('') || '<small class="muted">Nessuno</small>'}</div>
        <div class="sub-title">Fuori gruppo</div>
        <div class="players">${bench.filter(x => !T.group.includes(x.id)).map(x => btn(x, false)).join('')}</div>` : `
        <div class="sub-title">${st.inPeriod ? 'Panchina' : 'Giocatori'}</div>
        <div class="players">${bench.map(x => btn(x, false)).join('')}</div>`}
      <div class="team-actions">
        ${rules.timeoutsPerPeriod ? `<button class="btn small" data-act="timeout" data-team="${t}" ${st.inPeriod && to < rules.timeoutsPerPeriod ? '' : 'disabled'}>Time-out</button>` : ''}
        <button class="btn small" data-act="coachTech" data-team="${t}" ${st.inPeriod ? '' : 'disabled'}>Tecnico Istruttore</button>
        <button class="btn small" data-act="subMenu" data-team="${t}" ${st.inPeriod ? '' : 'disabled'}>Sostituzione</button>
      </div>
    </section>`;
  }

  // ----- formazioni a inizio periodo
  function openLineup() {
    const p = st.period + 1;
    const rules = st.rules;
    const sel = {};
    E.TEAMS.forEach(t => { sel[t] = E.suggestLineup(game, st, t, p); });
    const help = rules.subs === 'group'
      ? 'Tocca un giocatore per indicarlo <b>in campo</b> (verde); tocca ancora per inserirlo nel <b>gruppo del periodo in panchina</b> (arancio, potrà entrare con cambi all\'interno del gruppo).'
      : rules.subs === 'free' ? 'Scegli il quintetto iniziale: durante il periodo i cambi sono liberi.' : `Scegli i ${rules.onCourt} giocatori che disputano il periodo: non sono ammesse sostituzioni (salvo falli, espulsione o infortunio).`;
    const body = () => `<p class="muted">${help}</p>` + E.TEAMS.map(t => {
      const T = st.teams[t];
      const lu = sel[t];
      const ws = E.checkLineup(game, st, t, p, lu);
      const chips = game.teams[t].players.map(pp => {
        const pl = T.players[pp.id];
        const state = lu.court.includes(pl.id) ? 'court' : lu.group.includes(pl.id) ? 'group' : '';
        const dis = pl.out || pl.injured;
        return `<button class="chip ${state} ${dis ? 'disabled' : ''}" data-act="tog" data-team="${t}" data-id="${pl.id}" ${dis ? 'disabled' : ''}>
          <span class="ctop">#${esc(pl.number)} ${esc(pl.name)}</span>
          <span class="cmeta">${E.periodsPlayed(pl, rules)} periodi · ${pl.points} pt · ${pl.fouls.length} falli${pl.out ? ' · escluso' : ''}${pl.injured ? ' · infortunato' : ''}${state === 'group' ? ' · gruppo (panchina)' : ''}</span></button>`;
      }).join('');
      return `<div class="card team-head-${t}"><div class="row between"><h3 style="margin:0">${esc(teamName(t))} <small class="muted">in campo ${lu.court.length}/${rules.onCourt}${rules.subs === 'group' ? ` · gruppo ${lu.group.length}` : ''}</small></h3>
        <button class="btn small" data-act="suggest" data-team="${t}">Suggerisci (regolamento)</button></div>
        <div class="chip-list" style="margin-top:8px">${chips}</div>
        ${ws.map(w => `<div class="notice ${w.level === 'error' ? 'error' : w.level === 'warn' ? 'warn' : 'info'}">${esc(w.msg)}</div>`).join('')}</div>`;
    }).join('');
    openModal({
      title: `Formazioni ${R.periodName(p)}`, wide: true, body: body(),
      foot: '<button class="btn" data-act="__close">Annulla</button><button class="btn primary big" data-act="ok">Inizia periodo</button>',
      handlers: {
        tog: d => {
          const lu = sel[d.team], id = d.id;
          const inC = lu.court.includes(id), inG = lu.group.includes(id);
          const rm = (arr, x) => { const i = arr.indexOf(x); if (i >= 0) arr.splice(i, 1); };
          if (rules.subs === 'group') {
            if (inC) { rm(lu.court, id); if (!inG) lu.group.push(id); }
            else if (inG) rm(lu.group, id);
            else { lu.court.push(id); lu.group.push(id); }
          } else if (rules.subs === 'free') {
            if (inC) rm(lu.court, id); else lu.court.push(id);
          } else {
            if (inC) { rm(lu.court, id); rm(lu.group, id); } else { lu.court.push(id); lu.group.push(id); }
          }
          setModalBody(body());
        },
        suggest: d => { sel[d.team] = E.suggestLineup(game, st, d.team, p); setModalBody(body()); },
        ok: () => {
          const errs = E.TEAMS.flatMap(t => E.checkLineup(game, st, t, p, sel[t]).filter(w => w.level === 'error').map(w => `${teamName(t)}: ${w.msg}`));
          if (errs.length) { toast(esc(errs[0])); return; }
          E.TEAMS.forEach(t => {
            if (rules.subs === 'free') sel[t].group = game.teams[t].players.map(x => x.id);
            else sel[t].group = [...new Set([...sel[t].group, ...sel[t].court])];
          });
          closeModal();
          addEvents([{ type: 'periodStart', period: p, lineups: JSON.parse(JSON.stringify(sel)) }]);
          game.clock = { remaining: periodMs(), running: false, startedAt: null, breakUntil: null };
          persist();
          toast(`${R.periodName(p)}: premi ▶ Avvia al fischio d'inizio.`);
          render();
        }
      }
    });
  }

  function endPeriod() {
    const p = st.period;
    const a = st.teams.A.periodScore[p], b = st.teams.B.periodScore[p];
    const pts = a > b ? '3 – 1' : a < b ? '1 – 3' : '2 – 2';
    const warnTime = clockRemaining() > 0 ? `<div class="notice warn">Il cronometro segna ancora ${fmtClock(clockRemaining())}.</div>` : '';
    confirmModal(`Fine ${R.periodName(p)}`, `${warnTime}<p>Punteggio del periodo: <b>${esc(teamName('A'))} ${a} – ${b} ${esc(teamName('B'))}</b></p><p>Punti assegnati: <b>${pts}</b></p>`, 'Chiudi periodo', () => {
      clockPause();
      addEvents([{ type: 'periodEnd', period: p }]);
      const br = st.rules.breaks && st.rules.breaks[p];
      game.clock = { remaining: periodMs(), running: false, startedAt: null, breakUntil: br && !st.allPeriodsPlayed ? Date.now() + br * 60000 : null };
      persist();
      if (st.allPeriodsPlayed) { onGameMaybeFinished(); view = 'summary'; }
      render();
    });
  }

  // ----- azioni sul giocatore
  function openPlayer(t, id) {
    const rules = st.rules, T = st.teams[t], pl = T.players[id];
    const isCourt = st.inPeriod && T.court.includes(id);
    const title = `#${esc(pl.number)} ${esc(pl.name)} <small class="muted">${esc(teamName(t))}</small>`;
    const stats = `<p class="muted">${pl.points} punti · falli: ${pl.fouls.map(f => f.kind).join(' ') || 'nessuno'} · periodi giocati: ${E.periodsPlayed(pl, rules)}${pl.out ? ' · <b>escluso</b>' : ''}</p>`;
    if (!st.inPeriod) {
      openModal({ title, body: stats + '<div class="notice info">Avvia un periodo per registrare le azioni.</div>', foot: '<button class="btn" data-act="__close">Chiudi</button>' });
      return;
    }
    let body = stats;
    const handlers = {};
    if (isCourt && !pl.out) {
      body += `<div class="action-grid">
        <button class="btn primary" data-act="s2">+2<small>Canestro</small></button>
        ${rules.freeThrows ? '<button class="btn primary" data-act="s1">+1<small>Tiro libero</small></button>' : ''}
        <button class="btn" data-act="f" data-k="P">Fallo P<small>Personale</small></button>
        <button class="btn" data-act="f" data-k="U">Fallo U<small>Antisportivo</small></button>
        <button class="btn" data-act="f" data-k="D">Fallo D<small>Squalificante</small></button>
        <button class="btn" data-act="f" data-k="T">Fallo T<small>Tecnico</small></button>
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn small" data-act="inj">Esce per infortunio</button>
        ${rules.subs !== 'none' ? '<button class="btn small" data-act="subout">Sostituisci</button>' : ''}
      </div>`;
      handlers.s2 = () => { closeModal(); addEvents([{ type: 'score', team: t, player: id, pts: 2 }]); render(); };
      handlers.s1 = () => { closeModal(); addEvents([{ type: 'score', team: t, player: id, pts: 1, ft: true }]); render(); };
      handlers.f = d => { closeModal(); recordFoul(t, id, d.k, null); };
      handlers.inj = () => { closeModal(); openReplace(t, id, 'injury'); };
      handlers.subout = () => { closeModal(); openSub(t, id, null); };
    } else if (isCourt && pl.out) {
      body += `<div class="notice warn">Giocatore ${pl.out === 'falli' ? 'escluso per raggiunto limite di falli' : 'espulso'}: deve essere sostituito.</div>
        <button class="btn primary" data-act="rep">Scegli il sostituto</button>`;
      handlers.rep = () => { closeModal(); openReplace(t, id, 'exclusion'); };
    } else {
      const canEnter = !pl.out && !pl.injured && (rules.subs === 'free' || (rules.subs === 'group' && T.group.includes(id)));
      if (canEnter) {
        body += '<button class="btn primary" data-act="subin">Entra in campo</button>';
        handlers.subin = () => { closeModal(); openSub(t, null, id); };
      } else if (pl.injured) {
        body += '<div class="notice info">Infortunato: può rientrare solo al posto del giocatore che lo ha sostituito (usa "Sostituzione").</div>';
      } else {
        body += `<div class="notice info">${pl.out ? 'Giocatore escluso.' : rules.subs === 'group' ? 'Non fa parte del gruppo di questo periodo.' : 'In questa modalità non sono ammesse sostituzioni durante il periodo (salvo falli, espulsione o infortunio).'}</div>`;
      }
    }
    openModal({ title, body, foot: '<button class="btn" data-act="__close">Chiudi</button>', handlers });
  }

  function recordFoul(t, playerId, kind, coachIdx) {
    const rules = st.rules;
    clockPause();
    const foul = { type: 'foul', team: t, kind };
    if (coachIdx != null) foul.coach = coachIdx; else foul.player = playerId;
    const after = () => {
      render();
      if (playerId) {
        const pl = st.teams[t].players[playerId];
        if (pl.out) {
          toast(`<b>#${esc(pl.number)} ${pl.out === 'falli' ? 'escluso: limite di ' + rules.foulLimit + ' falli' : 'espulso'}</b>`, 5000);
          if (st.teams[t].court.includes(playerId)) openReplace(t, playerId, 'exclusion');
        }
      }
      if (coachIdx != null && st.teams[t].coaches[coachIdx].expelled) {
        toast(`<b>${coachIdx + 1}° Istruttore espulso</b> (2 falli tecnici).${coachIdx === 0 ? ' Subentra il 2° Istruttore.' : ''}`, 6000);
      }
    };
    if (!rules.freeThrows) {
      // modalità senza tiri liberi: 1 punto + possesso alla squadra avversaria
      const o = other(t);
      const opts = st.teams[o].court.map(id => st.teams[o].players[id]).filter(Boolean);
      const q = kind === 'T' ? 'A quale giocatore avversario attribuire il punto?' : 'Chi ha subito il fallo? (riceve 1 punto)';
      openModal({
        title: `Fallo ${kind}: 1 punto a ${esc(teamName(o))}`,
        body: `<p>${q}</p><div class="chip-list">${opts.map(pl => `<button class="chip" data-act="pick" data-id="${pl.id}"><span class="ctop">#${esc(pl.number)} ${esc(pl.name)}</span><span class="cmeta">${pl.points} pt</span></button>`).join('')}</div>
          <p class="muted" style="margin-top:10px">Tiri liberi non previsti in questa modalità: 1 punto e possesso di palla alla squadra che subisce il fallo.</p>`,
        foot: '<button class="btn" data-act="__close">Annulla</button>',
        handlers: { pick: d => { closeModal(); addEvents([foul, { type: 'score', team: o, player: d.id, pts: 1, ft: true, foulPoint: true }]); after(); } }
      });
      return;
    }
    addEvents([foul]);
    const tf = st.teams[t].teamFouls[st.period];
    let hint;
    if (kind === 'P') {
      hint = rules.bonus && tf > rules.bonus
        ? `<b>Bonus</b> (${tf}° fallo di squadra): 1 tiro libero + possesso. Se in azione di tiro: 2 tiri liberi.`
        : `In azione di tiro: 2 tiri liberi${rules.andOne ? ' (canestro realizzato: valido + 1 libero aggiuntivo)' : ' (canestro realizzato: valido, nessun libero)'}. Altrimenti rimessa.`;
    } else if (kind === 'U' || kind === 'D') {
      hint = `2 tiri liberi + possesso a metà campo${rules.andOne ? ' (canestro realizzato: valido + 1 libero)' : ''}.`;
    } else if (coachIdx != null) {
      hint = '2 tiri liberi agli avversari (senza rimbalzo) + rimessa a metà campo.';
    } else {
      hint = '2 tiri liberi agli avversari (con rimbalzo).';
    }
    toast(hint + ' Registra i liberi realizzati con «+1» sul tiratore.', 6500);
    after();
  }

  // sostituzione eccezionale (art. 43): falli, espulsione, infortunio
  function openReplace(t, outId, reason) {
    const rules = st.rules, T = st.teams[t];
    const outPl = T.players[outId];
    const cand = E.eligible(st, t).filter(x => !T.court.includes(x.id));
    const inGroup = x => T.group.includes(x.id) ? 0 : 1;
    cand.sort((a, b) => (rules.subs === 'group' ? inGroup(a) - inGroup(b) : 0) || E.byFairness(rules)(a, b));
    const rec = rules.subs === 'free' ? '' : '<p class="muted">Art. 43: entra chi ha giocato di meno e, a parità, chi ha segnato meno punti o commesso meno falli. Il primo è il consigliato.</p>';
    openModal({
      title: `Sostituisci #${esc(outPl.number)} ${esc(outPl.name)}`,
      body: `${rec}<div class="chip-list">${cand.map((pl, i) => {
        const k = E.periodsPlayed(pl, rules);
        const over = rules.subs === 'none' && !pl.entrate.has(st.period) && k >= rules.maxPeriods;
        return `<button class="chip ${i === 0 ? 'court' : ''}" data-act="pick" data-id="${pl.id}"><span class="ctop">#${esc(pl.number)} ${esc(pl.name)}${i === 0 && rec ? ' ★' : ''}</span>
          <span class="cmeta">${k} periodi · ${pl.points} pt · ${pl.fouls.length} falli${over ? ' · supera il max periodi' : ''}${rules.subs === 'group' && !T.group.includes(pl.id) ? ' · fuori gruppo' : ''}</span></button>`;
      }).join('') || '<p class="muted">Nessun giocatore disponibile.</p>'}</div>`,
      foot: `<button class="btn" data-act="none">Nessun sostituto (inferiorità numerica)</button>`,
      handlers: {
        pick: d => { closeModal(); addEvents([{ type: 'sub', team: t, out: outId, in: d.id, reason }]); render(); },
        none: () => {
          closeModal();
          addEvents([{ type: 'sub', team: t, out: outId, in: null, reason }]);
          render();
        }
      }
    });
  }

  // sostituzione ordinaria (OPEN: cambi liberi; 5c5: all'interno del gruppo)
  function openSub(t, outId, inId) {
    const rules = st.rules, T = st.teams[t];
    const pick = (title, list, cb) => openModal({
      title, body: `<div class="chip-list">${list.map(pl => `<button class="chip" data-act="pick" data-id="${pl.id}"><span class="ctop">#${esc(pl.number)} ${esc(pl.name)}</span><span class="cmeta">${pl.points} pt · ${pl.fouls.length} falli${pl.injured ? ' · infortunato' : ''}</span></button>`).join('') || '<p class="muted">Nessun giocatore disponibile.</p>'}</div>`,
      foot: '<button class="btn" data-act="__close">Annulla</button>',
      handlers: { pick: d => { closeModal(); cb(d.id); } }
    });
    const benchOk = () => Object.values(T.players).filter(x => !T.court.includes(x.id) && !x.out &&
      (rules.subs === 'free' || T.group.includes(x.id)) && (!x.injured || false));
    // rientro di un infortunato: solo al posto di chi lo ha sostituito
    const injuredBack = Object.values(T.players).filter(x => x.injured && !x.out);
    const done = (o, i) => { addEvents([{ type: 'sub', team: t, out: o, in: i, reason: T.players[i] && T.players[i].injured ? 'return' : rules.subs === 'free' ? 'free' : 'group' }]); render(); };
    if (rules.subs === 'none' && !outId && !inId && !injuredBack.length) {
      toast('In questa modalità non sono ammesse sostituzioni durante il periodo: per falli, espulsione o infortunio tocca il giocatore che esce.', 6000);
      return;
    }
    if (outId) {
      pick('Chi entra?', benchOk(), i => done(outId, i));
    } else if (inId) {
      pick('Chi esce?', T.court.map(id => T.players[id]).filter(Boolean), o => done(o, inId));
    } else {
      const extra = injuredBack.length ? `<p class="muted">Rientro da infortunio: scegli prima chi esce (il sostituto), poi l'infortunato che rientra.</p>` : '';
      openModal({
        title: `Sostituzione – ${esc(teamName(t))}`,
        body: `${extra}<p>Chi esce?</p><div class="chip-list">${T.court.map(id => T.players[id]).filter(Boolean).map(pl => `<button class="chip" data-act="o" data-id="${pl.id}"><span class="ctop">#${esc(pl.number)} ${esc(pl.name)}</span></button>`).join('')}</div>`,
        foot: '<button class="btn" data-act="__close">Annulla</button>',
        handlers: {
          o: d => {
            closeModal();
            const list = benchOk().concat(injuredBack.filter(x => !T.court.includes(x.id)));
            pick('Chi entra?', list, i => done(d.id, i));
          }
        }
      });
    }
  }

  // ================================================================= FIRME
  function signSlots() {
    const sigs = game.signatures || {};
    const coach = t => game.teams[t].coaches.map(c => c.name).filter(Boolean).join(' / ');
    const refs = (game.info.arbitri || '').split(/\s*(?:,|;|\/|\s-\s|\se\s)\s*/).filter(Boolean);
    return [
      { key: 'istruttoreA', label: `Istruttore ${teamName('A')}`, name: coach('A') },
      { key: 'istruttoreB', label: `Istruttore ${teamName('B')}`, name: coach('B') },
      { key: 'segnapunti', label: 'Segnapunti', name: game.info.segnapunti },
      { key: 'cronometrista', label: 'Cronometrista', name: game.info.cronometrista },
      { key: 'arbitro1', label: 'Arbitro', name: refs[0] || '' },
      { key: 'arbitro2', label: '2° Arbitro (se presente)', name: refs[1] || '' }
    ].map(x => Object.assign(x, sigs[x.key] || {}));
  }

  function renderSignCard() {
    const last = game.events.reduce((m, e) => Math.max(m, e.at || 0), 0);
    const slots = signSlots();
    const done = slots.filter(x => x.img).length;
    return `<div class="card"><div class="row between"><h2 style="margin:0">Firme</h2><small class="muted">${done} di ${slots.length} – inserite nel referto Excel e nella stampa</small></div>
      ${!st.finished ? '<div class="notice info">Le firme si raccolgono normalmente a fine gara.</div>' : ''}
      <div class="sign-grid">${slots.map(x => `<div class="sign-slot ${x.img ? 'signed' : ''}">
        <div class="sign-head"><b>${esc(x.label)}</b><small class="muted">${esc(x.name || '')}</small></div>
        <div class="sign-preview">${x.img ? `<img src="${x.img}" alt="Firma ${esc(x.label)}">` : '<span class="muted">Non firmato</span>'}</div>
        ${x.img && x.at && last > Date.parse(x.at) ? '<div class="notice warn" style="margin:4px 0">Il referto è stato modificato dopo la firma.</div>' : ''}
        <div class="row"><button class="btn small ${x.img ? '' : 'primary'}" data-act="sign" data-key="${x.key}">${x.img ? 'Rifai firma' : 'Firma'}</button>
        ${x.img ? `<button class="btn small danger" data-act="unsign" data-key="${x.key}">Rimuovi</button>` : ''}</div></div>`).join('')}</div></div>`;
  }

  function openSignPad(key) {
    const slot = signSlots().find(x => x.key === key);
    let pad = null;
    openModal({
      title: `Firma: ${esc(slot.label)}`, wide: true,
      body: `<p class="muted">${slot.name ? `Firma di <b>${esc(slot.name)}</b>. ` : ''}Firma con il dito, la penna o il mouse nel riquadro.</p>
        <div class="sigpad"><canvas id="sigCanvas" aria-label="Area firma"></canvas><div class="sigpad-line"></div><span class="sigpad-x">✕</span></div>`,
      foot: '<button class="btn" data-act="clear">Cancella</button><span class="grow"></span><button class="btn" data-act="__close">Annulla</button><button class="btn primary" data-act="save">Salva firma</button>',
      handlers: {
        clear: () => pad.clear(),
        save: () => {
          const out = pad.export();
          if (!out) { toast('Il riquadro è vuoto: firma prima di salvare.'); return; }
          game.signatures = game.signatures || {};
          game.signatures[key] = Object.assign(out, { at: new Date().toISOString(), name: slot.name || '' });
          persist(); closeModal(); render();
          toast('Firma salvata.');
          if (st.finished) saveToCloud(true, true);
        }
      }
    });
    pad = signaturePad($('#sigCanvas'));
  }

  // area di firma: tratto a penna con pressione (stilo) e curve levigate
  function signaturePad(canvas) {
    const ctx = canvas.getContext('2d');
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    let drawing = false, last = null, mid = null, empty = true;
    // adatta la risoluzione del canvas alla dimensione visibile (solo se vuoto: ridimensionare lo cancella)
    const fit = () => {
      const r = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (canvas.width === w && canvas.height === h) return;
      canvas.width = w; canvas.height = h;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#14246b'; ctx.fillStyle = '#14246b';
    };
    fit();
    const pos = e => { const b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top, p: e.pointerType === 'pen' ? e.pressure : 0 }; };
    const width = pt => (pt.p ? 1.4 + pt.p * 3 : 2.6);
    canvas.addEventListener('pointerdown', e => {
      e.preventDefault(); canvas.setPointerCapture(e.pointerId);
      if (empty) fit();
      drawing = true; last = pos(e); mid = last; empty = false;
      ctx.beginPath(); ctx.arc(last.x, last.y, width(last) / 2, 0, Math.PI * 2); ctx.fill();
    });
    canvas.addEventListener('pointermove', e => {
      if (!drawing) return;
      e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      for (const ev of evs.length ? evs : [e]) {
        const p = pos(ev);
        const m = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
        ctx.lineWidth = width(p);
        ctx.beginPath(); ctx.moveTo(mid.x, mid.y); ctx.quadraticCurveTo(last.x, last.y, m.x, m.y); ctx.stroke();
        last = p; mid = m;
      }
    });
    const end = () => { if (drawing) { ctx.beginPath(); ctx.moveTo(mid.x, mid.y); ctx.lineTo(last.x, last.y); ctx.stroke(); } drawing = false; };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    return {
      clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); empty = true; },
      // ritaglia la firma e la riduce (max 600 px di larghezza) per tenere leggero il salvataggio
      export() {
        if (empty) return null;
        const W = canvas.width, H = canvas.height;
        const data = ctx.getImageData(0, 0, W, H).data;
        let x0 = W, y0 = H, x1 = -1, y1 = -1;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (data[(y * W + x) * 4 + 3] > 10) {
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        if (x1 < 0) return null;
        const pad = Math.round(6 * dpr);
        x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
        const w = x1 - x0 + 1, h = y1 - y0 + 1, k = Math.min(1, 600 / w);
        const out = document.createElement('canvas');
        out.width = Math.max(1, Math.round(w * k)); out.height = Math.max(1, Math.round(h * k));
        const o = out.getContext('2d'); o.imageSmoothingQuality = 'high';
        o.drawImage(canvas, x0, y0, w, h, 0, 0, out.width, out.height);
        return { img: out.toDataURL('image/png'), w: out.width, h: out.height };
      }
    };
  }

  // ================================================================= RIEPILOGO / REFERTO
  function renderSummary() {
    const rules = st.rules;
    const val = E.validateGame(game, st);
    const winTxt = {
      periodi: w => `Vince ${esc(teamName(w))}`,
      pareggio: () => 'Pareggio (ammesso per questa categoria/modalità)',
      progressivo: w => `Parità nei punti dei periodi: vince ${esc(teamName(w))} per punteggio progressivo (${st.totals.A}-${st.totals.B}, art. 19)`,
      spareggio: w => `Vince ${esc(teamName(w))} dopo la gara/spareggio`,
      tavolino: w => `Vittoria a tavolino di ${esc(teamName(w))} (${rules.forfeit[1]}-${rules.forfeit[0]})`
    };
    const status = st.winner ? winTxt[st.winBy](st.winner) : st.needsSpareggio ? 'Parità anche nel punteggio progressivo: serve la gara/spareggio' : st.started ? 'Partita in corso' : 'Partita non iniziata';
    const set = Settings.get();
    const periodsRows = Array.from({ length: rules.periods }, (_, i) => {
      const pp = st.periodPoints[i];
      const played = st.ended.includes(i) || st.period === i;
      return `<tr><td class="l">${R.periodName(i)}</td><td>${played ? st.teams.A.periodScore[i] : ''}</td><td>${played ? st.teams.B.periodScore[i] : ''}</td><td>${pp ? pp[0] : ''}</td><td>${pp ? pp[1] : ''}</td></tr>`;
    }).join('');
    const teamTable = t => {
      const T = st.teams[t];
      return `<h3 style="margin-top:12px">${esc(teamName(t))}</h3><div class="table-wrap"><table class="sum"><thead><tr><th>N°</th><th class="l">Giocatore</th>${Array.from({ length: rules.periods }, (_, i) => `<th>${i + 1}°</th>`).join('')}<th>Falli</th><th>Punti</th></tr></thead><tbody>
        ${game.teams[t].players.map(p => { const pl = T.players[p.id]; return `<tr><td>${esc(p.number)}</td><td class="l">${esc(p.name)}</td>${Array.from({ length: rules.periods }, (_, i) => `<td>${pl.entrate.has(i) ? (pl.byPeriod[i].reduce((a, b) => a + b, 0) || 'X') : ''}</td>`).join('')}<td>${pl.fouls.map(f => f.kind).join(' ')}</td><td><b>${pl.points}</b></td></tr>`; }).join('')}
        </tbody></table></div>`;
    };
    app.innerHTML = `
      <div class="card">
        <div class="row between"><div><small class="muted">${esc(rules.categoryName)} · ${esc(rules.name)} · ${esc(fmtDate(game.info.data))} ${esc(game.info.ora)}</small><h1>Referto di gara</h1></div>
        <button class="btn" data-act="backToGame">← Torna alla partita</button></div>
        <div class="row" style="justify-content:center;gap:20px;margin:10px 0">
          <div style="text-align:right"><div class="sb-name" style="color:var(--teamA)">${esc(teamName('A'))}</div></div>
          <div class="result-big">${st.final.A} – ${st.final.B}</div>
          <div><div class="sb-name" style="color:var(--teamB)">${esc(teamName('B'))}</div></div>
        </div>
        <p style="text-align:center"><b>${status}</b><br><small class="muted">Punti realizzati: ${st.totals.A} – ${st.totals.B}</small></p>
        <div class="table-wrap"><table class="sum"><thead><tr><th class="l">Periodo</th><th>Punti A</th><th>Punti B</th><th>Punteggio A</th><th>Punteggio B</th></tr></thead><tbody>${periodsRows}
          ${st.spareggio ? `<tr><td class="l">Gara/spareggio</td><td colspan="2">${esc(teamName(st.spareggio))}</td><td>${st.spareggio === 'A' ? 3 : 1}</td><td>${st.spareggio === 'B' ? 3 : 1}</td></tr>` : ''}
          <tr><th class="l">Totale</th><th>${st.totals.A}</th><th>${st.totals.B}</th><th>${st.final.A}</th><th>${st.final.B}</th></tr></tbody></table></div>
      </div>
      ${st.needsSpareggio && !st.spareggio ? `<div class="card" style="border-color:var(--accent)">
        <h2>Gara/spareggio: Shooting Fire</h2>
        <p>Ogni squadra si divide in 2 gruppi, uno per canestro; il "potere" si assegna per sorteggio. Il primo dei 2 tiratori che realizza conquista il potere e fa 1 punto per la propria squadra. Si termina quando una squadra arriva a 12 punti su uno dei canestri; si sommano i punti dei 2 canestri (in caso di ulteriore parità si prosegue a oltranza). Vincente 3 punti, perdente 1.</p>
        <div class="row"><button class="btn big primary" data-act="spareggio" data-w="A">Vince ${esc(teamName('A'))}</button><button class="btn big primary" data-act="spareggio" data-w="B">Vince ${esc(teamName('B'))}</button></div>
      </div>` : ''}
      ${val.length ? `<div class="card"><h2>Controlli di regolamento</h2>${val.map(v => `<div class="notice ${v.level === 'error' ? 'error' : v.level === 'warn' ? 'warn' : 'info'}">${esc(v.msg)}</div>`).join('')}</div>` : (st.finished ? '<div class="notice ok">Nessuna irregolarità rilevata nelle norme di partecipazione.</div>' : '')}
      <div class="card">
        <h2>Esporta e salva</h2>
        <div class="grid cols-2">
          <label class="field">Modello di referto ufficiale
            <select data-act-change="variant"><option value="std" ${game.templateVariant !== 'int' ? 'selected' : ''}>Referto ${esc(rules.name)} (standard)</option><option value="int" ${game.templateVariant === 'int' ? 'selected' : ''}>Referto ${esc(rules.name)} con intestazione FIP</option></select></label>
          <div class="notice info" style="margin:0">${set.cloud === 'drive' ? `Cartella Google Drive: <b>${esc(set.folderName || Cloud.parseFolderId(set.folder))}</b>` : set.cloud === 'folder' ? `Cartella sincronizzata: <b>${esc(set.folderName)}</b>` : 'Salvataggio cloud non configurato: <a href="#" data-act="goSettings">configura</a>.'}<br><small id="cloudState"></small></div>
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn big primary" data-act="exportXlsx">Scarica referto Excel</button>
          <button class="btn big" data-act="printSheet">Stampa / PDF</button>
          ${set.cloud !== 'none' ? '<button class="btn big accent" data-act="saveCloud">Salva su cloud</button>' : ''}
          <button class="btn" data-act="exportJson">Backup partita (.json)</button>
        </div>
      </div>
      ${renderSignCard()}
      <div class="card"><h2>Tabellino</h2>${teamTable('A')}${teamTable('B')}</div>
      <div class="card"><h2>Altre azioni</h2><div class="row">
        <button class="btn" data-act="undo" ${game.events.length ? '' : 'disabled'}>↶ Annulla ultima azione</button>
        <button class="btn" data-act="editInfo">Modifica dati gara</button>
        ${!st.forfeit ? '<button class="btn danger" data-act="forfeit">Sconfitta a tavolino…</button>' : ''}
      </div></div>`;
    refreshCloudState();
  }

  async function refreshCloudState() {
    const el = $('#cloudState');
    if (!el) return;
    const names = await Cloud.pendingNames();
    const base = baseName(game);
    const mine = names.filter(n => n.startsWith(base));
    el.textContent = Settings.get().cloud === 'none' ? '' : mine.length ? `In attesa di invio: ${mine.join(', ')}` : (game.exported ? `Ultimo salvataggio: ${new Date(game.exported).toLocaleString('it-IT')}` : '');
  }

  async function buildXlsx() { return X.buildReferto(game, st); }
  function jsonBlob() { return new Blob([JSON.stringify(game, null, 1)], { type: 'application/json' }); }

  async function saveToCloud(withXlsx, silent) {
    const set = Settings.get();
    if (set.cloud === 'none') return;
    const base = baseName(game);
    try {
      if (withXlsx) await Cloud.save(base + '.xlsx', await buildXlsx(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      if (set.autoJson || withXlsx) await Cloud.save(base + '.json', jsonBlob(), 'application/json');
      game.exported = new Date().toISOString(); persist();
      if (!silent) toast('Referto salvato nella coda cloud: verrà inviato appena possibile.');
    } catch (e) { if (!silent) toast('Errore salvataggio: ' + esc(e.message)); }
    refreshCloudState();
  }

  function onGameMaybeFinished() {
    if (st.finished) saveToCloud(true, true);
    else if (Settings.get().autoJson) saveToCloud(false, true);
  }

  // ----- stampa
  function renderPrint() {
    const rules = st.rules;
    const P = rules.periods;
    const info = game.info;
    const team = t => {
      const T = st.teams[t], tm = game.teams[t];
      const key = rules.template + (game.templateVariant === 'int' ? '_int' : '');
      const max = window.REFERTO_LAYOUTS[key].teams[0].running.length;
      const running = Array.from({ length: max }, (_, i) => `<span class="${T.running.includes(i + 1) ? 'on' : ''}">${i + 1}</span>`).join('');
      return `<div class="team-title">SQUADRA "${t}": ${esc(tm.name)} ${tm.color ? '– maglia ' + esc(tm.color) : ''}</div>
      <table><thead><tr><th class="l">Giocatore</th><th>N°</th>${Array.from({ length: P }, (_, i) => `<th>E${i + 1}</th>`).join('')}<th>Falli</th>${Array.from({ length: P }, (_, i) => `<th>Punti ${i + 1}°</th>`).join('')}<th>Tot</th></tr></thead><tbody>
      ${tm.players.map(p => { const pl = T.players[p.id]; return `<tr><td class="l">${p.year ? esc(String(p.year).slice(-2)) + ' – ' : ''}${esc(p.name)}</td><td>${esc(p.number)}</td>${Array.from({ length: P }, (_, i) => `<td>${pl.entrate.has(i) ? 'X' : ''}</td>`).join('')}<td>${pl.fouls.map(f => f.kind + (f.period + 1)).join(' ')}</td>${pl.byPeriod.map(v => `<td>${v.join(' ')}</td>`).join('')}<td><b>${pl.points}</b></td></tr>`; }).join('')}
      </tbody></table>
      <div>Istruttori: ${tm.coaches.map((c, i) => c.name ? `${esc(c.name)}${c.card ? ' (tess. ' + esc(c.card) + ')' : ''}${T.coaches[i].techs ? ' ' + 'T'.repeat(T.coaches[i].techs) : ''}` : '').filter(Boolean).join(' · ')}
      ${rules.timeoutsPerPeriod ? ' — Sospensioni nei periodi: ' + T.timeouts.map((n, i) => n ? i + 1 : '').filter(Boolean).join(', ') : ''}</div>
      <div class="running">${running}</div>`;
    };
    $('#print').innerHTML = `
      <div class="print-head"><img src="icons/logo-senna.png" alt=""><h1>REFERTO UFFICIALE DI GARA ${esc(rules.name.toUpperCase())} MINIBASKET</h1><span>Polisportiva Senna</span></div>
      <div class="ph"><div>Categoria: <b>${esc(rules.categoryName)}</b></div><div>Girone: <b>${esc(info.girone)}</b></div><div>Gara n°: <b>${esc(info.gara)}</b></div><div>Data: <b>${esc(fmtDate(info.data))}</b></div><div>Ora: <b>${esc(info.ora)}</b></div><div>Campo: <b>${esc(info.campo)}</b></div>
      <div>Arbitri: <b>${esc(info.arbitri)}</b></div><div>Segnapunti: <b>${esc(info.segnapunti)}</b></div><div>Cronometrista: <b>${esc(info.cronometrista)}</b></div><div>DAE: <b>${esc(info.dae || '')}</b></div></div>
      ${team('A')}${team('B')}
      <table style="width:auto"><thead><tr><th class="l">Punti</th>${Array.from({ length: P }, (_, i) => `<th>${i + 1}°</th>`).join('')}${st.spareggio ? '<th>Spar.</th>' : ''}<th>Finale</th></tr></thead><tbody>
      ${['A', 'B'].map((t, k) => `<tr><td class="l">${t} – ${esc(teamName(t))}</td>${Array.from({ length: P }, (_, i) => `<td>${st.periodPoints[i] ? st.periodPoints[i][k] : ''}</td>`).join('')}${st.spareggio ? `<td>${st.spareggio === t ? 3 : 1}</td>` : ''}<td><b>${st.final[t]}</b></td></tr>`).join('')}
      </tbody></table>
      <div class="sign">${signSlots().map(x => `<div>${x.img ? `<img src="${x.img}" alt="">` : '<span class="blank"></span>'}${esc(x.label)}${x.name ? ' – ' + esc(x.name) : ''}</div>`).join('')}</div>`;
  }

  // ================================================================= IMPOSTAZIONI
  function renderSettings() {
    const s = Settings.get();
    const origin = location.origin && location.origin !== 'null' ? location.origin : '(apri l\'app da un indirizzo http/https)';
    app.innerHTML = `
      <div class="card"><h1>Impostazioni</h1>
        <h2 style="margin-top:12px">Salvataggio su cloud</h2>
        <p class="muted">Ogni partita viene salvata sempre su questo dispositivo (funziona offline). In più, il referto Excel e il backup della partita possono essere salvati in una cartella di Google Drive: se sei offline restano in coda e vengono inviati appena torna la connessione.</p>
        <div class="grid cols-3">
          <button class="choice ${s.cloud === 'none' ? 'court' : ''}" data-act="cloudMode" data-m="none"><b>${s.cloud === 'none' ? '✓ ' : ''}Solo su questo dispositivo</b><small>Nessun invio automatico</small></button>
          <button class="choice" data-act="cloudMode" data-m="drive"><b>${s.cloud === 'drive' ? '✓ ' : ''}Google Drive (online)</b><small>Caricamento diretto nella cartella indicata tramite API Google</small></button>
          <button class="choice ${Cloud.supportsFolder() ? '' : 'disabled'}" data-act="cloudMode" data-m="folder"><b>${s.cloud === 'folder' ? '✓ ' : ''}Cartella sincronizzata</b><small>Cartella di "Google Drive per desktop" sul PC (Chrome/Edge)</small></button>
        </div>
      </div>
      <div class="card ${s.cloud === 'drive' ? '' : 'hidden'}">
        <h2>Google Drive</h2>
        <div class="grid cols-2">
          <label class="field">Cartella di Google Drive (link o ID)<input type="text" id="setFolder" value="${esc(s.folder)}" placeholder="https://drive.google.com/drive/folders/..."></label>
          <label class="field">Client ID OAuth Google<input type="text" id="setClient" value="${esc(s.clientId)}" placeholder="xxxx.apps.googleusercontent.com"></label>
        </div>
        <div class="row" style="margin-top:10px"><button class="btn primary" data-act="driveConnect">Salva e collega</button>${s.folderName ? `<span class="muted">Cartella collegata: <b>${esc(s.folderName)}</b></span>` : ''}</div>
        <details style="margin-top:10px"><summary>Come ottenere il Client ID (una sola volta)</summary>
          <ol class="rules">
            <li>Vai su <b>console.cloud.google.com</b>, crea un progetto e abilita <b>Google Drive API</b>.</li>
            <li>In "Schermata consenso OAuth" scegli <i>Esterno</i>, inserisci il tuo indirizzo come utente di test.</li>
            <li>In "Credenziali" crea un <b>ID client OAuth</b> di tipo <i>Applicazione web</i> e aggiungi come origine JavaScript autorizzata: <code>${esc(origin)}</code></li>
            <li>Copia il Client ID qui sopra e incolla il link della cartella Drive di destinazione.</li>
          </ol></details>
      </div>
      <div class="card ${s.cloud === 'folder' ? '' : 'hidden'}">
        <h2>Cartella sincronizzata</h2>
        <p class="muted">Scegli una cartella dentro "Il mio Drive" di Google Drive per desktop (es. <code>G:\\Il mio Drive\\Referti Minibasket</code>). I file vengono scritti subito, anche offline, e Google Drive li sincronizza.</p>
        <div class="row"><button class="btn primary" data-act="pickFolder">Scegli cartella</button>${s.folderName ? `<span class="muted">Cartella: <b>${esc(s.folderName)}</b></span>` : ''}</div>
      </div>
      <div class="card ${s.cloud === 'none' ? 'hidden' : ''}">
        <div class="row between"><div><h2 style="margin:0">Coda di invio</h2><small class="muted" id="queueInfo"></small></div><button class="btn" data-act="syncNow">Sincronizza ora</button></div>
        <label class="row" style="margin-top:10px"><input type="checkbox" id="setAutoJson" ${s.autoJson ? 'checked' : ''}> Salva anche il backup della partita (.json) alla fine di ogni periodo</label>
      </div>
      <div class="card">
        <h2>Generale</h2>
        <div class="grid cols-2">
          <label class="field">Modello di referto predefinito<select id="setVariant"><option value="std" ${s.variant !== 'int' ? 'selected' : ''}>Standard</option><option value="int" ${s.variant === 'int' ? 'selected' : ''}>Con intestazione FIP</option></select></label>
          <label class="field">Segnapunti predefinito<input type="text" id="setScorer" value="${esc(s.segnapunti)}"></label>
        </div>
        <div class="row" style="margin-top:10px"><button class="btn primary" data-act="saveGeneral">Salva</button></div>
      </div>
      <div class="card"><h2>Regole generali applicate</h2><ul class="rules">${R.GENERAL_NOTES.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
        <p class="muted">Fonte: FIP – Il Minibasket: norme organizzative generali e regolamento di gioco 2026/2027.</p></div>
      ${ownerFooter()}`;
    Cloud.pendingNames().then(n => { const el = $('#queueInfo'); if (el) el.textContent = n.length ? `${n.length} file in attesa: ${n.join(', ')}` : 'Nessun file in attesa.'; });
  }

  // ================================================================= RENDER
  function render() {
    $('#brand').textContent = view === 'game' || view === 'summary' ? `${teamName('A')} – ${teamName('B')}` : 'Referto Minibasket';
    if (view === 'home') renderHome();
    else if (view === 'new') renderWizard();
    else if (view === 'form') app.innerHTML = renderForm();
    else if (view === 'game') renderGame();
    else if (view === 'summary') renderSummary();
    else if (view === 'settings') renderSettings();
  }

  // ================================================================= AZIONI
  const actions = {
    goHome: () => { clockSafePause(); view = 'home'; game = null; render(); },
    goSettings: () => { view = 'settings'; render(); },
    newGame: () => { wiz = { step: 'cat' }; view = 'new'; render(); },
    pickCat: d => {
      const c = R.category(d.id);
      if (!c.modes.length) { openModal({ title: c.name, body: `<div class="notice info">${esc(c.info)}</div>`, foot: '<button class="btn primary" data-act="__close">OK</button>' }); return; }
      wiz.categoryId = d.id; wiz.step = 'mode'; render();
    },
    pickMode: d => {
      wiz.modeId = d.id;
      const g = E.newGame(wiz.categoryId, d.id);
      const s = Settings.get();
      g.templateVariant = s.variant; g.info.segnapunti = s.segnapunti || '';
      const r = E.rulesOf(g);
      E.TEAMS.forEach(t => { for (let i = 0; i < r.minPlayers; i++) g.teams[t].players.push({ id: E.uid(), number: '', name: '' }); });
      form = { game: g, isNew: true };
      wiz.step = 'form'; render();
    },
    wizBack: () => { if (wiz.step === 'form') wiz.step = 'mode'; else if (wiz.step === 'mode') wiz.step = 'cat'; else view = 'home'; render(); },
    addPlayer: d => { const tm = form.game.teams[d.team]; if (tm.players.length < 12) tm.players.push({ id: E.uid(), number: '', name: '' }); render(); },
    delPlayer: d => {
      const tm = form.game.teams[d.team], p = tm.players[+d.i];
      if (playerUsed(form.game, d.team, p.id)) { toast('Il giocatore ha già eventi registrati: non può essere rimosso.'); return; }
      tm.players.splice(+d.i, 1); render();
    },
    pastePlayers: d => pastePlayers(d.team),
    formSubmit: () => submitForm(),
    formCancel: () => { form = null; game = Games.get(game.id); recompute(); view = 'game'; render(); },
    openGame: d => openGame(d.id),
    openSummary: d => { openGame(d.id); view = 'summary'; render(); },
    deleteGame: d => {
      const g = Games.get(d.id);
      confirmModal('Eliminare la partita?', `<p>${esc(teamName('A', g))} – ${esc(teamName('B', g))} del ${esc(fmtDate(g.info.data))} verrà eliminata da questo dispositivo. I file già salvati su Google Drive non vengono toccati.</p>`, 'Elimina', () => { Games.remove(d.id); render(); }, true);
    },
    importJson: () => $('#importFile').click(),
    // partita
    clockToggle: () => (game.clock.running ? clockPause() : clockStart()),
    clockEdit: () => {
      clockPause();
      openModal({
        title: 'Regola cronometro',
        body: `<label class="field">Tempo rimanente (m:ss)<input type="text" id="clkVal" value="${fmtClock(clockRemaining())}"></label>
          <div class="row" style="margin-top:10px">${[-10, -1, 1, 10].map(s => `<button class="btn" data-act="adj" data-s="${s}">${s > 0 ? '+' : ''}${s}s</button>`).join('')}<button class="btn" data-act="full">Riporta a ${st.rules.minutes}:00</button></div>`,
        foot: '<button class="btn" data-act="__close">Annulla</button><button class="btn primary" data-act="ok">Imposta</button>',
        handlers: {
          adj: d => { const el = $('#clkVal'); const [m, s] = el.value.split(':').map(Number); const v = Math.max(0, (m * 60 + (s || 0)) + +d.s); el.value = `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; },
          full: () => { $('#clkVal').value = `${st.rules.minutes}:00`; },
          ok: () => {
            const m = /^(\d+):(\d{1,2})$/.exec($('#clkVal').value.trim());
            if (!m) { toast('Formato non valido (m:ss)'); return; }
            game.clock.remaining = (+m[1] * 60 + +m[2]) * 1000; game.clock.running = false; persist(); closeModal(); render();
          }
        }
      });
    },
    startPeriod: () => openLineup(),
    endPeriod: () => endPeriod(),
    player: d => openPlayer(d.team, d.id),
    timeout: d => {
      clockPause();
      addEvents([{ type: 'timeout', team: d.team }]);
      toast(`Time-out ${esc(teamName(d.team))}`); render();
    },
    coachTech: d => {
      const T = st.teams[d.team], tm = game.teams[d.team];
      openModal({
        title: `Fallo tecnico Istruttore – ${esc(teamName(d.team))}`,
        body: `<div class="action-grid">${[0, 1].map(i => `<button class="btn" data-act="c" data-i="${i}" ${T.coaches[i].expelled ? 'disabled' : ''}>${i + 1}° Istruttore<small>${esc(tm.coaches[i].name || '—')} · T: ${T.coaches[i].techs}</small></button>`).join('')}</div>
          <p class="muted" style="margin-top:10px">Difesa a zona, raddoppi o blocchi: prima richiamo, poi ammonizione, poi fallo tecnico. Due tecnici = espulsione.</p>`,
        foot: '<button class="btn" data-act="__close">Annulla</button>',
        handlers: { c: x => { closeModal(); recordFoul(d.team, null, 'T', +x.i); } }
      });
    },
    subMenu: d => openSub(d.team, null, null),
    undo: () => confirmModal('Annullare l\'ultima azione?', `<p>${game.events.length ? describe(game.events[game.events.length - 1]) : ''}</p>`, 'Annulla azione', () => { const wasSummary = view === 'summary'; undoLast(); if (wasSummary && !st.allPeriodsPlayed) { view = 'game'; render(); } }),
    delEvent: d => {
      const e = game.events.find(x => x.id === d.id);
      if (!e) return;
      confirmModal('Eliminare l\'evento?', `<p>${describe(e)}</p>`, 'Elimina', () => { game.events = game.events.filter(x => x.id !== d.id); recompute(); persist(); render(); }, true);
    },
    editInfo: () => { clockSafePause(); form = { game: JSON.parse(JSON.stringify(game)), isNew: false }; view = 'form'; render(); },
    toSummary: () => { view = 'summary'; render(); },
    backToGame: () => { view = 'game'; render(); },
    spareggio: d => { addEvents([{ type: 'spareggio', winner: d.w, period: -1 }]); onGameMaybeFinished(); render(); },
    forfeit: () => {
      const rules = st.rules;
      openModal({
        title: 'Sconfitta a tavolino',
        body: `<p>Per mancato rispetto delle norme di partecipazione o per posizione irregolare degli Istruttori (artt. 3-4) la gara è persa con il punteggio <b>${rules.forfeit[0]}-${rules.forfeit[1]}</b>.</p><p>Quale squadra perde?</p>`,
        foot: `<button class="btn" data-act="__close">Annulla</button><button class="btn danger" data-act="l" data-t="A">${esc(teamName('A'))}</button><button class="btn danger" data-act="l" data-t="B">${esc(teamName('B'))}</button>`,
        handlers: { l: x => { closeModal(); addEvents([{ type: 'forfeit', loser: x.t, period: -1 }]); onGameMaybeFinished(); render(); } }
      });
    },
    exportXlsx: async () => {
      try {
        const blob = await buildXlsx();
        download(blob, baseName(game) + '.xlsx');
        if (Settings.get().cloud !== 'none') saveToCloud(true, true);
        toast('Referto Excel generato.');
      } catch (e) { console.error(e); toast('Errore nella generazione del referto: ' + esc(e.message)); }
    },
    printSheet: () => { renderPrint(); setTimeout(() => window.print(), 50); },
    exportJson: () => download(jsonBlob(), baseName(game) + '.json'),
    sign: d => openSignPad(d.key),
    unsign: d => {
      const x = signSlots().find(y => y.key === d.key);
      confirmModal('Rimuovere la firma?', `<p>${esc(x.label)}${x.name ? ' – ' + esc(x.name) : ''}</p>`, 'Rimuovi', () => {
        delete game.signatures[d.key]; persist(); render();
      }, true);
    },
    saveCloud: () => saveToCloud(true, false),
    // impostazioni
    cloudMode: d => {
      if (d.m === 'folder' && !Cloud.supportsFolder()) { toast('Questo browser non supporta la scelta di una cartella (usa Chrome o Edge su PC).'); return; }
      Settings.set({ cloud: d.m }); render(); updateBadge();
    },
    driveConnect: async () => {
      Settings.set({ folder: $('#setFolder').value.trim(), clientId: $('#setClient').value.trim(), cloud: 'drive' });
      try { const n = await Cloud.connectDrive(); toast('Collegato alla cartella «' + esc(n) + '».'); await Cloud.sync(true); } catch (e) { toast(esc(e.message), 6000); }
      render(); updateBadge();
    },
    pickFolder: async () => {
      try { const n = await Cloud.pickFolder(); toast('Cartella scelta: ' + esc(n)); await Cloud.sync(true); } catch (e) { if (e.name !== 'AbortError') toast(esc(e.message)); }
      render(); updateBadge();
    },
    syncNow: async () => {
      try { await Cloud.sync(true); toast('Sincronizzazione completata.'); } catch (e) { toast(esc(e.message), 6000); }
      if (view === 'settings') render(); else refreshCloudState();
    },
    saveGeneral: () => {
      Settings.set({ variant: $('#setVariant').value, segnapunti: $('#setScorer').value.trim(), autoJson: $('#setAutoJson') ? $('#setAutoJson').checked : Settings.get().autoJson });
      toast('Impostazioni salvate.');
    },
    __close: () => closeModal(),
    __backdrop: (d, el, ev) => { if (ev.target === el) closeModal(); }
  };

  function clockSafePause() { if (game && game.clock && game.clock.running) clockPause(); }

  document.addEventListener('click', ev => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (el.tagName === 'A') ev.preventDefault();
    if (el.disabled) return;
    if (el.closest('#modalRoot') && modalHandlers && modalHandlers[act]) { modalHandlers[act](el.dataset, el, ev); return; }
    if (actions[act]) actions[act](el.dataset, el, ev);
  });
  document.addEventListener('input', ev => {
    const el = ev.target;
    if (el.dataset && el.dataset.bind && form) {
      setPath(form.game, el.dataset.bind, el.value);
      const m = /^teams\.([AB])\.players/.exec(el.dataset.bind);
      if (m) { const c = $('#cnt' + m[1]); if (c) c.innerHTML = countLabel(form.game.teams[m[1]].players.length, E.rulesOf(form.game)); }
    }
  });
  document.addEventListener('change', async ev => {
    const el = ev.target;
    if (el.dataset && el.dataset.actChange === 'variant') { game.templateVariant = el.value; persist(); }
    if (el.id === 'setAutoJson') Settings.set({ autoJson: el.checked });
    if (el.id === 'importFile' && el.files[0]) {
      try {
        const g = JSON.parse(await el.files[0].text());
        if (!g.id || !g.teams || !g.events || !g.modeId) throw new Error('file non riconosciuto');
        const exists = Games.get(g.id);
        const doIt = () => { Games.save(g); toast('Partita importata.'); render(); };
        if (exists) confirmModal('Partita già presente', '<p>Sostituire la partita salvata con quella del file?</p>', 'Sostituisci', doIt); else doIt();
      } catch (e) { toast('Importazione non riuscita: ' + esc(e.message)); }
      el.value = '';
    }
  });
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && modalHandlers) closeModal();
    if (view === 'game' && ev.code === 'Space' && !modalHandlers && !/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement.tagName)) { ev.preventDefault(); actions.clockToggle(); }
  });

  $('#btnHome').addEventListener('click', () => actions.goHome());
  $('#btnSettings').addEventListener('click', () => { clockSafePause(); view = 'settings'; render(); });
  $('#syncBadge').addEventListener('click', async () => {
    if (Settings.get().cloud === 'none') { view = 'settings'; render(); return; }
    actions.syncNow();
  });

  // ---------------------------------------------------------------- badge sincronizzazione
  let lastSync = { state: 'ok', pending: 0 };
  function updateBadge(detail) {
    if (detail) lastSync = detail;
    const s = Settings.get();
    const b = $('#syncBadge'), t = $('#syncText');
    b.classList.remove('pending', 'error');
    if (s.cloud === 'none') { t.textContent = 'Solo locale'; return; }
    const n = lastSync.pending || 0;
    const where = s.cloud === 'drive' ? 'Drive' : 'Cartella';
    switch (lastSync.state) {
      case 'syncing': t.textContent = 'Invio…'; break;
      case 'offline': t.textContent = `Offline · ${n} in coda`; b.classList.add('pending'); break;
      case 'auth': t.textContent = `${n} da inviare · tocca`; b.classList.add('pending'); break;
      case 'error': t.textContent = 'Errore · riprova'; b.classList.add('error'); b.title = lastSync.error || ''; break;
      case 'queued': t.textContent = `${n} in coda`; b.classList.add('pending'); break;
      default: t.textContent = n ? `${n} in coda` : `${where} ✓`; if (n) b.classList.add('pending');
    }
  }
  window.addEventListener('mb-sync', e => { updateBadge(e.detail); if (view === 'summary') refreshCloudState(); });
  window.addEventListener('offline', () => Cloud.pending().then(n => updateBadge({ state: 'offline', pending: n })));
  Cloud.pending().then(n => updateBadge({ state: n ? 'auth' : 'ok', pending: n }));

  // ---------------------------------------------------------------- avvio
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    if (/[?&]nosw(&|$)/.test(location.search)) {
      // modalità di sviluppo: nessuna cache offline
      navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
    } else {
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register('sw.js').catch(() => { });
      // nuova versione dell'app installata: ricarica (lo stato della partita è già salvato)
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController && !modalHandlers) { if (game) persist(); location.reload(); }
      });
    }
  }
  window.addEventListener('beforeunload', () => { if (game && game.clock && game.clock.running) persist(); });

  // riapre l'ultima partita in corso
  const live = Games.list().find(g => { try { const s = E.compute(g); return s.started && !s.finished; } catch (e) { return false; } });
  if (live) { game = live; recompute(); view = 'game'; }
  render();

  // usato dai test automatici
  window.MB_APP = { get game() { return game; }, get state() { return st; }, actions, buildXlsx: () => buildXlsx() };
})();
