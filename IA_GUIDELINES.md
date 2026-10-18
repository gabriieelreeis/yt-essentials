# IA_GUIDELINES.md — YT Essentials

> **Fonte única de verdade do contexto deste projeto.**
> Todo agente de IA (ou pessoa) deve **ler este arquivo inteiro antes de alterar
> qualquer coisa** e **atualizar a seção 13 (Registro de mudanças)** ao terminar.
> Se uma decisão relevante for tomada que não esteja aqui, escreva aqui — do
> contrário, o próximo agente vai perder o contexto.

Última atualização: 2026-10-18 — v0.8.0 (interface traduzida para pt-BR, inglês,
espanhol, russo e alemão via `chrome.i18n` nativo, com o idioma do navegador e
fallback para inglês — seção 5.8; compilação e build verificados, QA manual no
YouTube pendente).

---

## 1. Visão geral

**YT Essentials** é uma extensão do Google Chrome (Manifest V3) que lê o que
acontece no YouTube e melhora a experiência do usuário. Repositório:
`yt-essentials`.

Escopo da v0.8.0 (exatamente estas cinco funcionalidades, nada mais — a
interface é traduzida, seção 5.8):

1. **Salvar vídeos assistidos** — grava localmente título, canal, tempo assistido,
   duração, porcentagem, contagem de reproduções e datas de cada vídeo assistido.
   A página de opções lista o histórico com busca, remoção individual, limpeza
   total e exportação em JSON.
2. **Definir resolução automaticamente** — força a resolução escolhida pelo
   usuário em cada vídeo. Se o vídeo não oferecer aquela qualidade, usa a melhor
   qualidade disponível *abaixo* da escolhida.
3. **Ativar legendas automaticamente** — liga a legenda no idioma escolhido,
   priorizando a faixa **gerada automaticamente (ASR)**; se não existir, usa a
   legenda humana no idioma; se também não existir, usa a tradução de qualquer
   faixa para o idioma escolhido.
4. **Reduzir o delay de lives** — mantém a reprodução de transmissões ao vivo
   perto da borda ao vivo automaticamente: lê a latência real e o **buffer**
   (mídia já baixada à frente do playhead) pelo player, **acelera o próprio
   player apenas o suficiente** para consumir o buffer que passa de um colchão
   de segurança **automático** (adaptado à conexão), descansa em 1x e volta a
   0.95x para reconstruir um colchão fino; se a reprodução ficar mais de 30 s
   atrás (pausa longa), salta direto para a borda ao vivo. Um **indicador
   dentro do player** mostra a latência e o buffer atual (visível até em tela
   cheia). Só age em lives, enquanto o vídeo está rodando. Detalhes na
   seção 5.7.
5. **Pular vídeos já assistidos** — ao abrir um vídeo cujo registro anterior
   tenha `percent >= ALREADY_WATCHED_PERCENT` (90), aparece um botão flutuante
   "Next video" no canto inferior esquerdo **da página** (overlay fixo, por cima
   de todo o conteúdo). O clique usa o botão "próximo" nativo do YouTube
   (playlists e autoplay, como um clique do usuário) e, quando ele não existe no
   DOM, a API do player (`nextVideo()`) via main world. **Nunca aparece em
   lives.** Configurável no popup/options: toggle **Next video button** (em
   pt-BR, "Próximo vídeo"; ligado por padrão) e sub-opção **Skip automatically**
   ("Pular automaticamente"; desligada por padrão) que avança sozinho. Os nomes
   em inglês são as chaves de código; os textos da UI são traduzidos por locale
   (seção 5.8). Detalhes na seção 5.6.

**Fora de escopo por enquanto** (não implemente sem pedido explícito do usuário):
retomar vídeo de onde parou, sincronização entre dispositivos, bloqueio de
anúncios, download de vídeos, service worker/background, testes automatizados.
(A i18n da UI saiu da lista na v0.8.0 — seção 5.8; a lista de idiomas é fechada
e **não** há seletor de idioma na interface.)

---

## 2. Stack e restrições técnicas

