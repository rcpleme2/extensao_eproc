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

// Na tabela de movimentacao, o eproc identifica o autor do ato so pela
// sigla funcional (ex.: "S287431"). O nome completo e o cargo ja existem
// no atributo aria-label do proprio label, usado hoje so para popular o
// tooltip nativo ao passar o mouse ("NOME<br>CARGO<br>LOTACAO", com as
// entidades HTML ja decodificadas pelo navegador). Trocamos apenas o texto
// visivel pelo nome completo, sem mexer no aria-label/tooltip original.
function substituirSiglaPorNomeUsuario() {
  const labels = document.querySelectorAll(
    "label.infraEventoUsuario[aria-label]:not([data-nome-substituido])"
  );
  for (const label of labels) {
    const ariaLabel = label.getAttribute("aria-label") || "";
    const nomeCompleto = ariaLabel.split("<br>")[0].trim();
    if (nomeCompleto) {
      label.textContent = nomeCompleto;
      label.setAttribute("data-nome-substituido", "1");
    }
  }
}

substituirSiglaPorNomeUsuario();

const observadorEventos = new MutationObserver(() => {
  substituirSiglaPorNomeUsuario();
});
observadorEventos.observe(document.body, { childList: true, subtree: true });

chrome.runtime.onMessage.addListener((mensagem, sender, sendResponse) => {
  if (mensagem && mensagem.tipo === "LISTAR_DOCUMENTOS") {
    sendResponse(listarDocumentos());
  }
  return true;
});
