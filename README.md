# Extensão Auxiliar eProc

Extensão para Chrome/Edge com funcionalidades para o sistema **eproc**
(usado por diversos tribunais brasileiros: TJPR, TJSC, TJAL, Justiça Federal,
etc.), organizadas em cartões colapsáveis no painel lateral: **Exportar
Documentos**, **Gestão da Unidade** (que reúne Relatórios, Regras de
Automação, Localizadores do Órgão e Busca específica de localizadores) e
**Corregedoria** (só para esse perfil). O painel abre enxuto (só o
primeiro cartão expandido); cada cartão expande ao clicar no título, e
reabre sozinho quando alguma operação dele progride, conclui ou falha.
Sucessos aparecem em verde e erros em vermelho na linha de status de
cada cartão.

Além do cartão **Corregedoria** (único que é realmente condicional - só
aparece quando esse é o perfil ativo, ver seção própria abaixo), os
demais cartões trazem um selo indicando a qual perfil a funcionalidade
se destina, **apenas como indicação organizacional** - continuam sempre
visíveis e utilizáveis por qualquer perfil:

- **perfil MAGISTRADO**: Exportar Documentos.
- **perfil GESTÃO DA UNIDADE**: Relatórios, Regras de Automação,
  Localizadores do Órgão e Busca específica de localizadores - reunidos
  num único cartão "Gestão da Unidade", cada um em sua própria subseção
  (título + divisor), não em sub-menus aninhados: assim que o cartão é
  aberto, todos os botões de todas as quatro funcionalidades já ficam à
  vista, sem precisar abrir mais nada.

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

Esse comportamento pode ser desligado na engrenagem de **Configurações**
do painel (ver seção própria abaixo) — desligar não desfaz o que já foi
trocado numa página já aberta (passa a valer a partir da próxima
navegação/recarregamento daquela página).

## Configurações

O ícone de engrenagem (⚙) discreto no canto superior direito do painel
abre um pequeno modal com uma opção, salva em `chrome.storage.local`
(preferência deste navegador, não sincronizada entre máquinas):

- **"Substituir a sigla do usuário pelo nome e cargo na movimentação"**
  (ligado por padrão): controla a troca descrita na seção "Nomes de
  usuário na movimentação" acima.

Os menus suspensos preenchidos pela extensão (unidades do Relatório da
Unidade, localizadores da "Busca específica de localizadores") sempre
aparecem em ordem alfabética — não é uma opção configurável, é aplicado
automaticamente.

Cada opção salva assim que marcada/desmarcada (sem precisar de um botão
"Salvar" separado); o botão "Fechar" só esconde o modal.

## PDF único combinado

Ao escolher o modo "PDF único combinado", a extensão monta um único arquivo
`<numero_do_processo>_completo.pdf` com todos os documentos do processo, na
mesma ordem cronológica usada na numeração sequencial. A montagem usa a
biblioteca [pdf-lib](https://pdf-lib.js.org/) (vendorizada em
`libs/pdf-lib.min.js`), rodando inteiramente dentro da extensão — nenhum
arquivo é enviado para servidores externos.

