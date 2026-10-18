# IA_GUIDELINES.md — YT Essentials

> **Fonte única de verdade do contexto deste projeto.**
> Todo agente de IA (ou pessoa) deve **ler este arquivo inteiro antes de alterar
> qualquer coisa** e **atualizar a seção 13 (Registro de mudanças)** ao terminar.
> Se uma decisão relevante for tomada que não esteja aqui, escreva aqui — do
> contrário, o próximo agente vai perder o contexto.

Última atualização: 2026-10-18 — v0.5.0 (botão "Next video" virou overlay da
página, avanço com fallback pela API do player e aviso visível de contexto
inválido; compilação e build verificados, QA manual no YouTube pendente).

---

## 1. Visão geral

**YT Essentials** é uma extensão do Google Chrome (Manifest V3) que lê o que
acontece no YouTube e melhora a experiência do usuário. Repositório:
`yt-essentials`.

Escopo da v0.5.0 (exatamente estas quatro funcionalidades, nada mais):

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
4. **Pular vídeos já assistidos** — ao abrir um vídeo cujo registro anterior
   tenha `percent >= ALREADY_WATCHED_PERCENT` (90), aparece um botão flutuante
   "Next video" no canto inferior esquerdo **da página** (overlay fixo, por cima
   de todo o conteúdo). O clique usa o botão "próximo" nativo do YouTube
   (playlists e autoplay, como um clique do usuário) e, quando ele não existe no
   DOM, a API do player (`nextVideo()`) via main world. **Nunca aparece em
   lives.** Configurável no popup/options: toggle **Next video button** (ligado
   por padrão) e sub-opção **Skip automatically** (desligada por padrão) que
   avança sozinho. Detalhes na seção 5.6.

**Fora de escopo por enquanto** (não implemente sem pedido explícito do usuário):
retomar vídeo de onde parou, sincronização entre dispositivos, bloqueio de
anúncios, download de vídeos, i18n da interface (interface hoje é só em inglês),
service worker/background, testes automatizados.

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
| UI / comentários de código | **Inglês** |
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
tools/make-icons.ps1        # regera os ícones (PowerShell + System.Drawing)
src/
  entrypoints/              # ← única pasta escaneada pelo WXT como entrypoints
    content.ts              # content script ISOLATED (storage + navegação + gravação + botão de pular)
    main-world.content.ts   # content script MAIN world (API do player)
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

- O controle de resolução e legendas do YouTube usa métodos internos do elemento
  `#movie_player` (`getAvailableQualityLevels()`, `setPlaybackQualityRange()`,
  `setOption()`, `loadModule()`).
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
│  • postMessage({type:'settings'})  ──────────┐                         │
│  • responde {type:'request-settings'}  ◄──┐  │                         │
│  • postMessage({type:'advance'})   ──────────┼──────────┐              │
└───────────────────────────────────────────┼──┼──────────┼──────────────┘
                                            │  │          │ window.postMessage
