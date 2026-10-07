/* Regole tratte da "Il Minibasket: norme organizzative generali e regolamento di gioco 2026/2027" (FIP) */
(function () {
  'use strict';

  // Modalità di gioco ("LE MODALITA' DI GIOCO", pagg. 14-19)
  const MODES = {
    '3c3sprint': {
      id: '3c3sprint', name: '3 contro 3 Sprint', template: '3c3sprint',
      onCourt: 3, periods: 4, minutes: 4,
      minPlayers: 6, maxPlayers: 12,
      foulLimit: 4, freeThrows: false, timeoutsPerPeriod: 0,
      subs: 'none',            // nessuna sostituzione nel tempo (salvo art. 43)
      minPeriods: 1, maxPeriods: 2,
      clock: 'running',
      drawAllowed: true,
      forfeit: [4, 12],
      breaks: null,
      notes: [
        '4 periodi da 4 minuti, cronometro sempre in movimento (si ferma solo per segnalare i falli).',
        'Da 6 a 12 giocatori; nessun giocatore può disputare più di 2 periodi.',
        'Con 7-11 giocatori il giocatore da riutilizzare è chi ha segnato meno punti / commesso meno falli.',
        'Limite falli: 4. Tiri liberi non previsti: ogni fallo = 1 punto + possesso alla squadra che lo subisce.',
        'Time-out non previsti. È ammesso il pareggio.'
      ]
    },
    '4c4sprint': {
      id: '4c4sprint', name: '4 contro 4 Sprint', template: '4c4sprint',
      onCourt: 4, periods: 4, minutes: 4,
      minPlayers: 8, maxPlayers: 12,
      foulLimit: 4, freeThrows: false, timeoutsPerPeriod: 0,
      subs: 'none',
      minPeriods: 1, maxPeriods: 2,
      clock: 'running',
      drawAllowed: false,      // dipende dalla categoria (art. 19)
      forfeit: [4, 12],
      breaks: null,
      notes: [
        '4 periodi da 4 minuti, cronometro sempre in movimento (si ferma solo per segnalare i falli).',
        'Da 8 a 12 giocatori; nessun giocatore può disputare più di 2 periodi.',
        'Con 9-11 giocatori il giocatore da riutilizzare è chi ha segnato meno punti e, in secondo ordine, commesso meno falli.',
        'Limite falli: 4. Tiri liberi non previsti: ogni fallo = 1 punto + possesso alla squadra che lo subisce.',
        'Time-out non previsti.'
      ]
    },
    '4c4': {
      id: '4c4', name: '4 contro 4', template: '4c4',
      onCourt: 4, periods: 6, minutes: 6,
      minPlayers: 10, maxPlayers: 12,
      foulLimit: 5, freeThrows: true, timeoutsPerPeriod: 1,
      subs: 'none',
      minPeriods: 2, maxPeriods: 3, allInFirst: 3,
      clock: 'running',        // effettivo per BIG ed Esordienti (vedi categoria)
      drawAllowed: false,
      forfeit: [6, 18],
      breaks: null,
      notes: [
        '6 periodi da 6 minuti.',
        'Da 10 a 12 giocatori; ogni giocatore deve disputare almeno 2 periodi.',
        'Obbligo di schierare tutti gli iscritti a referto nei primi 3 periodi.',
        'Periodi aggiuntivi (squadre da 10-11) solo dopo che tutti hanno giocato 2 periodi: a chi ha segnato meno punti, poi meno falli. Pena: sconfitta 6-18.',
        'Limite falli: 5. Tiri liberi previsti (2); il libero aggiuntivo su canestro realizzato solo per Esordienti.',
        'Un time-out per squadra per periodo.'
      ]
    },
    '4c4open': {
      id: '4c4open', name: '4 contro 4 OPEN', template: '4c4open',
      onCourt: 4, periods: 6, minutes: 6,
      minPlayers: 6, maxPlayers: 10,
      foulLimit: 5, freeThrows: false, timeoutsPerPeriod: 1,
      subs: 'free',
      minPeriods: 0, maxPeriods: 99,
      clock: 'running',
      drawAllowed: false,
      forfeit: [6, 18],
      breaks: null,
      notes: [
        '6 periodi da 6 minuti, cronometro fermo solo per time-out, falli e su indicazione del Miniarbitro.',
        'Da 6 a 10 giocatori; CAMBI LIBERI durante la partita.',
        'Limite falli: 5. Tiri liberi non previsti: ogni fallo = 1 punto + possesso alla squadra che lo subisce.',
        'Un time-out per squadra per periodo.'
      ]
    },
    '5c5': {
      id: '5c5', name: '5 contro 5', template: '5c5',
      onCourt: 5, periods: 4, minutes: 8,
      minPlayers: 10, maxPlayers: 12,
      foulLimit: 5, freeThrows: true, andOne: true, bonus: 5, timeoutsPerPeriod: 1,
      subs: 'group',           // gruppo di 5 o 6 per periodo, cambi solo all'interno del gruppo
      minPeriods: 2, maxPeriods: 2, allInFirst: 2,
      clock: 'effective',
      drawAllowed: false,
      forfeit: [4, 12],
      breaks: [1, 5, 1],
      notes: [
        '4 periodi da 8 minuti, tempo effettivo. Riposo: 1\' tra 1°-2° e 3°-4°, 5\' tra 2°-3°.',
        'Da 10 a 12 giocatori: ognuno gioca 2 periodi; tutti in campo nei primi 2 periodi.',
        '10 giocatori: nessuna sostituzione. 11: 5 giocano 2 periodi interi, gli altri 6 si sostituiscono tra loro. 12: 6 per periodo con cambi tra loro.',
        'Limite falli: 5. Bonus: dopo il 5° fallo di squadra nel periodo, ogni fallo = 1 tiro libero + possesso.',
        'Tiri liberi previsti, con libero aggiuntivo su canestro realizzato.',
        'Un time-out per squadra per periodo.'
      ]
    }
  };

  // Categorie ("LE CATEGORIE E LE ANNATE DI TESSERAMENTO" + "LE ATTIVITA' PREVISTE")
  const CATEGORIES = [
    { id: 'pulcini', name: 'Pulcini', years: '2020-2021', modes: [],
      info: 'Solo feste e manifestazioni Easybasket (2c2 senza competizione, nessuna classifica): non è previsto un referto di gara.' },
    { id: 'paperine', name: 'Paperine', years: '2020-2021', modes: [],
      info: 'Solo feste e manifestazioni Easybasket (2c2 senza competizione, nessuna classifica): non è previsto un referto di gara.' },
    { id: 'scoiattoli_small', name: 'Scoiattoli Small', years: '2019-2020', modes: ['3c3sprint', '4c4sprint'], draw: true },
    { id: 'scoiattoli_big', name: 'Scoiattoli Big', years: '2018-2019', modes: ['3c3sprint', '4c4sprint'], draw: true },
    { id: 'libellule_small', name: 'Libellule Small', years: '2019-2020', modes: ['3c3sprint', '4c4sprint'], draw: true },
    { id: 'libellule_big', name: 'Libellule Big', years: '2018-2019', modes: ['3c3sprint', '4c4sprint'], draw: true },
    { id: 'aquilotti_small', name: 'Aquilotti Small', years: '2017-2018', modes: ['3c3sprint', '4c4sprint', '4c4'] },
    { id: 'aquilotti_big', name: 'Aquilotti Big', years: '2016-2017', modes: ['3c3sprint', '4c4sprint', '4c4'], effective: true },
    { id: 'aquilotti_open', name: 'Aquilotti OPEN', years: '2016-2017-2018', modes: ['4c4open'] },
    { id: 'gazzelle_small', name: 'Gazzelle Small', years: '2017-2018', modes: ['3c3sprint', '4c4sprint', '4c4'] },
    { id: 'gazzelle_big', name: 'Gazzelle Big', years: '2016-2017', modes: ['3c3sprint', '4c4sprint', '4c4'], effective: true },
    { id: 'gazzelle_open', name: 'Gazzelle OPEN', years: '2016-2017-2018-2019', modes: ['4c4open'] },
    { id: 'esordienti_m', name: 'Esordienti Maschile', years: '2015 (amm. 2016)', modes: ['3c3sprint', '4c4sprint', '4c4', '5c5'], effective: true, andOne: true, highHoop: true },
    { id: 'esordienti_m_open', name: 'Esordienti Maschile OPEN', years: '2015-2016-2017', modes: ['4c4open'], highHoop: true },
    { id: 'esordienti_f', name: 'Esordienti Femminile', years: '2015 (amm. 2016-2017)', modes: ['3c3sprint', '4c4sprint', '4c4', '5c5'], effective: true, andOne: true, highHoop: true },
    { id: 'esordienti_f_open', name: 'Esordienti Femminile OPEN', years: '2015-2016-2017-2018', modes: ['4c4open'], highHoop: true }
  ];

  const GENERAL_NOTES = [
    'Canestro su azione = 2 punti, tiro libero = 1 punto. Non esiste il tiro da 3 punti.',
    'Al termine di ogni periodo: 3 punti a chi vince il periodo, 1 a chi perde, 2 a testa in caso di parità.',
    'Il punteggio della partita è la somma dei punti attribuiti nei singoli periodi.',
    'Difesa individuale obbligatoria, vietati raddoppi, zona e blocchi.',
    'Falli a referto: P personale, U antisportivo, D squalificante, T tecnico. Due antisportivi = espulsione.',
    'Due falli tecnici all\'Istruttore = espulsione (subentra il 2° Istruttore, altrimenti la gara non può proseguire).'
  ];

  function category(id) { return CATEGORIES.find(c => c.id === id); }

  // Regole effettive della gara = modalità + eccezioni della categoria
  function effectiveRules(categoryId, modeId) {
    const cat = category(categoryId) || {};
    const m = Object.assign({}, MODES[modeId]);
    m.categoryName = cat.name;
    // art. 19: pareggio ammesso per scoiattoli/libellule (e nel 3c3 sprint)
    m.drawAllowed = !!(m.drawAllowed || cat.draw);
    // art. 16 / 4c4: tempo effettivo per Aquilotti/Gazzelle BIG ed Esordienti
    if (modeId === '4c4' && cat.effective) m.clock = 'effective';
    // libero aggiuntivo su canestro realizzato: 5c5 ed Esordienti nel 4c4
    if (modeId === '4c4' && cat.andOne) m.andOne = true;
    m.highHoop = !!cat.highHoop;
    return m;
  }

  function periodName(p) {
    return ['1° tempo', '2° tempo', '3° tempo', '4° tempo', '5° tempo', '6° tempo'][p] || ((p + 1) + '° tempo');
  }

  window.MB_RULES = { MODES, CATEGORIES, GENERAL_NOTES, category, effectiveRules, periodName };
})();
