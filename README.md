# Extensão Auxiliar eProc

Extensão para Chrome/Edge com funcionalidades para o sistema **eproc**
(usado por diversos tribunais brasileiros: TJPR, TJSC, TJAL, Justiça Federal,
etc.), organizadas em três cartões separados no painel: **Exportar
Documentos**, **Relatórios** e **Regras de Automação**.

## Exportar Documentos

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
  _indice.json                                       (lista com sequencial, evento, nome, tipo e URL de cada documento)
  <numero_do_processo>_completo.pdf                  (opcional: todos os documentos combinados em um único PDF)
  <numero_do_processo>_completo_anonimizado.md       (opcional: movimentação + texto dos documentos, anonimizado)
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
2. Clique no ícone da extensão — isso abre um **painel lateral (side
   panel)** fixo ao lado da janela do navegador (como o painel da extensão
   do Claude), em vez de um popup que fecha sozinho. Ele permanece aberto
   mesmo trocando de aba ou navegando para outra página, até você fechá-lo
   manualmente (ícone de "X" no topo do painel ou clicando novamente no
   ícone da extensão). Requer Chrome/Edge 114 ou mais recente.
3. Clique em **"Detectar documentos"** — o painel lista quantos documentos
   encontrou na página e destaca (fundo amarelo claro) cada link de
   documento reconhecido diretamente na página, para conferência visual
   rápida contra os documentos exibidos.
4. Escolha **um** dos três modos (são alternativos, só um pode estar
   marcado por vez):
   - **Arquivos individuais** (marcada por padrão): um arquivo por
     documento, como já era feito.
   - **PDF único combinado**: um único PDF com todos os documentos do
     processo, na mesma ordem cronológica (petição inicial primeiro).
   - **MD único (texto e anonimizado)**: um único arquivo Markdown com a
     movimentação processual e o texto de todos os documentos,
     anonimizado automaticamente — ver seção própria abaixo. É o único
     modo disponível quando o processo não tem nenhum documento anexado
     (nesse caso, o arquivo sai só com a movimentação).
5. Clique em **"Baixar"** — gera o modo escolhido em
   `Downloads/eproc/<numero_do_processo>/`.
6. Acompanhe a barra de progresso no próprio painel.

## Nomes de usuário na movimentação

Na tabela de movimentação do processo, o eproc mostra apenas a sigla
funcional de quem praticou o ato (ex.: `S287431`). A extensão troca
automaticamente esse texto pelo nome completo do usuário seguido do cargo em
fonte menor (ex.: `CRISLAINY MARCELO - DIRETOR DE DISTRIBUIÇÃO`), lido do
próprio HTML da página (a informação já existe ali, usada hoje só para o
tooltip que aparece ao passar o mouse). O tooltip com cargo e lotação
continua funcionando normalmente.

## PDF único combinado

Ao escolher o modo "PDF único combinado", a extensão monta um único arquivo
`<numero_do_processo>_completo.pdf` com todos os documentos do processo, na
mesma ordem cronológica usada na numeração sequencial. A montagem usa a
biblioteca [pdf-lib](https://pdf-lib.js.org/) (vendorizada em
`libs/pdf-lib.min.js`), rodando inteiramente dentro da extensão — nenhum
arquivo é enviado para servidores externos.

Cada tipo de documento entra no PDF único de um jeito diferente:
- **PDF**: as páginas do documento original são copiadas para o PDF final,
  sem perda de qualidade.
- **Imagens** (jpg, png, gif, bmp, webp): a imagem é convertida e desenhada
  ocupando uma página inteira, do tamanho da imagem original.
- **HTML** (certidões, atos ordinatórios, mandados): como não dá para
  "imprimir" a página perfeitamente sem permissões extras, a extensão
  extrai o **texto** do documento e desenha como texto corrido em uma ou
  mais páginas de PDF. Tabelas, negrito e o layout original não são
  preservados nessa versão combinada — se a formatação exata importar,
  use o `.html` individual (esse sim fiel ao original).
- **Outros tipos** (raros): quando não é possível incorporar o arquivo,
  uma página de aviso é inserida no lugar, indicando para consultar o
  arquivo individual.

