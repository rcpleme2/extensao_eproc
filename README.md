# Extensão Auxiliar eProc

> Página de apresentação (instalação + principais funcionalidades):
> https://rcpleme2.github.io/extensao_eproc/ (requer o GitHub Pages do
> repositório habilitado em Settings → Pages → Source: branch `main`,
> pasta `/docs`).

Extensão para Chrome/Edge com funcionalidades para o sistema **eproc** do
TJPR, restrita aos endereços `https://eproc1g.tjpr.jus.br/eproc/` e
`https://eproc1g.tre.tjpr.jus.br/eproc/` (únicos hosts com permissão no
`manifest.json` — a extensão não roda em nenhum outro domínio),
organizadas em cartões colapsáveis no painel lateral: **Gestão
Gabinete** (Exportar Documentos + Busca específica de localizadores),
**Gestão da Unidade** (Exportar Relatório da Unidade em PDF, sem exigir
escolha de unidade — ver seção própria abaixo) e **Corregedoria**
(exclusivo desse perfil, com o Relatório para Correição de uma unidade
escolhida). O painel abre enxuto (**todos os cartões fechados**,
nenhum aberto por padrão); cada cartão expande ao clicar no título, e
reabre sozinho quando alguma operação dele progride, conclui ou falha.
Sucessos aparecem em verde e erros em vermelho na linha de status de
cada cartão. Os botões que **geram um arquivo para baixar** (Exportar
Documentos, Exportar Relatório da Unidade, Exportar Relatório para
Correição, Exportar processos/documentos de um localizador) ganham um
**cronômetro discreto** (ex.: "Gerando... (12s)" → "Gerando... (1min
8s)"), medindo quanto tempo aquela exportação está levando desde o
primeiro texto de andamento até o resultado final — assim dá pra saber
se uma exportação demorada ainda está rodando ou travou, sem precisar
cronometrar por fora. Essa linha de status fica parada na mensagem
inicial (só o cronômetro segue contando por cima dela); o passo atual
em detalhe (qual seção/consulta está sendo processada no momento)
aparece **só** na linha de progresso logo abaixo, para as duas áreas não
mostrarem o mesmo texto duas vezes. Operações que só **carregam
informação na tela** (Detectar documentos, Carregar unidades, Carregar
localizadores) não mostram esse cronômetro.

O cartão **Corregedoria** é o único realmente condicional - só aparece
quando esse é o perfil ativo (ver seção própria abaixo); os demais
ficam sempre visíveis e utilizáveis por qualquer perfil.

A ordem padrão dos cartões é **Corregedoria > Gestão da Unidade >
Gestão Gabinete**, mas cada um tem uma alça (⠿) ao lado do ícone
que pode ser arrastada com o mouse para reordená-los como preferir; a
ordem escolhida fica salva (`chrome.storage.local`) e é reaplicada da
próxima vez que o painel for aberto.

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

**Escolher quais documentos exportar**: ao clicar em "Detectar documentos",
além de listá-los no painel, a extensão insere um **checkbox marcado, direto
na própria página de movimentação do processo**, logo antes de cada link de
documento reconhecido — dá para desmarcar ali mesmo, na tela onde os
documentos já aparecem destacados, sem precisar decorar nomes/números e ir
procurá-los na lista do painel. Esse checkbox é propositalmente **maior e com
contorno verde bem vistoso**, e entra como **primeiro elemento** da célula do
documento (antes de qualquer ícone nativo do eproc que já viesse colado ali,
ex.: sigilo, recurso) — sem esse cuidado, ele se perdia visualmente no meio
desses ícones nativos parecidos. A lista do painel também traz um checkbox
por documento (mesmo estado, nos dois lugares) e dois atalhos **"Marcar
tudo"**/**"Desmarcar tudo"** para agilizar seleções grandes. Os dois lugares
ficam sincronizados: desmarcar um documento no painel também desmarca o
checkbox correspondente na página, e vice-versa — o painel só não sabe
imediatamente de uma mudança feita na página até o próximo clique em
"Detectar" ou "Baixar" (que sempre relê o estado atual direto da página antes
de exportar, então a sincronia nunca fica desatualizada na hora que importa).
Documentos desmarcados ficam de fora tanto de "Arquivos individuais" quanto
de "PDF único combinado".

**Incluir ou não a movimentação (linha do tempo)**: do mesmo jeito, um
checkbox **único** (a movimentação entra ou sai da exportação como um todo,
não evento por evento) aparece **acima da tabela de eventos**, na própria
página, e também no painel (marcado por padrão, sincronizado nos dois
sentidos igual aos documentos) — dá para excluir a linha do tempo inteira da
exportação quando ela não interessa. Essa escolha afeta tanto o "MD único"
(que perde a seção de movimentação) quanto o "PDF único combinado" (que deixa
de agrupar os documentos por evento, já que não há mais em qual evento
agrupá-los); "Arquivos individuais" não usa a movimentação de qualquer forma,
então não é afetado por esse checkbox. Clicar em "Baixar" sem nenhum
documento marcado e sem a movimentação incluída mostra um aviso em vez de
gerar uma exportação vazia (mesmo no modo "MD único", que só consegue gerar
algo com pelo menos um dos dois: documento(s) selecionado(s) ou a
movimentação incluída).

## Instalação

