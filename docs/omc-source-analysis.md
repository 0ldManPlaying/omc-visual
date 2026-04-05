# OMC broncode-analyse (oh-my-claudecode 4.10.2)

Doel: begrijpen hoe **oh-my-claudecode** output levert, teams start, en voltooiing detecteert, zodat **OMC Visual** daarop aansluit in plaats van parallelle conventies.

---

## 1. Hoe OMC output streamt

### 1.1 Single-agent / worker in een tmux-pane

- Workers worden gestart met **`tmux send-keys`** naar een **pane-id** (`%N`), niet via stdout van een parent Node-proces. Zie `spawnWorkerInPane` in `dist/team/tmux-session.js`: het bouwt een shell-commando met `buildWorkerStartCommand` en stuurt dat letterlijk naar het pane met `send-keys -l` + `Enter`.
- De **parent** ziet dus **geen** interactieve Claude TUI-output op eigen stdout; de CLI draait **in** het tmux-pane.
- OMC gebruikt **`tmux capture-pane`** om pane-inhoud te lezen voor **health / readiness**, niet als primaire “streaming API” naar eindgebruikers:
  - `capturePaneAsync` in `tmux-session.js`: `tmux capture-pane -t <paneId> -p -S -80`
  - `runtime-v2.js` functie `captureWorkerPane`: dezelfde aanpak (`-S -80`) voor monitor-logica.
- **`stream-json` / `output-format`**: in de onderzochte team/tmux-paden is dat **niet** de hoofdlijn; worker-launch gebruikt `buildWorkerArgv` / `buildLaunchArgs` uit `model-contract` + `bridge/runtime-cli.cjs` (Claude: o.a. `--dangerously-skip-permissions`, optioneel `--model`). JSON-achtige parsing komt vooral bij **codex** `parseOutput` in het bridge-contract, niet als algemene team-stream.

### 1.2 Print mode (`claude -p`) en OMC Visual

- Voor **one-shot**, niet-interactieve runs is **`claude -p`** passend: output gaat naar **stdout/stderr** van het child-proces. Dat is hetzelfde patroon als andere CLI-wrappers.
- OMC Visual gebruikt voor niet-team modes reeds **directe `spawn('claude', …)`** met stdout/stderr → WebSocket; dat sluit aan bij `-p` gedrag.

**Conclusie:** Voor **team/interactieve panes** is de bron van waarheid **tmux + capture-pane (+ state files)**. Voor **-p single-agent** is de bron van waarheid **process stdout/stderr**.

---

## 2. Hoe OMC teams spawnt

### 2.1 tmux-topologie (`createTeamSession`)

Uit `dist/team/tmux-session.js` (`createTeamSession`):

- Bepaalt context: **binnen tmux** (splits in huidige window), **eigen window** (`--new-window`), of **detached session** (`omc-team-<teamName>-<base36 timestamp>`) als er geen bruikbare tmux-context is.
- Worker-panes: **`split-window -h`** vanaf de leader, daarna **`-v`** voor extra workers; daarna **`main-vertical`** layout (`applyMainVerticalLayout`).
- Stabiliteit: gebruikt **pane IDs** (`%…`), niet alleen indices.

### 2.2 Worker start (`spawnWorkerInPane`)

- Zet `OMC_TEAM_WORKER={teamName}/workerName` in env (via `buildWorkerStartCommand` + worker config).
- Start de agent-binary (claude/codex/gemini) via **exec in shell** in dat pane.

### 2.3 CLI-entry: `omc team …`

Uit `dist/cli/commands/team.js` + `dist/cli/team.js`:

- Gebruiker start: `omc team [N:agent-type[:role]] "<task>"` (optioneel `--json`, `--cwd`, `--new-window`).
- Default runtime: **`runtime-v2.js`** (`isRuntimeV2Enabled()`), anders legacy `runtime.js`.
- `startTeamV2` / `startTeam` maken state onder **`.omc/state/team/<teamName>/`** en tmux-sessie; `monitorTeamV2` / `monitorTeam` lezen snapshots (geen langlopende stdout-pomp vanuit `omc team` zelf — het proces print status en kan daarna exit’en).

### 2.4 Sessienamen

- Legacy per-worker sessies: `omc-team-{team}-{worker}` (deprecated pad).
- Huidige team-topologie: **session name** in **`session:window`** vorm (bv. van `new-session -P -F '#S:0 #{pane_id}'`), niet het OMC Visual patroon `omc-session-<timestamp>`.

---

## 3. Hoe OMC weet dat een taak klaar is

### 3.1 Runtime v2 (default)

Uit `dist/team/runtime-v2.js` (kopcomment + `buildV2TaskInstruction`):

- **Geen `done.json` watchdog** als primaire waarheid.
- Voltooiing via **task lifecycle**: workers moeten `omc team api claim-task` / `transition-task-status` uitvoeren; state zit in **task JSON files** onder het team state root.
- Monitor wordt **door de caller** aangestuurd (`monitor.js`: snapshot, heartbeats, worker status).

### 3.2 Legacy runtime

- `runtime.js` gebruikt o.a. **done.json**-achtige signalen en tmux-pane events (ouder pad); v2 is leidend tenzij `OMC_RUNTIME_V2` uitgezet.

### 3.3 Pane “ready” heuristieken

- `paneLooksReady` / `paneHasActiveTask` in `tmux-session.js` inspecteren **capture-pane** tekst (prompt-lijnen `❯`, `›`, enz.) — voor **orchestratie**, niet als enige business-completion bron.