Assim como no MD único, os documentos são organizados por evento da
movimentação processual: para cada evento detectado na página, o PDF
recebe uma página divisória com o texto do evento (número, data/hora e
descrição) e a lista de nome + descrição de cada documento vinculado a
ele. A descrição é a observação livre que o usuário digita ao anexar o
documento no eproc (comum em documentos do tipo "Outros" — ex.: "FICHA DE
CADASTRO RÉ"), lida do `<span class="infraTextoTooltipObservacao">` que
aparece ao lado do link na página; nem todo documento tem uma, e nesses
casos a lista mostra "Arquivo sem descrição incluída". Depois da lista
vêm os documentos propriamente ditos (na mesma ordem cronológica de
sempre). Eventos sem nenhum documento anexado ainda recebem sua página
divisória, com uma nota indicando isso. Documentos cujo evento não foi
identificado (ou não bate com nenhum evento detectado na página) entram
por último, numa seção "Documentos sem evento identificado" (também com a
lista de nome + descrição no início). Se a movimentação não puder ser
detectada na página, o PDF volta ao formato antigo (documentos em
sequência, sem divisórias de evento).

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
  compartilhada dos PDFs). Alguns documentos (ex.: atos ordinatórios
  ligados à publicação no DJEN) não usam a div "#divdochtml"/AJAX
  clássica — a página inteira já chega pronta, com o conteúdo direto no
  `body`. Nesse caso a extensão detecta isso já na primeira leitura e usa
  esse texto na hora, sem esperar os ~18s de polling. Se a primeira
  tentativa (com a div clássica) não conseguir ler o conteúdo a tempo,
  uma segunda tentativa é feita automaticamente, com uma aba nova. Se
  ainda assim falhar por completo (ex.: a própria aba se fecha sozinha
  antes de terminar), a extensão tenta como último recurso um download
  direto (`fetch` autenticado da mesma URL). Só quando isso também falha
  o documento entra no arquivo final com uma nota de erro. Veja a seção
  de diagnóstico abaixo para os detalhes de cada tentativa.

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
   página depois de carregar, se a div "#divdochtml" chegou a existir, uma
   amostra do texto da página quando a div não existe (útil para
   descobrir para onde a página foi redirecionada) e se a aba se fechou
   sozinha antes de terminar. Se as duas tentativas com aba oculta
   falharem, um aviso `"tentando baixar bruto via fetch como último
   recurso"` indica que a extensão está tentando o fallback de download
   direto antes de desistir do documento.
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

## Corregedoria

Quando o perfil ativo (select de perfil no cabeçalho do eproc,
`#selInfraUnidades`) é **"CORREGEDORIA"**, um cartão exclusivo
**"Corregedoria"** aparece no painel (fica oculto para qualquer outro
perfil), com selo e borda destacada indicando que é condicional. Ele
oferece **dois relatórios independentes**, com botões e PDFs separados:

### Relatório Geral (todas as unidades)

Botão direto, sem precisar escolher unidade. Gera
`relatorio_geral_corregedoria_<data>.pdf` com capa institucional e duas
tabelas panorâmicas, extraídas de telas próprias do menu lateral:

- **Processos sem Movimentação N Dias (todas as varas)**
  (`acao=relatorio_sem_movimentacao_listar_geral`), preenchendo 90 dias —
  visão comparativa de todas as unidades de uma vez.
- **Relatório de Atuação Conciliador/Juiz Leigo**
  (`acao=relatorio_atuacao_auxiliar_justica`), sem filtro de unidade.

Como essas duas telas ainda não foram calibradas contra uma amostra HTML
real (diferente das demais), a extração usa um leitor genérico de
tabelas (best-effort): preenche o campo de dias se existir, clica em
"Consultar" se existir, e lê o resultado primeiro pela API do DataTables
e senão pela maior tabela HTML com dados, com logs `[eproc]` detalhados.
Se a detecção automática falhar em alguma das telas, o PDF sai com um
aviso no lugar — nesse caso, envie o HTML da tela para calibrar a
extração.

### Relatório da Unidade

1. **"Carregar unidades (Relatório da Unidade)"**: navega a aba atual até
   o Relatório Geral (mesmo mecanismo do botão "↗" do cartão Relatórios)
   e lê todas as opções do filtro "Órgão/Juízo" dessa tela — visualmente
   um dropdown do bootstrap-select, mas a leitura é feita direto no
   `<select id="selIdOrgaoJuizo">` nativo por trás dele — preenchendo um
   menu suspenso no painel, sempre em **ordem alfabética**. O botão
   **some assim que clicado** — ele só serve para um carregamento
   inicial, e só volta a aparecer se o carregamento falhar (para tentar
   de novo).
