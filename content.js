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

    documentos.push({
      idDocumento: idDoc,
      nome: (a.textContent || "").trim() || a.getAttribute("data-nome") || idDoc,
      dataNome: a.getAttribute("data-nome") || "",
      descricao: extrairDescricaoDocumento(a),
      mimetype: (a.getAttribute("data-mimetype") || "").toLowerCase(),
      href: a.href,
      evento: extrairNumeroEvento(a),
      ordemDoc: extrairOrdemNoEvento(a),
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
let configSubstituirSiglaAtivo = true;

function aplicarSubstituicaoSiglaSeAtivo() {
  if (configSubstituirSiglaAtivo) substituirSiglaPorNomeUsuario();
}

chrome.storage.local.get({ substituirSigla: true }, (itens) => {
  configSubstituirSiglaAtivo = itens.substituirSigla;
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

adicionarBotaoAbrirPainel();

const observadorEventos = new MutationObserver(() => {
  aplicarSubstituicaoSiglaSeAtivo();
  adicionarBotaoAbrirPainel();
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
function textoComQuebras(elemento) {
  const clone = elemento.cloneNode(true);
  clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
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
    const destinoAcaoHtml = (tds[5].innerHTML || "").trim();

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
    const criterioResumo = linhasCriterio[0] || "Sem critério definido";
    const criterioAlternativas = Math.max(0, linhasCriterio.length - 1);

    const linhasDestino = textoComQuebras(tds[5])
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const destinoResumo = linhasDestino[0] || "Sem destino definido";
    const linhaEvento = linhasDestino.find((l) => l.startsWith("Evento:"));
    const temAcaoProgramada = linhasDestino.some(
      (l) => l.includes("AUTOMATIZADO") || l.includes("Ação Programada")
    );
    const acaoResumo = temAcaoProgramada ? linhaEvento || "Ação automatizada programada" : "";

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
      criterioAlternativas,
      destinoResumo,
      acaoResumo,
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
  if (!select) return { perfil: null, valor: null };
  const opcaoSelecionada = select.options[select.selectedIndex];
  return {
    perfil: opcaoSelecionada ? (opcaoSelecionada.textContent || "").trim() : null,
    valor: select.value || null,
  };
}

chrome.runtime.onMessage.addListener((mensagem, sender, sendResponse) => {
  if (mensagem && mensagem.tipo === "LISTAR_DOCUMENTOS") {
    sendResponse(listarDocumentos());
  }
  if (mensagem && mensagem.tipo === "LISTAR_REGRAS_AUTOMACAO") {
    sendResponse(listarRegrasAutomacaoAtivas());
  }
  if (mensagem && mensagem.tipo === "LER_PERFIL_ATUAL") {
    sendResponse(lerPerfilAtual());
  }
  return true;
});
