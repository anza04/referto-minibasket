/* Motore di gioco: lo stato della partita è ricalcolato dagli eventi (undo = rimozione eventi) */
(function () {
  'use strict';
  const R = window.MB_RULES;
  const TEAMS = ['A', 'B'];
  const other = t => (t === 'A' ? 'B' : 'A');

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function newGame(categoryId, modeId) {
    return {
      id: uid(), version: 1,
      created: new Date().toISOString(), updated: new Date().toISOString(),
      categoryId, modeId, templateVariant: 'std',
      info: { girone: '', gara: '', data: new Date().toISOString().slice(0, 10), ora: '', campo: '', arbitri: '', segnapunti: '', cronometrista: '', dae: '' },
      teams: {
        A: { name: '', color: '', players: [], coaches: [{ name: '', card: '' }, { name: '', card: '' }] },
        B: { name: '', color: '', players: [], coaches: [{ name: '', card: '' }, { name: '', card: '' }] }
      },
      events: [],
      clock: { remaining: null, running: false, startedAt: null },
      exported: null
    };
  }

  function rulesOf(game) { return R.effectiveRules(game.categoryId, game.modeId); }

  function compute(game) {
    const rules = rulesOf(game);
    const P = rules.periods;
    const s = {
      rules, period: -1, inPeriod: false, ended: [], periodPoints: [], spareggio: null, forfeit: null,
      teams: {}, log: []
    };
    TEAMS.forEach(t => {
      const players = {};
      game.teams[t].players.forEach((p, i) => {
        players[p.id] = {
          id: p.id, idx: i, name: p.name, number: p.number,
          points: 0, byPeriod: Array.from({ length: P }, () => []),
          fouls: [], entrate: new Set(), groups: new Set(), out: null, injured: false
        };
      });
      s.teams[t] = {
        players, coaches: [{ techs: 0, expelled: false, periods: [] }, { techs: 0, expelled: false, periods: [] }],
        timeouts: Array(P).fill(0), teamFouls: Array(P).fill(0), periodScore: Array(P).fill(0),
        running: [], runningPer: [], group: [], court: [], total: 0
      };
    });

    for (const e of game.events) {
      const T = e.team ? s.teams[e.team] : null;
      switch (e.type) {
        case 'periodStart': {
          s.period = e.period; s.inPeriod = true;
          TEAMS.forEach(t => {
            const lu = (e.lineups && e.lineups[t]) || { group: [], court: [] };
            const tt = s.teams[t];
            tt.group = lu.group.slice(); tt.court = lu.court.slice();
            lu.group.forEach(id => tt.players[id] && tt.players[id].groups.add(e.period));
            lu.court.forEach(id => {
              if (!tt.players[id]) return;
              tt.players[id].entrate.add(e.period);
              tt.players[id].groups.add(e.period);
            });
          });
          break;
        }
        case 'score': {
          const pl = T.players[e.player];
          T.periodScore[e.period] += e.pts;
          T.total += e.pts;
          // numeri del punteggio progressivo raggiunti in questo periodo
          for (let n = T.total - e.pts + 1; n <= T.total; n++) T.runningPer[n - 1] = e.period;
          T.running.push(T.total);
          if (pl) { pl.points += e.pts; pl.byPeriod[e.period].push(e.pts); }
          break;
        }
        case 'foul': {
          if (e.coach !== undefined && e.coach !== null) {
            const c = T.coaches[e.coach];
            c.techs++; c.periods.push(e.period);
            if (c.techs >= 2) c.expelled = true;
          } else {
            const pl = T.players[e.player];
            if (!pl) break;
            pl.fouls.push({ kind: e.kind, period: e.period });
            T.teamFouls[e.period]++;
            const nU = pl.fouls.filter(f => f.kind === 'U').length;
            if (e.kind === 'D') pl.out = 'D';
            else if (nU >= 2) pl.out = 'U';
            else if (pl.fouls.length >= rules.foulLimit) pl.out = 'falli';
          }
          break;
        }
        case 'timeout': T.timeouts[e.period]++; break;
        case 'sub': {
          const i = T.court.indexOf(e.out);
          if (e.in) { if (i >= 0) T.court.splice(i, 1, e.in); else T.court.push(e.in); }
          else if (i >= 0) T.court.splice(i, 1);
          if (e.reason === 'injury' && T.players[e.out]) T.players[e.out].injured = true;
          const pin = T.players[e.in];
          if (pin) {
            pin.injured = false;
            pin.entrate.add(e.period); pin.groups.add(e.period);
            if (!T.group.includes(e.in)) T.group.push(e.in);
          }
          break;
        }
        case 'periodEnd': {
          s.inPeriod = false;
          if (!s.ended.includes(e.period)) s.ended.push(e.period);
          const a = s.teams.A.periodScore[e.period], b = s.teams.B.periodScore[e.period];
          s.periodPoints[e.period] = a > b ? [3, 1] : a < b ? [1, 3] : [2, 2];
          break;
        }
        case 'spareggio': s.spareggio = e.winner; break;
        case 'forfeit': s.forfeit = { loser: e.loser, reason: e.reason }; break;
      }
    }

    // risultato
    const pp = { A: 0, B: 0 };
    s.periodPoints.forEach(x => { if (x) { pp.A += x[0]; pp.B += x[1]; } });
    s.pp = pp;
    s.totals = { A: s.teams.A.total, B: s.teams.B.total };
    s.allPeriodsPlayed = s.ended.length >= P;
    s.needsSpareggio = s.allPeriodsPlayed && !rules.drawAllowed && pp.A === pp.B && s.totals.A === s.totals.B;
    s.final = { A: pp.A, B: pp.B };
    if (s.spareggio) {
      s.final[s.spareggio] += 3;
      s.final[other(s.spareggio)] += 1;
    }
    s.winner = null; s.winBy = null;
    if (s.allPeriodsPlayed) {
      if (pp.A !== pp.B) { s.winner = pp.A > pp.B ? 'A' : 'B'; s.winBy = 'periodi'; }
      else if (rules.drawAllowed) { s.winner = 'draw'; s.winBy = 'pareggio'; }
      else if (s.totals.A !== s.totals.B) { s.winner = s.totals.A > s.totals.B ? 'A' : 'B'; s.winBy = 'progressivo'; }
      else if (s.spareggio) { s.winner = s.spareggio; s.winBy = 'spareggio'; }
    }
    if (s.forfeit) {
      const L = s.forfeit.loser;
      s.final[L] = rules.forfeit[0]; s.final[other(L)] = rules.forfeit[1];
      s.winner = other(L); s.winBy = 'tavolino';
    }
    s.finished = !!s.forfeit || (s.allPeriodsPlayed && (!s.needsSpareggio || !!s.spareggio));
    s.started = s.period >= 0;
    return s;
  }

  // Giocatori disponibili (non esclusi e non infortunati)
  function eligible(st, team) {
    return Object.values(st.teams[team].players).filter(p => !p.out && !p.injured);
  }

  // Periodi giocati ai fini delle regole di utilizzo
  function periodsPlayed(pl, rules) {
    return rules.subs === 'group' ? pl.groups.size : pl.entrate.size;
  }

  // Ordinamento art. 43 / norme di utilizzo: meno periodi, meno punti, meno falli
  function byFairness(rules) {
    return (a, b) => periodsPlayed(a, rules) - periodsPlayed(b, rules) || a.points - b.points || a.fouls.length - b.fouls.length || a.idx - b.idx;
  }

  // Formazione suggerita per il periodo p
  function suggestLineup(game, st, team, p) {
    const rules = st.rules;
    const el = eligible(st, team);
    const n = game.teams[team].players.length;
    if (rules.subs === 'free') {
      const court = el.slice().sort(byFairness(rules)).slice(0, rules.onCourt).map(x => x.id);
      return { group: el.map(x => x.id), court };
    }
    if (rules.subs === 'group') {
      let ids;
      if (p >= 2) {
        // stesso gruppo di due periodi prima (es. gruppo da 5 nei periodi 1-3, da 6 nei periodi 2-4)
        const prev = Object.values(st.teams[team].players).filter(x => x.groups.has(p - 2));
        ids = prev.filter(x => !x.out && !x.injured).map(x => x.id);
      } else {
        const size0 = Math.floor(n / 2);
        const sorted = Object.values(st.teams[team].players).sort((a, b) => a.idx - b.idx);
        const chosen = p === 0 ? sorted.slice(0, size0) : sorted.filter(x => !x.groups.has(0));
        ids = chosen.filter(x => !x.out && !x.injured).map(x => x.id);
      }
      if (!ids.length) ids = el.slice().sort(byFairness(rules)).slice(0, rules.onCourt).map(x => x.id);
      return { group: ids, court: ids.slice(0, rules.onCourt) };
    }
    // 'none': esattamente onCourt giocatori, rispettando il massimo di periodi
    const sorted = el.slice().sort(byFairness(rules));
    let pick = sorted.filter(x => periodsPlayed(x, rules) < rules.maxPeriods);
    if (pick.length < rules.onCourt) pick = sorted;
    const court = pick.slice(0, rules.onCourt).map(x => x.id);
    return { group: court.slice(), court };
  }

  // Controlli sulla formazione scelta (avvisi, non bloccanti)
  function checkLineup(game, st, team, p, lu) {
    const rules = st.rules, w = [];
    const T = st.teams[team];
    const n = game.teams[team].players.length;
    const el = eligible(st, team);
    const need = Math.min(rules.onCourt, el.length);
    if (lu.court.length !== need) w.push({ level: 'error', msg: `In campo servono ${need} giocatori (selezionati ${lu.court.length}).` });
    if (rules.subs === 'group') {
      if (n >= 10 && (lu.group.length < 5 || lu.group.length > 6)) w.push({ level: 'warn', msg: 'Nel 5c5 il gruppo del periodo deve essere di 5 o 6 giocatori.' });
      if (n === 10 && lu.group.length !== 5) w.push({ level: 'warn', msg: 'Con 10 giocatori non sono ammesse sostituzioni: gruppo di 5.' });
    }
    const ids = rules.subs === 'group' ? lu.group : lu.court;
    ids.forEach(id => {
      const pl = T.players[id];
      if (!pl) return;
      const played = periodsPlayed(pl, rules);
      if (played >= rules.maxPeriods) w.push({ level: 'warn', msg: `#${pl.number} ${pl.name}: ha già giocato ${played} periodi (max ${rules.maxPeriods}).` });
      if (pl.out) w.push({ level: 'error', msg: `#${pl.number} ${pl.name}: escluso (${pl.out}).` });
    });
    // 4c4: periodo aggiuntivo solo dopo che tutti hanno giocato 2 periodi
    if (rules.id === '4c4') {
      const extra = ids.filter(id => periodsPlayed(T.players[id], rules) >= 2);
      const missing = Object.values(T.players).filter(x => !x.out && periodsPlayed(x, rules) + (ids.includes(x.id) ? 1 : 0) < 2);
      const periodsLeft = rules.periods - p - 1;
      if (extra.length && missing.length > periodsLeft * rules.onCourt) w.push({ level: 'warn', msg: 'Periodo aggiuntivo assegnato prima che tutti abbiano giocato 2 periodi.' });
      if (extra.length) {
        const cand = Object.values(T.players).filter(x => !x.out && periodsPlayed(x, rules) >= 2).sort(byFairness(rules));
        const best = cand.slice(0, extra.length).map(x => x.id);
        if (extra.some(id => !best.includes(id))) w.push({ level: 'info', msg: 'Il periodo aggiuntivo spetta a chi ha segnato meno punti e, poi, commesso meno falli.' });
      }
    }
    // obbligo di schierare tutti nei primi k periodi
    if (rules.allInFirst && p === rules.allInFirst - 1) {
      const never = Object.values(T.players).filter(x => !x.out && !x.injured && periodsPlayed(x, rules) === 0 && !ids.includes(x.id));
      if (never.length) w.push({ level: 'warn', msg: `Obbligo di schierare tutti entro il ${p + 1}° periodo: mancano ${never.map(x => '#' + x.number).join(', ')}.` });
    }
    // sprint: riutilizzo con 7-11 / 9-11 giocatori
    if (rules.subs === 'none' && rules.maxPeriods === 2) {
      const reused = ids.filter(id => periodsPlayed(T.players[id], rules) >= 1);
      const unused = Object.values(T.players).filter(x => !x.out && !x.injured && periodsPlayed(x, rules) === 0 && !ids.includes(x.id));
      if (reused.length && unused.length) w.push({ level: 'warn', msg: `Giocatori ancora da schierare (${unused.map(x => '#' + x.number).join(', ')}) prima di riutilizzare chi ha già giocato.` });
    }
    return w;
  }

  // Verifica finale del rispetto delle norme di partecipazione (art. 3)
  function validateGame(game, st) {
    const rules = st.rules, out = [];
    TEAMS.forEach(t => {
      const tm = game.teams[t], T = st.teams[t];
      const n = tm.players.length;
      const tn = tm.name || ('Squadra ' + t);
      if (n < rules.minPlayers) out.push({ level: 'warn', msg: `${tn}: ${n} giocatori (minimo ${rules.minPlayers}). Partita pro-forma, risultato senza efficacia per la classifica.` });
      if (n > rules.maxPlayers) out.push({ level: 'error', msg: `${tn}: ${n} giocatori (massimo ${rules.maxPlayers}).` });
      if (!tm.coaches[0].name && !tm.coaches[1].name) out.push({ level: 'warn', msg: `${tn}: nessun Istruttore indicato (la gara non può essere disputata senza Istruttore tesserato).` });
      if (!st.allPeriodsPlayed) return;
      Object.values(T.players).forEach(pl => {
        const k = periodsPlayed(pl, rules);
        const label = `${tn} #${pl.number} ${pl.name}`;
        if (k < rules.minPeriods && !pl.out && !pl.injured) out.push({ level: 'warn', msg: `${label}: ha giocato ${k} periodi (minimo ${rules.minPeriods}).` });
        if (k > rules.maxPeriods) out.push({ level: 'warn', msg: `${label}: ha giocato ${k} periodi (massimo ${rules.maxPeriods}).` });
        if (rules.allInFirst) {
          const early = [...(rules.subs === 'group' ? pl.groups : pl.entrate)].some(x => x < rules.allInFirst);
          if (!early && !pl.out) out.push({ level: 'warn', msg: `${label}: non schierato nei primi ${rules.allInFirst} periodi.` });
        }
      });
      T.coaches.forEach((c, i) => { if (c.expelled) out.push({ level: 'info', msg: `${tn}: ${i + 1}° Istruttore espulso (2 falli tecnici).` }); });
    });
    if (rules.subs !== 'free' && out.some(x => x.level === 'warn' && /periodi/.test(x.msg))) {
      out.push({ level: 'info', msg: `Il mancato rispetto delle norme di partecipazione comporta la sconfitta ${rules.forfeit[0]}-${rules.forfeit[1]} (art. 3).` });
    }
    return out;
  }

  window.MB_ENGINE = { TEAMS, other, uid, newGame, rulesOf, compute, eligible, periodsPlayed, byFairness, suggestLineup, checkLineup, validateGame };
})();
