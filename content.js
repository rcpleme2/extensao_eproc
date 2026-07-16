// Content script: roda na pagina de detalhes do processo no eproc e
// identifica todos os links de documento (a.infraLinkDocumento).

function extrairNumeroProcesso() {
  // O <title> comeca com o numero do processo, ex:
  // "6000078-32.2026.8.16.0171 :: eproc - ..."
  const titulo = document.title || "";
  const match = titulo.match(/[\d.\-\/]{15,}/);
  if (match) return match[0].trim();

  // Fallback: tenta extrair da querystring da URL (num_processo=...)
  const url = new URL(window.location.href);
  const numUrl = url.searchParams.get("num_processo");
  if (numUrl) return numUrl;

  return "processo_desconhecido";
}

function extrairNumeroEvento(anchorEl) {
  // Alguns documentos aparecem tambem em paineis/atalhos fora da tabela
  // principal de eventos (sem celula "tdEvento{N}Doc{M}" como ancestral).
  // Para cobrir esses casos, a fonte mais confiavel e' o texto oculto que
  // o proprio eproc gera para o recurso "Copiar link para documento"
  // (".widgetlinkdocumento[data-iddocumento]"), que sempre contem
  // "processo ..., evento N, NOME" e existe em qualquer parte da pagina.
  const idDoc = anchorEl.getAttribute("data-doc");
  if (idDoc) {
    const widget = document.querySelector(
      `.widgetlinkdocumento[data-iddocumento="${idDoc}"]`
    );
    if (widget) {
      const m = (widget.textContent || "").match(/evento\s+(\d+)/i);
      if (m) return Number(m[1]);
    }
  }

  // Fallback: celulas da tabela de eventos tem id="tdEvento{N}Doc{M}"
  const td = anchorEl.closest('td[id^="tdEvento"]');
  if (td) {
    const m = td.id.match(/^tdEvento(\d+)/);
    if (m) return Number(m[1]);
  }

  return null;
}

// A descricao livre que o usuario digita ao anexar um documento (comum em
// documentos do tipo "Outros") fica num <span class="infraTextoTooltip
// infraTextoTooltipObservacao"> logo apos o link, dentro da mesma celula
// da tabela - confirmado na pagina real do eproc (ex.: "OUT8</a><br>
// <span class="infraTextoTooltip infraTextoTooltipObservacao">imagem</span>").
// O aria-label do proprio link ("Visualizar documento OUT8 do tipo jpeg")
// NAO e' essa descricao, so' repete nome+tipo - por isso nao e' usado
// aqui. Nem todo documento tem essa observacao preenchida.
function extrairDescricaoDocumento(anchorEl) {
  const td = anchorEl.closest("td");
  if (!td) return "";
  const span = td.querySelector(".infraTextoTooltipObservacao");
  return span ? (span.textContent || "").replace(/\s+/g, " ").trim() : "";
}