2. Ao **escolher uma unidade** no menu, o painel mostra "Informações
   serão extraídas de: `<nome da unidade>`" e libera a lista **"Itens a
   incluir no PDF"** (7 checkboxes, um por seção do relatório — todos
   marcados por padrão) e o botão **"Exportar Relatório da Unidade
   (PDF)"**. Esse relatório sempre confere se uma unidade foi escolhida
   antes de rodar — sem isso, mostra o erro "Selecione uma unidade na
   lista antes de gerar este relatório." em vez de seguir sem saber de
   onde extrair os dados; e confere se pelo menos 1 item está marcado —
   sem isso, mostra "Marque ao menos um item do relatório antes de
   exportar.".
3. **"Exportar Relatório da Unidade (PDF)"** gera, filtrado pela unidade
   escolhida e pelos itens marcados, um único PDF com:
   - Nome da unidade e data/hora da extração.
   - Conclusos para decisão e para sentença: Urgentes, Não urgentes
     (calculado como Total − Urgentes, sem precisar de uma consulta a
     mais), Aguardando há mais de 90 dias e, **por último, o Total**.
   - Processos sem movimentação há mais de 30, 90 e 120 dias.
   - **Suspensos/sobrestados**: há mais de 90 dias (grupo inteiro do
     filtro "Situação" — os values de `#selStatusProcesso` seguem o
     formato `status;codigo;grupo`; o grupo SUSPENSÃO é o sufixo `;S`) e
     um **detalhamento por situação específica**: cada uma das ~40
     opções do grupo é consultada individualmente, mas só entram no
     relatório as que têm pelo menos 1 processo (ex.: "SUSPENSAO: 12",
     "SOBRESTADO CONVÊNIO: 3") — as dezenas de variantes zeradas ficam de
     fora, para não poluir o relatório. O **Total** vem por último,
     depois de todos os processos individuais listados acima.
   - O **nome de cada Localizador** da unidade, em ordem alfabética
     (**sem** o total de processos — ver aviso abaixo).

   Desmarcar um item pula tanto a(s) consulta(s) dele quanto o trecho
   correspondente no PDF — não é só uma questão de esconder o resultado,
   a consulta daquele item nem chega a rodar. Como cada seção equivale a
   uma ou mais consultas no Relatório Geral (cada uma com sua própria aba
   oculta), desmarcar itens que a unidade não precisa (ex.: uma vara que
   não quer o detalhamento de suspensos) também deixa a exportação mais
   rápida.

   Tudo isso reaproveita as funções já existentes no painel: as mesmas
   consultas do Relatório Geral (agora com um filtro extra de
   Órgão/Juízo) e o mesmo gerador de tabela em PDF — combinados num
   único arquivo `relatorio_gerencial_<unidade>_<data>.pdf` em
   `Downloads/eproc/`, em vez de arquivos separados.

   O PDF segue uma identidade visual sóbria e institucional, com o
   cabeçalho **"TRIBUNAL DE JUSTIÇA DO ESTADO DO PARANÁ · Sistema eProc"**
   repetido no topo de cada página, capa com os números organizados em
   seções coloridas (rótulo/valor, uma por bloco: decisão, sentença, sem
   movimentação, suspensos), rodapé com numeração de página e aviso de
   que o documento foi gerado pela extensão. A lista de Localizadores
   **não** vira uma tabela em página virada (paisagem) à parte — os
   nomes entram **um por linha** (com um marcador "-" e recuo pendurado
   para nomes longos que precisem quebrar em mais de uma linha) na mesma
   página retrato da capa, logo abaixo do aviso sobre o total de
   processos — bem mais fácil de escanear visualmente do que um
   parágrafo corrido com todos os nomes separados por vírgula. Continua
   em novas páginas (sempre com o mesmo cabeçalho/rodapé) só se a lista
   for grande demais para caber no que sobrou da página. Essa mesma
   identidade visual também vale para os PDFs de Localizadores/Processos
   por Localizador exportados fora do painel da Corregedoria, já que
   reaproveitam o mesmo gerador de tabela.

   A extração dos Localizadores **não** usa a tela "Localizadores do
   Órgão" (diferente do resto do painel) — o Relatório Geral tem seu
   próprio campo **"Localizador"** (um widget Tagify, igual ao de
   "Informação complementar"), que só lista os localizadores da unidade
   depois que um Órgão/Juízo é selecionado no filtro da tela.

   Para obter a **lista de nomes**, a extensão busca direto o mesmo
   endpoint JSON que o botão **"Listar todos"** chama por baixo dos panos
   (`acao=relatorio_geral/listar_localizador_orgao`, achado inspecionando
   a aba de Rede do navegador) — um único `fetch`, sem clicar em nada nem
   esperar o dropdown do Tagify renderizar. Só cai para o modo antigo
   (clicar em "Listar todos" e ler os itens do dropdown do Tagify) se
   esse fetch não encontrar a URL do endpoint na página ou a chamada
   falhar.

   Esse endpoint, porém, devolve **só os nomes** dos localizadores — sem
   nenhum total de processos —, e não existe (até onde verificamos)
   nenhum endpoint equivalente que devolva o total de todos de uma vez só
   para uma unidade arbitrária (o total depende da combinação de filtros
   de uma consulta no Relatório Geral, não é um dado fixo do localizador
   em si). Descobrir esse número um por um (uma aba nova por localizador)
   ficava lento demais para unidades com muitos localizadores, então **o
   relatório, por ora, traz só a lista de nomes** (em ordem alfabética) —
   o PDF sempre inclui um aviso explicando que a única forma de obter o
   total de processos de um localizador específico é se habilitar na
   própria unidade e usar a ferramenta **"Localizadores do Órgão"** do
   painel (que já mostra esse total, já que ali a extração é direto da
   tabela da tela, sem precisar de nenhuma consulta a mais).

