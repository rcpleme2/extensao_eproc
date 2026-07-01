# eproc - Exportador de Documentos

Extensão para Chrome/Edge que identifica e baixa em lote todos os documentos
de um processo no sistema **eproc** (usado por diversos tribunais brasileiros:
TJPR, TJSC, TJAL, Justiça Federal, etc.).

## O que ela faz

Na página de detalhes de um processo no eproc, cada documento (`INIC1`,
`CALC3`, `OUT2`, `ATOORD1`, `CERT1`, `MANDCITACAO1`, ...) é um link que hoje
precisa ser clicado individualmente para ser visualizado/baixado. Esta
extensão varre a página, identifica todos esses links automaticamente e
baixa cada documento para a pasta de Downloads do navegador, organizado em:

```
Downloads/eproc/<numero_do_processo>/
  0001_INIC1.pdf
  0002_OUT2.jpg
  0003_CALC3.pdf
  0004_ATOORD1.html
  0005_CERT1.html
  0006_MANDCITACAO1.html
  ...
  _indice.json   (lista com sequencial, evento, nome, tipo e URL de cada documento)
```

O número no início do nome do arquivo é um sequencial global de 4 dígitos
(`0001`, `0002`, ...), atribuído em ordem cronológica: o primeiro documento
do primeiro evento do processo (a petição inicial) recebe `0001`, e os
demais seguem na ordem em que os documentos foram juntados ao processo.

## Instalação (modo desenvolvedor)

1. Abra `chrome://extensions` (ou `edge://extensions` no Edge).
2. Ative o "Modo de desenvolvedor" (canto superior direito).
3. Clique em "Carregar sem compactação" e selecione a pasta `extensao_eproc`.
4. O ícone da extensão aparecerá na barra de ferramentas.

## Como usar

1. Faça login no sistema eproc do seu tribunal e abra a página de detalhes
   do processo desejado (a mesma página onde você vê a lista de eventos e
   documentos).
2. Clique no ícone da extensão.
3. Clique em **"Detectar documentos"** — a extensão lista quantos documentos
   encontrou na página e destaca (fundo amarelo claro) cada link de
   documento reconhecido diretamente na página, para conferência visual
   rápida contra os documentos exibidos.
4. Clique em **"Baixar todos"** — os arquivos serão baixados para
   `Downloads/eproc/<numero_do_processo>/`.
5. Acompanhe a barra de progresso no próprio popup.

## Observações

- Os documentos são baixados usando a mesma sessão autenticada do navegador
  (os links já contêm o token de acesso gerado pelo eproc para aquela sessão),
  então é preciso estar logado e com a página do processo aberta.
- O link de cada documento no eproc (`acao=acessar_documento`) retorna uma
  página "casca" em HTML com um `<iframe>` que aponta para a URL que
  realmente serve o arquivo (`acao=acessar_documento_implementacao`). Antes
  de baixar, a extensão busca essa página casca e extrai a URL real do
  iframe — sem esse passo, o arquivo salvo seria a casca HTML, não o
  documento em si.
- Documentos gerados internamente pelo eproc (certidões, atos ordinatórios,
  mandados, etc.) são páginas HTML. Para esses, a URL do iframe ainda
  devolve uma segunda casca (uma página vazia que carrega o conteúdo via
  AJAX no carregamento). A extensão refaz essa chamada AJAX
  (`X-Requested-With: XMLHttpRequest`) para obter o conteúdo real da
  certidão/ato e salva um `.html` autocontido só com esse conteúdo.
- A extensão funciona em qualquer domínio que siga o padrão de URL do eproc
  (`.../eproc/controlador.php`), não é restrita a um tribunal específico.
- Se um download falhar (ex.: link expirado), o erro aparece no popup ao
  final do processo; os demais downloads continuam normalmente.
