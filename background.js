// Service worker: recebe a lista de documentos do popup e dispara os
// downloads via chrome.downloads, um de cada vez, reportando progresso.

const EXTENSAO_POR_MIMETYPE = {
  pdf: "pdf",
  html: "html",
  htm: "html",
  jpg: "jpg",
  jpeg: "jpg",
  png: "png",
  gif: "gif",
  txt: "txt",
  doc: "doc",
  docx: "docx",
  xml: "xml",
  zip: "zip",
};

function sanitizarNomeArquivo(nome) {
  return String(nome)
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function extensaoParaMimetype(mimetype) {
  return EXTENSAO_POR_MIMETYPE[mimetype] || (mimetype ? mimetype.replace(/[^a-z0-9]/g, "") : "bin");
}

function montarNomeArquivo(pastaBase, doc, indice) {
  const eventoStr = doc.evento != null ? String(doc.evento).padStart(3, "0") : "000";
  const nomeBase = sanitizarNomeArquivo(doc.nome || doc.idDocumento);
  const ext = extensaoParaMimetype(doc.mimetype);
  return `${pastaBase}/${eventoStr}_${nomeBase}.${ext}`;
}

function baixarUm(filename, url) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename, saveAs: false, conflictAction: "uniquify" }, (downloadId) => {
      if (chrome.runtime.lastError || downloadId === undefined) {
        reject(chrome.runtime.lastError ? chrome.runtime.lastError.message : "falha ao iniciar download");
      } else {
        resolve(downloadId);
      }
    });
  });
}

function baixarIndice(pastaBase, numeroProcesso, documentos) {
  const indice = {
    numeroProcesso,
    geradoEm: new Date().toISOString(),
    documentos: documentos.map((d) => ({
      evento: d.evento,
      nome: d.nome,
      tipo: d.mimetype,
      idDocumento: d.idDocumento,
      url: d.href,
    })),
  };
  const json = JSON.stringify(indice, null, 2);
  const dataUrl = "data:application/json;base64," + btoa(unescape(encodeURIComponent(json)));
  return baixarUm(`${pastaBase}/_indice.json`, dataUrl);
}

async function processarFila(numeroProcesso, documentos, sender) {
  const pastaBase = `eproc/${sanitizarNomeArquivo(numeroProcesso)}`;
  const total = documentos.length;
  let concluidos = 0;
  const erros = [];

  const enviarProgresso = () => {
    chrome.runtime.sendMessage({
      tipo: "PROGRESSO_DOWNLOAD",
      concluidos,
      total,
      erros,
    }).catch(() => {});
  };

  for (const doc of documentos) {
    const filename = montarNomeArquivo(pastaBase, doc);
    try {
      await baixarUm(filename, doc.href);
    } catch (e) {
      erros.push({ nome: doc.nome, mensagem: String(e) });
    }
    concluidos += 1;
    enviarProgresso();
  }

  try {
    await baixarIndice(pastaBase, numeroProcesso, documentos);
  } catch (e) {
    erros.push({ nome: "_indice.json", mensagem: String(e) });
  }

  chrome.runtime.sendMessage({
    tipo: "DOWNLOAD_FINALIZADO",
    total,
    erros,
    pasta: pastaBase,
  }).catch(() => {});
}

chrome.runtime.onMessage.addListener((mensagem, sender, sendResponse) => {
  if (mensagem && mensagem.tipo === "BAIXAR_DOCUMENTOS") {
    processarFila(mensagem.numeroProcesso, mensagem.documentos, sender);
    sendResponse({ ok: true });
    return true;
  }
  return false;
});
