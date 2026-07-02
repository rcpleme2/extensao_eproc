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
  };
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
    chrome.runtime.sendMessage({ tipo: "ABRIR_PAINEL_LATERAL" }).catch(() => {});
  });

  logo.insertAdjacentElement("afterend", botao);
}

substituirSiglaPorNomeUsuario();
adicionarBotaoAbrirPainel();

const observadorEventos = new MutationObserver(() => {
  substituirSiglaPorNomeUsuario();
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

    const opcaoPrioridade = tds[1].querySelector("select.selPrioridade option[selected]");
    const prioridade = opcaoPrioridade ? (opcaoPrioridade.textContent || "").trim() : "";

    const spanGrupo = tds[2].querySelector('span[id^="spnGrupoRegra_"]');
    let grupo = spanGrupo ? (spanGrupo.textContent || "").trim() : "";
    if (!grupo || grupo === "[+]") grupo = "Nenhum";

    const localizadorOrigem = (tds[3].textContent || "").trim() || "Nenhum";
    const criterioHtml = (tds[4].innerHTML || "").trim();
    const destinoAcaoHtml = (tds[5].innerHTML || "").trim();
    const outrosCriteriosHtml = (tds[6].innerHTML || "").trim();

    const linkEditar = tds[7].querySelector(
      'a[href*="acao=automatizar_localizadores_alterar"]:not([href*="sin_duplicar_regra"])'
    );
    const linkLog = tds[7].querySelector('a[href*="acao=automatizar_localizadores_log_por_regra"]');

    regras.push({
      id,
      numero,
      prioridade,
      grupo,
      localizadorOrigem,
      criterioHtml,
      destinoAcaoHtml,
      outrosCriteriosHtml,
      linkEditar: linkEditar ? linkEditar.href : "",
      linkLog: linkLog ? linkLog.href : "",
    });
  }

  regras.sort((a, b) => (Number(a.numero) || 0) - (Number(b.numero) || 0));

  return {
    regras,
    tituloPagina: document.title || "",
    totalRegrasNaPagina: linhas.length,
  };
}

chrome.runtime.onMessage.addListener((mensagem, sender, sendResponse) => {
  if (mensagem && mensagem.tipo === "LISTAR_DOCUMENTOS") {
    sendResponse(listarDocumentos());
  }
  if (mensagem && mensagem.tipo === "LISTAR_REGRAS_AUTOMACAO") {
    sendResponse(listarRegrasAutomacaoAtivas());
  }
  return true;
});