| Item | Decisão |
| --- | --- |
| Manifest | V3 (apenas Chrome; Firefox não é alvo) |
| Chrome mínimo | 111 (`world: "MAIN"` em content scripts exige 111+) |
| Framework de extensão | **WXT 0.21** (gera manifest, orquestra entrypoints, dev mode com HMR) |
| Bundler | **Vite 8** (usado pelo WXT) |
| UI | **React 19** (somente popup e página de opções) |
| Linguagem | **TypeScript 7** (strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`) |
| Node | 20+ (a máquina de desenvolvimento usa Node 24) |
| Build | **Obrigatório**: `npm run build` → carregar `.output/chrome-mv3/` no Chrome |
| Persistência | `chrome.storage.local` (única permissão além de host) |
| Permissões de host | `https://www.youtube.com/*` |
| Comentários / logs / código | **Inglês** |
| Idiomas da UI | **pt-BR, en, es, ru, de** via `chrome.i18n`; o idioma segue o navegador e cai para inglês nos demais (seção 5.8) |
| Documentação (este arquivo, README) | **Português (Brasil)** |

**Atenção (Windows/PowerShell):** nesta máquina o shim `npm.ps1` é bloqueado por
execution policy. Use **`npm.cmd`** (ou `npx.cmd`) nos comandos.

Regra de ouro: **não adicione dependências novas** (state manager, UI kit,
tailwind, etc.) sem alinhar com o usuário. React + WXT já é tudo que o projeto
usa de propósito.

---

## 3. Estrutura de arquivos

```
package.json                # scripts: dev / build / zip / compile; postinstall: wxt prepare
wxt.config.ts               # srcDir=src, módulo React, imports:false e manifest (permissões, ícones)
tsconfig.json               # extends ./.wxt/tsconfig.json (gerado por `wxt prepare`) + types:["chrome"]
public/icons/*.png          # ícones (copiados verbatim para o build; regerar com tools/make-icons.ps1)
public/_locales/*/messages.json  # traduções da UI (en, pt_BR, es, ru, de; seção 5.8)
tools/make-icons.ps1        # regera os ícones (PowerShell + System.Drawing)
src/
  entrypoints/              # ← única pasta escaneada pelo WXT como entrypoints
    content.ts              # content script ISOLATED (storage + navegação + gravação + botão de pular + badge)
    main-world.content.ts   # content script MAIN world (API do player: qualidade, legendas, delay de lives)
    popup/index.html        # entrypoint do popup (WXT nomeia pelo diretório)
    popup/main.tsx          # bootstrap React do popup
    popup/PopupApp.tsx      # componente raiz do popup
    popup/style.css
    options/index.html      # entrypoint da página de opções (meta open_in_tab)
    options/main.tsx
    options/OptionsApp.tsx
    options/style.css
  shared/                   # código agnóstico de framework/contexto
    constants.ts            # defaults, listas (qualidades, idiomas), chaves de storage
    types.ts                # tipos de dados (Settings, WatchedVideoRecord, ...)
    storage.ts              # única camada que toca chrome.storage.local
    youtube-player.ts       # helpers puros do player (#movie_player) + tipos
    messages.ts             # protocolo postMessage entre os dois mundos
    youtube-events.ts       # augmentation de tipos dos eventos custom do YouTube
    skip-button.css         # estilo do botão "Next video" (injetado via content.ts)
    i18n.ts                 # textos da UI (`t()` sobre chrome.i18n; seção 5.8)
    logger.ts, utils.ts, theme.css
  components/               # componentes React compartilhados (Toggle, FeaturesSettings, VideoRow)
  hooks/                    # hooks React (useSettings)
.output/                    # builds gerados (NÃO versionado, NÃO editar)
  chrome-mv3/               # produção (carregar esta pasta no Chrome)
  chrome-mv3-dev/           # desenvolvimento (npm run dev)
```

### Regras do WXT que mordem se ignoradas

- **Só `src/entrypoints/` é escaneado.** Um arquivo colocado direto lá dentro
  (ex.: `src/entrypoints/util.ts`) vira um "entrypoint" e quebra o build. Utilitário
  vai para `src/shared/` ou `src/components/`.
- **Nada de efeito colateral no topo dos entrypoints.** O WXT importa os arquivos
  de entrypoint em Node durante o build; todo código de runtime tem que ficar
  dentro do `main()`.
- Entrypoint de página = diretório com `index.html`. O nome do diretório define o
  tipo (`popup/`, `options/`) e o HTML é gerado para `popup.html`/`options.html`.
- `imports: false` no `wxt.config.ts`: **nada de auto-import**; todo helper é
  importado explicitamente (`defineContentScript` vem de
  `wxt/utils/define-content-script`).
- O alias **`@/` aponta para `src/`** (definido no tsconfig gerado). Use `@/shared/...`
  para importar de fora da pasta do entrypoint.

---

## 4. Modelo de dados (`chrome.storage.local`)

Fonte da verdade dos tipos: `src/shared/types.ts`.

### 4.1 Chave `settings`

Merge profundo dos defaults com o que está salvo (ver `storage.getSettings()`).
Adicionar um campo em `DEFAULT_SETTINGS` (`src/shared/constants.ts`) + no tipo
`Settings` já entrega o valor padrão para todos.

```json
{
  "version": 1,
  "debug": false,
  "watched":  { "enabled": true, "minSeconds": 5, "maxEntries": 2000 },
  "quality":  { "enabled": false, "value": "hd1080" },
  "captions": { "enabled": false, "language": "en" },
  "liveDelay": { "enabled": false },
  "skip":     { "enabled": true, "autoSkip": false }
}
```

### 4.2 Chave `watchedVideos`

Mapa `videoId → registro` (mapa, não array, para upsert O(1)):

```json
{
  "dQw4w9WgXcQ": {
    "id": "dQw4w9WgXcQ",
    "title": "Video title",
    "channel": "Channel name",
    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "duration": 213,
    "watchedSeconds": 180,
    "percent": 84,
    "firstWatchedAt": 1712345678901,
    "lastWatchedAt": 1712345678901,
    "playCount": 3
  }
}
```

Regras de negócio embutidas em `storage.upsertWatchedVideo()`:

- `watchedSeconds` e `duration` só crescem (`Math.max` com o valor anterior) —
  nenhuma escrita parcial pode encolher o progresso já salvo.
- `playCount` só incrementa com `incrementPlayCount: true`, que o content script
  manda **apenas na primeira gravação de cada sessão de assistir** (evita contar
  cada autosave de 10s como um play).
- Sessões abaixo de `watched.minSeconds` (5s) são ignoradas — evita registrar
  cliques acidentais.
- Ao passar de `watched.maxEntries` (2000), os registros mais antigos por
  `lastWatchedAt` são podados.
- `storage.getWatchedVideos()` aceita array legado e converte para mapa
  (migração defensiva).

### 4.3 Migrações

`SCHEMA_VERSION` está em `src/shared/constants.ts` e é gravado em
`settings.version`. Ao mudar o formato dos dados: incremente `SCHEMA_VERSION`,
ajuste os tipos, adicione a migração em `storage.ts` e documente na seção 13.

---

## 5. Arquitetura

### 5.1 Por que existem DOIS content scripts

Este é o ponto mais importante do projeto:

- O controle de resolução, legendas e delay de lives do YouTube usa métodos
  internos do elemento `#movie_player` (`getAvailableQualityLevels()`,
  `setPlaybackQualityRange()`, `setOption()`, `loadModule()`,
  `getProgressState()`, `setPlaybackRate()`).
- Content scripts rodam em um **mundo isolado**: eles enxergam o DOM, mas **não
  enxergam propriedades JavaScript criadas pela página**. Ou seja,
  `document.getElementById('movie_player').setPlaybackQualityRange` é
  `undefined` no mundo isolado.
- Solução: `src/entrypoints/main-world.content.ts` é declarado com
  `world: 'MAIN'` e roda dentro do mundo da página, onde a API do player
  existe. Ele **não tem acesso a APIs `chrome.*`** e **não pode poluir o
  `window`** (a página enxerga tudo que ele expõe).
- Os dois scripts conversam por `window.postMessage` com o marcador
  `channel: 'yt-essentials'` (protocolo em `src/shared/messages.ts`).

```
┌─────────────────────────── ISOLATED world ─────────────────────────────┐
│ src/entrypoints/content.ts                                             │
│  • lê settings do chrome.storage.local                                 │
│  • detecta navegação SPA e grava vídeos assistidos                     │
│  • mostra o botão "Next video" (overlay fixo da página)                │
│  • desenha o indicador de delay de lives no player                     │
│  • postMessage({type:'settings'})  ──────────┐                         │
│  • responde {type:'request-settings'}  ◄──┐  │                         │
│  • postMessage({type:'advance'})   ──────────┼──────────┐              │
└───────────────────────────────────────────┼──┼──────────┼──────────────┘
                                            │  │          │ window.postMessage
┌───────────────────────────────────────────┼──┼──────────┼── MAIN world ┐
│ src/entrypoints/main-world.content.ts     ▼  │          ▼              │
│  • guarda o snapshot de settings          ◄──┘                         │
│  • aplica resolução e legendas no #movie_player                        │
│  • reduz o delay de lives (acelera 1.5x até o alvo)                    │
│  • publica {type:'live-status'} (badge no player)                      │
│  • atende {type:'advance'} → player.nextVideo()                        │
└────────────────────────────────────────────────────────────────────────┘
```

Handshake: os dois scripts rodam em `document_start`. `main-world` pede os
settings (`request-settings`) e `content.ts` também empurra os settings assim
que o `storage.getSettings()` resolve — a mensagem perdida no handshake é
coberta pelo push, então não há corrida real.

Além disso, o `main-world` publica `{type:'live-status'}` a cada 1 s enquanto a
opção de live delay estiver ligada numa live (buffer atual, delay em relação à
borda e se está acelerando); o `content.ts` usa esses dados para desenhar o
badge dentro do player e o esconde quando eles param de chegar (recurso
desligado, saiu da live, VOD).

### 5.2 Fluxo: configurações

UI React (popup/options) → `useSettings().update(patch)` →
`storage.updateSettings(patch)` → `chrome.storage.local` →
`chrome.storage.onChanged` dispara no `content.ts` → ele atualiza o snapshot
(resolução, legendas e live delay) e empurra para o `main-world`, que re-aplica
no player na hora (sem reload da página). **Não existe service worker** — toda a
reatividade é feita por `storage.onChanged`.

### 5.3 Fluxo: gravação de vídeos assistidos (content.ts)

1. Navegação detectada por `yt-navigate-finish`, `yt-page-data-updated`,
   `DOMContentLoaded` inicial e polling de `location.href` a cada 1s (fallback
   para navegações que o YouTube não anuncia). Deduplicação por `videoId`.
2. `startSession(videoId)` cria a sessão; o `<video>` é vinculado assim que
   aparece (checado a cada tick de 1s) — inclusive Shorts (`#shorts-player`).
   A sessão também guarda `previousPercent` (percentual do registro **anterior**,
   quando já é considerado "assistido"); como isso é lido na abertura do vídeo,
   os autosaves da própria sessão não conseguem criar falso positivo.
3. Eventos `timeupdate`/`durationchange`/`loadedmetadata`/`ended` mantêm
   `maxPosition` (maior `currentTime` já visto) e `duration`. Duração
   `Infinity`/`NaN` (lives) é descartada.
4. Autosave a cada 10s enquanto assiste (fechar a aba não perde progresso) e
   também em `pagehide`/`visibilitychange`.
5. `playCount` conta 1 por sessão; título/canal são lidos no momento da escrita
   (título via `<meta name="title">`, que é estável a mudanças de SPA).
6. Timers usam `ctx.setInterval` do WXT (são limpos automaticamente quando a
   extensão é recarregada/desativada).
7. `persistSession()` checa `isExtensionAlive()` (`ctx.isValid`) antes de gravar
   (v0.4.1): depois de recarregar a extensão com a aba aberta, o script antigo
   para de tentar salvar em vez de gerar
   `Extension context invalidated` a cada 10s.

### 5.4 Fluxo: resolução (main-world.content.ts)

- Loop de retry: a cada 500ms por até 20s (`startRetryLoop`), com deadline
  renovado a cada novo evento. Necessário porque o player demora a ficar pronto
  e **anúncios resetam a qualidade**.
- Eventos que re-pendem a aplicação: `yt-navigate-finish`,
  `yt-page-data-updated`, `load` e eventos `loadstart`/`playing` de `<video>`
  (capture, pois não borbulham).
- `pickQuality(available, requested)` (em `src/shared/youtube-player.ts`) resolve
  a qualidade desejada: se a escolhida não existir no vídeo, usa a melhor
  **abaixo** dela; se nada estiver abaixo, usa a mais baixa disponível.
  `highres` = a mais alta disponível.
- Chamadas defensivas: `setPlaybackQualityRange(target, target)` e
  `setPlaybackQuality(target)` em try/catch. Aplica de novo até
  `getPlaybackQuality()` confirmar (troca de qualidade é assíncrona).
- `value: "auto"` devolve o controle ao YouTube
  (`setPlaybackQualityRange('auto', 'auto')`, best effort).

### 5.5 Fluxo: legendas (main-world.content.ts)

- `loadModule('captions')` → `getOption('captions', 'tracklist')` (pode não
  existir ainda; o retry cobre) → `pickCaptionTrack()`:
  1. faixa **ASR** (`kind === 'asr'`) no idioma → `{ languageCode }`;
  2. faixa humana no idioma;
  3. tradução: `{ languageCode: <faixa>, translationLanguage: { languageCode: <idioma> } }`
     com `setOption('captions', 'reload', true)`.
- Comparação de idioma é tolerante: `pt` casa com `pt-BR` e vice-versa (match
  exato ou pela base antes do `-`).
- Se nenhuma opção existir, o retry para (nada a fazer naquele vídeo). Se o
  idioma já está ativo, não chama nada (evita piscar/toggle).
- Quando a opção geral está **desligada**, a extensão não toca nas legendas do
  usuário.

### 5.6 Fluxo: botão "Next video" (vídeos já assistidos) — content.ts

- **Configuração:** `settings.skip.enabled` (default **true**) controla o botão;
  `settings.skip.autoSkip` (default **false**) só tem efeito com o anterior
  ligado (na UI aparece como sub-opção desabilitada). Sem schema novo: campo
  adicionado com default é preenchido pelo `deepMerge` do `getSettings()`.
- **Onde:** `skipState()` + `updateSkipButton()`, chamados a cada tick de 1s.
- **Quando aparece** (`skipState()`): `skip.enabled` ligado **e** a sessão atual
  tem `previousPercent !== null` (registro anterior com `percent >= 90`,
  `ALREADY_WATCHED_PERCENT` em `constants.ts`) **e** não é live. A checagem é
  **permissiva de propósito** (não exige achar o botão nativo no DOM): descobrir
  se existe próximo vídeo é responsabilidade do YouTube no momento do clique;
  errar para "não mostrar" foi exatamente o bug da v0.4.x.
- **Live** (`isLivePlayback()`): considerada live se a URL começa com `/live/`,
  se o player tem a classe `ytp-live` ou se `video.duration === Infinity`.
  Nesses casos o botão nunca aparece (não há "próximo" em live).
- **Posicionamento:** overlay **da página**, não do player: elemento
  `position: fixed` com id `yte-skip-button` anexado ao `document.body`
  (canto inferior esquerdo, `left: 12px; bottom: 12px`,
  `z-index: 2147483647` = por cima de todo o conteúdo; sobrevive a re-renders do
  player, que era o motivo de o botão sumir antes). Em **tela cheia** o overlay
  não aparece (o fullscreen só renderiza a subárvore do elemento em tela cheia).
  Estilo em `src/shared/skip-button.css`, importado pelo `content.ts` (o WXT
  adiciona o CSS ao manifest do content script isolado). Os ids do CSS e as
  constantes `SKIP_BUTTON_ID`/`STALE_NOTICE_ID` do `content.ts` ficam em sincronia.
- **Avanço** (`advanceToNextVideo()`): clica no botão nativo `.ytp-next-button`
  quando ele existe e não está marcado como desabilitado
  (`ytp-button-disabled`/`aria-disabled`/`disabled`); se não existir, manda
  `{type:'advance'}` por postMessage e o **main world chama
  `player.nextVideo()`** (com try/catch). Assim o avanço funciona em playlists,
  autoplay e transições SPA, com fallback quando o DOM não coopera.
- **Clique (manual):** `preventDefault()` + `stopPropagation()` +
  `stopImmediatePropagation()` (nunca deixar o clique vazar para os handlers do
  YouTube) e em seguida `advanceToNextVideo()`. O botão é removido na hora e
  reaparece no próximo tick se as condições ainda valerem.
- **Pular sozinho** (`maybeAutoSkip()`, com `skip.autoSkip` ligado): no primeiro
  tick em que o botão *poderia* aparecer, agenda `ctx.setTimeout` de
  `AUTO_SKIP_DELAY_MS` (1,5s — dá tempo do usuário ver o que está acontecendo e
  clicar antes) e então chama `advanceToNextVideo()`. O callback re-checa tudo
  (setting ligado, mesma sessão, `skipState().available`), então desligar o
  toggle no meio do caminho cancela o pulo.
- **Uma vez por vídeo:** `advanceHandledFor` guarda o `videoId` já avançado
  (por clique manual **ou** auto-skip). Reabrir o mesmo vídeo não dispara o
  auto-skip de novo — isso evita brigar com o usuário que voltou de propósito e
  evita loop se o clique no próximo falhar. Vídeos *seguintes* também já
  assistidos continuam sendo pulados em cadeia (cada um com seu próprio
  `videoId`), que é o comportamento desejado em playlists.
- **Diagnóstico:** `logSkipState()` imprime **uma** linha `skip button state`
  (vídeo, percentual, disponível, motivo, e se o botão nativo foi achado) a cada
  mudança de estado, quando o Debug está ligado. Motivos possíveis:
  `disabled in settings`, `not on a video page`, `not watched before (>= 90%)`,
  `live stream`, `already watched`. Se nenhuma linha aparece nem com Debug
  ligado, o content script da aba está **inválido** (extensão recarregada com a
  aba aberta) — nesse caso aparece o aviso `yte-stale-notice` na página.
- **Aviso de contexto inválido:** `showStaleNotice()` cria
  `#yte-stale-notice` (fixed, rodapé central, fundo vermelho,
  `pointer-events: none`, some em 15s) quando `ctx.isValid` falha; é o sintoma
  "recarreguei a extensão e nada funciona nesta aba".
- **Tooltip:** `You already watched this video (N%)` com o percentual anterior
  (texto vem do locale ativo — seção 5.8).

### 5.7 Fluxo: redução do delay de lives (main-world.content.ts)

- **Configuração:** `settings.liveDelay.enabled` (default **false**) e
  `settings.liveDelay.buffer` (default `"2s"`). Opções em `LIVE_DELAY_OPTIONS`
  (`constants.ts`): `real-time` (0 s), `2s`, `5s`, `10s` — o número é o
  "colchão" tolerado atrás da borda ao vivo; cada opção tem um informativo de
  conexão exibido no popup/options. Desligado por padrão: recurso que mexe na
  reprodução via APIs internas é opt-in (como resolução/legendas).
- **Loop:** `checkLiveDelay()` roda a cada 1 s (`LIVE_DELAY_CHECK_INTERVAL_MS`)
  no main world desde o boot — não depende de eventos e não faz nada quando o
  recurso está desligado.
- **Medição:** `liveEdgeDelay(progress)` (`youtube-player.ts`) = `seekableEnd −
  current`, em segundos. É o único sinal usado (não dá para confiar em
  `getDuration()` em lives).
- **Ação (aceleração, não seek):** com o player **playing**, sem anúncio
  (`ad-showing`) e numa live, quando `delay > buffer + LIVE_DELAY_TOLERANCE_S`
  (1,5 s) chama `player.setPlaybackRate(LIVE_CATCH_UP_RATE)` (1.5x; fallback
  `video.playbackRate` se a API não existir) e mantém a aceleração até
  `delay <= buffer + LIVE_DELAY_STOP_MARGIN_S` (0,5 s — histerese que evita
  liga/desliga a cada tick), quando restaura a velocidade anterior. A 1.5x o
  delay fecha 0,5 s por segundo: um atraso de D segundos além do alvo leva
  ~2×D segundos para convergir. Pausado/buffering desliga a aceleração (e
  restaura a velocidade); ao dar play, ela volta em ≤1 s se ainda estiver atrás.
- **Velocidade do usuário:** a velocidade anterior é capturada ao acelerar e
  restaurada ao terminar; se o usuário mudar a velocidade manualmente no meio
  (valor diferente de 1.5x), a extensão não sobrescreve.
- **Indicador no player (badge):** a cada verificação o main world publica
  `{type:'live-status'}` (buffer, delay, `catchingUp`, taxa) e o `content.ts`
  desenha `#yte-live-status` **dentro do `#movie_player`** (canto superior
  direito, `pointer-events: none`) — visível também em **tela cheia**, ao
  contrário do overlay do botão "Next video". Texto: `12.3s behind (buffer 5s)`
  ou `... (real time)` e ` · 1.5x` enquanto acelera (em pt-BR: `12.3s atrás
  (buffer 5s)` — textos do locale ativo, seção 5.8).
  O badge some quando o status fica velho (>5 s sem publicação: recurso
  desligado, saiu da live, VOD). Estilo em `skip-button.css` (id espelhado em
  `LIVE_STATUS_ID` no `content.ts`).
- **Diagnóstico (Debug ligado):** `live delay: catching up`
  (`{ delaySeconds, bufferSeconds, rate }`), `live delay: catch-up finished`
  (`{ delaySeconds, restoredRate }`) e **uma** linha por vídeo+motivo quando
  não dá para medir (`cannot measure the live delay`).
- **Limitações:** precisa que o player exponha `getProgressState()`; lives sem
  DVR não têm atraso real para recuperar (o recurso fica inerte). Não muda a
  latência de transmissão do streamer, só mantém o player na borda que o
  YouTube entrega. Em aba oculta o Chrome throttla timers (~1×/min após um
  tempo): a aceleração já ligada continua, só as decisões ficam mais espaçadas.

---

### 5.8 Fluxo: i18n da interface (chrome.i18n nativo)

- **Idiomas:** `pt_BR`, `en`, `es`, `ru`, `de` — 56 chaves por idioma, todas
  completas. O idioma vem do **navegador** (não há seletor na UI); qualquer
  outro idioma cai em inglês (`default_locale: "en"` no manifest). pt-PT pode
  receber pt-BR ou inglês (decisão do Chrome).
- **Arquivos:** `public/_locales/<locale>/messages.json`, copiados verbatim
  para a raiz do build. O WXT lê o arquivo do `default_locale` (`en`) e gera a
  **união tipada** de chaves em `.wxt/types/i18n.d.ts` — chave errada em `t()`
  quebra o `npm run compile` (rode o build uma vez após mexer nos locales, pois
  os tipos são regenerados ali).
- **Helper:** `src/shared/i18n.ts` exporta `t(key, substitutions?)` (fallback:
  devolve a própria chave em vez de string vazia), `getUiLocale()` (idioma do
  navegador, para o `Intl`) e `languageDisplayName()` (nomes de idiomas de
  legenda via `Intl.DisplayNames`). Usa `browser` de `wxt/browser` porque só
  esse módulo recebe a tipagem gerada — o resto do projeto segue com `chrome.*`.
- **Onde é usado:** popup/options (todos os textos), `content.ts` (botão,
  tooltip, aviso de contexto e badge de delay) e `utils.ts`
  (`formatRelativeTime` usa `Intl.RelativeTimeFormat(locale)`; "just now" virou
  a chave `timeJustNow`). O `main-world.content.ts` **não tem texto de UI** (sem
  `chrome.*`; só logs de debug em inglês).
- **Manifest:** `description: "__MSG_extDescription__"` + `default_locale:
  "en"`; a descrição aparece traduzida em `chrome://extensions`.
- **Frase inteira, não concatenação:** badge, tooltip e histórico usam mensagens
  com placeholders (`$delay$`, `$buffer$`, `$percent$`, `$count$`) para o
  tradutor receber a frase montável (ordem das palavras varia; russo tem
  unidade e plural próprios). O sufixo ` · 1.5x` do catch-up é dado, não texto.
- **`Intl` em vez de mensagens** para nomes de idiomas de legenda (30 × 5
  locales seriam centenas de strings) e datas relativas — funciona em
  **qualquer** idioma de navegador, não só nos 5. Os nomes em inglês de
  `CAPTION_LANGUAGES` ficaram como fallback.
- **Adicionar idioma novo:** criar `public/_locales/<novo>/messages.json`
  copiando o `en` com todas as chaves, traduzir e rebuildar. Nenhum código
  muda (o tipo gerado só olha o `en`).

---

## 6. Decisões técnicas registradas

| Decisão | Por quê |
| --- | --- |
| **WXT** em vez de Vite puro ou `vite-plugin-web-extension` | O autor do `vite-plugin-web-extension` descontinuou o plugin em favor do WXT (sucessor oficial, mesma pessoa). WXT resolve manifest, múltiplos entrypoints, content scripts em MAIN world, HMR e dev mode com auto-launch. |
| `chrome.storage.local` em vez de `localStorage` da página | Acessível no popup/options, persiste mesmo limpando dados do site, limite maior (10MB). Escolha explícita do usuário. |
| React **só** no popup/options | Content scripts não têm UI (são lógica de player/storage). React no content script seria peso morto; a UI da extensão é toda em React. |
| `world: 'MAIN'` em vez de `injectScript` | Um entrypoint só, síncrono no `document_start` e sem `web_accessible_resources`. O script não precisa de APIs de extensão (o `content.ts` é o "pai"). WXT suporta `world` nativamente. |
| `imports: false` no WXT | Sem auto-imports mágicos: imports explícitos são mais legíveis para humanos e agentes de IA e não dependem de tipos gerados. |
| `types: ["chrome"]` explícito no tsconfig | Os tipos globais do `@types/chrome` não estavam sendo incluídos automaticamente; declarar a lista deixa o type-check determinístico. |
| Sem service worker | Todas as necessidades são cobertas por `storage.onChanged` + content scripts. Menos partes móveis. |
| Snapshot de settings + retry loop no main-world | Player não está pronto no `document_start` e anúncios resetam estado; retry idempotente resolve sem polling permanente. |
| Título via `<meta name="title">` | Selector do YouTube quebra com frequência; a meta tag é nativa e atualizada a cada navegação. |
| Mapa `videoId → registro` no storage | Upsert simples e leitura O(1) na gravação periódica. |
| `percent` calculado na escrita, não na leitura | Lista de opções renderiza sem cálculo e sem depender de `duration` disponível. |
| Shorts: suporte best-effort | `#shorts-player` e `/shorts/<id>` já são reconhecidos; seletores de canal de Shorts podem falhar e não devem bloquear nada. |
| Botão "Next video" clica no botão **nativo** do YouTube (`.ytp-next-button`), com fallback `player.nextVideo()` | Zero lógica de "qual é o próximo": playlists, autoplay e navegação SPA ficam idênticos ao comportamento nativo. O fallback (mensagem `advance` → main world) cobre o DOM não cooperar sem exigir heurística de disponibilidade. |
| Botão como **overlay da página** (`position: fixed`, `z-index` máximo), não dentro do player | Pedido explícito do usuário: por cima de todo o conteúdo, no canto inferior esquerdo. De quebra, o jogador recriar o DOM em navegações SPA não remove mais o botão. Trade-off: não aparece em tela cheia (limitação do fullscreen). |
| Visibilidade **permissiva** (não exige achar o botão nativo antes de mostrar) | A v0.4.x escondia o botão quando `findNextButton()` falhava — falso negativo real (relatado com vídeo 99% assistido). Mostrar sempre que "já assistiu e não é live" nunca esconde o botão indevidamente; se não houver próximo, o clique simplesmente não avança. |
| `logSkipState()` (debug) com o motivo em uma linha por mudança | O sintoma "o botão não apareceu" tem várias causas possíveis (setting, percentual, live, contexto inválido); com Debug ligado dá para saber qual delas agiu sem inspecionar o código. |
| Aviso `yte-stale-notice` quando o contexto da extensão morre | Recarregar a extensão com abas abertas deixava a aba silenciosamente quebrada (tick parado, sem botão, sem gravação). O aviso na página + `logger.info` tornam o estado visível sem exigir o console. |
| Botão em **DOM puro**, sem React | É um único elemento nos content scripts; importar React só por isso inflaria o bundle. UI "de conteúdo" continua sendo DOM quando é pequena (ver convenções 9). |
| "Já assistido" = `percent >= 90` do registro **anterior** | `watchedSeconds`/`duration` só crescem e `playCount` conta qualquer sessão ≥5s; o percentual é o sinal mais fiel de "assistiu até o fim". Lido na abertura do vídeo para os autosaves da sessão atual não criarem falso positivo. |
| Botão "Next video" com toggle (`skip.enabled` default **true**) e auto-skip desligado por padrão | O botão já existia para todos; default `true` preserva o comportamento. "Pular sozinho" muda o que acontece sem clique do usuário — agressivo demais para ligar por default, então é opt-in. |
| Auto-skip com atraso de 1,5s (`AUTO_SKIP_DELAY_MS`) em vez de instantâneo | O pulo instantâneo confundiria ("o vídeo mudou sozinho antes de eu ver"); com o atraso o botão aparece, o usuário entende e ainda pode clicar/pausar antes. Constante única para calibrar. |
| Auto-skip **uma vez por vídeo** (`advanceHandledFor`) | Impede loop se o clique no próximo não navegar, evita pulsar de novo se o usuário voltar de propósito para o mesmo vídeo e ainda permite pular vários vídeos já assistidos em sequência (playlist). |
| `skip.enabled`/`skip.autoSkip` como sub-opção desabilitada na UI | Coerência visual: com o toggle principal desligado, "Skip automatically" fica cinza (`Toggle` já suportava `disabled`; `className="sub"` só indenta). |
| Delay de lives por **aceleração** (`player.setPlaybackRate`, 1.5x) até o alvo, não por seek | Escolha explícita do usuário: sem "teleporte" de conteúdo, a reprodução acelera até a borda como um ajuste de velocidade do próprio player. Trade-off: converge a 0,5 s/s (um atraso D além do alvo leva ~2×D s) e o badge mostra `1.5x` durante o catch-up. |
| Buffer de live como **teto tolerado** com histerese: acelera em `buffer + 1,5 s`, para em `buffer + 0,5 s` | Evita liga/desliga da aceleração a cada oscilação; estar mais perto da borda que o buffer é bom e não deve gerar ação. As duas margens são constantes calibráveis (`LIVE_DELAY_TOLERANCE_S`/`LIVE_DELAY_STOP_MARGIN_S`). |
| Live delay **desligado por padrão** | Recursos que mexem na reprodução via APIs internas são opt-in no projeto (como resolução/legendas) — e ainda não houve QA manual em navegador real. |
| Sincronia de live só com o player **playing** (state 1, sem `ad-showing`) | Nunca tirar o usuário de uma pausa nem competir com buffering/anúncio; a aceleração é desligada (e a velocidade restaurada) ao pausar e volta em ≤1 s ao dar play. |
| Indicador de delay **dentro do `#movie_player`** (não overlay da página) | Pedido do usuário para ver buffer e tempo atrás; dentro do player ele aparece também em **tela cheia** (onde o overlay do botão "Next video" não aparece). Dados via `{type:'live-status'}`; CSS no arquivo compartilhado e DOM no `content.ts`. |
| i18n com **`chrome.i18n` nativo** (sem `@wxt-dev/i18n`) | Zero dependências novas e fallback automático: o Chrome resolve o idioma do navegador e usa `default_locale: "en"` no que faltar. O WXT já gera a **união tipada** das chaves a partir de `public/_locales/en/messages.json`, então não se perde a segurança de tipos. |
| Textos como **chave** em constantes (`labelKey`/`hintKey` em `LIVE_DELAY_OPTIONS`/`QUALITY_LEVELS`) | O texto vive só nos messages.json; frase duplicada em constante + locale sairia de sincronia. Chave inexistente quebra o `npm run compile` (união `MessageKey`). |
| Nomes de idiomas de legenda via **`Intl.DisplayNames`** e datas via **`Intl.RelativeTimeFormat`** | 30 idiomas × 5 locales seriam centenas de strings para manter; o `Intl` resolve de graça e em **qualquer** idioma de navegador (não só nos 5). Os nomes em inglês de `CAPTION_LANGUAGES` viraram fallback. |
| Frases da UI como **frase inteira com placeholders** (`$delay$`, `$buffer$`, `$count$`), não concatenação de pedaços | Ordem das palavras varia por idioma (russo: `отставание $delay$ с (буфер $buffer$ с)`). Plural: onde o inglês usava "(s)/x vezes", cada idioma usou construção neutra ("no total", "всего", "insgesamt"). |
| Texto do badge montado no `content.ts` com `t()` a partir do payload | Os números continuam vindo do main world; ele não tem `chrome.*` nem textos de UI (seção 5.8). |

---

## 7. Limitações e armadilhas conhecidas

- `setPlaybackQualityRange`/`setOption`/`getOption` são **APIs internas do
  YouTube** — podem mudar sem aviso. Por isso todo acesso é defensivo
  (try/catch + retry com deadline) e não deve ser "otimizado".
- A qualidade forçada vale por sessão do player; o YouTube pode rebaixar
  temporariamente durante anúncios/buffering — o re-apply cobre a maioria.
- Legenda ASR só existe se o YouTube tiver gerado para aquele vídeo; sem faixa
  alguma, nenhuma legenda é forçada.
- Lives: a extensão reduz o delay **do player** (mantém a reprodução na borda
  ao vivo dentro do buffer escolhido), não a latência de transmissão
  (ingest/processamento do YouTube — no modo "normal latency" o delay real do
  stream continua). Lives sem janela DVR não têm o que reposicionar (o recurso
  não age).
- O catch-up de lives usa APIs internas (`getProgressState()`,
  `getPlayerState()`, `setPlaybackRate()`): se o YouTube mudar, o recurso para
  de agir em silêncio (nada quebra). A aceleração leva tempo para convergir
  (fecha 0,5 s por segundo; ~2×D s para um atraso D além do alvo) — foi escolha
  do usuário em vez do "pulo" por seek. Com o recurso ligado, pausar/voltar no
  DVR é recuperado quando a reprodução retoma — é o comportamento pretendido
  ("sempre perto do ao vivo"); para assistir atrás, desligue o toggle.
- Em aba oculta o Chrome throttla os timers: as verificações do delay de live
  ficam mais espaçadas (a aceleração já ligada continua valendo), voltando ao
  ritmo normal quando a aba fica visível.
- O idioma da UI é o do **navegador**, fixado quando a extensão carrega: não há
  seletor próprio; trocar exige mudar o idioma do Chrome (ou do sistema) e
  reabrir popup/options/abas do YouTube. A lista é fechada (pt-BR, en, es, ru,
  de); qualquer outra cai em inglês, inclusive pt-PT (que pode receber pt-BR ou
  inglês — decisão do Chrome).
- Chave i18n faltando numa locale: `t()` devolve a **própria chave** (aparece
  crua na UI, nada quebra). O compile garante que as chaves usadas existem no
  `en`; mantendo os cinco arquivos completos, o problema não aparece.
- O histórico é local: limpar dados da extensão (`chrome://extensions` →
  dados) apaga tudo. Export JSON é o escape.
- Lives (`duration = Infinity`) salvam progresso mas `percent` fica 0.
- Detecção de "já assistido" é por percentual (90%): vídeos parcialmente
  assistidos (< 90%) **não** mostram o botão, mesmo com `playCount > 1`.
- O avanço depende de nomes internos do YouTube (`.ytp-next-button`, classe
  `ytp-live`) e da API interna `player.nextVideo()`: se o YouTube mudar algo, o
  clique pode não avançar (falha silenciosa, nada quebra). O botão continua
  aparecendo para vídeos já assistidos.
- O botão pode aparecer quando não existe próximo vídeo de verdade (ex.: último
  item de uma playlist sem autoplay) — o clique então não faz nada. É o preço da
  visibilidade permissiva da v0.5.0, escolhida para nunca esconder o botão
  indevidamente (o falso negativo da v0.4.x foi um bug relatado).
- Shorts e lives nunca mostram o botão (Shorts têm navegação própria por swipe).
- Em **tela cheia** o botão não aparece: ele é um overlay da página e o
  fullscreen só renderiza a subárvore do elemento em tela cheia. O auto-skip
  continua funcionando (o avanço não depende do botão).
- O limiar de 90% (`ALREADY_WATCHED_PERCENT`) e o atraso de 1,5s
  (`AUTO_SKIP_DELAY_MS`) são constantes de código, não configuráveis pela UI.
- Com "Skip automatically" ligado, a guarda `advanceHandledFor` vale por sessão
  de aba: voltar **na mesma aba** para um vídeo que já foi auto-pulado não pula
  de novo, mas abrir o mesmo vídeo numa **nova aba/carregamento completo** pula
  na hora (é o efeito do opt-in). Para reassistir com controle, desligue a
  sub-opção e use o botão.
- Histórico e decisão de pular usam o `watchedVideos` local: vídeo assistido em
  outro navegador/dispositivo não conta (não há sync).
- Título/canal podem vir vazios em Shorts; o registro ainda é salvo com o id.
- **`.output/` é gerado** — nunca editar ali nem commitar; para testar uma
  mudança é preciso rodar `npm run build` de novo e recarregar a extensão.
- **"Extension context invalidated"** — erro esperado quando a extensão é
  recarregada/atualizada com abas do YouTube abertas: o content script antigo
  continua na página, mas todo `chrome.*` dele morre. Tratamento (v0.4.1): o
  `tick` é limpo automaticamente pelo `ctx` do WXT e `persistSession()` agora
  checa `isExtensionAlive()` (`ctx.isValid`, que também dispara a limpeza do
  WXT) antes de gravar — sem erro repetido a cada 10s; um `logger.info` único
  avisa para recarregar a aba. **Recarregar a aba do YouTube é obrigatório** para
  o script novo assumir (o antigo não se autocura).
- A extensão **não faz nenhuma requisição de rede própria** (não chama `youtubei`/APIs do Google): a tela "Conecte-se à Internet" do YouTube com bloqueador de anúncios ligado é filtro de terceiros bloqueando a sonda de conectividade `https://www.youtube.com/generate_204` e/ou `https://www.youtube.com/youtubei/v1/browse` — diagnóstico e correção na seção 8. Não é bug da extensão, e um content script não consegue (nem deve) desbloquear requisição bloqueada por outro filtro.
- Content scripts são bundlados como IIFE pelo WXT. Não é possível declarar
  `type: "module"` em content script no manifest (limitação do MV3).
- Type-check: `npm run compile`. O build **não** faz type-check completo do
  projeto — rode os dois antes de considerar algo pronto.
- `noUncheckedIndexedAccess` está ligado: acessos `array[i]` retornam
  `T | undefined`. Use `??`/guards em vez de casts.

---

## 8. Como carregar, testar e depurar

Instalação (primeira vez):

```powershell
npm.cmd install          # instala deps e roda `wxt prepare`
npm.cmd run build        # gera .output/chrome-mv3
```

Carregar no Chrome:

1. `chrome://extensions` → ligar **Modo do desenvolvedor** → **Carregar sem
   compactação** → selecionar **`.output/chrome-mv3`** (não a raiz do repo!).
2. Alterou código? `npm.cmd run build` e clicar em **recarregar** na página de
   extensões (content scripts só recarregam reabrindo abas do YouTube).

Modo desenvolvimento (HMR no popup/options e recarga de content scripts):

```powershell
npm.cmd run dev          # abre o Chrome com a extensão já carregada (.output/chrome-mv3-dev)
```

Outros comandos: `npm.cmd run compile` (type-check), `npm.cmd run zip`
(pacote para publicação em `.output/`).

Checklist manual de QA (rodar antes de considerar uma mudança concluída):

- [ ] `npm run compile` e `npm run build` sem erros.
- [ ] Popup abre, toggles refletem o que está salvo e persistem após fechar/abrir.
- [ ] Página de opções abre pelo popup (pt-BR: `Configurações & assistidos`; en:
      `Settings & watched list`).
- [ ] Abrir um vídeo, assistir ~10s: registro aparece na lista com título, canal,
      progresso e data; `playCount` = 1.
- [ ] Navegar para outro vídeo sem reload: novo registro; `playCount` do anterior
      continua 1.
- [ ] Ativar resolução 720p e abrir um vídeo 1080p+: o menu de qualidade do
      YouTube mostra 720p. Testar também um vídeo que não tem 720p (deve cair
      para a melhor abaixo).
- [ ] Ativar legendas (ex.: Português) em vídeo com ASR em PT: legenda aparece
      ligada. Testar vídeo sem faixa PT (deve traduzir, se houver tradução).
- [ ] Ligar **Reduce live delay** com buffer de 5 s numa live: o badge no canto
      superior direito **do player** mostra o delay atualizando ~1×/s (en:
      `X.Xs behind (buffer 5s)`; pt-BR: `X.Xs atrás (buffer 5s)`); pausar
      ~1 min e voltar: a reprodução acelera (badge `· 1.5x`), converge para o
      buffer e a velocidade volta a 1x (Debug mostra `live delay: catching up`
      e `catch-up finished`).
- [ ] Entrar em **tela cheia** com o badge visível (deve continuar aparecendo);
      trocar de vídeo/sair da live: o badge some em ≤5 s.
- [ ] Buffer **Real time**: fica colado na borda (pode pausar/travar em conexão
      instável — é o esperado). Com o toggle desligado e em VODs: nada acontece
      (sem aceleração, sem badge, sem linha de ação no debug).
- [ ] **Idiomas**: com o Chrome em pt-BR (depois es, ru e de), popup, opções,
      botão, tooltip, badge e aviso de atualização aparecem no idioma do
      navegador, e `chrome://extensions` mostra a descrição traduzida. Com um
      idioma não suportado (ex.: fr), tudo cai em inglês. Na lista de vídeos, a
      data relativa e os nomes de idiomas de legenda acompanham o navegador.
- [ ] Desligar tudo nos toggles e confirmar que nada mais é aplicado/gravado.
- [ ] Vídeo já assistido: assistir um vídeo até o fim (≥ 90%), abrir outro e
      voltar. O botão **Next video** (pt-BR: **Próximo vídeo**) aparece no canto
      inferior esquerdo **da página** (overlay fixo por cima do conteúdo — rolar
      a página não o move; tooltip com a %). Clicar avança sem pausar o vídeo
      atual.
- [ ] Clicar no botão estando numa **playlist** avança para o próximo item da
      playlist; fora de playlist, segue o autoplay (mesmo destino do botão
      "próximo" nativo). Testar também um vídeo em que o botão nativo não exista
      no DOM (o fallback `player.nextVideo()` deve avançar).
- [ ] Vídeo assistido < 90%: botão não aparece. Live e Shorts: botão não
      aparece. Último item de playlist sem próximo: o botão **pode** aparecer e o
      clique não faz nada (comportamento permissivo esperado na v0.5.0).
- [ ] Desligar **Next video button**: botão não aparece em vídeo já assistido e a
      sub-opção **Skip automatically** fica desabilitada (cinza) na UI.
- [ ] Ligar **Skip automatically**: ao abrir um vídeo já assistido, o botão
      aparece e ~1,5s depois avança sozinho; em playlist com vários já assistidos
      pula em sequência; voltar na mesma aba para um já pulado **não** pula de
      novo.
- [ ] Com "Skip automatically" ligado, desligar o toggle no meio do atraso de
      1,5s cancela o pulo (página continua no vídeo).
- [ ] Debug ligado: para cada vídeo aparece **uma** linha `skip button state`
      com `available`/`reason` (ex.: `not watched before (>= 90%)`, `live
      stream`, `already watched`).
- [ ] Recarregar a extensão com uma aba do YouTube aberta: aparece o aviso
      vermelho de atualização no rodapé (pt-BR: `O YT Essentials foi
      atualizado...`; en: `YT Essentials was updated...`; some em 15s) e o
      console mostra o `logger.info` (seção 7); depois de recarregar a aba,
      tudo volta a funcionar.
- [ ] Debug ligado → console do YouTube mostra logs `[YT Essentials]` e
      `[YT Essentials:main]`.

Depurar storage (o projeto não tem service worker): abrir o DevTools da **página
de opções** e rodar `chrome.storage.local.get(console.log)`, ou inspecionar em
`chrome://extensions` → YT Essentials → *Inspect views*.

Ao recarregar a extensão (`chrome://extensions` → recarregar) com abas do YouTube
abertas, o console dessas abas pode mostrar
`[YT Essentials] extension was reloaded or updated: reload this YouTube tab...` —
é o aviso esperado (seção 7). **Recarregue a aba** para o content script novo
assumir; sem isso ela fica sem gravar/sem reagir às configurações.

### Diagnóstico: "Conecte-se à Internet" no YouTube com a internet funcionando

Sintoma: o YouTube mostra a tela de offline ("Você está offline. Verifique sua
conexão.") mas a navegação normal do Chrome funciona. Não é a YT Essentials (ela
não faz requisição de rede): quase sempre é **bloqueador de anúncios/DNS**
barrando um dos endpoints internos que o YouTube usa para se orientar — nos logs
reais os suspeitos foram a **sonda de conectividade
`https://www.youtube.com/generate_204`** e a chamada do feed
`https://www.youtube.com/youtubei/v1/browse` (feed inicial,
`browseId: FEwhat_to_watch`). Quando qualquer uma dessas falha, o SPA do YouTube
cai na tela de offline.

Como confirmar e corrigir:

1. DevTools → **Network** → reproduza → filtre por `youtubei`: a requisição
   aparece com `(blocked:other)` / `net::ERR_BLOCKED_BY_CLIENT` quando é filtro
   local (DNS bloqueado aparece como falha de resolução/timeout).
2. Descobrir a regra: no uBlock Origin, Dashboard → **Logger** (ligue antes de
   reproduzir); no AdGuard, **Filtering log**. A entrada bloqueada mostra qual
   lista/regra agiu. Filtros populares de "remover feed/Shorts do YouTube"
   bloqueiam exatamente `youtubei/v1/browse`.
3. Exceção: no uBlock Origin (Dashboard → **My filters**) usar algo como
   `@@||www.youtube.com/youtubei/v1/browse$xmlhttprequest`; ou simplesmente
   desligar o bloqueador no site (botão de power na toolbar). No AdGuard, regra
   equivalente com `$xmlhttprequest`. Depois, `Ctrl+F5`.
4. Alternativas: remover a lista/custom filter culpada, atualizar listas e o
   bloqueador, manter **só um** bloqueador ativo e checar bloqueios em nível de
   DNS (NextDNS/Pi-hole/AdGuard DNS) para `youtubei`.
5. Sem mudar nada, **F5 na página costuma restaurar**: o carregamento inicial usa
   o HTML renderizado pelo servidor e não depende da chamada bloqueada.

**Exemplo real de console (18/10/2026, adblock ligado):** `ERR_BLOCKED_BY_CLIENT`
em `/generate_204`, `google(.com).br/pagead/lvz`, `youtubei/v1/log_event`,
`api/stats/qoe` e `/ptracking`. Os quatro últimos (anúncio/telemetria/estatística)
podem ficar bloqueados sem quebrar nada; **`/generate_204` não pode** — é a sonda
"estou online?" que o YouTube consulta antes de desistir. No mesmo console
apareceram `403` em `youtubei/v1/search|browse|get_watch`, mas **não eram do
bloqueador**: vinham da extensão **YoutubeAntiTranslate** (marcas
`[YoutubeAntiTranslate]` no console), que chama a API interna por conta própria e
é rejeitada (403) pelo servidor — ruído de terceiro, sem relação com a tela de
offline. Não confundir: `403` = servidor respondeu; `ERR_BLOCKED_BY_CLIENT` =
algo local barrou.

Exceções mínimas (uBlock Origin → My filters; no AdGuard a sintaxe é a mesma):

```text
@@||www.youtube.com/generate_204
@@||i.ytimg.com/generate_204
@@||www.youtube.com/youtubei/v1/browse$xmlhttprequest
```

A terceira só se `youtubei/v1/browse` do próprio YouTube aparecer como
`ERR_BLOCKED_BY_CLIENT` no Network. **Não** criar exceção para
`log_event`/`qoe`/`ptracking`/`pagead`: bloquear esses é o comportamento desejado
do bloqueador.

---

## 9. Convenções de código

- Comentários, logs e identificadores de código em **inglês**; este documento e
  o README em **PT-BR**. Textos da UI **nunca hardcoded**: vivem em
  `public/_locales/*/messages.json` (seção 5.8).
- TypeScript strict. Imports de tipos **sempre** com `import type`/`type` inline
  (`verbatimModuleSyntax` está ligado e o build quebra sem isso).
- Imports entre pastas usam o alias `@/` (ex.: `@/shared/storage`); dentro da
  mesma pasta, caminho relativo.
- Sem auto-imports (`imports: false`): `defineContentScript` vem de
  `wxt/utils/define-content-script`.
- Todo código compartilhado fica em `src/shared/` (agnóstico) ou
  `src/components/` + `src/hooks/` (React). **Nunca** coloque utilitários dentro
  de `src/entrypoints/`.
- **Nunca** use `chrome.*` dentro de `main-world.content.ts`, e nunca exponha
  nada em `window` nesse arquivo.
- Novas opções: adicione o default em `DEFAULT_SETTINGS` + o tipo em
  `Settings` (`constants.ts`/`types.ts`), o controle em `FeaturesSettings.tsx`
  (que é compartilhado entre popup e options) e trate no destino (`content.ts`
  e/ou `main-world.content.ts`).
- Logs: via `logger` (`src/shared/logger.ts`) no isolated/popup/options e com
  prefixo `[YT Essentials:main]` no main world (gated por `settings.debug`).
- UI construída com React; nunca `innerHTML` com dados vindos do YouTube.
- **Exceção:** UI pequena dos content scripts é DOM puro (ex.: botão
  "Next video" e aviso de contexto inválido). Nesse caso: ids com prefixo
  `yte-`, estilo em CSS dentro de `src/shared/` importado pelo content script (o
  WXT adiciona o arquivo ao array `css` do content script no manifest) e
  `textContent` (nunca `innerHTML`). Overlays vão no `document.body` com
  `position: fixed` e `z-index` alto; elementos informativos usam
  `pointer-events: none` para nunca roubar cliques da página.
- Texto novo de UI: `t('chave')` (`src/shared/i18n.ts`) + a chave nos **cinco**
  arquivos de locale (o `en` define o tipo; sem ele o compile acusa). Textos
  curtos, `label`/`htmlFor` corretos.

---

## 10. Roadmap (ideias, não compromissos)

1. **Retomar de onde parou** — mostrar/retomar posição salva (o dado
   `watchedSeconds` já existe).
2. **Shorts como recurso de primeira classe** (hoje é best-effort).
3. Regras por canal (ex.: resolução diferente por canal).
4. Estatísticas (tempo total assistido, top canais).
5. ~~i18n da UI~~ — **feito na v0.8.0** (pt-BR, en, es, ru e de via
   `chrome.i18n` nativo; seção 5.8).
6. Sincronizar settings via `chrome.storage.sync` (histórico continua local).
7. Importar JSON de volta (hoje só exporta).
8. Badge no ícone com o número de vídeos registrados hoje.
9. Publicação na Chrome Web Store (`npm run zip` já gera o pacote).

---

## 11. Regras para agentes de IA

1. **Leia este arquivo inteiro antes de mexer no código.**
2. Respeite o escopo: nada fora da seção 1 sem o usuário pedir.
3. Não adicione dependências novas, state managers ou UI kits.
4. Se mudar o formato dos dados salvos, incremente `SCHEMA_VERSION`, ajuste os
   tipos e escreva a migração.
5. Rode `npm run compile` **e** `npm run build` antes de declarar concluído, e
   diga exatamente o que não pôde validar (ex.: QA manual no YouTube).
6. Suba a `version` do `package.json` em mudanças visíveis ao usuário (o
   manifest usa essa versão).
7. **Atualize a seção 13** ao final de qualquer mudança relevante, e ajuste as
   demais seções se a arquitetura mudou.
8. Em dúvida sobre produto (o que e como), pergunte ao usuário em vez de
   inventar comportamento.

---

## 12. Estado atual

- Versão: **0.8.0** (`package.json`), sem publicação na Chrome Web Store.
- v0.2.0 (WXT + Vite + React + TypeScript) concluída e verificada; v0.3.0
  adicionou o botão "Next video"; v0.4.0 o tornou configurável com o
  "pular sozinho"; v0.4.1 tratou o "Extension context invalidated"; v0.5.0
  transformou o botão em overlay da página, removeu a checagem de
  disponibilidade que causava falso negativo (relatado com vídeo 99% assistido),
  adicionou fallback `player.nextVideo()` e um aviso visível de contexto
  inválido; v0.6.0 adicionou a **redução do delay de lives** com buffer
  configurável; v0.7.0 trocou o catch-up por **aceleração do próprio player**
  (1.5x) e adicionou o **indicador de delay dentro do player** (seção 5.7);
  v0.8.0 traduziu a interface (pt-BR, inglês, espanhol, russo e alemão) com
  `chrome.i18n` nativo, seguindo o idioma do navegador com fallback para inglês
  (seção 5.8).
- **Verificado em v0.8.0:** `npm run compile` limpo (chaves i18n tipadas pelo
  WXT a partir do `en`); `npm run build` OK (`_locales/` com os 5 idiomas no
  output, manifest com `default_locale: "en"`/`__MSG_extDescription__` na versão
  0.8.0; `content.js` com `t()`; `main-world.js` sem `chrome.*`/i18n); os 5
  `messages.json` checados por script (56 chaves idênticas, placeholders
  declarados).
- **Pendente: validação manual no YouTube** (checklist da seção 8 nunca foi
  executado em navegador real — inclui botão, auto-skip, fallback, logs de
  estado, aviso de contexto inválido, o delay de lives com o badge e agora as
  traduções nos 5 idiomas).
- A v0.1.0 (vanilla JS, sem build) foi substituída pela v0.2.0; o histórico
  está no registro abaixo.

---

## 13. Registro de mudanças

| Data | Versão | Mudança |
| --- | --- | --- |
| 2026-10-18 | 0.8.0 | **i18n da interface** (pt-BR, inglês, espanhol, russo e alemão) com `chrome.i18n` nativo, sem dependências novas: `public/_locales/<locale>/messages.json` (56 chaves cada; o `en` define a união tipada gerada pelo WXT em `.wxt/types/i18n.d.ts`), manifest com `default_locale: "en"` + `description: "__MSG_extDescription__"` (fallback automático para inglês no que não existir). Novo `src/shared/i18n.ts` (`t()`, `getUiLocale()`, `languageDisplayName()` via `Intl.DisplayNames`); todos os textos de popup/options/content traduzidos (`content.ts`: botão, tooltip, aviso de contexto e badge por mensagens com placeholders `$delay$`/`$buffer$`/`$percent$`); `LIVE_DELAY_OPTIONS`/`QUALITY_LEVELS` passaram a carregar `labelKey`/`hintKey` (tipos `LiveDelayOption`/`QualityLevelOption` atualizados); datas relativas com `Intl.RelativeTimeFormat` (fim do `'en'` fixo e do "just now" hardcoded); `<html lang>` e título da página de opções dinâmicos. Verificado: compile limpo, build OK (5 locales no output, manifest 0.8.0), consistência dos 5 arquivos checada por script (56 chaves, placeholders). QA manual pendente. |
| 2026-10-18 | 0.7.0 | Delay de lives v2: catch-up por **aceleração do próprio player** (`setPlaybackRate(1.5)`, fallback `video.playbackRate`) em vez de seek, mantendo até `buffer + 0,5 s` e restaurando a velocidade anterior (e respeitando mudança manual do usuário); loop passou a 1 s. Novo **badge `#yte-live-status` dentro do `#movie_player`** (canto superior direito, visível também em tela cheia) com `X.Xs behind (buffer Ns) · 1.5x`, alimentado pela mensagem `{type:'live-status'}` publicada pelo main world (novo `LiveStatusMessage` em `messages.ts`); some após 5 s sem dados ou com o recurso desligado. `seekTo` removido do tipo do player; CSS do badge em `skip-button.css`; `content.ts` agora recebe mensagens do main world e desenha o badge. Verificado: type-check limpo, build OK, manifest 0.7.0. QA manual pendente. |
| 2026-10-18 | 0.6.0 | Nova função **reduzir o delay de lives** (`settings.liveDelay`, default desligado, buffer default `2s`). No main world, `checkLiveDelay()` roda a cada 2 s e, em live reproduzindo, mede `seekableEnd − current` via `getProgressState()`; quando o delay passa de `buffer + 1,5 s`, chama `player.seekTo(seekableEnd − buffer)` (catch-up por seek, sem mudar a velocidade; pausado/buffering/anúncio nunca é tocado). Buffers: tempo real (0 s), 2 s, 5 s e 10 s, cada um com informativo de conexão no popup/options (`LIVE_DELAY_OPTIONS`). Campo aditivo (sem bump de `SCHEMA_VERSION`), `PlayerSettings`/`main-world` atualizados, card novo em `FeaturesSettings.tsx`, `package.json`/descrição/README/docs atualizados. Verificado: type-check limpo, build OK, manifest 0.6.0. QA manual pendente. |
| 2026-10-18 | 0.5.0 | (docs, sem mudança de código) Refino da nota de diagnóstico da seção 8 com a análise de um console real com adblock: `ERR_BLOCKED_BY_CLIENT` na sonda de conectividade `/generate_204` (suspeito principal da tela de offline), telemetria bloqueada sem impacto (`log_event`, `api/stats/qoe`, `/ptracking`, `pagead/lvz`) e `403` de `youtubei/v1/search|browse|get_watch` que vinham da extensão YoutubeAntiTranslate — não do bloqueador. Exceções mínimas sugeridas (`@@||www.youtube.com/generate_204`, `@@||i.ytimg.com/generate_204` e, se aplicável, `@@||www.youtube.com/youtubei/v1/browse$xmlhttprequest`). |
| 2026-10-18 | 0.5.0 | (docs, sem mudança de código) Nota de diagnóstico nas seções 7/8 para a tela "Conecte-se à Internet" do YouTube com adblock: é filtro de terceiros bloqueando `www.youtube.com/youtubei/v1/browse`, não a extensão (que não faz requisições de rede). Inclui como confirmar no DevTools, achar a regra no log do bloqueador e criar a exceção. |
| 2026-10-18 | 0.5.0 | Correção do falso negativo relatado ("vídeo 99% assistido e o botão não aparece") e mudança de posição pedida pelo usuário. Botão virou **overlay da página** (`position: fixed`, `left/bottom: 12px`, `z-index: 2147483647`, anexado ao `document.body`) em vez de elemento absoluto dentro de `#movie_player`. Visibilidade ficou **permissiva** (`skipState()` não exige mais achar `.ytp-next-button`); Shorts continuam sem botão (motivo `shorts page`); avanço com **fallback**: clique no botão nativo e, se ausente, mensagem `advance` → main world chama `player.nextVideo()` (novo `AdvanceMessage` em messages.ts, `nextVideo?` no tipo do player, tratamento no main-world). Diagnóstico: `logSkipState()` (uma linha debug por mudança, com motivo) e aviso visível `#yte-stale-notice` (15s, `pointer-events: none`) quando o contexto da extensão morre. Verificado: type-check limpo, build OK, manifest 0.5.0, CSS com overlay fixo, main-world com `nextVideo`. QA manual pendente. |
| 2026-10-18 | 0.4.1 | Correção do erro `could not save watched video: Extension context invalidated` (aparecia a cada ~10s no console de abas abertas após recarregar/atualizar a extensão). `persistSession()` agora checa `isExtensionAlive()` (`ctx.isValid`, que também dispara a limpeza do WXT) antes de tocar no storage, e o `catch` do upsert ignora falhas quando o contexto já morreu; um `logger.info` único orienta a recarregar a aba. Sem mudança de dados. Verificado: type-check limpo, build OK, manifest 0.4.1. QA manual pendente. |
| 2026-10-18 | 0.4.0 | Toggle **Next video button** (`skip.enabled`, default `true`) e sub-opção **Skip automatically** (`skip.autoSkip`, default `false`, desabilitada na UI quando o toggle principal está off). Auto-skip agenda `ctx.setTimeout` de 1,5s (`AUTO_SKIP_DELAY_MS`) quando o botão ficaria disponível, re-checando setting/sessão/disponibilidade ao disparar; guarda `advanceHandledFor` evita disparo repetido para o mesmo vídeo (inclusive revisitas) sem impedir pulos em cadeia em playlists. Novos campos em `Settings`/`DEFAULT_SETTINGS` (aditivo, sem bump de `SCHEMA_VERSION`: `deepMerge` preenche o default), card novo em `FeaturesSettings.tsx`, `Toggle` ganhou `className`, tema ganhou `.switch.sub` + estilo de toggle desabilitado. Verificado: type-check limpo, build OK, manifest 0.4.0. QA manual pendente. |
| 2026-10-18 | 0.3.0 | Botão "Next video" para vídeos já assistidos: aparece no canto inferior esquerdo do player quando o registro anterior tem `percent >= 90` (`ALREADY_WATCHED_PERCENT`), nunca em lives, e só quando o botão nativo `.ytp-next-button` existe/habilitado (clique nele = avanço nativo em playlists/autoplay). Novos: `src/shared/skip-button.css` (CSS do botão, importado por `content.ts`), lógica em `content.ts` (botão DOM puro + detecção de live/`previousPercent`), cache do mapa `watchedVideos` no content script via `storage.onChanged`. Sem mudança no formato de dados/schema. Verificado: type-check limpo, build OK, CSS presente no manifest só do content script isolado. QA manual pendente. |
| 2026-10-18 | 0.2.0 | Migração para WXT 0.21 + Vite 8 + React 19 + TypeScript 7. Novo layout (`src/entrypoints`, `src/shared`, `src/components`, `src/hooks`), manifest gerado pelo WXT a partir do `wxt.config.ts`, ícones movidos para `public/icons`, build em `.output/chrome-mv3`. Verificado: type-check limpo, build de produção e de desenvolvimento OK, main-world sem referências a `chrome.*`. QA manual pendente. |
| 2026-10-18 | 0.1.0 | Implementação inicial completa em vanilla JS sem build: manifest MV3, content scripts (main-world + isolated), popup, options com histórico, ícones e este documento. Código com sintaxe validada; QA manual no YouTube nunca executado. |
