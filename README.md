# Extensão Auxiliar eProc

Uma extensão para Chrome/Edge que facilita o dia a dia de quem usa o
**eproc** — hoje funciona no eProc do **TJPR** e do **TRF4**. Ela abre um
painel lateral fixo do lado da janela do navegador, organizado em
**cartões**, um por função: exportar documentos, analisar processos com
IA, transcrever audiências, gerar relatórios da unidade e navegar por
localizadores. Sem menus escondidos, sem precisar decorar atalhos — é só
abrir o painel e clicar no que você precisa.

> Página de apresentação, com prints das principais telas:
> https://rcpleme2.github.io/extensao_eproc/

---

## Instalação

### Pela Chrome Web Store (mais simples)

[Instalar pela Chrome Web Store](https://chromewebstore.google.com/detail/gicnjchohekkcoocondkjplhdmkhciog?utm_source=item-share-cb)

A Google demora alguns dias (às vezes semanas) para aprovar cada
atualização enviada à loja, então a versão publicada ali costuma ficar
um pouco atrasada em relação às novidades mais recentes.

### Modo desenvolvedor (sempre a versão mais atual)

1. Baixe este repositório (botão **"Code" → "Download ZIP"** no GitHub, ou
   `git clone`) e extraia a pasta em algum lugar do seu computador.
2. Abra `chrome://extensions` (ou `edge://extensions` no Edge).
3. Ative o **"Modo de desenvolvedor"** (canto superior direito).
4. Clique em **"Carregar sem compactação"** e selecione a pasta
   `extensao_eproc` que você extraiu.
5. O ícone da extensão (uma balança da justiça branca sobre fundo azul)
   aparece na barra de ferramentas.

Para atualizar depois, baixe a versão nova e repita o passo 4 apontando
para a pasta atualizada (ou clique no ícone de recarregar ↻ no card da
extensão, em `chrome://extensions`, se já tiver substituído os arquivos
na mesma pasta).

---

## Como usar, na prática

1. Faça login no eproc e abra a página do processo que você quer
   trabalhar (a mesma tela onde aparecem a movimentação e os documentos).
2. Clique no ícone da extensão na barra de ferramentas — ou no botão
   laranja **"Extensão eProc" ⚖**, que a extensão adiciona ao lado da
   logo do "Portal jus.br" no cabeçalho do eproc (útil se o ícone da
   barra de ferramentas estiver escondido atrás do ícone de "peça de
   quebra-cabeça", como costuma acontecer em instalações novas do
   navegador).
3. Isso abre o **painel lateral**: ele fica fixo ao lado da janela,
   continua aberto mesmo trocando de aba ou de página, até você fechá-lo
   manualmente.
4. O painel abre com **todos os cartões fechados** — clique no título de
   um cartão para abri-lo. Cada cartão reabre sozinho quando alguma
   operação dele está em andamento, terminou ou deu erro, então você
   nunca perde um resultado escondido atrás de um cartão fechado.
   Sucessos aparecem em **verde**, erros em **vermelho**, e exportações
   mais longas mostram um cronômetro discreto (ex.: "Gerando... (1min
   8s)") para você saber que ainda está rodando.
5. Não gostou da ordem dos cartões? Arraste pela alcinha (⠿) ao lado do
   ícone de cada um para reordenar como preferir — a ordem escolhida
   fica salva e volta a valer da próxima vez que você abrir o painel.

O cartão **"Corregedoria"** só aparece para quem está logado com esse
perfil no eproc; os demais cartões ficam sempre disponíveis, para
qualquer perfil.

---

## O que a extensão já ajusta sozinha na página do processo

Sem precisar clicar em nada, assim que você abre a página de um
processo:

- **Nomes em vez de siglas na movimentação**: o eproc mostra só a sigla
  de quem praticou cada ato (ex.: `S287431`). A extensão troca isso pelo
  nome completo da pessoa e o cargo, direto na tabela de movimentação.
- **Magistrado nos eventos "Conclusos"**: eventos como "Conclusos para
  decisão/despacho" passam a mostrar também o nome do magistrado
  responsável, entre parênteses, sem precisar passar o mouse em cima
  para ver o tooltip.

Os dois ajustes podem ser desligados a qualquer momento nas
**Configurações** do painel (veja mais abaixo), caso prefira a tela
original do eproc.

---

## Funcionalidades

### 📄 Exportar Documentos

Baixa todos os documentos de um processo de uma vez, em vez de clicar
em cada link individualmente.

1. Abra a página do processo e clique em **"Detectar documentos"** — a
   extensão lista quantos encontrou e destaca cada um deles em amarelo
   direto na página, para você conferir.
2. Marque quais documentos entram na exportação (dá para desmarcar tanto
   na lista do painel quanto direto na página — os dois lados ficam
   sincronizados) e se a movimentação processual deve entrar também.
3. Escolha um dos três formatos de saída:
   - **Arquivos individuais** — um arquivo por documento, cada um com
     seu nome original.
   - **PDF único combinado** — todos os documentos do processo reunidos
     num único PDF, organizados por evento da movimentação, na ordem
     cronológica.
   - **MD único (texto e anonimizado)** — um único arquivo de texto com
     a movimentação e o conteúdo de cada documento, com dados sensíveis
     (CPF, CNPJ, telefone, e-mail, endereços, nomes) removidos ou
     abreviados automaticamente. É a única opção disponível quando o
     processo não tem nenhum documento anexado.
4. Clique em **"Baixar"** e acompanhe o progresso no painel. Os arquivos
   ficam salvos em `Downloads/eproc/<número do processo>/`.

A anonimização do modo MD é de **melhor esforço** — sempre revise o
resultado antes de compartilhar algo sensível.

### 🤖 Analisar com IA

Gera análises e relatórios do conteúdo de um processo usando
inteligência artificial (Claude, Gemini ou ChatGPT — você escolhe qual).

**Uso rápido (análise imediata):**

1. Detecte os documentos do processo (mesmo botão de "Exportar
   Documentos" — os dois cartões compartilham a mesma seleção) e marque
   quais entram na análise.
2. Escolha um **prompt** — o que a IA deve fazer com o conteúdo. A
   extensão já vem com um prompt padrão pronto para análise inicial em
   processos de família, mas você pode cadastrar, editar ou excluir
   quantos prompts quiser em **"Gerenciar prompts de análise"**, nas
   Configurações. Também dá para digitar um prompt avulso na hora, sem
   precisar cadastrar nada.
3. Clique em **"Analisar agora"**. Antes de gastar qualquer coisa, a
   extensão mostra uma **pré-visualização editável** de tudo o que seria
   enviado (documentos + movimentação, já anonimizado se você marcar
   essa opção) junto com uma estimativa de custo — revise, edite se
   quiser, e só então clique em **"Confirmar e enviar"**.
4. A resposta aparece no painel com um botão para copiar.

**Processando vários processos de uma vez (fila em lote):** para quando
você não precisa da resposta na hora e quer economizar — o mesmo pedido
sai por metade do preço. Adicione quantos processos quiser à fila (indo
de processo em processo e clicando em "Adicionar à fila em lote"), dê um
nome à fila se quiser se organizar melhor, e clique em **"Enviar lote"**
quando terminar de montá-la. O resultado de cada processo aparece
separado, identificado pelo número, assim que fica pronto (a extensão
confere sozinha, mesmo com o painel fechado). Esse recurso funciona
apenas com o provedor Claude/Anthropic.

**Lote por localizador:** roda o mesmo prompt em **todos os processos de
um localizador**, de uma vez, sem precisar abrir cada um manualmente.
Escolha o localizador, filtre por tipo de documento (ex.: só petições
iniciais) e clique em "Adicionar processos filtrados à fila em lote" —
os processos entram na mesma fila acima, prontos para enviar.

Configure sua chave de API e o modelo de cada provedor nas
**Configurações** do painel — veja a seção própria mais abaixo.

### 🎙️ Transcrever Depoimentos

Transcreve os vídeos de audiência de um processo usando IA.

1. Clique em **"Detectar vídeos"** — a extensão localiza os vídeos de
   audiência do processo e mostra cada um como checkbox.
2. Marque quais vídeos entram na transcrição (selecionar mais de um
   transcreve todos juntos, numa única resposta).
3. Clique em **"Transcrever selecionado(s)"**. A transcrição vem com
   timestamps, tentativa de identificar quem fala e marcação de trechos
   inaudíveis.
4. O resultado aparece numa caixa de texto no painel, com botão de
   copiar — não é baixado como arquivo automaticamente.

Você pode escolher entre dois provedores nas Configurações:

- **Gemini** — recebe o vídeo inteiro e identifica quem fala pelo
  próprio áudio, sem limite prático de tamanho de arquivo.
- **ChatGPT/Whisper** — funciona só com áudios de até 25 MB; identifica
  quem fala com menos precisão, já que trabalha só com o texto
  transcrito, não com o áudio em si.

Diferente dos documentos de texto, o áudio da audiência **não passa por
anonimização** antes de ser enviado — avalie com cuidado antes de
transcrever gravações sob segredo de justiça.

### 🏛️ Corregedoria — Relatório para Correição

Exclusivo de quem está logado com o perfil **CORREGEDORIA**. Gera um
relatório completo em PDF de qualquer unidade do tribunal, sem precisar
estar logado nela.

1. Clique em **"Carregar unidades"**.
2. Escolha a **comarca** e depois o **juízo/vara** desejado, nos dois
   menus que aparecem em sequência.
3. Marque quais itens entram no relatório (todos vêm marcados por
   padrão — use "Marcar tudo"/"Desmarcar tudo" para agilizar) e clique
   em **"Exportar Relatório para Correição (PDF)"**.

O PDF traz, entre outras informações: processos ativos (com gráficos de
distribuição por classe e ranking de partes), processos suspensos,
conclusos para decisão/sentença, processos sem movimentação, processos
paralisados, remessas aos juízes leigos, audiências marcadas, regras de
automação (com a análise de conflitos entre elas) e a lista de
localizadores da unidade. Cada seção do resumo (na capa) tem um link
clicável que leva direto à tabela detalhada correspondente, no final do
PDF. Marcando **"Apenas resumos"**, o relatório sai bem mais enxuto — só
com os números de cada seção, sem as tabelas linha a linha.

### 🏢 Relatório da Unidade

A mesma ideia do relatório acima, só que para quem já está logado
**diretamente numa unidade** (perfil Magistrado ou Gestão da Unidade) —
não precisa escolher nada, o relatório já sai da sua própria unidade.

1. Marque os itens desejados em "Itens a incluir no PDF".
2. Escolha entre **"Unidade integral"** (um número só por seção) ou
   **"Separação por competência"** (cada seção também detalhada por
   competência — demora mais para gerar).
3. Clique em **"Exportar Relatório da Unidade (PDF)"**.

Além de tudo que o Relatório para Correição já traz, este cartão inclui
dois itens exclusivos:

- **Mandados em aberto** — todos os mandados ainda não devolvidos, com
  um resumo por situação e outro por servidor responsável (mostrando há
  quanto tempo o mandado mais antigo está em posse de cada um).
- **Agenda Padrão de Audiência** e **Relatório de Audiências Novo** —
  capacidade da pauta da unidade e o panorama de audiências individuais
  dos últimos/próximos 3 anos, separadas por magistrado, conciliador e
  juiz leigo.

**Análise de Automações (ATP)**: um item próprio (marcável junto com ou
independentemente de "Regras de automação") que compara as regras de
"Automatizar Tramitação Processual" da unidade **entre si** e aponta
possíveis erros de configuração — regras duplicadas, uma regra "roubando"
processos de outra antes da hora, regras com critérios logicamente
impossíveis, ou regras que podem entrar em loop. Cada conflito encontrado
vem com uma explicação e uma sugestão de correção, direto no PDF.

### 🔎 Busca de localizadores

Navega e exporta rapidamente os processos de um localizador específico,
sem precisar procurar a linha certa na tela do eproc.

1. Clique em **"Carregar localizadores"**.
2. Escolha um localizador no menu (só aparecem os que têm pelo menos um
   processo).
3. Escolha uma das ações:
   - **"Ir para o relatório"** — leva direto à lista de processos
     daquele localizador.
   - **"Exportar relação de processos deste localizador"** — gera um
     PDF e/ou planilha Excel só com a lista (número, classe e data de
     inclusão de cada processo).
   - **"Exportar na íntegra todos os processos nesse localizador"** —
     baixa todos os documentos de todos os processos daquele
     localizador, um PDF combinado por processo. Pode demorar bastante
     para localizadores com muitos processos.

---

## Configurações

O botão **"Configurações"**, no canto superior direito do painel, abre
um modal com:

- **Ajustes na página do processo**: ligar/desligar a troca de sigla por
  nome na movimentação, o nome do magistrado nos eventos "Conclusos" e a
  separação de Comarca/Juízo no filtro do Relatório Geral.
- **Chaves de API** — para usar "Analisar com IA" e "Transcrever
  Depoimentos", cadastre aqui sua chave de cada provedor que quiser usar
  (Claude/Anthropic, Gemini/Google e/ou ChatGPT/OpenAI) e escolha o
  modelo de cada um. As chaves ficam guardadas só neste navegador e são
  enviadas direto para a API do provedor escolhido — nunca passam por
  nenhum servidor da extensão (que, aliás, não existe).
- **Gerenciar prompts de análise** — cadastre, edite ou exclua os
  prompts usados em "Analisar com IA".

Tudo é salvo automaticamente assim que você marca ou desmarca uma opção
— não tem botão "Salvar" separado.

---

## Segurança e privacidade

- A extensão **não tem servidor próprio** e **não coleta nem armazena
  nenhum dado seu** — tudo roda localmente, no seu navegador, usando a
  sua própria sessão logada no eproc.
- Documentos e textos de processo só saem do seu navegador quando você
  aciona uma função de IA (Analisar com IA ou Transcrever Depoimentos) —
  e, mesmo assim, vão direto para a API do provedor que você escolheu,
  usando a chave que você mesmo cadastrou.
- Política de privacidade completa (a mesma publicada na Chrome Web
  Store): [`PRIVACY.md`](PRIVACY.md) ou
  <https://rcpleme2.github.io/extensao_eproc/privacy.html>.

---

## Dúvidas frequentes

**A extensão altera algo no eproc?** Não. Ela só lê o que já está na
tela e baixa/exporta/envia para análise — nunca marca, edita ou exclui
nada por conta própria.

**Preciso estar logado?** Sim, todas as funções usam a sua própria
sessão já autenticada no eproc.

**Funciona em outro tribunal, além de TJPR e TRF4?** Por enquanto não —
a extensão só tem permissão para rodar nos domínios desses dois
tribunais (ver `manifest.json`).

**Um download falhou, e agora?** O erro aparece no painel ao final do
processo, mas os demais documentos/processos continuam sendo baixados
normalmente — só o que falhou fica de fora, com uma mensagem explicando
o motivo.

**Como sei qual versão estou usando?** Confira em `chrome://extensions`,
no card da extensão. O histórico de novidades de cada versão está na
[página de apresentação](https://rcpleme2.github.io/extensao_eproc/).