┌───────────────────────────────────────────┼──┼──────────┼── MAIN world ┐
│ src/entrypoints/main-world.content.ts     ▼  │          ▼              │
│  • guarda o snapshot de settings          ◄──┘                         │
│  • aplica resolução e legendas no #movie_player                        │
│  • atende {type:'advance'} → player.nextVideo()                        │
└────────────────────────────────────────────────────────────────────────┘
```

Handshake: os dois scripts rodam em `document_start`. `main-world` pede os
settings (`request-settings`) e `content.ts` também empurra os settings assim
que o `storage.getSettings()` resolve — a mensagem perdida no handshake é
coberta pelo push, então não há corrida real.

### 5.2 Fluxo: configurações

UI React (popup/options) → `useSettings().update(patch)` →
`storage.updateSettings(patch)` → `chrome.storage.local` →
`chrome.storage.onChanged` dispara no `content.ts` → ele atualiza o snapshot e
empurra para o `main-world`, que re-aplica no player na hora (sem reload da
página). **Não existe service worker** — toda a reatividade é feita por
`storage.onChanged`.

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
- **Tooltip:** `You already watched this video (N%)` com o percentual anterior.

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

---

## 7. Limitações e armadilhas conhecidas

- `setPlaybackQualityRange`/`setOption`/`getOption` são **APIs internas do
  YouTube** — podem mudar sem aviso. Por isso todo acesso é defensivo
  (try/catch + retry com deadline) e não deve ser "otimizado".
- A qualidade forçada vale por sessão do player; o YouTube pode rebaixar
  temporariamente durante anúncios/buffering — o re-apply cobre a maioria.
- Legenda ASR só existe se o YouTube tiver gerado para aquele vídeo; sem faixa
  alguma, nenhuma legenda é forçada.
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
- [ ] Página de opções abre pelo popup (`Settings & watched list`).
- [ ] Abrir um vídeo, assistir ~10s: registro aparece na lista com título, canal,
      progresso e data; `playCount` = 1.
- [ ] Navegar para outro vídeo sem reload: novo registro; `playCount` do anterior
      continua 1.
- [ ] Ativar resolução 720p e abrir um vídeo 1080p+: o menu de qualidade do
      YouTube mostra 720p. Testar também um vídeo que não tem 720p (deve cair
      para a melhor abaixo).
- [ ] Ativar legendas (ex.: Português) em vídeo com ASR em PT: legenda aparece
      ligada. Testar vídeo sem faixa PT (deve traduzir, se houver tradução).
- [ ] Desligar tudo nos toggles e confirmar que nada mais é aplicado/gravado.
- [ ] Vídeo já assistido: assistir um vídeo até o fim (≥ 90%), abrir outro e
      voltar. O botão **Next video** aparece no canto inferior esquerdo **da
      página** (overlay fixo por cima do conteúdo — rolar a página não o move;
      tooltip com a %). Clicar avança sem pausar o vídeo atual.
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
      vermelho `YT Essentials was updated...` no rodapé (some em 15s) e o console
      mostra o `logger.info` (seção 7); depois de recarregar a aba, tudo volta a
      funcionar.
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

- UI e comentários em **inglês**; este documento e o README em **PT-BR**.
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
- Textos da UI em inglês, curtos, e `label`/`htmlFor` corretos.

---

## 10. Roadmap (ideias, não compromissos)

1. **Retomar de onde parou** — mostrar/retomar posição salva (o dado
   `watchedSeconds` já existe).
2. **Shorts como recurso de primeira classe** (hoje é best-effort).
3. Regras por canal (ex.: resolução diferente por canal).
4. Estatísticas (tempo total assistido, top canais).
5. i18n da UI (`@wxt-dev/i18n` ou `chrome.i18n`).
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

- Versão: **0.5.0** (`package.json`), sem publicação na Chrome Web Store.
- v0.2.0 (WXT + Vite + React + TypeScript) concluída e verificada; v0.3.0
  adicionou o botão "Next video"; v0.4.0 o tornou configurável com o
  "pular sozinho"; v0.4.1 tratou o "Extension context invalidated"; v0.5.0
  transformou o botão em overlay da página, removeu a checagem de
  disponibilidade que causava falso negativo (relatado com vídeo 99% assistido),
  adicionou fallback `player.nextVideo()` e um aviso visível de contexto inválido.
- **Verificado em v0.5.0:** `npm run compile` limpo; `npm run build` OK
  (`content-scripts/content.css` com `position: fixed`/`z-index` do overlay,
  presente no manifest apenas do content script isolado; `main-world.js` com
  `nextVideo()` e sem `chrome.*`); manifest na versão 0.5.0.
- **Pendente: validação manual no YouTube** (checklist da seção 8 nunca foi
  executado em navegador real — inclui botão, auto-skip, fallback, logs de
  estado e o aviso de contexto inválido).
- A v0.1.0 (vanilla JS, sem build) foi substituída pela v0.2.0; o histórico
  está no registro abaixo.

---

## 13. Registro de mudanças

| Data | Versão | Mudança |
| --- | --- | --- |
| 2026-10-18 | 0.5.0 | (docs, sem mudança de código) Refino da nota de diagnóstico da seção 8 com a análise de um console real com adblock: `ERR_BLOCKED_BY_CLIENT` na sonda de conectividade `/generate_204` (suspeito principal da tela de offline), telemetria bloqueada sem impacto (`log_event`, `api/stats/qoe`, `/ptracking`, `pagead/lvz`) e `403` de `youtubei/v1/search|browse|get_watch` que vinham da extensão YoutubeAntiTranslate — não do bloqueador. Exceções mínimas sugeridas (`@@||www.youtube.com/generate_204`, `@@||i.ytimg.com/generate_204` e, se aplicável, `@@||www.youtube.com/youtubei/v1/browse$xmlhttprequest`). |
| 2026-10-18 | 0.5.0 | (docs, sem mudança de código) Nota de diagnóstico nas seções 7/8 para a tela "Conecte-se à Internet" do YouTube com adblock: é filtro de terceiros bloqueando `www.youtube.com/youtubei/v1/browse`, não a extensão (que não faz requisições de rede). Inclui como confirmar no DevTools, achar a regra no log do bloqueador e criar a exceção. |
| 2026-10-18 | 0.5.0 | Correção do falso negativo relatado ("vídeo 99% assistido e o botão não aparece") e mudança de posição pedida pelo usuário. Botão virou **overlay da página** (`position: fixed`, `left/bottom: 12px`, `z-index: 2147483647`, anexado ao `document.body`) em vez de elemento absoluto dentro de `#movie_player`. Visibilidade ficou **permissiva** (`skipState()` não exige mais achar `.ytp-next-button`); Shorts continuam sem botão (motivo `shorts page`); avanço com **fallback**: clique no botão nativo e, se ausente, mensagem `advance` → main world chama `player.nextVideo()` (novo `AdvanceMessage` em messages.ts, `nextVideo?` no tipo do player, tratamento no main-world). Diagnóstico: `logSkipState()` (uma linha debug por mudança, com motivo) e aviso visível `#yte-stale-notice` (15s, `pointer-events: none`) quando o contexto da extensão morre. Verificado: type-check limpo, build OK, manifest 0.5.0, CSS com overlay fixo, main-world com `nextVideo`. QA manual pendente. |
| 2026-10-18 | 0.4.1 | Correção do erro `could not save watched video: Extension context invalidated` (aparecia a cada ~10s no console de abas abertas após recarregar/atualizar a extensão). `persistSession()` agora checa `isExtensionAlive()` (`ctx.isValid`, que também dispara a limpeza do WXT) antes de tocar no storage, e o `catch` do upsert ignora falhas quando o contexto já morreu; um `logger.info` único orienta a recarregar a aba. Sem mudança de dados. Verificado: type-check limpo, build OK, manifest 0.4.1. QA manual pendente. |
| 2026-10-18 | 0.4.0 | Toggle **Next video button** (`skip.enabled`, default `true`) e sub-opção **Skip automatically** (`skip.autoSkip`, default `false`, desabilitada na UI quando o toggle principal está off). Auto-skip agenda `ctx.setTimeout` de 1,5s (`AUTO_SKIP_DELAY_MS`) quando o botão ficaria disponível, re-checando setting/sessão/disponibilidade ao disparar; guarda `advanceHandledFor` evita disparo repetido para o mesmo vídeo (inclusive revisitas) sem impedir pulos em cadeia em playlists. Novos campos em `Settings`/`DEFAULT_SETTINGS` (aditivo, sem bump de `SCHEMA_VERSION`: `deepMerge` preenche o default), card novo em `FeaturesSettings.tsx`, `Toggle` ganhou `className`, tema ganhou `.switch.sub` + estilo de toggle desabilitado. Verificado: type-check limpo, build OK, manifest 0.4.0. QA manual pendente. |
| 2026-10-18 | 0.3.0 | Botão "Next video" para vídeos já assistidos: aparece no canto inferior esquerdo do player quando o registro anterior tem `percent >= 90` (`ALREADY_WATCHED_PERCENT`), nunca em lives, e só quando o botão nativo `.ytp-next-button` existe/habilitado (clique nele = avanço nativo em playlists/autoplay). Novos: `src/shared/skip-button.css` (CSS do botão, importado por `content.ts`), lógica em `content.ts` (botão DOM puro + detecção de live/`previousPercent`), cache do mapa `watchedVideos` no content script via `storage.onChanged`. Sem mudança no formato de dados/schema. Verificado: type-check limpo, build OK, CSS presente no manifest só do content script isolado. QA manual pendente. |
| 2026-10-18 | 0.2.0 | Migração para WXT 0.21 + Vite 8 + React 19 + TypeScript 7. Novo layout (`src/entrypoints`, `src/shared`, `src/components`, `src/hooks`), manifest gerado pelo WXT a partir do `wxt.config.ts`, ícones movidos para `public/icons`, build em `.output/chrome-mv3`. Verificado: type-check limpo, build de produção e de desenvolvimento OK, main-world sem referências a `chrome.*`. QA manual pendente. |
| 2026-10-18 | 0.1.0 | Implementação inicial completa em vanilla JS sem build: manifest MV3, content scripts (main-world + isolated), popup, options com histórico, ícones e este documento. Código com sintaxe validada; QA manual no YouTube nunca executado. |
