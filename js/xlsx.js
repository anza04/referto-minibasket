/* Compilazione del referto Excel ufficiale (.xlsx) senza librerie esterne.
   Il modello originale viene aperto (zip), modificato nel foglio e negli stili, e riscritto. */
(function () {
  'use strict';
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  // colori a penna dei periodi (come sul referto cartaceo): rosso, blu, verde, ...
  const PERIOD_COLORS = ['FFD0021B', 'FF1F4FA8', 'FF1B8A3A'];
  const pcol = p => PERIOD_COLORS[p % PERIOD_COLORS.length];

  // ---------- ZIP ----------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  async function pipe(data, stream) {
    const out = await new Response(new Blob([data]).stream().pipeThrough(stream)).arrayBuffer();
    return new Uint8Array(out);
  }
  function b64ToBytes(b64) {
    const bin = atob(b64), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function unzip(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Modello Excel non valido');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = [];
    const dec = new TextDecoder();
    for (let i = 0; i < count; i++) {
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
      const lnlen = dv.getUint16(off + 26, true), lelen = dv.getUint16(off + 28, true);
      const raw = bytes.subarray(off + 30 + lnlen + lelen, off + 30 + lnlen + lelen + csize);
      let data;
      if (method === 0) data = raw.slice();
      else if (method === 8) data = await pipe(raw, new DecompressionStream('deflate-raw'));
      else throw new Error('Compressione zip non supportata: ' + method);
      files.push({ name, data });
      p += 46 + nlen + elen + clen;
    }
    return files;
  }

  async function zip(files) {
    const enc = new TextEncoder();
    const canDeflate = typeof CompressionStream !== 'undefined';
    const chunks = [], central = [];
    let offset = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const f of files) {
      const name = enc.encode(f.name);
      const crc = crc32(f.data);
      let method = 0, body = f.data;
      if (canDeflate && !/\.(png|jpe?g|gif)$/i.test(f.name)) {
        try { body = await pipe(f.data, new CompressionStream('deflate-raw')); method = 8; } catch (e) { body = f.data; method = 0; }
      }
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, method, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, body.length, true); lh.setUint32(22, f.data.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), name, body);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, method, true); ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, body.length, true); ch.setUint32(24, f.data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + body.length;
    }
    const cdSize = central.reduce((a, c) => a + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  // ---------- Foglio ----------
  function colNum(letters) { let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
  function colLetters(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function splitRef(ref) { const m = /^([A-Z]+)(\d+)$/.exec(ref); return { col: colNum(m[1]), row: +m[2] }; }

  class Sheet {
    constructor(sheetXml, stylesXml) {
      const P = new DOMParser();
      this.doc = P.parseFromString(sheetXml, 'application/xml');
      this.sty = P.parseFromString(stylesXml, 'application/xml');
      this.sheetData = this.doc.getElementsByTagNameNS(NS, 'sheetData')[0];
      this.rows = new Map();
      for (const r of this.sheetData.getElementsByTagNameNS(NS, 'row')) this.rows.set(+r.getAttribute('r'), r);
      this.styleCache = new Map();
      this.lines = [];
      this.circles = [];
      this.pictures = [];
      this.fontCache = new Map();
    }
    row(n) {
      let r = this.rows.get(n);
      if (r) return r;
      r = this.doc.createElementNS(NS, 'row');
      r.setAttribute('r', n);
      let before = null;
      for (const [k, el] of [...this.rows.entries()].sort((a, b) => a[0] - b[0])) if (k > n) { before = el; break; }
      this.sheetData.insertBefore(r, before);
      this.rows.set(n, r);
      return r;
    }
    // dimensioni in EMU (per posizionare i disegni)
    colEmu(c) {
      if (!this._cols) {
        this._cols = [...this.doc.getElementsByTagNameNS(NS, 'col')].map(x => ({ min: +x.getAttribute('min'), max: +x.getAttribute('max'), w: +x.getAttribute('width') }));
        const f = this.doc.getElementsByTagNameNS(NS, 'sheetFormatPr')[0];
        this._defW = f && f.getAttribute('defaultColWidth') ? +f.getAttribute('defaultColWidth') : 8.43;
        this._defH = f && f.getAttribute('defaultRowHeight') ? +f.getAttribute('defaultRowHeight') : 15;
      }
      const d = this._cols.find(x => c >= x.min && c <= x.max);
      const w = d ? d.w : this._defW;
      return Math.trunc(w * 7 + 5) * 9525;
    }
    rowEmu(r) {
      this.colEmu(1);
      const el = this.rows.get(r);
      const ht = el && el.getAttribute('ht') ? +el.getAttribute('ht') : this._defH;
      return Math.round(ht * 12700);
    }
    // posizione frazionaria (colonne/righe da 0) -> EMU assoluti e viceversa
    xToEmu(x) { let e = 0, c = 0; for (; c < Math.floor(x); c++) e += this.colEmu(c + 1); return e + (x - c) * this.colEmu(c + 1); }
    yToEmu(y) { let e = 0, r = 0; for (; r < Math.floor(y); r++) e += this.rowEmu(r + 1); return e + (y - r) * this.rowEmu(r + 1); }
    emuToCol(e) { let c = 0; while (e >= this.colEmu(c + 1)) { e -= this.colEmu(c + 1); c++; } return { i: c, off: Math.round(e) }; }
    emuToRow(e) { let r = 0; while (e >= this.rowEmu(r + 1)) { e -= this.rowEmu(r + 1); r++; } return { i: r, off: Math.round(e) }; }
    rowHeight(n, ht) {
      const r = this.row(n);
      r.setAttribute('ht', ht); r.setAttribute('customHeight', '1');
    }
    cell(ref) {
      const { col, row } = splitRef(ref);
      const r = this.row(row);
      let before = null;
      for (const c of r.getElementsByTagNameNS(NS, 'c')) {
        const cr = c.getAttribute('r');
        if (cr === ref) return c;
        if (splitRef(cr).col > col) { before = c; break; }
      }
      const c = this.doc.createElementNS(NS, 'c');
      c.setAttribute('r', ref);
      r.insertBefore(c, before);
      return c;
    }
    // fmt: { size, bold } per rendere leggibile il testo inserito
    set(ref, value, fmt) {
      if (value === undefined || value === null || value === '') return;
      const c = this.cell(ref);
      if (fmt) c.setAttribute('s', this.style(+(c.getAttribute('s') || 0), fmt));
      while (c.firstChild) c.removeChild(c.firstChild);
      if (typeof value === 'number') {
        c.removeAttribute('t');
        const v = this.doc.createElementNS(NS, 'v'); v.textContent = String(value); c.appendChild(v);
      } else {
        c.setAttribute('t', 'inlineStr');
        const is = this.doc.createElementNS(NS, 'is'), t = this.doc.createElementNS(NS, 't');
        t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
        t.textContent = String(value);
        is.appendChild(t); c.appendChild(is);
      }
    }
    // segno a penna sulla cella: "/" (barra), "x" (croce) o riquadro, nel colore del periodo
    mark(ref, how, color) {
      const c = this.cell(ref);
      const s = +(c.getAttribute('s') || 0);
      const opt = how === 'box' ? { sides: { left: color, right: color, top: color, bottom: color } } : { diag: how || '/', color };
      c.setAttribute('s', this.style(s, opt));
      if (how === 'box') {
        // anche i lati condivisi delle celle vicine, altrimenti Excel mostra i loro bordi sottili
        const { col, row } = splitRef(ref);
        [[col - 1, row, 'right'], [col + 1, row, 'left'], [col, row - 1, 'bottom'], [col, row + 1, 'top']].forEach(([cc, rr, side]) => {
          if (cc < 1 || rr < 1) return;
          const n = this.cell(colLetters(cc) + rr);
          n.setAttribute('s', this.style(+(n.getAttribute('s') || 0), { sides: { [side]: color } }));
        });
      }
    }
    // colore del testo inserito (senza cambiare bordi)
    restyle(ref, opt) {
      const c = this.cell(ref);
      c.setAttribute('s', this.style(+(c.getAttribute('s') || 0), opt));
    }
    add(tag, el) {
      const parent = this.sty.getElementsByTagNameNS(NS, tag)[0];
      parent.appendChild(el);
      const n = parent.children.length;
      parent.setAttribute('count', n);
      return n - 1;
    }
    font(size, bold, color) {
      const key = `${size}|${bold ? 'b' : ''}|${color || ''}`;
      if (this.fontCache.has(key)) return this.fontCache.get(key);
      const sty = this.sty;
      const f = sty.createElementNS(NS, 'font');
      if (bold) f.appendChild(sty.createElementNS(NS, 'b'));
      const sz = sty.createElementNS(NS, 'sz'); sz.setAttribute('val', size); f.appendChild(sz);
      if (color) { const co = sty.createElementNS(NS, 'color'); co.setAttribute('rgb', color); f.appendChild(co); }
      const nm = sty.createElementNS(NS, 'name'); nm.setAttribute('val', 'Arial'); f.appendChild(nm);
      const fam = sty.createElementNS(NS, 'family'); fam.setAttribute('val', '2'); f.appendChild(fam);
      const id = this.add('fonts', f);
      this.fontCache.set(key, id);
      return id;
    }
    // copia del bordo originale con diagonale ("/" o "x") oppure riquadro colorato
    border(baseId, opt) {
      const sty = this.sty;
      const borders = sty.getElementsByTagNameNS(NS, 'borders')[0];
      const base = borders.children[baseId] || borders.children[0];
      const b = base.cloneNode(true);
      const side = name => {
        let el = [...b.children].find(x => x.localName === name);
        if (!el) { el = sty.createElementNS(NS, name); b.appendChild(el); }
        return el;
      };
      const paint = (el, style, color) => {
        el.setAttribute('style', style);
        while (el.firstChild) el.removeChild(el.firstChild);
        const co = sty.createElementNS(NS, 'color'); co.setAttribute('rgb', color); el.appendChild(co);
      };
      if (opt.diag) {
        b.setAttribute('diagonalUp', '1');
        if (opt.diag === 'x') b.setAttribute('diagonalDown', '1');
        // ordine richiesto: left, right, top, bottom, diagonal
        ['left', 'right', 'top', 'bottom'].forEach(side);
        const d = side('diagonal'); b.appendChild(d);
        paint(d, 'thick', opt.color || 'FF000000');
      }
      if (opt.sides) {
        Object.entries(opt.sides).forEach(([n, color]) => paint(side(n), 'thick', color));
        side('diagonal');
      }
      // riordina i figli nell'ordine dello schema
      const order = ['start', 'left', 'end', 'right', 'top', 'bottom', 'diagonal', 'vertical', 'horizontal'];
      [...b.children].sort((x, y) => order.indexOf(x.localName) - order.indexOf(y.localName)).forEach(x => b.appendChild(x));
      return this.add('borders', b);
    }
    style(s, opt) {
      const key = `${s}|${JSON.stringify(opt)}`;
      if (this.styleCache.has(key)) return this.styleCache.get(key);
      const sty = this.sty;
      const xfs = sty.getElementsByTagNameNS(NS, 'cellXfs')[0];
      const clone = (xfs.children[s] || xfs.children[0]).cloneNode(true);
      if (opt.size || opt.color) {
        const curFont = sty.getElementsByTagNameNS(NS, 'fonts')[0].children[+clone.getAttribute('fontId') || 0];
        const curSz = curFont && [...curFont.children].find(x => x.localName === 'sz');
        clone.setAttribute('fontId', this.font(opt.size || (curSz ? +curSz.getAttribute('val') : 11), opt.bold, opt.color));
        clone.setAttribute('applyFont', '1');
      }
      if (opt.diag || opt.sides) {
        clone.setAttribute('borderId', this.border(+clone.getAttribute('borderId') || 0, opt));
        clone.setAttribute('applyBorder', '1');
      }
      if (opt.center) {
        let al = [...clone.children].find(x => x.localName === 'alignment');
        if (!al) { al = sty.createElementNS(NS, 'alignment'); clone.appendChild(al); }
        al.setAttribute('horizontal', 'center'); al.setAttribute('vertical', 'center');
        clone.setAttribute('applyAlignment', '1');
      }
      const id = this.add('cellXfs', clone);
      this.styleCache.set(key, id);
      return id;
    }
    serialize() {
      const S = new XMLSerializer();
      const fix = x => (x.startsWith('<?xml') ? x : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + x);
      return { sheet: fix(S.serializeToString(this.doc)), styles: fix(S.serializeToString(this.sty)) };
    }
  }

  // ---------- Compilazione ----------
  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return d && m && y ? `${d}/${m}/${y}` : iso;
  }

  function fill(sh, L, game, st) {
    const rules = st.rules;
    const info = game.info;
    const H = L.header;
    // il foglio si stampa al 20%: le etichette originali sono a 24-28 pt
    const HF = { size: 24, bold: true };
    sh.set(H.categoria, `${rules.categoryName || ''}`, HF);
    sh.set(H.girone, info.girone, HF);
    sh.set(H.gara, info.gara, HF);
    sh.set(H.data, fmtDate(info.data), HF);
    sh.set(H.ora, info.ora, HF);
    sh.set(H.campo, info.campo, HF);
    sh.set(H.squadraA, game.teams.A.name, HF);
    sh.set(H.squadraB, game.teams.B.name, HF);
    sh.set(H.arbitri, info.arbitri, HF);
    sh.set(H.segnapunti, info.segnapunti, HF);
    sh.set(H.cronometrista, info.cronometrista, HF);
    const NAME = { size: 24 }, BIG = { size: 26, bold: true }, FIN = { size: 28, bold: true };
    const PEN = per => ({ size: 24, bold: true, color: pcol(per) });
    const BLACK = 'FF000000';

    // addetto DAE (defibrillatore) in alto, sopra l'intestazione
    if (info.dae) {
      const col = /^[A-Z]+/.exec(H.campo)[0];
      sh.rowHeight(2, 36);
      sh.set(`${col}2`, `DAE: ${info.dae}`, { size: 28, bold: true });
    }

    ['A', 'B'].forEach((t, ti) => {
      const TL = L.teams[ti];
      const tm = game.teams[t];
      const T = st.teams[t];
      sh.set(TL.titleCell, `SQUADRA "${t}": ${tm.name || ''}`);
      if (tm.color) sh.set(TL.colorCell, `MAGLIA: ${tm.color}`);
      const rowsUsed = TL.periodCols.map(() => new Set());
      const cellsUsed = TL.periodCols.map(() => 0);   // caselle occupate dal giocatore che ha segnato di più
      tm.players.slice(0, TL.playerRows.length).forEach((p, i) => {
        const row = TL.playerRows[i];
        const pl = T.players[p.id];
        const at = c => `${colLetters(c)}${row}`;
        // anno di nascita a sinistra del nome (es. 16, 17)
        const yy = String(p.year || '').trim();
        if (yy && TL.nameCol > 1) sh.set(at(TL.nameCol - 1), yy.length === 4 ? yy.slice(2) : yy, { size: 22, bold: true, center: true });
        sh.set(at(TL.nameCol), p.name, NAME);
        const num = String(p.number).trim();
        sh.set(at(TL.numCol), /^\d+$/.test(num) ? +num : num, BIG);
        // entrate in gioco: X nel colore del periodo
        pl.entrate.forEach(per => { if (TL.entrateCols[per]) sh.set(at(TL.entrateCols[per]), 'X', PEN(per)); });
        // falli: tipo + periodo (es. P3), nel colore del periodo
        pl.fouls.slice(0, TL.foulCols.length).forEach((f, k) => sh.set(at(TL.foulCols[k]), `${f.kind}${f.period + 1}`, PEN(f.period)));
        // punti segnati per tempo (un canestro per casella)
        pl.byPeriod.forEach((vals, per) => {
          const pc = TL.periodCols[per];
          if (!pc || !vals.length) return;
          rowsUsed[per].add(i);
          const width = pc[1] - pc[0] + 1;
          const shown = vals.length > width ? vals.slice(0, width - 1).concat([vals.slice(width - 1).reduce((a, b) => a + b, 0)]) : vals;
          shown.forEach((v, k) => sh.set(at(pc[0] + k), v, PEN(per)));
          cellsUsed[per] = Math.max(cellsUsed[per], shown.length);
        });
      });
      // linea di chiusura del tempo (dal basso, a destra dell'ultimo punto scritto, fino all'angolo in alto a destra)
      // con il totale della squadra nel periodo cerchiato a metà della linea
      TL.periodCols.forEach((pc, per) => {
        if (!st.ended.includes(per)) return;
        const startCol = Math.min(pc[0] + cellsUsed[per], pc[1]);
        const line = {
          fromCol: startCol - 1, fromRow: TL.playerRows[0] - 1,
          toCol: pc[1], toRow: TL.playerRows[TL.playerRows.length - 1],
          color: pcol(per).slice(2)
        };
        sh.lines.push(line);
        sh.circles.push({
          x: (line.fromCol + line.toCol) / 2, y: (line.fromRow + line.toRow) / 2,
          text: String(T.periodScore[per]), color: line.color
        });
      });
      // istruttori
      tm.coaches.forEach((c, i) => {
        const CL = TL.coaches[i];
        if (!CL) return;
        if (c.name) sh.set(CL.nameCell, `ISTRUTTORE: ${c.name}`);
        if (c.card) sh.set(CL.cardCell, `N° TESSERA: ${c.card}`);
        const techs = T.coaches[i].periods || [];
        for (let k = 0; k < Math.min(T.coaches[i].techs, CL.techCells.length); k++) {
          const per = techs[k];
          sh.set(CL.techCells[k], per != null ? `T${per + 1}` : 'T', per != null ? PEN(per) : { size: 24, bold: true });
        }
      });
      // sospensioni (time-out): barra sul numero del periodo
      T.timeouts.forEach((n, per) => { if (n > 0 && TL.timeouts[per]) sh.mark(TL.timeouts[per], '/', pcol(per)); });
      // punteggio progressivo: barra su ogni numero raggiunto, nel colore del periodo
      for (let v = 1; v <= T.total; v++) if (TL.running[v - 1]) sh.mark(TL.running[v - 1], '/', pcol(T.runningPer[v - 1] || 0));
    });

    // punti per tempo (3 / 2 / 1): croce sul valore
    st.periodPoints.forEach((pp, per) => {
      const row = L.periodPoints[per];
      if (!pp || !row) return;
      if (row.A[pp[0]]) sh.mark(row.A[pp[0]], 'x', BLACK);
      if (row.B[pp[1]]) sh.mark(row.B[pp[1]], 'x', BLACK);
    });
    if (st.spareggio && L.spareggio) {
      const w = st.spareggio, l = w === 'A' ? 'B' : 'A';
      if (L.spareggio[w][3]) sh.mark(L.spareggio[w][3], 'x', BLACK);
      if (L.spareggio[l][1]) sh.mark(L.spareggio[l][1], 'x', BLACK);
    }
    if (st.started) {
      sh.set(L.final.A, `A   ${st.final.A}`, FIN);
      sh.set(L.final.B, `B   ${st.final.B}`, FIN);
    }
  }

  // linee e cerchi disegnati (come a penna) nel livello disegni del foglio
  function addDrawings(xml, sh) {
    let id = 1000;
    const anchor = (f, t, body) => `<xdr:twoCellAnchor editAs="oneCell">` +
      `<xdr:from><xdr:col>${f.c}</xdr:col><xdr:colOff>${f.co}</xdr:colOff><xdr:row>${f.r}</xdr:row><xdr:rowOff>${f.ro}</xdr:rowOff></xdr:from>` +
      `<xdr:to><xdr:col>${t.c}</xdr:col><xdr:colOff>${t.co}</xdr:colOff><xdr:row>${t.r}</xdr:row><xdr:rowOff>${t.ro}</xdr:rowOff></xdr:to>` +
      body + `<xdr:clientData/></xdr:twoCellAnchor>`;
    const lines = sh.lines.map(l => anchor({ c: l.fromCol, co: 0, r: l.fromRow, ro: 0 }, { c: l.toCol, co: 0, r: l.toRow, ro: 0 },
      `<xdr:cxnSp macro=""><xdr:nvCxnSpPr><xdr:cNvPr id="${++id}" name="Chiusura tempo ${id}"/><xdr:cNvCxnSpPr/></xdr:nvCxnSpPr>` +
      `<xdr:spPr><a:xfrm flipV="1"><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom>` +
      `<a:ln w="38100"><a:solidFill><a:srgbClr val="${l.color}"/></a:solidFill></a:ln></xdr:spPr></xdr:cxnSp>`));
    const circles = sh.circles.map(c => {
      const cx = sh.xToEmu(c.x), cy = sh.yToEmu(c.y);
      const d = Math.round(sh.rowEmu(Math.floor(c.y) + 1) * 2.1);   // diametro: circa due righe
      const f = { x: sh.emuToCol(cx - d / 2), y: sh.emuToRow(cy - d / 2) };
      const t = { x: sh.emuToCol(cx + d / 2), y: sh.emuToRow(cy + d / 2) };
      return anchor({ c: f.x.i, co: f.x.off, r: f.y.i, ro: f.y.off }, { c: t.x.i, co: t.x.off, r: t.y.i, ro: t.y.off },
        `<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${++id}" name="Totale tempo ${id}"/><xdr:cNvSpPr/></xdr:nvSpPr>` +
        `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${d}" cy="${d}"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>` +
        `<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="44450"><a:solidFill><a:srgbClr val="${c.color}"/></a:solidFill></a:ln></xdr:spPr>` +
        `<xdr:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="ctr" anchorCtr="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>` +
        `<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="it-IT" sz="5400" b="1"><a:solidFill><a:srgbClr val="${c.color}"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>${c.text}</a:t></a:r></a:p></xdr:txBody></xdr:sp>`);
    });
    const pics = sh.pictures.map(p => {
      const f = { x: sh.emuToCol(p.x), y: sh.emuToRow(p.y) }, t = { x: sh.emuToCol(p.x + p.cx), y: sh.emuToRow(p.y + p.cy) };
      return anchor({ c: f.x.i, co: f.x.off, r: f.y.i, ro: f.y.off }, { c: t.x.i, co: t.x.off, r: t.y.i, ro: t.y.off },
        `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${++id}" name="${p.name}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
        `<xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${p.rid}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
        `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${p.cx}" cy="${p.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>`);
    });
    // i cerchi dopo le linee, così restano sopra
    return xml.replace('</xdr:wsDr>', lines.join('') + circles.join('') + pics.join('') + '</xdr:wsDr>');
  }

  // firme: immagini PNG posate sulle righe "FIRME" del referto
  const SIGN_SLOTS = [
    ['istruttoreA', 'istruttori', 0], ['istruttoreB', 'istruttori', 1],
    ['segnapunti', 'segnapunti', 0], ['cronometrista', 'cronometrista', 0],
    ['arbitro1', 'arbitri', 0], ['arbitro2', 'arbitri', 1]
  ];
  function addSignatures(sh, L, game, files) {
    const sigs = game.signatures || {};
    const used = SIGN_SLOTS.filter(([k, g, i]) => sigs[k] && sigs[k].img && L.signatures && L.signatures[g] && L.signatures[g][i]);
    if (!used.length) return;
    const drawF = files.find(f => /^xl\/drawings\/drawing\d+\.xml$/.test(f.name));
    if (!drawF) return;
    const relsName = drawF.name.replace(/drawings\/(drawing\d+\.xml)$/, 'drawings/_rels/$1.rels');
    const enc = new TextEncoder(), dec = new TextDecoder();
    let rels = files.find(f => f.name === relsName);
    if (!rels) { rels = { name: relsName, data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>') }; files.push(rels); }
    let relXml = dec.decode(rels.data);
    used.forEach(([k, g, i]) => {
      const sig = sigs[k];
      const line = L.signatures[g][i];
      const rid = 'rIdFirma_' + k;
      files.push({ name: `xl/media/firma_${k}.png`, data: b64ToBytes(sig.img.split(',')[1]) });
      relXml = relXml.replace('</Relationships>', `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/firma_${k}.png"/></Relationships>`);
      // riquadro: la riga della firma e quella sopra, per tutta la larghezza
      const x0 = sh.xToEmu(line.c0 - 1), x1 = sh.xToEmu(line.c1);
      const y0 = sh.yToEmu(line.row - 2), y1 = sh.yToEmu(line.row);
      const bw = (x1 - x0) * 0.92, bh = (y1 - y0) * 0.95;    // resta sotto l'etichetta
      const scale = Math.min(bw / sig.w, bh / sig.h);
      const cx = Math.round(sig.w * scale), cy = Math.round(sig.h * scale);
      sh.pictures.push({ rid, name: 'Firma ' + k, cx, cy, x: Math.round(x0 + (x1 - x0 - cx) / 2), y: Math.round(y1 - cy - (y1 - y0) * 0.03) });
    });
    rels.data = enc.encode(relXml);
    const ct = files.find(f => f.name === '[Content_Types].xml');
    let ctXml = dec.decode(ct.data);
    if (!/Extension="png"/i.test(ctXml)) ctXml = ctXml.replace('<Default ', '<Default Extension="png" ContentType="image/png"/><Default ');
    ct.data = enc.encode(ctXml);
  }

  async function buildReferto(game, st) {
    const key = st.rules.template + (game.templateVariant === 'int' ? '_int' : '');
    const L = window.REFERTO_LAYOUTS[key];
    const files = await unzip(b64ToBytes(window.REFERTO_FILES[key]));
    const sheetF = files.find(f => f.name === 'xl/worksheets/sheet1.xml');
    const stylesF = files.find(f => f.name === 'xl/styles.xml');
    const dec = new TextDecoder(), enc = new TextEncoder();
    const sh = new Sheet(dec.decode(sheetF.data), dec.decode(stylesF.data));
    fill(sh, L, game, st);
    addSignatures(sh, L, game, files);
    const out = sh.serialize();
    sheetF.data = enc.encode(out.sheet);
    stylesF.data = enc.encode(out.styles);
    const drawF = files.find(f => /^xl\/drawings\/drawing\d+\.xml$/.test(f.name));
    if (drawF && (sh.lines.length || sh.circles.length || sh.pictures.length)) drawF.data = enc.encode(addDrawings(dec.decode(drawF.data), sh));
    return zip(files.filter(f => f.name !== 'xl/calcChain.xml'));
  }

  window.MB_XLSX = { buildReferto, unzip, zip, crc32, colLetters };
})();