## Regras de Automação

Na tela **"Automatizar Tramitação Processual"** do eproc
(`acao=automatizar_localizadores`), cada regra listada na tabela pode estar
**ativa** ou **desativada** (indicado pelo interruptor "Ativa"/"**
DESATIVADA **" ao lado de cada linha). Essa tabela é difícil de ler de
relance: as colunas são estreitas e cada regra mistura critério, ação e
outros filtros num texto corrido.

O cartão **"Regras de Automação"** tem um botão **"Exportar regras
ativas"**, sempre habilitado — não é preciso estar (nem navegar
manualmente) na tela "Automatizar Tramitação Processual". Ao clicar:

1. A extensão abre uma aba oculta a partir da URL da aba atual e clica no
   link "Automatizar Localizadores do Órgão" do menu lateral (menu
   "Localizadores" → "Automatizar Localizadores do Órgão"), do mesmo jeito
   já usado para "Localizadores do Órgão"/"Relatório Geral".
2. Lê a tabela dessa aba oculta e filtra **apenas as regras ativas**
   (ignora as marcadas como "** DESATIVADA **").
3. Ordena as regras: se **alguma** regra ativa tiver uma prioridade
   numérica definida (ex.: "Executar 1º"), o relatório segue essa ordem de
   execução; regras sem prioridade não entram nessa comparação. Quando
   **nenhuma** regra ativa tem prioridade definida, a ordem cai para o
   número da regra. Regras sem prioridade aparecem como
   "[Sem prioridade definida]" em vez do rótulo "[ Prioridade ]" da
   própria página, que é mais confuso fora de contexto.