Os três modos (arquivos individuais / PDF único / MD único) são
mutuamente exclusivos por esse motivo, entre outros: a segunda camada dos
documentos "html" (a página com a `div` preenchida via AJAX) parece não
aceitar bem ser acessada duas vezes seguidas para o mesmo documento, o
que causava falhas quando duas opções rodavam juntas na mesma execução.
Se ainda assim algum documento não puder ser incorporado, a página de
aviso no PDF único inclui o motivo exato da falha (ex.: tempo esgotado,
elemento não encontrado), para facilitar o diagnóstico.

## MD único (texto e anonimizado)

Ao escolher o modo "MD único", a extensão monta um único arquivo
`<numero_do_processo>_completo_anonimizado.md` com a **movimentação
processual e os documentos organizados juntos, evento por evento** — cada
evento aparece com sua data/hora e descrição, seguido dos documentos que
foram juntados naquele evento (na mesma numeração sequencial global de
sempre: `#### 0001 — INIC1`, `#### 0002 — OUT2`, ...). Eventos sem nenhum
documento anexado aparecem só com a descrição. Isso é incluído mesmo que
o processo não tenha nenhum documento anexado (nesse caso, o arquivo sai
só com a movimentação). O cabeçalho do arquivo traz só o número do
processo e a data/hora da exportação, sem nenhum outro comentário.

```
# Processo 6000101-75.2026.8.16.0171
02/07/2026 14:32:10

### Evento 1 — 02/07/2026 09:50:47 — Distribuído por sorteio (TOMUN01)

#### 0001 — INIC1

(texto do documento...)

#### 0002 — BOC2

(texto do documento...)

### Evento 2 — 02/07/2026 09:50:47 — Autos incluídos no Juízo 100% Digital

_Nenhum documento anexado a este evento._
```

Documentos cujo evento não pôde ser determinado (ou que não batem com
nenhum evento realmente detectado na movimentação) aparecem por último,
numa seção **"Documentos sem evento identificado"** — nenhum documento é
descartado silenciosamente.

Esse modo roda inteiramente **offline, sem OCR e sem nenhuma chamada de
rede** além do próprio eproc.

### Movimentação processual

A tabela de eventos é identificada pela estrutura confirmada numa página
real do eproc: a tabela `#tblEventos`, com uma linha `<tr
id="trEventoN">` por evento (número, data/hora e descrição em colunas
próprias — a descrição usa a classe `td.infraEventoDescricao`). Um
método alternativo (baseado só em reconhecer o padrão de data/hora)
entra em ação apenas se essa estrutura não for encontrada, para tentar
cobrir variações entre tribunais.

Cada linha de movimentação reconhecida é destacada na própria página com
um fundo **azul claro**, do mesmo jeito que os links de documento já são
destacados em amarelo — útil para conferir visualmente que a extensão
identificou a tabela certa antes de exportar.

