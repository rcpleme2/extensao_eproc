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
  // As celulas da tabela de eventos tem id="tdEvento{N}Doc{M}"
  const td = anchorEl.closest('td[id^="tdEvento"]');
  if (td) {
    const m = td.id.match(/^tdEvento(\d+)Doc(\d+)/);
    if (m) return { evento: Number(m[1]), doc: Number(m[2]) };
  }
  return { evento: null, doc: null };
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

    const { evento, doc } = extrairNumeroEvento(a);
    documentos.push({
      idDocumento: idDoc,
      nome: (a.textContent || "").trim() || a.getAttribute("data-nome") || idDoc,
      dataNome: a.getAttribute("data-nome") || "",
      mimetype: (a.getAttribute("data-mimetype") || "").toLowerCase(),
      href: a.href,
      evento,
      ordemDoc: doc,
    });
  }

  // Ordena por evento e depois pela ordem do documento no evento
  documentos.sort((x, y) => {
    if (x.evento !== y.evento) return (x.evento || 0) - (y.evento || 0);
    return (x.ordemDoc || 0) - (y.ordemDoc || 0);
  });

  destacarAncoras(anchors);

  return {
    numeroProcesso: extrairNumeroProcesso(),
    documentos,
  };
}

chrome.runtime.onMessage.addListener((mensagem, sender, sendResponse) => {
  if (mensagem && mensagem.tipo === "LISTAR_DOCUMENTOS") {
    sendResponse(listarDocumentos());
  }
  return true;
});