4. Gera um documento HTML novo, com um "cartão" por regra ativa. Cada
   cartão traz, no topo, um **fluxograma numerado em sequência vertical**
   (1 Origem → 2 Critério → 3 Destino → 4 Ação automatizada, quando
   houver) para entender de relance o que aquela regra faz — cada passo
   numa caixa colorida própria, empilhada de cima para baixo com uma seta
   entre elas. Esse layout vertical substitui a versão anterior (caixas
   numa linha horizontal com quebra automática): com textos de tamanhos
   bem diferentes entre as regras, a quebra de linha da versão horizontal
   ficava imprevisível e as setas pareciam soltas; empilhado e numerado, a
   ordem de execução fica clara não importa o tamanho de cada texto.
   Logo abaixo do fluxograma vem o detalhamento completo e legível:
   número/prioridade, grupo, localizador de origem, o critério que
   dispara a regra, o localizador de destino/ação (incluindo eventos
   automatizados programados, quando houver) e outros critérios (ex.:
   juízo do processo, localizador adicional). O conteúdo detalhado é o
   mesmo da página original (nada é resumido ou omitido ali), só que
   reorganizado em blocos rotulados em vez da tabela apertada.

   Tanto a caixa **"Ação automatizada"** do fluxograma quanto o campo
   **"Localizador DESTINO / Ação"** do detalhamento levam em conta que a
   coluna correspondente da tabela original pode ter dois blocos
   sobrepostos quando o conteúdo é longo (um truncado, escondido por
   padrão, e um completo) — o mesmo padrão que a coluna "Outros
   Critérios" já tinha. Sem preferir sempre o bloco completo, os detalhes
   de qual ação exatamente seria executada (evento, documento, texto,
   etc.) podiam sair cortados; e o resumo do fluxograma pegava só a linha
   "Evento: ..." e descartava o resto — agora leva tudo a partir do
   cabeçalho "AUTOMATIZADO"/"Ação Programada" em diante.
5. Fecha a aba oculta e abre o documento em uma **aba nova visível**, com
   um link de atalho em cada cartão para editar aquela regra ou ver seu
   histórico diretamente no eproc.

Se o link "Automatizar Localizadores do Órgão" não for encontrado na aba
oculta (ex.: o rótulo do menu mudou), a extensão avisa exatamente qual
link procurou — nesse caso, pode ser preciso regravar o script de acesso
para confirmar o caminho atual do menu.

## Localizadores do Órgão (exportar em PDF/Excel)

O cartão **"Localizadores do Órgão"** exporta a lista completa de
Localizadores do Órgão (tela `acao=localizador_orgao_listar` do eproc) em
PDF e/ou planilha Excel, com três colunas: **Localizador** (nome), a
**Descrição do Localizador** e o **Total de processos**.

Ao clicar em **"Exportar"** (com PDF e/ou Excel marcados):

1. A extensão abre uma aba oculta a partir da URL da aba atual e clica no
   link "Localizadores do Órgão" do menu lateral (funciona mesmo com o
   submenu colapsado, já que o link já existe no DOM independente do
   estado visual do menu).
2. O eproc lembra a última página vista nessa listagem e reabre a tela
   nela (não sempre na página 1) — antes de coletar, a extensão confere
   se o botão "Primeira Página" está desabilitado (sinal de que já está
   na página 1); se não estiver, clica nele e espera voltar, para nunca
   perder os localizadores das páginas anteriores.
3. Raspa a tabela da página atual e, enquanto o botão "Próxima Página"
   estiver habilitado, clica nele e espera a página seguinte terminar de
   carregar (detectado pela mudança no texto da legenda da tabela, ex.:
   "1 a 50" → "51 a 100") antes de raspar a página seguinte — cobrindo
   listas com qualquer quantidade de páginas. Cada raspagem/clique roda
   como uma chamada independente e curta (nunca um laço assíncrono
   contínuo dentro da própria página), para não quebrar com "Frame with
   ID 0 was removed" caso a paginação dispare uma navegação de verdade em
   vez de só atualizar a tabela via AJAX.
4. Ordena os localizadores pelo **Total de processos** (do maior para o
   menor) e gera os arquivos marcados em `Downloads/eproc/`:
   - **PDF**: tabela paginada (A4 paisagem), com cabeçalho repetido em
     cada página e as colunas de nome/descrição quebradas em várias
     linhas quando o texto for longo, para nunca cortar conteúdo.
   - **Excel**: arquivo `.xls` no formato nativo "Excel XML Spreadsheet"
     (texto XML puro, sem precisar de nenhuma biblioteca de compressão
     ZIP) — abre diretamente no Excel/LibreOffice como uma planilha
     comum, sem aviso de formato incompatível.