**Conclusie voor Visual:** team-**business** completion = **state files + API transitions**; **UI live output** in panes = **capture-pane** (of toekomstige aanvulling met state events). Single-agent **-p** completion = **process exit**.

---

## 4. Hoe OMC team workers monitort

Uit `dist/team/monitor.js`:

- Leest/schrijft JSON onder **`.omc/state/team/<name>/`**: `config`, manifest, `workerStatus`, `heartbeat`, `monitorSnapshot`, `phaseState`, shutdown request/ack, enz. (`TeamPaths` via `state-paths.js`).
- **`readMonitorSnapshot` / `writeMonitorSnapshot`**: incrementele monitor-state.
- **Geen** verplichte poll van `~/.claude/tasks/` in dit pad; team tasks leven in **`.omc/state/team/.../tasks/`** (via `team-ops` / file layout).

**tmux:** `capture-pane` en `isWorkerAlive` (pane) voor liveness en display; **samengesteld** met filesystem snapshots.

---

## 5. Bridge `runtime-cli.cjs`

Pad: `~/.claude/plugins/cache/omc/oh-my-claudecode/4.10.2/bridge/runtime-cli.cjs`

- Bundelt o.a. **tmux-session** (createTeamSession, spawnWorkerInPane, …), **model-contracts** (`CONTRACTS.claude.buildLaunchArgs`, …), en team-runtime logica voor **Claude Code plugin / bridge** scenario’s.
- `buildLaunchArgs` / `buildWorkerArgv`: resolved binary + flags per agent type (Claude: `--dangerously-skip-permissions`, optioneel `--model`).
- Wordt gebruikt als **gemeenschappelijke implementatie** naast `dist/` ESM builds; inhoudelijk parallel aan `dist/team/*.js`.

---

## 6. Relevante code-fragmenten (referentie)

### 6.1 Worker in pane + capture-pane

`dist/team/tmux-session.js` — `spawnWorkerInPane` (ingekort):

```js
await execFileAsync('tmux', ['send-keys', '-t', paneId, '-l', startCmd]);
await execFileAsync('tmux', ['send-keys', '-t', paneId, 'Enter']);
```

`capturePaneAsync`:

```js
const result = await execFileAsync('tmux', ['capture-pane', '-t', paneId, '-p', '-S', '-80']);
```

### 6.2 Team start (CLI)

`dist/cli/commands/team.js` — na `startTeamV2` met `--json`:

```js
console.log(JSON.stringify({
  teamName: runtime.teamName,
  sessionName: runtime.sessionName,
  workerCount: runtime.config.worker_count,
  agentType: uniqueTypes,
  tasks: snapshot ? snapshot.tasks : null,
}));
```

### 6.3 Runtime v2 completion model

`dist/team/runtime-v2.js` — instructies aan worker (levencyclus via CLI API, geen done.json):

```js
// V2: transition-task-status ... REMINDER: Do NOT write done.json
```

---

## 7. Aanbevelingen voor OMC Visual

1. **Niet-team modes (`-p`)**  
   Behoud **directe stdout/stderr streaming** van `claude`; dit matcht print-mode en vermijdt capture-pane/TUI-problemen.

2. **Team mode**  
   Start teams via de **echte OMC CLI**: `omc team <N>:claude:<role> "<task>" --json` (cwd = werkmap), parse **`sessionName`** uit JSON stdout. Daarmee krijg je dezelfde tmux-topologie en **`.omc/state/team/`** als `omc team` in de terminal.

3. **tmux targets**  
   Sla **`sessionName` exact** op zoals OMC teruggeeft (vaak `sessie:venster`). Gebruik **geen** blinde suffix `:0` als die al in de string zit; anders wordt `list-panes` / `capture-pane` ongeldig.

4. **Monitoring in de UI**  
   - Live pane-tekst: blijf **`capture-pane`** gebruiken voor team-sessies (consistent met OMC intern).  
   - Voortgang / “klaar”: waar mogelijk later uitbreiden met **state file reads** of `omc team status` / snapshot API; dat is dichter bij OMC v2 dan alleen pane-tekst.

5. **Fallback**  
   Als `omc` niet op PATH staat: val terug op het vorige pad (clawhip/tmux + “team …” prompt in Claude), met duidelijke logging.

---

*Bestanden gelezen (cache 4.10.2):*  
`dist/team/tmux-session.js`, `runtime.js`, `monitor.js`, `runtime-v2.js`, `api-interop.js`, `dist/cli/team.js`, `dist/cli/commands/team.js`, begin van `bridge/runtime-cli.cjs`.

---

## 8. OMC Visual-implementatie (na analyse)

- **Team start**: als `omc` op PATH staat en `/api/session/team` stuurt `options.teamLaunch`, start de server `omc team <N>:claude:<role> "<taak>" --json` met `cwd` = werkmap; `sessionName` uit JSON wordt opgeslagen als `tmuxSessionName` (vaak `sessie:venster`).
- **tmux-targets**: `list-panes` / `capture-pane` gebruiken `tmuxWindowTargetForListPanes()` (geen dubbele `:0`); `kill-session` gebruikt alleen de sessienaam (`split(':')[0]`).
- **Fallback**: geen `omc` → bestaand Clawhip/bare-tmux pad met `team <N>:<role> …` prompt naar Claude.
- **Print modes**: ongewijzigd directe `claude` stdout/stderr stream.