function extrairOrdemNoEvento(anchorEl) {
  // O numero no final do rotulo visivel (INIC1 -> 1, OUT3 -> 3, ...)
  // corresponde a posicao do documento dentro do seu evento.
  const texto = (anchorEl.textContent || "").trim();
  const m = texto.match(/(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

const CLASSE_DESTAQUE = "eproc-exportador-destaque";
const ID_ESTILO_DESTAQUE = "eproc-exportador-estilo-destaque";

function garantirEstiloDestaque() {
  if (document.getElementById(ID_ESTILO_DESTAQUE)) return;
  const style = document.createElement("style");
  style.id = ID_ESTILO_DESTAQUE;
  style.textContent = `
    a.${CLASSE_DESTAQUE} {
      background-color: rgba(255, 235, 59, 0.45) !important;
      outline: 1px solid #f9a825 !important;
      border-radius: 3px !important;
      box-shadow: 0 0 0 1px rgba(249, 168, 37, 0.4) !important;
    }
  `;
  document.head.appendChild(style);
}

function destacarAncoras(anchors) {
  garantirEstiloDestaque();
  for (const a of anchors) {
    a.classList.add(CLASSE_DESTAQUE);
  }
}

// Checkbox de selecao injetado na propria tela de movimentacao, logo
// antes de cada link de documento - permite escolher direto ali quais
// documentos entram na exportacao, sem precisar abrir o painel para
// desmarcar um por um. Marcado por padrao (todo documento reconhecido
// comeca incluido). Idempotente: chamar de novo (ex.: o usuario clica em
// "Detectar" mais de uma vez) NAO reseta o estado ja escolhido pelo
// usuario - so' cria o checkbox na primeira vez que encontra aquele link.
const CLASSE_CHECKBOX_DOCUMENTO = "eproc-exportador-checkbox-doc";

function garantirCheckboxDocumento(anchorEl, idDoc) {
  const anterior = anchorEl.previousElementSibling;
  if (anterior && anterior.classList && anterior.classList.contains(CLASSE_CHECKBOX_DOCUMENTO)) {
    return anterior;
  }
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = true;
  checkbox.className = CLASSE_CHECKBOX_DOCUMENTO;
  checkbox.title = "Incluir este documento na exportação";
  checkbox.style.marginRight = "4px";
  checkbox.setAttribute("data-doc-checkbox", idDoc);
  anchorEl.parentNode.insertBefore(checkbox, anchorEl);
  return checkbox;
}

// Le o estado ATUAL dos checkboxes direto do DOM (sem recriar nada) -
// usado bem antes de comecar a exportar, para pegar qualquer selecao que
// o usuario tenha ajustado na propria pagina depois do ultimo "Detectar".
function obterSelecaoDocumentos() {
  const selecionados = [];
  document.querySelectorAll(`.${CLASSE_CHECKBOX_DOCUMENTO}`).forEach((chk) => {
    if (chk.checked) {
      const idDoc = chk.getAttribute("data-doc-checkbox");
      if (idDoc) selecionados.push(idDoc);
    }
  });
  return selecionados;
}

function definirSelecaoDocumento(idDocumento, selecionado) {
  const chk = document.querySelector(`.${CLASSE_CHECKBOX_DOCUMENTO}[data-doc-checkbox="${idDocumento}"]`);
  if (chk) chk.checked = Boolean(selecionado);
}

function definirSelecaoTodosDocumentos(selecionado) {
  document.querySelectorAll(`.${CLASSE_CHECKBOX_DOCUMENTO}`).forEach((chk) => {
    chk.checked = Boolean(selecionado);
  });
}

function listarDocumentos() {
  const anchors = Array.from(
    document.querySelectorAll("a.infraLinkDocumento[data-doc]")
  );

  const vistos = new Set();
  const documentos = [];

  for (const a of anchors) {
    const idDoc = a.getAttribute("data-doc");
    if (!idDoc || vistos.has(idDoc)) continue;
    vistos.add(idDoc);

    const checkbox = garantirCheckboxDocumento(a, idDoc);

    documentos.push({
      idDocumento: idDoc,
      nome: (a.textContent || "").trim() || a.getAttribute("data-nome") || idDoc,
      dataNome: a.getAttribute("data-nome") || "",
      descricao: extrairDescricaoDocumento(a),
      mimetype: (a.getAttribute("data-mimetype") || "").toLowerCase(),
      href: a.href,
      evento: extrairNumeroEvento(a),
      ordemDoc: extrairOrdemNoEvento(a),
      selecionado: checkbox.checked,
    });
  }

  // Ordena por evento e depois pela ordem do documento no evento.
  // Evento desconhecido vai para o final (nunca para o inicio), para nao
  // empurrar documentos legitimos do evento 1 (ex.: a peticao inicial)
  // para depois de casos que nao puderam ser identificados.
  documentos.sort((x, y) => {
    const eventoX = x.evento == null ? Infinity : x.evento;
    const eventoY = y.evento == null ? Infinity : y.evento;
    if (eventoX !== eventoY) return eventoX - eventoY;
    const ordemX = x.ordemDoc == null ? Infinity : x.ordemDoc;
    const ordemY = y.ordemDoc == null ? Infinity : y.ordemDoc;
    return ordemX - ordemY;
  });

  destacarAncoras(anchors);

  return {
    numeroProcesso: extrairNumeroProcesso(),
    documentos,
    movimentacao: listarMovimentacaoProcessual(),
  };
}

const CLASSE_DESTAQUE_MOVIMENTACAO = "eproc-exportador-destaque-movimentacao";
const ID_ESTILO_DESTAQUE_MOVIMENTACAO = "eproc-exportador-estilo-destaque-movimentacao";

// Mesma ideia de "garantirEstiloDestaque"/"destacarAncoras" (usadas para
// destacar os links de documento), so' que para as linhas de
// movimentação identificadas - com uma cor diferente (azul) para não se
// confundir com o destaque amarelo dos documentos.
function garantirEstiloDestaqueMovimentacao() {
  if (document.getElementById(ID_ESTILO_DESTAQUE_MOVIMENTACAO)) return;
  const style = document.createElement("style");
  style.id = ID_ESTILO_DESTAQUE_MOVIMENTACAO;
  style.textContent = `
    tr.${CLASSE_DESTAQUE_MOVIMENTACAO} {
      background-color: rgba(33, 150, 243, 0.16) !important;
      outline: 1px solid #1565c0 !important;
      box-shadow: 0 0 0 1px rgba(21, 101, 192, 0.35) !important;
    }
    tr.${CLASSE_DESTAQUE_MOVIMENTACAO} > td {
      background-color: rgba(33, 150, 243, 0.16) !important;
    }
  `;
  document.head.appendChild(style);
}

function destacarLinhasMovimentacao(linhas) {
  garantirEstiloDestaqueMovimentacao();
  for (const linha of linhas) {
    linha.classList.add(CLASSE_DESTAQUE_MOVIMENTACAO);
  }
}

// Le' a tabela de movimentação do processo (numero do evento, data/hora e
// descrição), usada para incluir uma linha do tempo no MD único - mesmo
// quando o processo não tem nenhum documento anexado - e destaca
// visualmente (fundo azul) cada linha reconhecida na própria página,
// para conferência visual, do mesmo jeito que já é feito com os
// documentos (fundo amarelo).
//
// Estrutura confirmada com uma página real do eproc (tela de detalhes do
// processo): tabela "#tblEventos", uma linha "<tr id=\"trEventoN\">" por
// evento, com colunas diretas (não aninhadas) para número do evento,
// data/hora ("dd/mm/aaaa hh:mm:ss") e descrição
// ("td.infraEventoDescricao"). Os documentos de cada evento ficam numa
// tabela ANINHADA dentro de uma dessas colunas (por isso não usamos mais
// "td[id^=tdEvento]" para achar a linha do evento - esse id pertence à
// tabela aninhada de documentos, não à linha do evento).
//
// Estratégia 2 (fallback): usada só se a estratégia 1 não encontrar
// nada, ex. num tribunal cuja tabela tenha outro id/estrutura - considera
// qualquer <tr> cuja alguma célula direta seja reconhecível como
// data/hora.
function listarMovimentacaoProcessual() {
  const REGEX_DATA_HORA = /^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}(?::\d{2})?)$/;

  function celulasDiretas(linha) {
    return Array.from(linha.querySelectorAll(":scope > td"));
  }

  function extrairDeLinha(linha) {
    const idMatch = (linha.id || "").match(/^trEvento(\d+)$/);
    const numeroEvento = idMatch ? Number(idMatch[1]) : null;

    const tds = celulasDiretas(linha);
    const tdData = tds.find((td) => REGEX_DATA_HORA.test((td.textContent || "").trim()));
    if (!tdData) return null;
    const dataHora = (tdData.textContent || "").trim();

    const tdDescricao = linha.querySelector(":scope > td.infraEventoDescricao");
    let descricao;
    if (tdDescricao) {
      descricao = (tdDescricao.textContent || "").replace(/\s+/g, " ").trim();
    } else {
      // Fallback generico (tribunal sem a classe "infraEventoDescricao"):
      // junta as demais celulas diretas, exceto a de data e uma que seja
      // so' o numero do evento repetido.
      descricao = tds
        .filter(
          (td) =>
            td !== tdData &&
            (numeroEvento == null || (td.textContent || "").trim() !== String(numeroEvento))
        )
        .map((td) => (td.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join(" — ");
    }

    return { linha, numeroEvento, dataHora, descricao };
  }

  const eventos = [];
  const linhasDestacar = [];
  const vistos = new Set();

  const processarLinha = (linha) => {
    const evento = extrairDeLinha(linha);
    if (!evento) return;
    const chave = `${evento.numeroEvento}|${evento.dataHora}|${evento.descricao}`;
    if (vistos.has(chave)) return;
    vistos.add(chave);
    linhasDestacar.push(linha);
    eventos.push({
      numeroEvento: evento.numeroEvento,
      dataHora: evento.dataHora,
      descricao: evento.descricao,
    });
  };

  document
    .querySelectorAll('#tblEventos tbody > tr[id^="trEvento"], table.infraTable tbody > tr[id^="trEvento"]')
    .forEach(processarLinha);

  if (eventos.length === 0) {
    document.querySelectorAll("tr").forEach((tr) => {
      if (celulasDiretas(tr).some((td) => REGEX_DATA_HORA.test((td.textContent || "").trim()))) {
        processarLinha(tr);
      }
    });
  }

  eventos.sort((a, b) => {
    if (a.numeroEvento != null && b.numeroEvento != null) return a.numeroEvento - b.numeroEvento;
    return 0;
  });

  destacarLinhasMovimentacao(linhasDestacar);

  return eventos;
}

const CLASSE_CARGO_USUARIO = "eproc-exportador-cargo-usuario";
const ID_ESTILO_CARGO_USUARIO = "eproc-exportador-estilo-cargo-usuario";

function garantirEstiloCargoUsuario() {
  if (document.getElementById(ID_ESTILO_CARGO_USUARIO)) return;
  const style = document.createElement("style");
  style.id = ID_ESTILO_CARGO_USUARIO;
  style.textContent = `
    .${CLASSE_CARGO_USUARIO} {
      font-size: 0.8em;
      color: #666;
    }
  `;
  document.head.appendChild(style);
}

// Na tabela de movimentacao, o eproc identifica o autor do ato so pela
// sigla funcional (ex.: "S287431"). O nome completo e o cargo ja existem
// no atributo aria-label do proprio label, usado hoje so para popular o
// tooltip nativo ao passar o mouse ("NOME<br>CARGO<br>LOTACAO", com as
// entidades HTML ja decodificadas pelo navegador). Trocamos o texto
// visivel pelo nome completo + cargo (em fonte menor), sem mexer no
// aria-label/tooltip original.
function substituirSiglaPorNomeUsuario() {
  const labels = document.querySelectorAll(
    "label.infraEventoUsuario[aria-label]:not([data-nome-substituido])"
  );
  if (labels.length > 0) garantirEstiloCargoUsuario();

  for (const label of labels) {
    const ariaLabel = label.getAttribute("aria-label") || "";
    const partes = ariaLabel.split("<br>").map((parte) => parte.trim());
    const nomeCompleto = partes[0];
    const cargo = partes[1] || "";
    if (!nomeCompleto) continue;

    label.textContent = "";
    label.appendChild(document.createTextNode(nomeCompleto));

    if (cargo) {
      const spanCargo = document.createElement("span");
      spanCargo.className = CLASSE_CARGO_USUARIO;
      spanCargo.textContent = ` - ${cargo}`;
      label.appendChild(spanCargo);
    }

    label.setAttribute("data-nome-substituido", "1");
  }
}

// ---- Anexar Magistrado(s) ao evento "Conclusos *" ----
//
// Quando um evento da tabela "#tblEventos" e' um "Conclusos para
// decisão/despacho" (ou qualquer outro que comece com "Conclusos"), o
// nome do magistrado responsável já existe na página, só que escondido
// atrás do tooltip nativo "Informações do Evento" (ícone de lupa ao lado
// da descrição) - não aparece na coluna Descrição em si. Lido do
// atributo "aria-description" do "<span class='sr-only'>" vizinho
// (texto puro gerado pelo próprio eproc para leitores de tela); esse
// texto concatena "Data do Evento:", "Evento:", "Usuário:" e
// "Magistrado(s):" SEM nenhum separador entre os valores (o eproc usa
// "<br>" na versão visual/tooltip, mas eles somem na versão para leitor
// de tela) - por isso cada campo só pode ser isolado ancorando no
// RÓTULO do campo seguinte, nunca por espaço ou pontuação.
function extrairMagistradoDoEvento(linha) {
  const spanSr = linha.querySelector("span.sr-only[aria-description]");
  if (!spanSr) return null;
  const texto = spanSr.getAttribute("aria-description") || "";
  const m = texto.match(/Magistrado\(s\):\s*(.+)$/);
  if (!m) return null;
  const bruto = m[1].trim();
  if (!bruto) return null;
  // O campo vem como "NOME - Cargo" (ex.: "ROSANGELA FAORO - Juiz da
  // Fase") - só o nome entra no texto acrescentado.
  return bruto.split(/\s+-\s+/)[0].trim() || null;
}

const CLASSE_CONCLUSOS_MAGISTRADO = "eproc-exportador-conclusos-magistrado";

// Acrescenta " (NOME DO MAGISTRADO)" ao final do texto já existente na
// coluna Descrição, so' para eventos "Conclusos *" - ex.: "Conclusos
// para decisão/despacho" vira "Conclusos para decisão/despacho
// (ROSANGELA FAORO)". Idempotente via "data-magistrado-verificado"
// (mesmo padrão de "substituirSiglaPorNomeUsuario" acima): cada linha só
// é examinada uma vez, mesmo chamada de novo a cada mutação do DOM.
function anexarMagistradoEmConclusos() {
  const linhas = document.querySelectorAll(
    '#tblEventos tbody > tr[id^="trEvento"]:not([data-magistrado-verificado]), ' +
      'table.infraTable tbody > tr[id^="trEvento"]:not([data-magistrado-verificado])'
  );

  for (const linha of linhas) {
    linha.setAttribute("data-magistrado-verificado", "1");

    const tdDescricao = linha.querySelector(":scope > td.infraEventoDescricao");
    if (!tdDescricao) continue;
    if (!/^\s*Conclusos\b/i.test(tdDescricao.textContent || "")) continue;

    const nomeMagistrado = extrairMagistradoDoEvento(linha);
    if (!nomeMagistrado) continue;

    const spanMagistrado = document.createElement("span");
    spanMagistrado.className = CLASSE_CONCLUSOS_MAGISTRADO;
    spanMagistrado.textContent = ` (${nomeMagistrado})`;
    tdDescricao.appendChild(spanMagistrado);
  }
}

// Botao injetado ao lado da logo do Portal jus.br no cabecalho do eproc,
// que abre o painel lateral da extensao com um clique - alternativa para
// quem prefere nao depender do icone da extensao na barra de ferramentas
// do navegador (que fica escondido atras do icone de "puzzle" por padrao
// em instalacoes novas do Chrome/Edge).
const ID_BOTAO_ABRIR_PAINEL = "eproc-exportador-botao-abrir-painel";
const SELETOR_LOGO_JUSBR = 'img[src*="jusbr_logo"]';

function garantirEstiloBotaoAbrirPainel() {
  const ID_ESTILO = "eproc-exportador-estilo-botao-abrir-painel";
  if (document.getElementById(ID_ESTILO)) return;
  const style = document.createElement("style");
  style.id = ID_ESTILO;
  // Cor vibrante e propositalmente diferente do azul do cabecalho/logo do
  // jus.br, para o botao nao se camuflar e ficar facil de notar.
  style.textContent = `
    #${ID_BOTAO_ABRIR_PAINEL} {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      margin-left: 0.6rem;
      padding: 5px 12px;
      border: none;
      border-radius: 999px;
      background: #f5a623;
      color: #1c1c1c;
      font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
      font-size: 0.78rem;
      font-weight: 700;
      line-height: 1;
      white-space: nowrap;
      cursor: pointer;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
      transition: transform 0.1s ease, box-shadow 0.1s ease;
    }
    #${ID_BOTAO_ABRIR_PAINEL}:hover {
      background: #ffb648;
      transform: scale(1.05);
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
    }
    #${ID_BOTAO_ABRIR_PAINEL} .eproc-exportador-botao-icone {
      font-size: 0.95rem;
      line-height: 1;
    }
  `;
  document.head.appendChild(style);
}

function adicionarBotaoAbrirPainel() {
  if (document.getElementById(ID_BOTAO_ABRIR_PAINEL)) return;

  const logo = document.querySelector(SELETOR_LOGO_JUSBR);
  if (!logo || !logo.parentElement) return;

  garantirEstiloBotaoAbrirPainel();

  const botao = document.createElement("button");
  botao.id = ID_BOTAO_ABRIR_PAINEL;
  botao.type = "button";
  botao.title = "Abrir Extensão Auxiliar eProc";
  botao.setAttribute("aria-label", "Abrir Extensão Auxiliar eProc");

  const icone = document.createElement("span");
  icone.className = "eproc-exportador-botao-icone";
  icone.setAttribute("aria-hidden", "true");
  icone.textContent = "⚖";
  botao.appendChild(icone);
  botao.appendChild(document.createTextNode("Extensão eProc"));

  botao.addEventListener("click", (evento) => {
    evento.preventDefault();
    evento.stopPropagation();
    // Se a extensao foi recarregada (chrome://extensions) depois que esta
    // pagina foi carregada, o content script antigo fica "orfao" e
    // chrome.runtime.sendMessage lanca uma excecao SINCRONA ("Extension
    // context invalidated"), que nao seria pega por um .catch() na
    // Promise - por isso o try/catch aqui. Nesse caso so' da' pra avisar o
    // usuario a recarregar a pagina; nao ha' como reconectar sem isso.
    try {
      if (!chrome.runtime || !chrome.runtime.id) {
        window.alert("A extensão foi atualizada. Recarregue esta página para usar este botão.");
        return;
      }
      chrome.runtime.sendMessage({ tipo: "ABRIR_PAINEL_LATERAL" }).catch(() => {});
    } catch (e) {
      window.alert("A extensão foi atualizada. Recarregue esta página para usar este botão.");
    }
  });

  logo.insertAdjacentElement("afterend", botao);
}

// Configuracao do painel (engrenagem): liga/desliga a substituicao da
// sigla pelo nome+cargo. Default "true" preserva o comportamento de
// antes dessa opcao existir. Le' uma vez no carregamento da pagina e
// tambem escuta mudancas (chrome.storage.onChanged) para reagir na hora
// se o usuario alternar a opcao com esta mesma aba do eproc ja' aberta,
// sem precisar recarregar a pagina.
//
// "configuracaoSiglaCarregada" existe para evitar uma corrida: o
// MutationObserver logo abaixo comeca a observar de forma SINCRONA,
// muito antes do "chrome.storage.local.get" (assincrono) responder - o
// carregamento inicial da pagina do eproc dispara varias mutacoes no DOM
// nesse meio-tempo, e sem essa guarda o observer chamava
// "substituirSiglaPorNomeUsuario()" usando o valor padrao (true) mesmo
// quando o usuario tinha desligado a opcao, ja' que o valor real ainda
// nao tinha chegado. Enquanto essa flag for false, nenhuma chamada faz
// efeito; assim que o valor real chega, ela vira true e roda uma vez
// (cobrindo o que ja mudou no DOM nesse meio-tempo).
let configSubstituirSiglaAtivo = true;
let configuracaoSiglaCarregada = false;

function aplicarSubstituicaoSiglaSeAtivo() {
  if (configuracaoSiglaCarregada && configSubstituirSiglaAtivo) substituirSiglaPorNomeUsuario();
}

chrome.storage.local.get({ substituirSigla: true }, (itens) => {
  configSubstituirSiglaAtivo = itens.substituirSigla;
  configuracaoSiglaCarregada = true;
  aplicarSubstituicaoSiglaSeAtivo();
});

chrome.storage.onChanged.addListener((mudancas, area) => {
  if (area === "local" && mudancas.substituirSigla) {
    configSubstituirSiglaAtivo = mudancas.substituirSigla.newValue;
    aplicarSubstituicaoSiglaSeAtivo();
    // Desligar agora nao desfaz o que ja foi trocado nesta pagina (exigiria
    // guardar o texto original de cada label) - so' passa a nao trocar mais
    // nada dai pra frente, ate' a proxima navegacao/recarregamento.
  }
});

// Configuracao do painel: liga/desliga o anexo do Magistrado aos eventos
// "Conclusos *" (ver "anexarMagistradoEmConclusos" acima). Default
// "true"; mesmo mecanismo de guarda contra corrida do "substituirSigla"
// acima (o MutationObserver comeca a observar antes do
// "chrome.storage.local.get" responder).
let configAnexarMagistradoAtivo = true;
let configuracaoMagistradoCarregada = false;

function aplicarAnexoMagistradoSeAtivo() {
  if (configuracaoMagistradoCarregada && configAnexarMagistradoAtivo) anexarMagistradoEmConclusos();
}

chrome.storage.local.get({ anexarMagistradoConclusos: true }, (itens) => {
  configAnexarMagistradoAtivo = itens.anexarMagistradoConclusos;
  configuracaoMagistradoCarregada = true;
  aplicarAnexoMagistradoSeAtivo();
});

chrome.storage.onChanged.addListener((mudancas, area) => {
  if (area === "local" && mudancas.anexarMagistradoConclusos) {
    configAnexarMagistradoAtivo = mudancas.anexarMagistradoConclusos.newValue;
    // Desligar não desfaz o que já foi anexado nesta página - mesma
    // observação de "substituirSigla" acima.
    aplicarAnexoMagistradoSeAtivo();
  }
});

// ---- Separar Comarca/Juízo no campo "Órgão/Juízo" do Relatório Geral ----
//
// Mesma logica de duas etapas ja' usada no proprio painel da extensao
// para escolher a unidade do Relatório para Correição (nomes de unidade
// seguem o padrao "<Juízo/Vara> de <Comarca>" - separar a Comarca do
// resto permite duas listas curtas em vez de uma unica com centenas de
// opcoes) - aqui replicada em cima do campo NATIVO "Órgão/Juízo"
// (`#selIdOrgaoJuizo`) da propria tela do Relatório Geral do eproc.
// Recurso OPCIONAL (desligado por padrao, ver Configurações do painel),
// ja' que altera a interface da propria pagina do eproc em vez de so'
// ler dados dela.
const ID_WRAPPER_COMARCA_JUIZO = "eproc-exportador-comarca-juizo";

// Algumas comarcas do Paraná tem "de" no PRÓPRIO nome (ex.: "Cândido de
// Abreu") - separar pelo ÚLTIMO " de " cortaria errado nesses casos (ex.:
// "... do Juízo Único de Cândido de Abreu" viraria comarca "Abreu" em vez
// de "Cândido de Abreu"). Mesma lista de exceções usada em
// "separarComarcaDoJuizo" (popup.js).
const COMARCAS_COM_DE_NO_NOME_ORGAO = ["Cândido de Abreu", "Primeiro de Maio"];

function separarComarcaDoJuizoOrgao(nomeCompleto) {
  const texto = (nomeCompleto || "").trim();

  for (const comarcaExcecao of COMARCAS_COM_DE_NO_NOME_ORGAO) {
    const sufixo = ` de ${comarcaExcecao}`;
    if (texto.toLowerCase().endsWith(sufixo.toLowerCase())) {
      return {
        comarca: comarcaExcecao,
        juizo: texto.slice(0, texto.length - sufixo.length).trim() || texto,
      };
    }
  }

  const marcador = " de ";
  const indice = texto.lastIndexOf(marcador);
  if (indice === -1) {
    return { comarca: "(Outras)", juizo: texto };
  }
  return {
    comarca: texto.slice(indice + marcador.length).trim() || "(Outras)",
    juizo: texto.slice(0, indice).trim() || texto,
  };
}

// Muda o value do <select> nativo e dispara "change" - o bootstrap-select
// da propria pagina escuta esse evento e atualiza o widget visual junto
// (mesmo mecanismo que "selecionarOrgaoJuizo" usa em background.js para
// automatizar essa mesma troca numa aba oculta).
function selecionarOrgaoJuizoNaPaginaAtual(valorOrgaoJuizo) {
  const select = document.getElementById("selIdOrgaoJuizo");
  if (!select) return;
  let encontrou = false;
  for (const opcao of select.options) {
    const selecionada = opcao.value === valorOrgaoJuizo;
    opcao.selected = selecionada;
    if (selecionada) encontrou = true;
  }
  if (encontrou) select.dispatchEvent(new Event("change", { bubbles: true }));
}

// O <select> nativo do bootstrap-select fica escondido dentro de um
// wrapper "div.bootstrap-select" (o botao visivel com o texto/dropdown
// e' outro elemento dentro desse wrapper) - encontrar esse wrapper e'
// best-effort: cai para o proprio elemento pai quando a classe não é
// encontrada, em vez de falhar.
function wrapperOriginalOrgaoJuizo(select) {
  return select.closest(".bootstrap-select") || select.parentElement;
}

function montarComarcaJuizoOrgao() {
  if (document.getElementById(ID_WRAPPER_COMARCA_JUIZO)) return; // ja' montado nesta pagina
  const select = document.getElementById("selIdOrgaoJuizo");
  if (!select) return;

  const unidades = Array.from(select.options)
    .filter((opcao) => opcao.value)
    .map((opcao) => ({ valor: opcao.value, ...separarComarcaDoJuizoOrgao((opcao.textContent || "").trim()) }));
  if (unidades.length === 0) return;

  const comarcas = [...new Set(unidades.map((u) => u.comarca))].sort((a, b) => a.localeCompare(b, "pt-BR"));

  const wrapper = document.createElement("div");
  wrapper.id = ID_WRAPPER_COMARCA_JUIZO;
  wrapper.style.cssText = "display:flex;flex-direction:column;gap:4px;margin-top:6px;max-width:420px;";

  const selectComarca = document.createElement("select");
  selectComarca.className = "form-control form-control-sm";
  selectComarca.innerHTML = '<option value="" selected disabled>Selecione uma comarca...</option>';
  for (const comarca of comarcas) {
    const opcao = document.createElement("option");
    opcao.value = comarca;
    opcao.textContent = comarca;
    selectComarca.appendChild(opcao);
  }

  const selectJuizo = document.createElement("select");
  selectJuizo.className = "form-control form-control-sm";
  selectJuizo.disabled = true;
  selectJuizo.innerHTML = '<option value="" selected disabled>Selecione um juízo/vara...</option>';

  selectComarca.addEventListener("change", () => {
    const comarca = selectComarca.value;
    selectJuizo.innerHTML = '<option value="" selected disabled>Selecione um juízo/vara...</option>';
    const unidadesDaComarca = unidades
      .filter((u) => u.comarca === comarca)
      .sort((a, b) => a.juizo.localeCompare(b.juizo, "pt-BR"));
    for (const unidade of unidadesDaComarca) {
      const opcao = document.createElement("option");
      opcao.value = unidade.valor;
      opcao.textContent = unidade.juizo;
      selectJuizo.appendChild(opcao);
    }
    selectJuizo.disabled = unidadesDaComarca.length === 0;
  });

  selectJuizo.addEventListener("change", () => {
    selecionarOrgaoJuizoNaPaginaAtual(selectJuizo.value);
  });

  wrapper.appendChild(selectComarca);
  wrapper.appendChild(selectJuizo);

  const wrapperOriginal = wrapperOriginalOrgaoJuizo(select);
  wrapperOriginal.insertAdjacentElement("afterend", wrapper);
  wrapperOriginal.dataset.eprocExportadorEscondido = "1";
  wrapperOriginal.style.display = "none";
}

function desmontarComarcaJuizoOrgao() {
  const wrapper = document.getElementById(ID_WRAPPER_COMARCA_JUIZO);
  if (wrapper) wrapper.remove();

  const select = document.getElementById("selIdOrgaoJuizo");
  if (!select) return;
  const wrapperOriginal = wrapperOriginalOrgaoJuizo(select);
  if (wrapperOriginal && wrapperOriginal.dataset.eprocExportadorEscondido) {
    wrapperOriginal.style.display = "";
    delete wrapperOriginal.dataset.eprocExportadorEscondido;
  }
}

let configSepararOrgaoJuizoAtivo = false;
let configSepararOrgaoJuizoCarregada = false;

function aplicarSepararOrgaoJuizoSeAtivo() {
  if (!configSepararOrgaoJuizoCarregada) return;
  if (configSepararOrgaoJuizoAtivo) montarComarcaJuizoOrgao();
  else desmontarComarcaJuizoOrgao();
}

chrome.storage.local.get({ separarOrgaoJuizoPorComarca: false }, (itens) => {
  configSepararOrgaoJuizoAtivo = itens.separarOrgaoJuizoPorComarca;
  configSepararOrgaoJuizoCarregada = true;
  aplicarSepararOrgaoJuizoSeAtivo();
});

chrome.storage.onChanged.addListener((mudancas, area) => {
  if (area === "local" && mudancas.separarOrgaoJuizoPorComarca) {
    configSepararOrgaoJuizoAtivo = mudancas.separarOrgaoJuizoPorComarca.newValue;
    aplicarSepararOrgaoJuizoSeAtivo();
  }
});

adicionarBotaoAbrirPainel();

const observadorEventos = new MutationObserver(() => {
  aplicarSubstituicaoSiglaSeAtivo();
  aplicarAnexoMagistradoSeAtivo();
  adicionarBotaoAbrirPainel();
  aplicarSepararOrgaoJuizoSeAtivo();
});
observadorEventos.observe(document.body, { childList: true, subtree: true });

// Le' as regras da tela "Automatizar Tramitação Processual"
// (acao=automatizar_localizadores). Cada regra e' uma <tr
// id="trLocalizadorAut_{id}"> com 8 colunas (na mesma ordem do <thead> da
// pagina): checkbox, Nº/Prioridade, Grupo, Localizador ORIGEM, Tipo de
// Controle/Critério, Localizador DESTINO/Ação, Outros Critérios, Ações.
// O estado ativa/inativa de cada regra e' o proprio checkbox do
// "toggle" (#customSwitch{id}, rotulado "Ativa"/"Inativar Regra
// Temporariamente") - so' as regras com esse checkbox marcado entram no
// resultado, conforme pedido ("considere apenas as regras que estão
// ativas").
// Copia o elemento, troca cada <br> por uma quebra de linha real e devolve
// o texto puro - usado para conseguir separar o conteudo das celulas em
// "linhas" de forma confiavel (textContent sozinho ignora <br>).
//
// Blocos (div/p/li/tr/h1-h6) tambem representam uma quebra visual na
// pagina, mas "textContent" ignora fronteiras de elemento (so' <br> vira
// quebra real) - sem tratar isso tambem, duas linhas em <div>s/<p>s
// separadas (comum na coluna "Localizador DESTINO/Ação" do eproc, onde o
// cabecalho "AUTOMATIZADO" e os detalhes da acao programada vem em blocos
// proprios sem <br> entre eles) saiam coladas uma na outra (ex.: "LANÇAR
// EVENTOAUTOMATIZADOEvento: ..."), o que tornava o "Ação Automatizada" do
// relatório ilegível.
function textoComQuebras(elemento) {
  const clone = elemento.cloneNode(true);
  clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  clone.querySelectorAll("div, p, li, tr, h1, h2, h3, h4, h5, h6").forEach((bloco) => {
    bloco.appendChild(document.createTextNode("\n"));
  });
  return (clone.textContent || "").replace(/[ \t]+/g, " ").trim();
}

function listarRegrasAutomacaoAtivas() {
  const linhas = Array.from(document.querySelectorAll('tr[id^="trLocalizadorAut_"]'));
  const regras = [];

  for (const linha of linhas) {
    const m = linha.id.match(/^trLocalizadorAut_(.+)$/);
    const id = m ? m[1] : null;
    const switchEl = id ? document.getElementById(`customSwitch${id}`) : null;
    // Se por algum motivo o switch nao for encontrado, nao arrisca excluir
    // a regra silenciosamente - melhor incluir do que esconder uma regra
    // que pode estar ativa.
    const ativa = switchEl ? switchEl.checked : true;
    if (!ativa) continue;

    const tds = linha.querySelectorAll(":scope > td");
    if (tds.length < 8) continue;

    const spanNumero = tds[1].querySelector("span > span");
    const numero = spanNumero ? (spanNumero.textContent || "").trim() : "";

    // O select de prioridade tem uma opcao "[ Prioridade ]" (value="0")
    // usada como placeholder quando a regra nao tem uma ordem de execucao
    // definida - trocamos esse texto pelo equivalente mais claro pedido,
    // e guardamos tambem o numero (quando existe, no formato "Executar
    // Nº") para poder ordenar por prioridade depois.
    const opcaoPrioridade = tds[1].querySelector("select.selPrioridade option[selected]");
    const prioridadeBruta = opcaoPrioridade ? (opcaoPrioridade.textContent || "").trim() : "";
    const matchPrioridade = prioridadeBruta.match(/Executar\s+(\d+)/);
    const prioridadeNumero = matchPrioridade ? Number(matchPrioridade[1]) : null;
    const prioridade = prioridadeNumero !== null ? prioridadeBruta : "[Sem prioridade definida]";

    const spanGrupo = tds[2].querySelector('span[id^="spnGrupoRegra_"]');
    let grupo = spanGrupo ? (spanGrupo.textContent || "").trim() : "";
    if (!grupo || grupo === "[+]") grupo = "Nenhum";

    const localizadorOrigem = (tds[3].textContent || "").trim() || "Nenhum";
    const criterioHtml = (tds[4].innerHTML || "").trim();

    // A coluna "Localizador DESTINO/Ação" pode ter o mesmo padrao de DOIS
    // blocos sobrepostos que a coluna "Outros Critérios" tem quando o
    // conteudo e' longo: "dadosResumidos_{cod}" (truncado, oculto por
    // padrao) e "dadosCompletos_{cod}" (o texto inteiro). Sem preferir o
    // bloco "completo" aqui tambem, os detalhes da Ação Automatizada
    // (o que exatamente sera' executado) saiam cortados no meio - essa
    // era a causa do "Ação Automatizada" incompleto na exportacao.
    const divDestinoCompleto = tds[5].querySelector('[id^="dadosCompletos_"]');
    const origemDestinoAcao = divDestinoCompleto || tds[5];
    const destinoAcaoHtml = (origemDestinoAcao.innerHTML || "").trim();

    // A coluna "Outros Critérios" tem, quando o conteudo e' longo, DOIS
    // blocos sobrepostos: "dadosResumidos_{cod}" (truncado, oculto por
    // padrao) e "dadosCompletos_{cod}" (o texto inteiro, visivel por
    // padrao, com um link "[ + Expandir ]" dentro do bloco truncado). Sem
    // filtrar isso, o texto extraido sairia duplicado. Preferimos sempre o
    // bloco "completo" quando ele existe.
    const divOutrosCompleto = tds[6].querySelector('[id^="dadosCompletos_"]');
    const origemOutrosCriterios = divOutrosCompleto || tds[6];
    const outrosCriteriosHtml = (origemOutrosCriterios.innerHTML || "").trim();

    // Versoes resumidas (texto puro, sem HTML) de cada coluna, usadas so'
    // para desenhar o fluxograma - o conteudo completo (com toda a
    // formatacao original) continua disponivel nos campos "*Html" acima.
    const linhasCriterio = textoComQuebras(tds[4])
      .split(/\s*OU\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    // Todos os critérios levados em consideração (quando a regra tem mais
    // de um, ligados por "OU" na página original) - o fluxograma lista
    // todos eles, um por linha, em vez de só o primeiro com um badge
    // "+N alternativa(s)" escondendo quais são os demais.
    const criteriosLista = linhasCriterio.length > 0 ? linhasCriterio : ["Sem critério definido"];
    const criterioResumo = criteriosLista[0];

    const linhasDestino = textoComQuebras(origemDestinoAcao)
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const destinoResumo = linhasDestino[0] || "Sem destino definido";
    // A linha "AUTOMATIZADO"/"Ação Programada" e' so' o cabecalho do
    // bloco - os detalhes de qual acao sera' executada (evento, texto,
    // destino, etc.) vem nas linhas SEGUINTES. Pegar so' a linha
    // "Evento:" descartava o resto; agora leva tudo dali pra frente.
    const indiceAcaoProgramada = linhasDestino.findIndex(
      (l) => l.includes("AUTOMATIZADO") || l.includes("Ação Programada")
    );
    const linhasAcao = indiceAcaoProgramada !== -1 ? linhasDestino.slice(indiceAcaoProgramada) : [];

    // O "Localizador de Erro" (para onde o processo vai se a acao
    // automatizada falhar) e' destacado a parte no relatório (seta + caixa
    // vermelha), em vez de so' mais uma linha dentro do texto corrido da
    // Ação Automatizada - por isso sai da lista antes de montar o resumo.
    const indiceLocalizadorErro = linhasAcao.findIndex((l) => /localizador de erro/i.test(l));
    const localizadorErro =
      indiceLocalizadorErro !== -1
        ? linhasAcao[indiceLocalizadorErro].replace(/^.*localizador de erro:?\s*/i, "").trim()
        : "";
    const linhasAcaoSemErro =
      indiceLocalizadorErro !== -1
        ? [...linhasAcao.slice(0, indiceLocalizadorErro), ...linhasAcao.slice(indiceLocalizadorErro + 1)]
        : linhasAcao;

    const acaoResumo =
      linhasAcaoSemErro.length > 0 ? linhasAcaoSemErro.join(" — ") || "Ação automatizada programada" : "";
    // Linhas separadas (sem juntar tudo num paragrafo so' com " — "), para
    // o relatório poder desenhar cada informação (ação programada, evento,
    // texto etc.) em seu proprio bloco, com um divisor entre elas, em vez
    // de um texto corrido dificil de escanear.
    const acaoLinhas = linhasAcaoSemErro.length > 0 ? linhasAcaoSemErro : [];

    const outrosCriteriosResumo = textoComQuebras(origemOutrosCriterios)
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    const linkEditar = tds[7].querySelector(
      'a[href*="acao=automatizar_localizadores_alterar"]:not([href*="sin_duplicar_regra"])'
    );
    const linkLog = tds[7].querySelector('a[href*="acao=automatizar_localizadores_log_por_regra"]');

    regras.push({
      id,
      numero,
      prioridade,
      prioridadeNumero,
      grupo,
      localizadorOrigem,
      criterioHtml,
      destinoAcaoHtml,
      outrosCriteriosHtml,
      criterioResumo,
      criteriosLista,
      destinoResumo,
      acaoResumo,
      acaoLinhas,
      localizadorErro,
      outrosCriteriosResumo,
      linkEditar: linkEditar ? linkEditar.href : "",
      linkLog: linkLog ? linkLog.href : "",
    });
  }

  // Se alguma regra ativa tem prioridade numerica definida, a ordem do
  // relatorio segue essa prioridade (a ordem real de execucao); so' cai de
  // volta para o numero da regra quando NENHUMA delas tem prioridade
  // definida (ordenar por prioridade nesse caso nao faria sentido, ja' que
  // todas ficariam empatadas).
  const algumaTemPrioridade = regras.some((r) => r.prioridadeNumero !== null);
  regras.sort((a, b) => {
    if (algumaTemPrioridade) {
      const pa = a.prioridadeNumero === null ? Infinity : a.prioridadeNumero;
      const pb = b.prioridadeNumero === null ? Infinity : b.prioridadeNumero;
      if (pa !== pb) return pa - pb;
    }
    return (Number(a.numero) || 0) - (Number(b.numero) || 0);
  });

  return {
    regras,
    tituloPagina: document.title || "",
    totalRegrasNaPagina: linhas.length,
  };
}

// Le' o perfil/unidade atualmente selecionado no seletor de perfil do
// eproc (select#selInfraUnidades, no cabecalho superior, presente em
// qualquer pagina logada) - usado para decidir se o botao "Relatório
// Gerencial da Unidade" deve aparecer no painel (so' quando o perfil
// ativo for "CORREGEDORIA").
function lerPerfilAtual() {
  const select = document.getElementById("selInfraUnidades");
  if (!select) return { perfil: null, valor: null, unidadeNome: null };
  const opcaoSelecionada = select.options[select.selectedIndex];
  const sigla = opcaoSelecionada ? (opcaoSelecionada.textContent || "").trim() : null;

  // O <option> traz, no atributo "title", o nome completo da unidade
  // seguido da sigla (ex.: title="Vara Única da Comarca de Tomazina -
  // TOMUN/CHEFE DE SECRETARIA" para o <option>TOMUN/CHEFE DE
  // SECRETARIA</option>) - usado para exibir o nome da unidade por
  // extenso (ex.: no Relatório da Unidade) em vez da sigla. Extrai so' o
  // nome completo removendo o sufixo " - <sigla>" - a comparacao usa a
  // propria sigla ja lida acima (nao so' corta no primeiro " - "), para
  // nao quebrar caso o nome da unidade tenha um "-" no meio.
  let unidadeNome = sigla;
  const titulo = opcaoSelecionada ? (opcaoSelecionada.getAttribute("title") || "").trim() : "";
  if (titulo && sigla && titulo.endsWith(sigla)) {
    const nomeExtraido = titulo
      .slice(0, titulo.length - sigla.length)
      .replace(/\s*-\s*$/, "")
      .trim();
    if (nomeExtraido) unidadeNome = nomeExtraido;
  }

  return {
    perfil: sigla,
    valor: select.value || null,
    unidadeNome,
  };
}

chrome.runtime.onMessage.addListener((mensagem, sender, sendResponse) => {
  if (mensagem && mensagem.tipo === "LISTAR_DOCUMENTOS") {
    sendResponse(listarDocumentos());
  }
  if (mensagem && mensagem.tipo === "OBTER_SELECAO_DOCUMENTOS") {
    sendResponse({ selecionados: obterSelecaoDocumentos() });
  }
  if (mensagem && mensagem.tipo === "DEFINIR_SELECAO_DOCUMENTO") {
    definirSelecaoDocumento(mensagem.idDocumento, mensagem.selecionado);
    sendResponse({ ok: true });
  }
  if (mensagem && mensagem.tipo === "DEFINIR_SELECAO_TODOS_DOCUMENTOS") {
    definirSelecaoTodosDocumentos(mensagem.selecionado);
    sendResponse({ ok: true });
  }
  if (mensagem && mensagem.tipo === "LISTAR_REGRAS_AUTOMACAO") {
    sendResponse(listarRegrasAutomacaoAtivas());
  }
  if (mensagem && mensagem.tipo === "LER_PERFIL_ATUAL") {
    sendResponse(lerPerfilAtual());
  }
  return true;
});
