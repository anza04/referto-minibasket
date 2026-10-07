# Referto Minibasket

Web app offline per compilare il referto delle gare di Minibasket FIP, con le regole del
**Regolamento di gioco 2026/2027** e l'esportazione del **referto ufficiale Excel** (modelli 5c5, 4c4,
4c4 OPEN, 3c3 Sprint, 4c4 Sprint, standard o con intestazione FIP).

## Cosa fa

1. **Categoria** – chiede la categoria (Scoiattoli, Libellule, Aquilotti, Gazzelle Small/Big/OPEN, Esordienti M/F/OPEN).
   Pulcini e Paperine non hanno referto (solo Easybasket).
2. **Modalità** – propone solo le modalità previste per la categoria e applica le regole relative:
   periodi e minuti, numero giocatori, limite falli (4 o 5), tiri liberi sì/no (senza tiri liberi ogni fallo
   dà 1 punto + possesso), libero aggiuntivo (5c5 ed Esordienti), bonus 5c5, time-out, tempo effettivo,
   pareggio ammesso (Scoiattoli/Libellule e 3c3) o spareggio.
3. **Partita** – formazioni a ogni periodo con suggerimento secondo il regolamento (periodi minimi/massimi,
   tutti in campo entro il 3° periodo nel 4c4 o il 2° nel 5c5, gruppi da 5/6 nel 5c5, cambi liberi nell'OPEN),
   canestri, tiri liberi, falli P/U/D/T, esclusioni automatiche, sostituzioni (art. 43), tecnici agli Istruttori,
   time-out, cronometro, annulla.
4. **Fine gara** – punteggio a periodi (3-1 / 2-2), punteggio progressivo, gara/spareggio *Shooting Fire*,
   controlli di regolamento, sconfitta a tavolino.
5. **Referto** – compila il modello Excel ufficiale corretto (intestazione, giocatori, entrate in gioco, falli,
   punti per tempo, punteggio progressivo, sospensioni, punti per periodo, punteggio finale). Anche stampa/PDF.
   La compilazione riproduce quella a mano: un colore per periodo (rosso, blu, verde, ripetuti), falli con il
   periodo (`P3`), barra sui numeri del punteggio progressivo e sulle sospensioni, totale della squadra nel periodo
   cerchiato in grande a metà della linea diagonale di chiusura di ogni tempo, croce sui punti del periodo, anno di nascita a sinistra del nome, addetto DAE in alto.
6. **Firme** – nella schermata del referto ogni firma (Istruttore A e B, segnapunti, cronometrista, arbitri)
   si raccoglie con il dito, la penna o il mouse; le firme vengono posate sulle righe "FIRME" del referto Excel
   e compaiono nella stampa/PDF. Se il referto viene modificato dopo una firma, l'app lo segnala.
7. **Salvataggio** – tutto è salvato sul dispositivo a ogni azione; referto `.xlsx` e backup `.json` vengono
   salvati nella cartella Google Drive indicata (in coda se offline, inviati al ritorno della connessione).

## Avvio

L'app è composta solo da file statici (nessun server o database necessario).

- **Uso rapido**: apri `index.html` con Chrome/Edge. Funziona tutto tranne l'installazione come app e il
  collegamento diretto a Google Drive (che richiede un indirizzo `http(s)://`).
- **Consigliato**: pubblica la cartella su un hosting statico gratuito (GitHub Pages, Netlify, Cloudflare Pages)
  oppure in locale con `python -m http.server 8765` e apri `http://localhost:8765`.
  Alla prima apertura l'app si salva nel browser: da quel momento funziona **completamente offline**
  e può essere installata ("Installa app" / "Aggiungi a schermata Home") su PC, tablet e telefono.

## Salvataggio su Google Drive

In *Impostazioni → Salvataggio su cloud* scegli una delle due modalità:

**A. Google Drive (online)** – carica i file direttamente nella cartella indicata.
1. Su <https://console.cloud.google.com> crea un progetto e abilita **Google Drive API**.
2. *Schermata consenso OAuth*: tipo *Esterno*, aggiungi il tuo account tra gli utenti di test.
3. *Credenziali → Crea credenziali → ID client OAuth → Applicazione web*; in *Origini JavaScript autorizzate*
   aggiungi l'indirizzo da cui apri l'app (es. `https://tuonome.github.io` o `http://localhost:8765`).
4. Nell'app incolla il **Client ID** e il **link della cartella Drive** (es. `https://drive.google.com/drive/folders/…`)
   e premi *Salva e collega*.

I file in attesa sono indicati dal badge in alto: toccandolo si forza la sincronizzazione
(l'accesso Google dura circa un'ora, poi viene richiesto di nuovo con un tocco).

**B. Cartella sincronizzata (PC, Chrome/Edge)** – scegli una cartella di *Google Drive per desktop*
(es. `G:\Il mio Drive\Referti Minibasket`): i file vengono scritti subito anche offline e Drive li sincronizza.
Non richiede alcuna configurazione su Google Cloud.

I file prendono il nome `Referto_<data>_<categoria>_<modalità>_<squadraA>-vs-<squadraB>_gara<n>.xlsx`
(e `.json`); se si riesporta la stessa gara il file su Drive viene aggiornato, non duplicato.
Il `.json` può essere reimportato da *Importa backup* nella schermata iniziale.

## Struttura

| File | Contenuto |
|---|---|
| `index.html`, `css/app.css` | interfaccia |
| `js/rules.js` | categorie, modalità e regole del regolamento 2026/2027 |
| `js/engine.js` | motore di gioco (stato ricalcolato dagli eventi, controlli di regolamento) |
| `js/xlsx.js` | compilazione del modello Excel ufficiale (senza librerie esterne) |
| `js/storage.js` | salvataggio locale, coda e sincronizzazione Google Drive |
| `js/templates.js` | modelli Excel incorporati + mappa delle celle (generato) |
| `sw.js`, `manifest.webmanifest` | funzionamento offline e installazione |
| `tools/` | file Excel originale, modelli per foglio e script `build_templates.py` |

Se cambia il modello Excel della FIP: sostituisci `tools/referto-originale.xls`, rigenera i modelli per foglio
(vedi `tools/split_templates.ps1`, richiede Excel) ed esegui `python tools/build_templates.py`
(richiede `openpyxl`). Aggiorna anche `CACHE` in `sw.js` per far scaricare la nuova versione.