A extensão também está disponível na
[Chrome Web Store](https://chromewebstore.google.com/detail/gicnjchohekkcoocondkjplhdmkhciog?utm_source=item-share-cb).
A Google demora para aprovar cada atualização enviada à loja, então a versão
publicada lá costuma ficar **alguns dias ou semanas atrasada** em relação a
este repositório — para sempre ter a versão mais recente, prefira o modo
desenvolvedor abaixo.

### Modo desenvolvedor (versão mais atual)

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

## Magistrado nos eventos "Conclusos \*"

Na tabela de eventos do processo (`#tblEventos`), quando um evento é um
"Conclusos" (ex.: "Conclusos para decisão/despacho", "Conclusos para
sentença" — qualquer descrição que **comece** com "Conclusos"), o
Magistrado responsável já existe na página, só que escondido atrás do
tooltip nativo "Informações do Evento" (o ícone de lupa ao lado da
descrição, que só aparece ao passar o mouse) — não vem na própria coluna
Descrição. A extensão lê esse dado direto do atributo `aria-description`
do `<span class="sr-only">` vizinho ao ícone (o mesmo texto usado pelos
leitores de tela, sempre presente no HTML independente do hover) e
acrescenta **só o nome do Magistrado**, entre parênteses, ao final do
texto já existente na coluna — ex.: "Conclusos para decisão/despacho"
vira **"Conclusos para decisão/despacho (ROSANGELA FAORO)"**. O cargo
(ex.: "Juiz da Fase", vindo depois do nome como "NOME - Cargo" nesse
mesmo atributo) fica de fora, só o nome entra.

Esse atributo concatena "Data do Evento:", "Evento:", "Usuário:" e
"Magistrado(s):" **sem nenhum separador visível** entre os valores (o
eproc usa `<br>` só na versão visual do tooltip; a versão para leitor de
tela perde essas quebras) — por isso a extensão isola cada campo
ancorando no **rótulo do campo seguinte**, nunca em espaço ou pontuação,
e conclusão só é procurada no campo "Magistrado(s):" (o último), lendo
tudo que sobra depois desse rótulo.

Assim como a troca de sigla por nome (acima), esse comportamento pode ser
desligado na engrenagem de **Configurações** do painel — desligar não
desfaz o que já foi acrescentado numa página já aberta.

## Configurações

O ícone de engrenagem (⚙) no canto superior direito do painel — com um
fundo sutil para não passar despercebido, mas sem chamar mais atenção que
os botões de ação — abre um pequeno modal com uma opção, salva em
`chrome.storage.local`
(preferência deste navegador, não sincronizada entre máquinas):

- **"Substituir a sigla do usuário pelo nome e cargo na movimentação"**
  (ligado por padrão): controla a troca descrita na seção "Nomes de
  usuário na movimentação" acima.
- **"Separar Comarca/Juízo no campo 'Órgão/Juízo' do Relatório Geral"**
  (**desligado por padrão**): quando ligada, na própria tela do
  Relatório Geral do eproc (`#selIdOrgaoJuizo`), o dropdown único com
  centenas de unidades é substituído por **dois selects em sequência**
  — primeiro a Comarca, depois o Juízo/Vara (só com as unidades daquela
  comarca) — igual à escolha em duas etapas já usada pelo próprio painel
  para o Relatório para Correição (mesma separação de nome pelo padrão
  "`<Juízo/Vara> de <Comarca>`"). Ao escolher o Juízo/Vara, o `<select>`
  nativo da página é atualizado e dispara "change" normalmente, então o
  resto da tela (bootstrap-select, filtros dependentes) continua
  funcionando como se a unidade tivesse sido escolhida no dropdown
  original — que fica oculto (não removido) enquanto a opção estiver
  ligada. Desligada por padrão porque altera a interface da própria
  página do eproc, não só lê dados dela.
- **"Acrescentar o Magistrado aos eventos 'Conclusos \*' na tela do
  processo"** (ligado por padrão): ver seção "Magistrado nos eventos
  'Conclusos \*'" abaixo.

Os menus suspensos preenchidos pela extensão (unidades do Relatório para
Correição, localizadores da "Busca específica de localizadores") sempre
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
  de diagnóstico abaixo para os detalhes de cada tentativa. A conversão
  para texto simples remove por inteiro (tag **e** conteúdo) qualquer
  `<style>`/`<script>`/comentário embutido no HTML do documento (comum em
  certidões/mandados, que trazem CSS de impressão junto) — sem isso, o
  conteúdo dessas tags vazava como se fosse texto do próprio documento.

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
4. Nenhuma requisição de rede fica presa para sempre: toda chamada
   `fetch` feita pela extensão (resolver a URL real de um documento,
   baixar o conteúdo de um PDF/imagem, buscar a lista de Localizadores)
   usa um `AbortController` com limite de **10 segundos** — ao estourar,
   a requisição específica é **abortada de fato** (não só "desistida"), o
   item correspondente (documento, consulta) é pulado e o motivo
   ("Tempo esgotado (10s) aguardando resposta de ...") entra nos
   avisos/erros do resultado final, sem impedir os próximos itens de
   serem processados. A extração de texto de cada PDF (que envolve várias
   páginas, não só uma requisição) tem um limite maior, de 60s.

## Analisar com IA

**"Analisar com IA"** é sua própria subseção dentro do cartão "Gestão
Gabinete" — separada de "Exportar Documentos", com título e recolhimento
próprios — mas reaproveita o mesmo mecanismo de detecção/seleção: assim
que "Detectar documentos" (em "Exportar Documentos") encontra um processo,
essa subseção passa a mostrar o número do processo e o total de
documentos, e usa a mesma seleção de documentos e o mesmo checkbox de
"incluir a movimentação" já usados para baixar/exportar — não é preciso
escolher de novo, nem essa subseção tem sua própria lista de checkboxes.

### Análise imediata

1. Marque quais documentos entram na análise (na lista de "Exportar
   Documentos" ou direto na página do processo) e se a movimentação deve
   ser incluída.
2. Escolha o **tipo de prompt** (por enquanto só há um cadastrado, ver
   abaixo) e se o conteúdo deve ser **anonimizado antes de enviar** (mesma
   anonimização de melhor esforço do "MD único" — CPF/CNPJ, telefone,
   e-mail, endereços removidos e nomes abreviados; ver aviso na seção "MD
   único" acima sobre os limites dessa anonimização).
3. Clique em **"Analisar agora"**. A extensão extrai o texto dos
   documentos selecionados (mesmo mecanismo do "MD único") e mostra uma
   **estimativa de custo** (tokens aproximados e custo em dólares,
   calculados por uma heurística de caracteres — não é o tokenizador real
   do provedor) antes de gastar qualquer coisa de verdade.
4. Clique em **"Confirmar e enviar"** para de fato chamar a API do
   provedor escolhido (Claude ou Gemini, configurado nas configurações da
   extensão — ver abaixo). Ou **"Cancelar"** para descartar sem gastar
   nada.
5. A resposta da IA aparece num campo de texto somente leitura, com um
   botão **"Copiar"** para colar em outro lugar da página do processo. O
   custo **real** da chamada (calculado a partir do uso de tokens
   devolvido pela própria API) substitui a estimativa nesse momento.

### Fila em lote (mais barato, para quando não precisa da resposta na hora)

Ao lado da análise imediata, a mesma subseção tem um bloco **"Fila em
lote"**, usando a [Message Batches API da
Claude](https://platform.claude.com/docs/en/api/creating-message-batches):
o mesmo pedido custa **50% menos**, mas a resposta não sai na hora — o
lote é processado em segundo plano e pode levar até 24h (a maioria
termina bem mais rápido). Só funciona com o provedor **Claude** (o Gemini
não tem uma API de lote assíncrona equivalente cadastrada nesta extensão
ainda).

Fluxo:

1. Em vez de (ou além de) "Analisar agora", clique em **"Adicionar à fila
   em lote"**. A extensão já extrai o texto do processo nesse momento (o
   lote pode ser enviado bem depois, mesmo sem a aba do processo mais
   aberta) e mostra o item na lista da fila, com o custo estimado já com o
   desconto de lote.
2. Repita para quantos processos quiser — navegue para outro processo,
   detecte, marque a seleção e "Adicionar à fila em lote" de novo. A fila
   persiste mesmo fechando o painel.
3. Quando terminar de montar a fila, clique em **"Enviar lote"** — todos
   os itens da fila são enviados de uma vez, numa única chamada à API de
   lotes, e a fila é esvaziada.
4. O lote enviado aparece em **"Lotes enviados"**, com o status
   ("processando..." ou a contagem de concluídos/com erro) e um botão
   **"Verificar agora"** para checar manualmente sem esperar a checagem
   automática (a extensão também verifica sozinha a cada 10 minutos,
   mesmo com o painel fechado, via `chrome.alarms`).
5. Quando o lote termina, cada processo do lote aparece **separado**,
   identificado pelo número do processo, com sua própria resposta num
   campo de texto e um botão "Copiar" individual — nenhuma resposta fica
   misturada com a de outro processo do mesmo lote.

Os resultados dos lotes ficam disponíveis por 29 dias na Claude — depois
disso, um lote muito antigo que ainda não tenha sido verificado pode não
conseguir mais recuperar os resultados.

### Configuração (provedor, modelo e chaves de API)

Nas configurações da extensão (ícone de engrenagem), na seção "Análise com
IA":

- Escolha o provedor: **Claude (Anthropic)** ou **Gemini (Google)**.
- Informe a chave de API do provedor escolhido (os dois campos ficam
  salvos, então dá para trocar de provedor sem digitar a chave de novo).
  As chaves ficam guardadas localmente (`chrome.storage.local`, neste
  navegador) e só são enviadas para a API do próprio provedor ao chamar
  "Analisar com IA" — nunca para nenhum servidor da extensão (que não
  existe).
- Escolha o **modelo** de cada provedor, num select logo abaixo da
  respectiva chave:
  - Claude: Haiku 4.5 (padrão, mais barato), Sonnet 5 ou Opus 4.8.
  - Gemini: Flash-Lite 3.1 (padrão, mais barato) ou Pro 3.1.

  O modelo escolhido é o mesmo usado tanto na análise imediata quanto ao
  adicionar itens à fila em lote (que sempre usa o modelo Claude
  configurado, já que o lote só funciona com esse provedor — ver abaixo).
  O padrão de cada provedor é sempre o modelo **mais barato** da lista;
  modelos mais caros tendem a produzir relatórios mais elaborados, mas
  custam mais por chamada.

Sem uma chave configurada para o provedor escolhido, "Confirmar e enviar"
retorna um erro pedindo para configurá-la.

### Prompt cadastrado: "Análise inicial - família"

Único prompt disponível por enquanto. É sempre **apensado ao final** do
conteúdo do processo (documentos selecionados + movimentação, quando
incluída) — ou seja, a IA recebe primeiro o conteúdo do processo e, depois
dele, as instruções do prompt. Pede um relatório no formato FIRAC+ (fatos,
pedidos, tutela de urgência) com foco em direito de família (guarda,
alimentos, visitas, partilha), linguagem que evita termos como "menor" em
favor de "criança"/"adolescente", e perguntas adicionais ao final (advogado
dativo, tabela de gastos, conta bancária, idade dos menores envolvidos).

### Custos e privacidade

- Cada análise (imediata ou em lote) é uma chamada paga à API do provedor
  escolhido, cobrada na conta cuja chave foi configurada — a extensão não
  intermedia nem subsidia esse custo. A fila em lote custa 50% menos que a
  análise imediata pelo mesmo prompt, em troca de não ter a resposta na
  hora.
- O conteúdo do processo (documentos + movimentação) sai do navegador do
  usuário direto para a API do provedor escolhido. A anonimização é
  **opcional e de melhor esforço** (mesmas limitações do "MD único") —
  revise o que está sendo enviado antes de confirmar, especialmente em
  processos com dados sensíveis.

## Corregedoria

Quando o perfil ativo (select de perfil no cabeçalho do eproc,
`#selInfraUnidades`) é **"CORREGEDORIA"**, um cartão exclusivo
**"Corregedoria"** aparece no painel (fica oculto para qualquer outro
perfil), com selo e borda destacada indicando que é condicional. Por
enquanto ele só mostra o **Relatório para Correição** (ver abaixo).

> **Relatório Geral (todas as unidades)** — desativado temporariamente.
> O botão, a área de progresso e toda a lógica (`exportarRelatorioPanoramico`
> em `background.js`) continuam no código, só comentados/ocultos em
> `popup.html`/`popup.js` — a ideia é melhorar esse relatório antes de
> voltar a expô-lo no painel.

### Relatório para Correição

1. **"Carregar unidades (Relatório para Correição)"**: navega a aba atual até
   o Relatório Geral e lê todas as opções do filtro "Órgão/Juízo" dessa
   tela — visualmente
   um dropdown do bootstrap-select, mas a leitura é feita direto no
   `<select id="selIdOrgaoJuizo">` nativo por trás dele. O botão **some
   assim que clicado** — ele só serve para um carregamento inicial, e só
   volta a aparecer se o carregamento falhar (para tentar de novo).
2. Como os nomes de unidade do eproc seguem o padrão "`<Juízo/Vara> de
   <Comarca>`" (ex.: "Juizado Especial Cível, Criminal e da Fazenda
   Pública de Piraquara"), o painel separa a **Comarca** (tudo depois do
   último " de " do nome) do restante e oferece a escolha em **duas
   etapas**, em vez de uma lista única com centenas de unidades:
   - Primeiro, um menu **"Selecione uma comarca..."** (em ordem
     alfabética), preenchido assim que a lista termina de carregar.
   - Ao escolher uma comarca, um segundo menu **"Selecione um
     juízo/vara..."** aparece, já filtrado só com as unidades daquela
     comarca (também em ordem alfabética) — o nome mostrado nesse menu
     **não repete** o sufixo "de `<Comarca>`" (já está implícito na
     comarca escolhida acima), mas o **nome completo original** é o que
     aparece na confirmação abaixo e é usado de fato no relatório/PDF.
     Nomes sem nenhum " de " (ex.: siglas curtas) caem numa comarca
     "(Outras)". Exceção conhecida: comarcas cujo próprio nome tem "de"
     (hoje só **"Cândido de Abreu"**) entrariam erradas nesse split
     ingênuo pelo ÚLTIMO " de " — ex.: "... do Juízo Único de Cândido de
     Abreu" viraria comarca "Abreu" — por isso essas comarcas ficam numa
     lista de exceções, verificadas pelo nome inteiro antes de qualquer
     tentativa de split.
3. Ao **escolher um juízo/vara** no segundo menu, o painel mostra
   "Informações serão extraídas de: `<nome completo da unidade>`" e
   libera a lista **"Itens a incluir no PDF"** (checkboxes, um por seção
   do relatório — todos marcados por padrão) e o botão **"Exportar
   Relatório para Correição (PDF)"**. Esse relatório sempre confere se uma
   unidade foi escolhida antes de rodar — sem isso, mostra o erro
   "Selecione uma unidade na lista antes de gerar este relatório." em vez
   de seguir sem saber de onde extrair os dados; e confere se pelo menos
   1 item está marcado — sem isso, mostra "Marque ao menos um item do
   relatório antes de exportar.".
4. **"Exportar Relatório para Correição (PDF)"** gera, filtrado pela unidade
   escolhida e pelos itens marcados, um único PDF com as seções abaixo
   **nesta ordem** (mesma ordem dos checkboxes "Itens a incluir no PDF"):
   - Nome da unidade e data/hora da extração.
   - **Relação de processos ativos**: o próprio Relatório Geral filtrado
     pela unidade e por **todos os macro grupos do filtro "Situação"
     EXCETO BAIXADO e SUSPENSÃO** (e os respectivos subitens) — em vez de
     deixar o campo em branco, o que contava também suspensos/sobrestados
     e baixados como "ativos". Sai em **página retrato** própria, com só
     os campos **Nº do Processo, Data da Autuação, Situação, Classe,
     Último Evento e Data/Hora** (a tabela real do eproc traz mais
     colunas, como Sigilo e Localizador, que ficam de fora aqui) — casados
     pelo texto do cabeçalho, não pela posição, para não depender da ordem
     exata das colunas na tela. Ordenada pela **Data de Autuação, do
     processo mais antigo para o mais novo**. Duas situações com nome
     longo saem abreviadas na coluna Situação: "MOVIMENTO-AGUARDA
     DESPACHO" vira **"Cls. Despacho"** e "MOVIMENTO-AGUARDA SENTENÇA"
     vira **"Cls. Sentença"**. Quando o processo está concluso para
     despacho ou sentença E tem o campo **"Petição Urgente"** marcado no
     eproc, a Situação ganha o sufixo **" (Urgente)"** (ex.: "Cls.
     Despacho (Urgente)") — como esse dado não vem como coluna na tabela
     de processos em si (só é possível filtrar por ele), a extensão faz
     **2 consultas a mais** (uma para despacho, outra para sentença,
     ambas em paralelo), filtrando por "Petição Urgente = Sim", só para
     descobrir quais números de processo tem o campo marcado. Cada valor
     distinto de Situação ganha sua
     própria **cor de texto**, sempre a mesma para o mesmo valor ao longo
     do PDF — como a tabela é ordenada por Data de Autuação (não por
     Situação), a cor ajuda a identificar rapidamente processos na mesma
     situação mesmo espalhados entre linhas não adjacentes.

     Ao final dessa relação (mesmo PDF, páginas extras), entram mais duas
     seções, montadas com os mesmos dados já extraídos (sem nenhuma
     consulta a mais):
     - Um **gráfico de barras** com a distribuição por classe processual:
       as **15 classes mais frequentes**, cada uma com a fração percentual
       sobre o total de processos ativos da unidade, e as demais
       agrupadas em **"Outros"** (quando houver mais de 15 classes
       distintas). O nome da classe é **uniformizado em maiúsculas** antes
       de agrupar — sem isso, a mesma classe grafada de forma diferente
       entre processos (ex.: "Procedimento Comum Cível" e "PROCEDIMENTO
       COMUM CÍVEL") virava duas fatias separadas no gráfico em vez de uma
       só.
     - Os **15 maiores demandantes** (polo ativo) e os **15 maiores
       demandados** (polo passivo), com o número de processos ativos em
       que cada parte aparece — lidos das colunas **Autor** e **Réu** da
       mesma tabela do Relatório Geral. Quando um processo tem mais de uma
       parte no mesmo polo (litisconsórcio), cada nome vem no seu próprio
       `<span class="d-block">` dentro da célula (sem espaço nem
       pontuação entre eles) — a extensão separa cada nome individualmente
       antes de contar, em vez de somar tudo como se fosse um nome só.
   - **Suspensos/sobrestados**: há mais de 90 dias (grupo inteiro do
     filtro "Situação" — os values de `#selStatusProcesso` seguem o
     formato `status;codigo;grupo`; o grupo SUSPENSÃO é o sufixo `;S`) e
     um **detalhamento por situação específica**: cada uma das ~40
     opções do grupo é consultada individualmente, mas só entram no
     relatório as que têm pelo menos 1 processo (ex.: "SUSPENSAO: 12",
     "SOBRESTADO CONVÊNIO: 3") — as dezenas de variantes zeradas ficam de
     fora, para não poluir o relatório. O **Total** vem por último,
     depois de todos os processos individuais listados acima, com a
     contagem de **processos há mais de 90 dias entre parênteses** (ex.:
     "Total 21 (5 há mais de 90 dias)") — em vez de uma linha
     própria para esse recorte, já que é só um subconjunto do próprio
     Total, não um número independente. O parêntese só aparece quando o
     Total é maior que 0 (com Total 0 não há nada a detalhar) e mostra
     **"nenhum"** em vez de "0" quando não há nenhum processo com mais de
     90 dias (ex.: "Total 10 (nenhum há mais de 90 dias)") —
     mesma regra usada em Conclusos para decisão/sentença, abaixo. Além do
     total, o relatório também traz a **relação de processos**, em
     **página retrato**, com só os campos **Nº do Processo, Data da
     Autuação, Situação, Localizador e Data/Hora** (a tabela real do eproc
     traz mais colunas, como Sigilo e Classe, que ficam de fora aqui) —
     casados pelo texto do cabeçalho, igual à relação de processos ativos
     (mesmo filtro contra a linha "vazia" do DataTables quando não há
     nenhum processo — ver nota na seção de Remessas aos juízes leigos
     abaixo, que teve o mesmo problema). Quando o processo tem **mais de
     um Localizador**, cada um entra numa **linha própria** dentro da
     célula (em vez de ficar tudo colado numa linha só). A própria
     célula do eproc traz, colado antes de cada nome, um **ícone**
     (glifo de uma fonte de ícones, fora da faixa de caracteres que o PDF
     consegue desenhar) sem nenhum separador de texto entre um
     Localizador e outro — a extensão trata qualquer trecho fora dessa
     faixa como o limite entre um Localizador e o próximo (a mesma regra
     também aceita o delimitador `" | "` de "textoCelula", usado em
     outras colunas com múltiplos valores), então esses ícones **não
     aparecem** no PDF - nem como um caractere solto, nem grudados no
     nome do Localizador seguinte. Valores exatamente **"?"** (localizador
     expirado/inconsistente do próprio eproc) também são descartados por
     completo, em vez de aparecerem como um "?" solto sem significado.
     Esse
     detalhamento por situação é a parte mais demorada do relatório (uma
     consulta por situação), então roda **em paralelo**: a lista de ~40
     situações do grupo é dividida em **9 blocos** (o máximo de abas
     ocultas simultâneas permitido, ver "Limite de abas ocultas
     simultâneas" abaixo) e cada bloco é consultado numa **aba oculta
     própria, simultaneamente** às demais (em vez de uma única aba
     consultando as ~40 situações uma de cada vez). Dentro de cada bloco,
     cada situação espera o evento **`draw.dt`** do próprio DataTable da
     tela (o mesmo mecanismo já usado para esperar a tabela de processos
     terminar de carregar) em vez de comparar o texto da contagem antes/
     depois com um intervalo fixo de espera — como a maioria das ~40
     situações costuma ter 0 processos, duas consultas seguidas com
     contagem igual ("0") faziam esse método antigo esperar até 2s
     "achando" que a consulta ainda não tinha terminado, mesmo já tendo
     concluído há muito tempo; o `draw.dt` elimina essa espera
     desnecessária e deixa o detalhamento sensivelmente mais rápido no
     caso comum. Cada bloco tem um
     orçamento interno de 60s (verificado ENTRE uma situação e outra,
     preservando o que já foi apurado até ali) e um timeout externo de
     75s como rede de segurança; se algum bloco não terminar a tempo (ou
     falhar por qualquer motivo), o relatório sai com o que os demais
     blocos conseguiram apurar e um aviso discreto do tipo "Consulta em
     paralelo (9 bloco(s) simultâneos) não concluiu a tempo - N de 40
     situação(ões) não consultada(s)." — o **Total geral de suspensos**
     (que vem de uma consulta separada, à parte) nunca é afetado por
     esse limite, só o detalhamento por situação específica fica
     incompleto.
   - Conclusos para decisão e para sentença: Urgentes, Não urgentes
     (calculado como Total − Urgentes, sem precisar de uma consulta a
     mais) e, **por último, o Total**, com a contagem de **processos há
     mais de 90 dias entre parênteses** (ex.: "Total 10 (3 há mais de 90
     dias)") — mesmo formato usado em Suspensos/Sobrestados, também sem
     uma linha própria para esse recorte, sem o parêntese quando o Total é
     0 e escrevendo **"nenhum"** em vez de "0" quando não há nenhum
     processo com mais de 90 dias. As 3 sub-consultas de cada
     bloco (total/urgentes/atraso), e os dois blocos (decisão e sentença)
     entre si, rodam **em paralelo**.
   - Processos sem movimentação há mais de 30, 90 e 120 dias — as 3
     faixas também consultadas **em paralelo**.
   - **Processos paralisados**: relação **completa** dos processos parados
     **a partir de 31 dias** sem movimentação (mesmo campo "Dias sem
     movimentação" usado no demonstrativo acima, só que numa única
     consulta com o piso em 31, em vez de repetir para 30/90/120) — ao
     contrário do item anterior (só a contagem), aqui a extensão lê a
     **relação de processos** de verdade, numa única tabela (sem separar
     por faixa de dias), em **página retrato**, com os campos **Nº do
     Processo, Situação, Classe, Localizador, Último Evento, Data/Hora e
     Dias** (a tabela real do eproc traz mais colunas, como Sigilo e Data
     da Autuação, que ficam de fora aqui) — casados pelo texto do
     cabeçalho, igual às demais relações deste relatório. A última coluna
     ("Dias") é calculada pela própria extensão (não vem da tabela
     original): a diferença, em dias corridos, entre o momento da geração
     do relatório e a Data/Hora do último evento — quando essa data não é
     reconhecida por algum motivo, a coluna fica em branco em vez de
     mostrar um número sem sentido. Localizadores seguem a
     mesma técnica de quebra de linha das demais tabelas (um por linha,
     "?" descartado), mas aqui, quando há **mais de um**, cada linha
     também ganha um **marcador "- "** na frente (diferente da relação de
     suspensos, que não usa marcador nenhum) — pedido específico desta
     seção. Ordenados do processo **mais paralisado para o menos
     paralisado**: como "paralisado" significa "sem nenhuma movimentação
     há muito tempo", isso é o mesmo que ordenar pela **Data/Hora do
     último evento, da mais antiga para a mais recente** (quanto mais
     antiga essa data, mais tempo o processo está parado).
   - **Remessas aos juízes leigos**: extraída da tela própria do menu
     lateral "Relatórios → Relatório de remessas em aberto"
     (`acao=relatorio_remessas_em_aberto/listar`), preenchendo o filtro
     "Órgão Julgador" (`#IdOrgaoSecretaria`) com a mesma unidade
     escolhida. Sai em **página retrato** (diferente das demais tabelas
     deste relatório, que usam página virada), com o **total geral** no
     topo e, em seguida, um bloco por juiz leigo (subtítulo com nome e
     total daquele juiz) seguido da tabela com Nome do Juiz Leigo, Número
     do Processo, Classe Processual, Data Remessa e Dias da Remessa de
     cada processo dele, ordenada do **mais antigo para o mais novo**
     (maior quantidade de dias em remessa primeiro). Processos com
     **prioridade legal** (idoso, doença grave etc. — identificados pelo
     `<label>` extra que o eproc inclui na célula de Classe Processual
     desses processos) aparecem com o **número do processo em vermelho**
     e o motivo da prioridade **entre parênteses** logo depois (ex.:
     "0000001-11.2024.8.16.0001 (Idoso)"), com uma legenda no topo da
     página explicando a cor sempre que houver ao menos um caso. Quando a
     consulta não encontra nenhum processo em remessa, o DataTables da
     tela desenha uma linha "vazia" (célula única com o texto "Nenhum
     registro encontrado") em vez de simplesmente não ter linha nenhuma no
     resultado — essa linha é descartada da extração (não é um processo de
     verdade), evitando a contradição de mostrar ao mesmo tempo "Nenhum
     registro encontrado" e "Total: 1 processo(s)".
   - O **nome de cada Localizador** da unidade, em ordem alfabética, em
     páginas próprias no **final do PDF**, depois de todas as demais
     seções — valores exatamente **"?"** (localizador expirado/
     inconsistente do próprio eproc) são descartados da lista, em vez de
     aparecerem como um "?" solto sem significado. Logo abaixo do título
     dessa seção, um **subtítulo discreto**
     (fonte pequena, sem destaque) avisa que a lista traz só os nomes —
     por enquanto, a única forma de obter o total de processos de cada
     localizador é se habilitar na própria unidade e usar a ferramenta
     "Localizadores do Órgão" do painel. Essa observação fica junto da
     seção que ela explica (não mais misturada com os "Avisos" gerais no
     início do relatório).

   **Limite de abas ocultas simultâneas**: todo o Relatório para Correição
   (e as demais rotinas desta extensão que abrem abas ocultas - Localizadores
   do Órgão, Busca específica de localizadores, Regras de Automação etc.)
   compartilha um **semáforo global** que nunca deixa mais de **9 abas
   ocultas** abertas ao mesmo tempo - o excesso espera na fila, na ordem
   de chegada, e ganha um "lugar" assim que uma aba anterior termina e
   fecha. Esse limite existe para não sobrecarregar o navegador nem fazer
   o próprio eproc atrasar/bloquear por excesso de requisições simultâneas
   da mesma sessão. Graças a esse limite compartilhado, várias partes do
   relatório (ex.: conclusos para decisão e para sentença, cada uma com
   suas 3 sub-consultas, mais as 3 faixas de sem movimentação) podem
   disparar suas consultas **todas ao mesmo tempo** sem risco de abrir
   dezenas de abas de uma vez - o semáforo escalona automaticamente.

   As "relações de processos" (ativos e suspensos) usam a API do
   DataTables só para **mostrar tudo de uma vez** (sem paginação) na
   tabela de resultado do Relatório Geral (`#tblProcessoLista`) antes de
   ler; a leitura em si é feita direto nas células `<td>` já renderizadas
   (na mesma ordem visual dos cabeçalhos), colunas limitadas às 8
   primeiras. A relação de remessas aos juízes leigos usa a mesma técnica,
   direto na tabela `#tbl_remessas_em_aberto` dessa tela. Ler da API
   `rows().data()` (usada em versões anteriores) devolvia o objeto de
   dados BRUTO de cada linha, cujas chaves nem sempre seguem a mesma
   ordem das colunas visíveis — causava desalinhamento entre cabeçalho e
   valor (ex.: coluna "Situação" saindo vazia com o conteúdo de outra
   coluna aparecendo no lugar errado); ler as células já renderizadas
   evita esse problema por completo. Essas leituras (e o "mostrar tudo")
   rodam no **MAIN world** da página (`chrome.scripting.executeScript`
   com `world: "MAIN"`) — o `jQuery`/`DataTable` da própria página só
   existe nesse contexto; injetar no mundo isolado padrão (usado nas
   demais funções, que só mexem no DOM) faria a extensão nunca enxergar
   esse `jQuery`, mesmo com a tabela funcionando normalmente na tela. Se a
   extração falhar por qualquer motivo, um aviso aparece na capa e a
   seção simplesmente não entra no PDF, sem interromper o resto do
   relatório.

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
   único arquivo `Relatório_<unidade>.pdf` em `Downloads/eproc/`, em vez
   de arquivos separados.

   O PDF segue uma identidade visual sóbria e institucional, com o
   cabeçalho **"TRIBUNAL DE JUSTIÇA DO ESTADO DO PARANÁ · Sistema eProc"**
   repetido no topo de cada página, capa com os números organizados em
   seções coloridas (rótulo/valor, uma por bloco, na ordem acima) e rodapé
   só com a **paginação** ("Página X de Y", centralizada) — sem nenhum
   outro texto. Títulos longos (ex.: nome de unidade extenso) quebram em
   mais de uma linha em vez de ultrapassar a margem da página. A lista de
   Localizadores **não** vira uma tabela em página
   virada (paisagem) — os nomes entram **um por linha** (com um marcador
   "-" e recuo pendurado para nomes longos que precisem quebrar em mais
   de uma linha) em página(s) retrato próprias, no final do PDF — bem
   mais fácil de escanear visualmente do que um parágrafo corrido com
   todos os nomes separados por vírgula. As relações de **processos
   ativos** e de **suspensos/sobrestados** usam página **retrato**, com
   colunas curadas (casadas pelo texto do cabeçalho, não pela posição, e
   por isso imunes a mudanças na ordem das colunas reais da tela). Já a
   relação de remessas aos juízes leigos usa página **retrato**, agrupada
   por juiz leigo (ver acima), com destaque em vermelho para prioridades
   legais. Título, cabeçalho e zebrado seguem a mesma identidade visual em
   todas as tabelas. Essa mesma identidade visual também vale para os
   PDFs de Localizadores/Processos por Localizador exportados fora do
   painel da Corregedoria, já que reaproveitam o mesmo gerador de
   tabela.

   **Regras de Automação**: a mesma relação de regras ativas do cartão
   "Regras de Automação" (fluxograma + detalhamento, ver seção própria
   abaixo), entra **antes** de Localizadores. Essa seção vem da tela
   "Automatizar Tramitação Processual", que tem um seletor **próprio**
   (`#selOrgao`, diferente do "Órgão/Juízo" do Relatório Geral, inclusive
   com um espaço de valores diferente entre as duas telas) — **só
   aparece para o perfil CORREGEDORIA** (que enxerga todas as unidades);
   para quem está logado direto numa unidade, esse filtro nem existe na
   tela. Quando uma unidade foi escolhida no dropdown da Corregedoria, a
   extensão seleciona a unidade correspondente nesse filtro (casando pelo
   **texto** do nome, já que os `value` das duas telas não são
   compatíveis) e clica em "Pesquisar" antes de ler a tabela — sem isso,
   a tela simplesmente **não lista regra nenhuma**, mesmo havendo regras
   cadastradas. Cada `<option>` desse filtro traz o nome da unidade
   seguido de " - `<código/sigla>` (`<contagem>`)" (ex.: "Juizado Especial
   Cível e Juizado Especial da Fazenda Pública de Astorga - AST1JE (1)"),
   nem sempre com a mesma quantidade de espaços antes do hífen — a
   extensão extrai só o nome (removendo a contagem entre parênteses e
   tudo a partir do ÚLTIMO " - ") e compara nome com nome, em vez de casar
   o texto inteiro da opção contra o nome da unidade; comparar o texto
   inteiro fazia a seleção falhar sempre que aparecia esse espaçamento
   extra, mesmo com o nome da unidade correto.
   cadastradas (esse filtro é obrigatório na tela, mas a extensão não o
   preenchia antes; essa era a causa real de "regras de automação
   retornando zero" para o perfil Corregedoria).

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

## Gestão da Unidade

Cartão para quem já está logado **diretamente numa unidade** (em vez do
perfil CORREGEDORIA, que enxerga todas as unidades e por isso precisa
escolher uma no cartão "Corregedoria" — ver acima). Reaproveita **quase
inteiramente** o mesmo Relatório para Correição do cartão Corregedoria
(mesmas seções, mesmas consultas, mesmo gerador de PDF:
`exportarRelatorioGerencialUnidade`), com algumas diferenças de conteúdo
cobertas abaixo.

- **Não exige nenhuma unidade selecionada** — não há dropdown de
  Comarca/Juízo neste cartão. Basta marcar os itens desejados em "Itens a
  incluir no PDF" e clicar em **"Exportar Relatório da Unidade (PDF)"**.
- **"Como consolidar os dados"** (dois botões de opção, mutuamente
  exclusivos, acima de "Itens a incluir no PDF"):
  - **Unidade integral** (padrão): cada seção do relatório mostra so' o
    número total da unidade, exatamente como sempre funcionou.
  - **Separação por competência**: as seções **Relação de processos
    ativos, Suspensos/sobrestados, Conclusos para decisão, Conclusos
    para sentença, Processos sem movimentação e Processos paralisados**
    passam a trazer, além do total da unidade, um **subtotal por
    competência** no resumo (capa) — e as três seções com relação de
    processos (ativos, suspensos, paralisados) ganham uma **subseção
    com tabela própria por competência** (em vez de uma tabela única
    combinada), da competência com mais processos para a com menos. A
    "Competência" vem do filtro `select#selCompetencia` do Relatório
    Geral, cujas opções seguem o formato "`<Competência>` - `<Detalhe>`"
    (ex.: "Juizado Especial Cível - Consórcio"); a extensão agrupa tudo
    que vem **antes do primeiro "-"**, ignorando o que vem depois — ou
    seja, várias opções (ex.: "... - Consórcio", "... - Planos de
    Saúde") caem no mesmo grupo "Juizado Especial Cível". Como isso
    exige uma rodada extra de consultas (uma por grupo de competência,
    para cada uma das 6 seções), a geração do PDF demora bastante mais
    nesse modo — o painel avisa isso ao lado da opção. Se a tela não
    tiver o campo "Competência" disponível, o relatório é interrompido
    com um erro claro em vez de seguir sem os dados por competência.
- Cada consulta interna (processos ativos, suspensos, conclusos, sem
  movimentação, processos paralisados, remessas aos juízes leigos) recebe um
  valor de unidade **nulo** em vez do valor escolhido num dropdown — isso faz
  a extensão **pular** a etapa de selecionar um Órgão/Juízo (ou um Órgão
  Julgador, no caso das remessas) em cada tela e simplesmente usar o filtro
  que a própria tela do eproc **já aplica sozinha** para o perfil logado.
  Regras de Automação nunca dependeu de unidade selecionada (sempre reflete
  a unidade habilitada no momento), então não muda nada nessa seção.
- O **título da capa** é **"Relatório da Unidade"** (em vez de "Relatório
  para Correição") e sai **centralizado horizontalmente** na página — a
  mesma capa (`construirCapaRelatorioGerencial`) aceita um título
  customizável, sempre centralizado, com "Relatório para Correição" como
  padrão para não mudar nada no relatório da Corregedoria.
- A seção de **Localizadores** também muda: em vez do campo "Localizador" do
  Relatório Geral (que só traz o nome, sem total de processos — ver a seção
  equivalente do Relatório para Correição, acima), este cartão reaproveita a
  mesma coleta multi-página da tela **"Localizadores do Órgão"** (só
  possível aqui porque, sem unidade escolhida, a unidade é sempre a
  habilitada no momento). Isso traz o **total de processos de cada
  localizador**, algo que o relatório da Corregedoria não consegue oferecer.
  A lista mostra **todos os localizadores da unidade, inclusive os com 0
  processos** (diferente da "Busca específica de localizadores", que só
  lista os com pelo menos 1 — ali o interesse é "para onde navegar"; aqui é
  o panorama completo), ordenados do **maior para o menor total de
  processos**. Cada linha vira "Nome — N processo(s)" em vez de só o nome.
- Item **exclusivo** deste cartão (não existe no relatório da
  Corregedoria): **Mandados em aberto**, logo **após "Processos sem
  movimentação"** na capa e nas tabelas anexas. Extraído da tela
  **"Relatório de Mandados Distribuídos"** (menu lateral,
  `acao=mandados/relatorio_secretaria/consultar`), marcando **todas** as
  opções do filtro "Situação do mandado" (`#selStatusMandado`, um
  bootstrap-select de múltipla seleção) **exceto "Devolvido"** — ou seja,
  tudo que ainda não foi devolvido: "Aguardando cumprimento", "Aguardando
  distribuição", "Aguardando redistribuição" e "Não Remetido". Quando a
  situação vem como **"Aguardando cumprimento - `<NOME DO OFICIAL>`"**
  (formato usado pelo eproc assim que um oficial de justiça é designado), a
  extensão separa esse nome numa coluna própria **Responsável**, deixando a
  Situação só com "Aguardando cumprimento" — mandados ainda sem oficial
  designado mantêm a coluna Responsável em branco. A relação discriminada
  sai em **página retrato**, com os campos **Número do Processo, Tipo de
  Ato** (coluna real da tela: "Atos"), **Data da Remessa** (coluna real:
  "Data Remessa" — casada por "remessa" no cabeçalho, para não confundir
  com a coluna vizinha "Data Juntada"), **Situação** e **Responsável**,
  ordenada pela Data da Remessa do mandado parado há **mais tempo para o
  mais recente**. Na capa, o resumo traz duas seções: **"MANDADOS EM
  ABERTO"**, com a contagem por Situação (da mais frequente para a menos
  frequente, Total por último), e **"MANDADOS POR CUMPRIDOR"**, com a
  contagem de mandados aguardando cumprimento por Responsável (também da
  mais frequente para a menos frequente; só aparece quando algum mandado
  já tem oficial designado). Não precisa de nenhuma seleção de unidade (a
  tela já reflete a unidade habilitada, mesma lógica das demais seções
  deste cartão).
- O nome usado na capa/título do PDF (o texto "Unidade: `<nome>`", diferente
  do título "Relatório da Unidade" acima) vem do próprio seletor de perfil
  do eproc (`#selInfraUnidades`, cabeçalho superior) — não a sigla exibida
  nesse seletor (ex.: "TOMUN/CHEFE DE SECRETARIA"), e sim o **nome por
  extenso da unidade** (ex.: "Vara Única da Comarca de Tomazina"), lido do
  atributo `title` do `<option>` selecionado (que traz o nome completo
  seguido da sigla, ex.: `title="Vara Única da Comarca de Tomazina -
  TOMUN/CHEFE DE SECRETARIA"` — a extensão remove o sufixo " - `<sigla>`"
  usando a própria sigla já lida, então funciona mesmo se o nome da
  unidade tiver um "-" no meio). Se não for possível ler nem o nome nem a
  sigla por qualquer motivo, cai num rótulo genérico ("Unidade atual") em
  vez de travar o relatório inteiro por causa só do nome.

## Regras de Automação

Na tela **"Automatizar Tramitação Processual"** do eproc
(`acao=automatizar_localizadores`), cada regra listada na tabela pode estar
**ativa** ou **desativada** (indicado pelo interruptor "Ativa"/"**
DESATIVADA **" ao lado de cada linha). Essa tabela é difícil de ler de
relance: as colunas são estreitas e cada regra mistura critério, ação e
outros filtros num texto corrido.

Marcando o item **"Regras de automação"** em "Itens a incluir no PDF" (no
cartão "Corregedoria" ou "Gestão da Unidade"), a extensão inclui no
Relatório para Correição/Relatório da Unidade um bloco com as regras
ativas dessa tela, sem precisar estar (nem navegar manualmente) na tela
"Automatizar Tramitação Processual":

1. A extensão abre uma aba oculta a partir da URL da aba atual e clica no
   link "Automatizar Localizadores do Órgão" do menu lateral (menu
   "Localizadores" → "Automatizar Localizadores do Órgão"), do mesmo jeito
   já usado para "Localizadores do Órgão"/"Relatório Geral".
2. Lê a tabela dessa aba oculta e filtra **apenas as regras ativas**
   (ignora as marcadas como "** DESATIVADA **"). A tabela pode terminar
   de montar um pouco depois da própria aba "carregar" (ex.: alguma
   inicialização em segundo plano) — se a primeira leitura não encontrar
   nenhuma linha, a extensão **tenta de novo** (até 4 vezes, com um
   pequeno intervalo entre cada) antes de desistir, em vez de já
   reportar "nenhuma regra encontrada" numa leitura que só foi rápida
   demais. Se, mesmo assim, a tela realmente não tiver nenhuma regra
   cadastrada para a unidade atual, ou se houver regras na tela mas
   **nenhuma** com o interruptor "Ativa" ligado, a mensagem de erro
   distingue os dois casos (em vez de um "nenhuma regra ativa
   encontrada" genérico nas duas situações).

   > **Perfil CORREGEDORIA**: essa tela tem um filtro obrigatório
   > "ÓRGÃO" (`#selOrgao`) que só aparece para esse perfil — sem
   > selecionar uma unidade nele e clicar em "Pesquisar", a tabela nunca
   > lista regra nenhuma, mesmo havendo regras cadastradas. No cartão
   > "Corregedoria", esse filtro é preenchido automaticamente com a
   > unidade escolhida no dropdown (ver seção "Corregedoria" acima). O
   > cartão "Gestão da Unidade" não precisa desse filtro — ele é exclusivo
   > de quem já está logado numa unidade, não do perfil CORREGEDORIA.
3. Ordena as regras: se **alguma** regra ativa tiver uma prioridade
   numérica definida (ex.: "Executar 1º"), o relatório segue essa ordem de
   execução; regras sem prioridade não entram nessa comparação. Quando
   **nenhuma** regra ativa tem prioridade definida, a ordem cai para o
   número da regra. Regras sem prioridade aparecem como
   "[Sem prioridade definida]" em vez do rótulo "[ Prioridade ]" da
   própria página, que é mais confuso fora de contexto.
4. Gera o PDF, com um "cartão" por regra ativa. Cada cartão traz, no topo,
   um **fluxograma numerado em sequência vertical** (1 Localizador Origem
   → 2 Critério → 3 Destino → 4 Ação automatizada, quando houver) para
   entender de relance o que aquela regra faz — cada passo numa caixa
   colorida própria, empilhada de cima para baixo com uma seta entre
   elas, todas com o número bem visível (branco sobre o fundo colorido do
   círculo). Esse layout vertical substitui a versão anterior (caixas
   numa linha horizontal com quebra automática): com textos de tamanhos
   bem diferentes entre as regras, a quebra de linha da versão horizontal
   ficava imprevisível e as setas pareciam soltas; empilhado e numerado, a
   ordem de execução fica clara não importa o tamanho de cada texto. O
   **Localizador de Erro** (quando a regra tiver um) não entra mais nesse
   fluxograma como uma caixa gráfica à parte — só no detalhamento em
   texto logo abaixo (ver adiante).

   Quando a regra aceita **mais de um critério** (ligados por "OU" na
   página original), a caixa "Critério" lista **todos eles**, um por
   linha com um traço fino entre si — em vez de mostrar só o primeiro com
   um badge "+N alternativa(s)" escondendo quais são os demais.

   A caixa "Ação automatizada" mostra cada informação (ação programada,
   evento, texto etc.) em **linhas separadas por um traço fino**, em vez
   de tudo colado num único parágrafo.

   Logo abaixo do fluxograma vem o detalhamento completo e legível:
   número/prioridade, grupo, **Localizador Origem**, o critério que
   dispara a regra (Tipo de Controle/Critério), o Localizador Destino/Ação
   (incluindo eventos automatizados programados, quando houver), outros
   critérios (ex.: juízo do processo, localizador adicional), a **Ação
   Automatizada** por extenso e, quando a regra tiver um, o
   **Localizador de Erro** — as duas últimas antes só apareciam no
   fluxograma gráfico; agora também entram no detalhamento em texto, para
   não ficarem omitidas de quem lê só essa parte. O conteúdo detalhado é
   o mesmo da página original (nada é resumido ou omitido ali), só que
   reorganizado em blocos rotulados em vez da tabela apertada.

   Tanto a caixa **"Ação automatizada"** do fluxograma quanto os campos
   **"Localizador Destino / Ação"** e **"Ação Automatizada"** do
   detalhamento levam em conta que a coluna correspondente da tabela
   original pode ter dois blocos sobrepostos quando o conteúdo é longo (um
   truncado, escondido por padrão, e um completo) — o mesmo padrão que a
   coluna "Outros Critérios" já tinha. Sem preferir sempre o bloco
   completo, os detalhes de qual ação exatamente seria executada (evento,
   documento, texto, etc.) podiam sair cortados; e o resumo do fluxograma
   pegava só a linha "Evento: ..." e descartava o resto — agora leva tudo
   a partir do cabeçalho "AUTOMATIZADO"/"Ação Programada" em diante.
5. Fecha a aba oculta e monta esse bloco (fluxograma completo — caixas,
   setas e numeração — e o mesmo detalhamento) dentro do PDF do Relatório
   para Correição/Relatório da Unidade.

Se o link "Automatizar Localizadores do Órgão" não for encontrado na aba
oculta (ex.: o rótulo do menu mudou), a extensão avisa exatamente qual
link procurou — nesse caso, pode ser preciso regravar o script de acesso
para confirmar o caminho atual do menu.

## Localizadores do Órgão (coleta reaproveitada)

A tela **"Localizadores do Órgão"** do eproc (`acao=localizador_orgao_listar`)
lista, por página, cada Localizador com sua Descrição e o Total de
processos. Em vez de um botão de exportação próprio, essa coleta é
reaproveitada por duas funcionalidades do painel: o item **"Localizadores"**
do Relatório da Unidade (ver seção "Gestão da Unidade" acima, que traz o
total de processos de cada um) e a **"Busca específica de localizadores"**
(cartão "Gestão Gabinete", ver abaixo). A coleta em si:

1. Abre uma aba oculta a partir da URL da aba atual e clica no link
   "Localizadores do Órgão" do menu lateral (funciona mesmo com o submenu
   colapsado, já que o link já existe no DOM independente do estado visual
   do menu).
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

A aba oculta usada para navegar e coletar os dados é fechada
automaticamente ao final, sem interferir na aba que você está usando.

## Busca específica de localizadores

A subseção **"Busca específica de localizadores"** (dentro do cartão
**"Gestão Gabinete"**) carrega os Localizadores do Órgão com pelo menos
um processo atribuído e permite ir direto até a lista de processos de um
deles, ou exportar um relatório desses processos - sem precisar abrir a
tela de Localizadores manualmente e procurar a linha certa.

Ao clicar em **"Carregar localizadores"** (o botão **some assim que
clicado** — mesmo padrão do "Carregar unidades" do Relatório para Correição;
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
   saem em `Downloads/eproc/<número do processo>/Exportado -
   <localizador>.pdf` — a mesma pasta por processo usada pelo resto da
   extensão (não uma pasta própria por localizador), com o arquivo
   nomeado pelo localizador escolhido; assim, exportar o mesmo processo
   por localizadores diferentes não sobrescreve nada, cada exportação
   fica em seu próprio arquivo dentro da pasta do processo. Processos sem
   nenhum documento ou com falha ao abrir são pulados e aparecem como
   aviso ao final, sem interromper os demais.

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

## Versionamento

A partir da versão **1.0.0** (`manifest.json`), a extensão segue um
esquema de versão `MAIOR.MENOR.PATCH`:

- **MENOR** (ex.: 1.0.0 → 1.1.0): correções ou pequenos ajustes em
  ferramentas já existentes (bugs de formatação, textos, comportamento).
- **MAIOR** (ex.: 1.1.0 → 2.0.0): inclusão de novas funções/ferramentas no
  painel.
- **PATCH** fica reservado para eventuais correções pontuais dentro de um
  MENOR já lançado, quando fizer sentido diferenciar.

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
- A extensão é restrita aos hosts `eproc1g.tjpr.jus.br` e
  `eproc1g.tre.tjpr.jus.br` (ver `manifest.json`) — não roda em nenhum
  outro domínio.
- Se um download falhar (ex.: link expirado), o erro aparece no painel ao
  final do processo; os demais downloads continuam normalmente.
- Textos extraídos de páginas do eproc às vezes trazem um caractere de
  controle C1 (U+0080-U+009F) no lugar do caractere tipográfico que
  realmente pretendiam representar (mojibake de Windows-1252 não
  convertido direito para UTF-8) — ex.: um travessão vira o controle
  invisível U+0096, que a fonte WinAnsi usada nos PDFs não sabe desenhar
  e lançava o erro "WinAnsi cannot encode ... (0x96)", interrompendo a
  geração do PDF inteiro. `sanitizarTextoPdf` (em `background.js`), usada
  por todo texto desenhado em qualquer PDF da extensão, mapeia esses
  controles para o equivalente ASCII mais próximo antes de desenhar.
- Todas as funcionalidades desta extensão (exportar documentos, PDF
  único, MD único, relatórios, regras de automação) funcionam
  inteiramente offline/local, sem nenhuma chamada de rede além do próprio
  eproc.
