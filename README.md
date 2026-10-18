# YT Essentials

Extensão do Chrome (Manifest V3) que adiciona cinco recursos ao YouTube:

- **Salvar vídeos assistidos** — histórico local com título, canal, tempo assistido,
  porcentagem e datas (busca, remoção, limpeza e export JSON na página de opções).
- **Definir resolução automaticamente** — força a resolução escolhida em cada
  vídeo, com fallback inteligente quando a qualidade não existe no vídeo.
- **Ativar legendas automaticamente** — liga a legenda no idioma escolhido,
  priorizando a faixa gerada automaticamente (ASR) e caindo para tradução quando
  necessário.
- **Reduzir o delay de lives** — mantém a transmissão ao vivo o mais perto
  possível da borda *do player*, com um **colchão de segurança escolhido por
  você** (slider de 1 a 10 segundos: menos buffer fica mais perto do ao vivo,
  mas exige uma conexão melhor). A reprodução acelera sozinha (até 1.5x) só o
  suficiente para consumir o buffer que passa do colchão e desce a 0.90x para
  recompor quando falta; se ficar mais de 30 segundos atrás (pausa longa),
  salta direto para a borda ao vivo. Um indicador no player mostra a latência e
  o buffer atual (visível também em tela cheia). Só age em lives, e só enquanto
  o vídeo está rodando.
- **Pular vídeos já assistidos** — ao reabrir um vídeo que você já assistiu
  (≥ 90%), surge um botão **Próximo vídeo** (*Next video* em inglês) no canto
  inferior esquerdo da página (por cima de todo o conteúdo) que avança para o
  próximo vídeo (playlist ou autoplay). Nunca aparece em lives nem em Shorts.
  Pode ser desligado no popup, e com a sub-opção **Pular automaticamente**
  (*Skip automatically*) a extensão pula sozinha.

## Stack

- [WXT](https://wxt.dev) 0.21 (Vite 8) — build e manifest da extensão
- React 19 + TypeScript 7 — popup e página de opções
- `chrome.storage.local` — persistência local (sem servidor, sem conta)

## Requisitos

- Node.js 20+
- Chrome 111+

## Desenvolvimento

```powershell
npm.cmd install          # instala dependências e prepara os tipos do WXT
npm.cmd run build        # build de produção em .output/chrome-mv3
npm.cmd run dev          # abre o Chrome com a extensão e HMR
npm.cmd run compile      # type-check (tsc --noEmit)
npm.cmd run zip          # pacote .zip para publicação
```

> **Windows/PowerShell:** se `npm` falhar com erro de execution policy, use
> `npm.cmd` (como acima) ou ajuste a policy com
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

Para carregar manualmente: `chrome://extensions` → **Modo do desenvolvedor** →
**Carregar sem compactação** → selecione **`.output/chrome-mv3`**.

## Uso

- **Popup** (ícone da extensão): ligar/desligar as funcionalidades configuráveis
  e escolher resolução, idioma das legendas e o buffer das lives (1–10 s).
  Alterações aplicam na hora, sem recarregar a página do YouTube.
- **Página de opções** (botão `Configurações & assistidos` no popup): as mesmas
  configurações, log de depuração e o histórico de vídeos assistidos.
- **Idiomas**: a interface segue o idioma do navegador — português (Brasil),
  inglês, espanhol, russo e alemão. Qualquer outro idioma usa o inglês.

## Estrutura

```
wxt.config.ts          # configuração do WXT (manifest, srcDir, módulo React)
tsconfig.json          # TypeScript (extends do tsconfig gerado pelo WXT)
public/icons/          # Ícones (regerar com tools/make-icons.ps1)
public/_locales/       # Traduções da UI (en, pt_BR, es, ru, de)
src/entrypoints/       # content scripts (isolated + MAIN world), popup e options
src/shared/            # tipos, constantes, storage, helpers do player
src/components/        # componentes React compartilhados
src/hooks/             # hooks React
.output/               # builds gerados (não versionado)
```

## Documentação para desenvolvimento

Todo o contexto do projeto (arquitetura, modelo de dados, decisões, limitações e
regras) está em [`IA_GUIDELINES.md`](IA_GUIDELINES.md). **Leia antes de alterar
qualquer coisa.**

## Avisos

- Todos os dados ficam apenas no seu navegador (`chrome.storage.local`).
- A extensão usa APIs internas do player do YouTube para resolução, legendas e
  o delay das lives; elas podem mudar sem aviso (o código é defensivo, mas pode
  quebrar eventualmente).
- A lógica de redução do delay das lives foi inspirada no projeto
  [ZeroDelay](https://github.com/joaogfc/ZeroDelay) (joaogfc), referência
  validada em transmissões reais (inclusive a regulação do colchão
  personalizado).