Se a lista sair incompleta, fora de ordem ou vazia no seu tribunal, um
`.mhtml` da tela de detalhes do processo (Chrome: Ctrl+S → "Página da Web,
completa") permite ajustar a detecção com precisão.

### Extração de texto dos documentos

- **PDF com camada de texto** (a maioria dos documentos gerados
  digitalmente): o texto é extraído com a biblioteca
  [pdf.js](https://mozilla.github.io/pdf.js/) (vendorizada em
  `libs/pdf.min.js` / `libs/pdf.worker.min.js`). Isso roda numa **aba
  oculta** própria (reaproveitada para todos os PDFs do processo, uma só
  aba para todos eles) aberta no domínio do eproc — não no service worker
  da extensão, já que o pdf.js precisa de um documento HTML mesmo só para
  ler texto (rodar no service worker, que não tem DOM, falhava com
  `Setting up fake worker failed: "document is not defined"`).
- **PDF escaneado ou imagem** (jpg, png, gif, bmp, webp) sem camada de
  texto: **não há OCR nesta versão** (uma tentativa anterior usando
  Tesseract.js não funcionou de forma confiável e foi removida). Esses
  casos entram no arquivo apenas com uma nota indicando que o texto não
  pôde ser extraído — consulte o arquivo individual (modo "Arquivos
  individuais") para ver o conteúdo original.
- **HTML** (certidões, atos ordinatórios, mandados): reaproveita o mesmo
  mecanismo de aba oculta já usado nos outros modos para ler o texto real
  do documento (uma aba própria por documento, separada da aba
  compartilhada dos PDFs). Se a primeira tentativa não conseguir ler o
  conteúdo a tempo, uma segunda tentativa é feita automaticamente, com
  uma aba nova. Se mesmo assim continuar falhando com "div não
  preencheu a tempo", veja a seção de diagnóstico abaixo — o log agora
  diz se a div chegou a existir na página ou não, o que ajuda a
  descobrir se o problema é a página não ser a esperada (redirecionada
  para outro lugar) ou realmente o carregamento via AJAX não terminar.

### Anonimização (melhor esforço)

Antes de salvar, o texto combinado (movimentação + documentos) passa por
uma anonimização automática:

- **CPF, CNPJ, telefone e e-mail**: identificados por padrão (regex) e
  substituídos por `[CPF removido]`, `[CNPJ removido]`, etc.
- **Endereços**: ao encontrar uma palavra típica de endereço ("Rua", "Av",
  "Rodovia", "Bairro", "CEP", ...), só o **trecho do endereço** é
  substituído por `[endereço removido]` — do início reconhecido até um
  CEP, um sufixo "/UF" (ex.: "/PR") ou uma quebra de parágrafo logo em
  seguida, o que vier primeiro. O resto da frase/linha ao redor (nome de
  quem mora lá, contexto, etc.) permanece intacto — diferente de versões
  anteriores, que apagavam a linha inteira (e, em documentos PDF sem
  quebras de linha bem definidas, chegavam a apagar a página toda).
- **Nomes de pessoas (Maiúscula+minúscula)**: sequências de 3 ou mais
  palavras (ex.: "Maria Aparecida Santos") são detectadas e abreviadas
  (ex.: "Maria A. Santos"), preservando primeiro e último nome. Uma
  pequena lista de frases institucionais comuns ("Poder Judiciário",
  "Tribunal de Justiça", ...) é excluída dessa detecção para não
  abreviá-las por engano.
- **Nomes de partes em CAIXA ALTA (pessoa ou empresa)**: reconhecidos
  especificamente quando seguidos de uma qualificação jurídica padrão
  ("..., brasileiro", "..., pessoa jurídica", "..., portador(a)",
  "..., inscrito(a)", "..., residente/domiciliado(a)"), um padrão comum
  logo após nomear uma parte em petições. Ex.: `"ACIT – ASSOCIAÇÃO
  COMERCIAL E INDUSTRIAL DE TOMAZINA, pessoa jurídica..."` vira `"ACIT –
  A. C. e I. de TOMAZINA, pessoa jurídica..."`. Fora dessa posição
  específica, nomes em CAIXA ALTA continuam sem detecção (ver limitação
  abaixo).

**Isso é um processo de melhor esforço baseado em padrões, não uma
garantia de anonimização completa** — não é NLP nem usa uma lista real
das partes do processo. Em particular:
- Nomes em **CAIXA ALTA sem uma qualificação jurídica logo em seguida**
  não são tocados de propósito, já que no eproc CAIXA ALTA sozinha
  normalmente indica rótulos de evento/situação, não nomes de pessoas —
  abreviar todo bloco em caixa alta geraria muitos falsos positivos.
- Endereços sem as palavras-chave reconhecidas, ou em formatos atípicos,
  podem não ser detectados.

**Sempre revise o arquivo `.md` gerado antes de compartilhar
externamente** — o aviso já aparece no próprio painel ao escolher esse
modo (o arquivo em si não traz mais esse aviso no cabeçalho, a pedido:
o cabeçalho do arquivo só tem o número do processo e a data/hora da
exportação).

### Se o "MD único" travar, falhar ou parecer não avançar

1. Abra o console do service worker em `chrome://extensions` (clique em
   **"service worker"** / "Inspect views: service worker" na extensão).
   Os logs prefixados `[eproc-md]` mostram cada etapa: abertura da aba de
   PDF, início/fim de cada documento, downloads, etc.
2. Se o processo tiver algum PDF, uma aba oculta é aberta para
   processá-los (visível na barra de abas do navegador, sem ficar em
   primeiro plano) — clique nela e abra o DevTools (F12) para ver logs
   `[eproc-md]` específicos de dentro dela.
3. Documentos "html" usam sua própria aba oculta separada (mesmo
   mecanismo já usado no modo "Arquivos individuais"/"PDF único"), com
   logs prefixados `[eproc-html]` no console do service worker: URL da
   página depois de carregar, se a div "#divdochtml" chegou a existir, e
   se o preenchimento por AJAX terminou a tempo.
4. Nenhuma etapa demorada fica presa para sempre: download de documento
   tem limite de 30s, e a extração de texto de cada PDF tem limite de
   60s — ao estourar, vira um erro tratado normalmente (nos avisos do
   arquivo final), em vez de travar a exportação inteira.

## Relatório Geral (conclusos para despacho/sentença)

O painel também tem um botão **"Relatórios"** que automatiza uma consulta
que hoje precisa ser feita manualmente, **sem alterar a página que você
está vendo**. Para cada situação (**"MOVIMENTO-AGUARDA DESPACHO"** e
**"MOVIMENTO-AGUARDA SENTENÇA"**), ele levanta três números:

- **Total**: quantos processos estão nessa situação.
- **Urgentes**: quantos desses têm a marcação "Informação complementar" =
  "Petição Urgente - Sim".
- **+30 dias**: quantos desses estão na situação há mais de 30 dias
  (preenchendo o campo "Dias na situação" com `30` antes de consultar).

Além disso, o mesmo botão levanta um demonstrativo de **processos sem
movimentação**, preenchendo numericamente o campo "Dias sem movimentação"
(`#txtDiasSemMovimentacao`) com três faixas: **30, 90 e 120 dias**. Esse
filtro não depende de nenhuma situação selecionada.

Isso dá 9 consultas ao todo (6 de situação + 3 de sem movimentação). Cada
uma delas roda em uma **aba oculta própria** (criada com `active: false`,
sem roubar o foco nem alterar o que você está vendo), que abre a página,
navega até o Relatório Geral, seleciona a situação (quando aplicável) e o
filtro daquela consulta específica, clica em "Consultar", lê o resultado e
fecha a aba — uma aba nova para cada consulta, nunca reaproveitando a
mesma aba para mais de uma.
Isso é proposital: reaproveitar a mesma aba para interagir duas vezes
seguidas com o campo "Informação complementar" (um componente Tagify)
se mostrou instável nos testes — a primeira consulta na aba sempre
funcionava, a segunda às vezes não. Com uma aba nova por consulta, esse
problema desaparece por completo, ao custo de o relatório completo levar
mais tempo (a ordem de alguns segundos por consulta, já que cada uma
recarrega a página do zero).

O campo "Informação complementar" usa o dropdown de sugestões nativo do
Tagify (confirmado inspecionando a página ao vivo: os itens aparecem como
`div.tagify__dropdown__item`, com o valor exato no atributo `value`). A
extensão simula a digitação de "Petição Urgente" no campo, espera a
sugestão "Petição Urgente - Sim" aparecer no dropdown e clica nela — o
mesmo que um clique real faria. Se alguma consulta falhar por qualquer
motivo, as demais continuam normalmente; o painel mostra um aviso listando
especificamente o que não pôde ser determinado, sem travar o resto do
relatório.

Enquanto processa, o painel mostra um indicador de progresso com o passo
atual (qual situação/filtro está sendo consultado no momento), então dá
para acompanhar sem achar que a extensão travou.

Ao lado do botão "Relatórios" há um ícone **↗** que, diferente do botão
principal, navega a **aba atual e visível** direto para a tela do
Relatório Geral (sem consultar nada) — um atalho para quem prefere
conferir manualmente.

Todos os números das duas tabelas — os 6 de Total/Urgentes/+30 dias ×
Despacho/Sentença e os 3 do demonstrativo de sem movimentação (30/90/120
dias) — são clicáveis. Ao clicar, a extensão pergunta o que fazer:

- **Abrir relatório**: abre uma **aba nova**, em primeiro plano, que
  navega até o Relatório Geral já com a mesma situação (ou, no caso de
  "sem movimentação", sem nenhuma situação) e o mesmo filtro daquele
  número selecionados, e a consulta já executada, mostrando a lista de
  processos por trás dele — útil para conferir exatamente quais processos
  compõem aquela contagem.
- **Exportar planilha (Excel)**: faz a mesma navegação/consulta acima
  (também numa aba nova) e, em seguida, clica automaticamente no botão
  "Exportar" da tabela de resultados e na opção "Excel", disparando o
  download da planilha que o próprio eproc gera para aquele filtro exato.
  O arquivo baixado é renomeado automaticamente para identificar o
  relatório de origem, ex.: `relatorio_despacho_urgentes.xlsx`,
  `relatorio_sentenca_mais30dias.xlsx`,
  `relatorio_sem_movimentacao_90dias.xlsx`.

A aba onde você estava trabalhando **nunca é navegada nem alterada** —
essa aba nova é aberta à parte (usando a mesma URL base do eproc só para
saber onde entrar) e permanece aberta ao final, para você ver o resultado
ou conferir o download.

O botão funciona a partir de qualquer página do eproc que tenha o menu
lateral visível (não precisa estar na tela de um processo
especificamente).

## Regras de Automação

Na tela **"Automatizar Tramitação Processual"** do eproc
(`acao=automatizar_localizadores`), cada regra listada na tabela pode estar
**ativa** ou **desativada** (indicado pelo interruptor "Ativa"/"**
DESATIVADA **" ao lado de cada linha). Essa tabela é difícil de ler de
relance: as colunas são estreitas e cada regra mistura critério, ação e
outros filtros num texto corrido.

O cartão **"Regras de Automação"** tem um botão **"Exportar regras
ativas"**, habilitado automaticamente sempre que a aba ativa está nessa
tela (reavaliado a cada troca de aba/navegação, já que o painel lateral
permanece aberto). Ao clicar:

1. A extensão lê a tabela e filtra **apenas as regras ativas** (ignora as
   marcadas como "** DESATIVADA **").
2. Ordena as regras: se **alguma** regra ativa tiver uma prioridade
   numérica definida (ex.: "Executar 1º"), o relatório segue essa ordem de
   execução; regras sem prioridade não entram nessa comparação. Quando
   **nenhuma** regra ativa tem prioridade definida, a ordem cai para o
   número da regra. Regras sem prioridade aparecem como
   "[Sem prioridade definida]" em vez do rótulo "[ Prioridade ]" da
   própria página, que é mais confuso fora de contexto.
3. Gera um documento HTML novo, com um "cartão" por regra ativa. Cada
   cartão traz, no topo, um **fluxograma** (Origem → Critério → Destino →
   Ação automatizada, quando houver) para entender de relance o que
   aquela regra faz, e logo abaixo o detalhamento completo e legível:
   número/prioridade, grupo, localizador de origem, o critério que
   dispara a regra, o localizador de destino/ação (incluindo eventos
   automatizados programados, quando houver) e outros critérios (ex.:
   juízo do processo, localizador adicional). O conteúdo detalhado é o
   mesmo da página original (nada é resumido ou omitido ali), só que
   reorganizado em blocos rotulados em vez da tabela apertada.
4. Abre esse documento em uma **aba nova**, com um link de atalho em cada
   cartão para editar aquela regra ou ver seu histórico diretamente no
   eproc.

## Abrir o painel a partir da própria página

Além do ícone da extensão na barra de ferramentas (que em instalações
novas do Chrome/Edge costuma ficar escondido atrás do ícone de "peça de
quebra-cabeça", precisando ser fixado manualmente), a extensão injeta um
botão em formato de pílula, laranja e com o texto "Extensão eProc" (⚖),
ao lado da logo do "Portal jus.br" no cabeçalho do eproc — a cor e o
texto são propositalmente diferentes do resto do cabeçalho, para o botão
não passar despercebido. Clicar nele abre o painel lateral da extensão
diretamente, sem precisar localizar o ícone na barra de ferramentas.

## Ícone da extensão

O ícone (barra de ferramentas e `chrome://extensions`) é uma balança da
justiça branca sobre fundo azul (`#2c6ea6`, a mesma cor usada no resto do
painel), em vez do ícone genérico de documento usado antes.

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
  devolve uma segunda casca: uma página com uma área vazia que só é
  preenchida depois que o JavaScript da própria página roda no navegador
  (uma chamada AJAX síncrona disparada ao carregar a página) — não dá para
  reproduzir isso com uma simples requisição de rede. Por isso, para esses
  documentos a extensão abre uma aba oculta com a página real, espera o
  script nativo do eproc preencher o conteúdo, lê o resultado e fecha a
  aba, salvando um `.html` autocontido só com o conteúdo real da
  certidão/ato. Isso pode fazer o download desses documentos específicos
  demorar um pouco mais (a aba precisa carregar de verdade).
- A extensão funciona em qualquer domínio que siga o padrão de URL do eproc
  (`.../eproc/controlador.php`), não é restrita a um tribunal específico.
- Se um download falhar (ex.: link expirado), o erro aparece no painel ao
  final do processo; os demais downloads continuam normalmente.
- Todas as funcionalidades desta extensão (exportar documentos, PDF
  único, MD único, relatórios, regras de automação) funcionam
  inteiramente offline/local, sem nenhuma chamada de rede além do próprio
  eproc.