A aba oculta usada para navegar e coletar os dados é fechada
automaticamente ao final, sem interferir na aba que você está usando.

## Busca específica de localizadores

O cartão **"Busca específica de localizadores"** carrega os
Localizadores do Órgão com pelo menos um processo atribuído e permite ir
direto até a lista de processos de um deles, ou exportar um relatório
desses processos - sem precisar abrir a tela de Localizadores
manualmente e procurar a linha certa.

Ao clicar em **"Carregar localizadores"** (o botão **some assim que
clicado** — mesmo padrão do "Carregar unidades" do Relatório da Unidade;
só volta a aparecer se o carregamento falhar ou não encontrar nenhum
localizador, para tentar de novo):

1. A extensão roda a mesma coleta multi-página usada pela exportação em
   PDF/Excel (aba oculta, volta para a página 1 se necessário, percorre
   todas as páginas da listagem).
2. Filtra para manter só os localizadores com **pelo menos 1 processo**
   atribuído — os demais não têm para onde navegar, já que o número da
   coluna "Total de processos" só é um link quando maior que zero.
3. Preenche um menu suspenso com esses localizadores (nome e total de
   processos entre parênteses), sempre em ordem alfabética.

Ao **escolher um localizador** no menu, aparecem duas ações (a escolha
no menu sozinha não navega nem exporta nada — é preciso clicar em um dos
botões):

a. **"Ir para o relatório"**: navega a aba em que o painel foi aberto
   diretamente para `acao=localizador_processos_lista` daquele
   localizador — a mesma página que abriria clicando no número da coluna
   "Total de processos" na listagem (URL já capturada, com sessão/hash
   inclusos, durante a coleta).
b. **"Exportar relação de processos deste localizador"** (com PDF e/ou
   planilha Excel marcados) — nome escolhido para não ser confundido com
   a opção (c): gera um relatório só com os processos desse localizador,
   com três colunas: **Número Processo**, **Classe** e **Inclusão no
   localizador**. O relatório é gerado em segundo plano (percorrendo
   todas as páginas da listagem de processos, com a mesma correção de
   "volta pra página 1" já usada na exportação de Localizadores) e
   ordenado pela **Inclusão no localizador da data mais antiga para a
   mais nova**. Os arquivos saem em `Downloads/eproc/` como
   `processos_localizador_<nome_do_localizador>_<data>.pdf`/`.xls`.
c. **"Exportar na íntegra todos os processos nesse localizador"**: entra, um de
   cada vez, em CADA processo da lista do localizador escolhido (numa
   aba oculta controlada pela própria extensão) e monta, para cada um,
   um PDF único combinado com todos os seus documentos — mesmo formato
   do modo "PDF único combinado" do cartão "Exportar Documentos", com a
   movimentação intercalada entre os documentos de cada evento. Como
   processa um processo inteiro por vez (abrir a aba, ler os documentos,
   baixar cada um, montar o PDF), pode demorar bastante para
   localizadores com muitos processos — o progresso mostra qual
   processo e documento estão sendo tratados no momento. Os arquivos
   saem em `Downloads/eproc/documentos_localizador_<nome_do_localizador>/`,
   **uma pasta por processo (nome da pasta = número do processo)**,
   contendo um único arquivo `<nome_do_localizador>.pdf` — assim,
   exportar o mesmo processo por localizadores diferentes não sobrescreve
   nada, cada exportação fica em seu próprio arquivo dentro da pasta do
   processo. Processos sem nenhum documento ou com falha ao abrir são
   pulados e aparecem como aviso ao final, sem interromper os demais.

Como o botão "Carregar localizadores" some depois de carregado, para
atualizar a lista (por exemplo, depois que os números mudarem) basta
fechar e reabrir o painel — ele volta a aparecer do zero.

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
