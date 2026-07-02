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
  style.textContent = `
    #${ID_BOTAO_ABRIR_PAINEL} {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.6rem;
      height: 1.6rem;
      margin-left: 0.5rem;
      padding: 0;
      border: none;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.15);
      color: #fff;
      font-size: 1rem;
      line-height: 1;
      cursor: pointer;
    }
    #${ID_BOTAO_ABRIR_PAINEL}:hover {
      background: rgba(255, 255, 255, 0.3);
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
  botao.textContent = "⚖";
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

chrome.runtime.onMessage.addListener((mensagem, sender, sendResponse) => {
  if (mensagem && mensagem.tipo === "LISTAR_DOCUMENTOS") {
    sendResponse(listarDocumentos());
  }
  return true;
});
