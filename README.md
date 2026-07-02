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
  _indice.json                          (lista com sequencial, evento, nome, tipo e URL de cada documento)
  <numero_do_processo>_completo.pdf     (opcional: todos os documentos combinados em um único PDF)
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
4. Escolha **um** dos dois modos (são alternativos, só um pode estar
   marcado por vez):
   - **Arquivos individuais** (marcada por padrão): um arquivo por
     documento, como já era feito.
   - **PDF único combinado**: um único PDF com todos os documentos do
     processo, na mesma ordem cronológica (petição inicial primeiro).
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

Os dois modos (arquivos individuais / PDF único) são mutuamente
exclusivos por esse motivo, entre outros: a segunda camada dos
documentos "html" (a página com a `div` preenchida via AJAX) parece não
aceitar bem ser acessada duas vezes seguidas para o mesmo documento, o
que causava falhas quando as duas opções rodavam juntas na mesma
execução. Se ainda assim algum documento não puder ser incorporado, a
página de aviso no PDF único inclui o motivo exato da falha (ex.: tempo
esgotado, elemento não encontrado), para facilitar o diagnóstico.

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

Isso dá 6 consultas ao todo. Cada uma delas roda em uma **aba oculta
própria** (criada com `active: false`, sem roubar o foco nem alterar o que
você está vendo), que abre a página, navega até o Relatório Geral,
seleciona a situação e o filtro daquela consulta específica, clica em
"Consultar", lê o resultado e fecha a aba — uma aba nova para cada uma das
6 combinações, nunca reaproveitando a mesma aba para mais de uma consulta.
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

O botão funciona a partir de qualquer página do eproc que tenha o menu
lateral visível (não precisa estar na tela de um processo
especificamente).

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
