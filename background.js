// Service worker: recebe a lista de documentos do painel e dispara os
// downloads via chrome.downloads, um de cada vez, reportando progresso.

// Abre o painel lateral (side panel) ao clicar no icone da extensao, em
// vez do popup efemero padrao, para que ele permaneca visivel enquanto o
// usuario navega entre paginas/abas do eproc.
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

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

function montarNomeArquivo(pastaBase, doc, sequencial) {
  const seqStr = String(sequencial).padStart(4, "0");
  const nomeBase = sanitizarNomeArquivo(doc.nome || doc.idDocumento);
  const ext = extensaoParaMimetype(doc.mimetype);
  return `${pastaBase}/${seqStr}_${nomeBase}.${ext}`;
}

const REGEX_IFRAME_CONTEUDO = /id=["']conteudoIframe["'][^>]*\ssrc=["']([^"']+)["']/i;

// A URL do link do documento (acao=acessar_documento) retorna uma pagina
// "casca" em HTML com um <iframe id="conteudoIframe"> cujo src e' quem
// efetivamente serve o arquivo (acao=acessar_documento_implementacao).
// Sem isso, o download salva a casca HTML como se fosse o arquivo real.
async function resolverUrlReal(url) {
  let resposta;
  try {
    resposta = await fetch(url, { credentials: "same-origin" });
  } catch (e) {
    return url;
  }
  if (!resposta.ok) return url;

  const texto = await resposta.text();
  const match = texto.match(REGEX_IFRAME_CONTEUDO);
  if (!match) return url;

  const srcIframe = match[1].replace(/&amp;/g, "&");
  try {
    return new URL(srcIframe, url).toString();
  } catch (e) {
    return url;
  }
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

function construirDataUrl(mimetype, texto) {
  return `data:${mimetype};charset=utf-8;base64,` + btoa(unescape(encodeURIComponent(texto)));
}

function aguardarCarregamentoAba(tabId) {
  return new Promise((resolve) => {
    function listener(idAtualizado, changeInfo) {
      if (idAtualizado === tabId && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function lerConteudoDivDochtml(tabId) {
  return chrome.scripting
    .executeScript({
      target: { tabId },
      func: () => {
        const div = document.getElementById("divdochtml");
        return div ? div.innerHTML : "";
      },
    })
    .then((resultados) => (resultados && resultados[0] ? resultados[0].result : ""))
    .catch(() => "");
}

// Documentos "html" (certidoes, atos ordinatorios, mandados) sao servidos
// via uma pagina com uma div vazia (#divdochtml) que so e' preenchida
// depois que o proprio JavaScript da pagina roda no navegador (uma chamada
// AJAX sincrona disparada no onload). Nao da' para replicar isso com um
// simples fetch (o servidor devolve a mesma casca de novo). Em vez disso,
// abrimos o documento numa aba oculta, deixamos o script da pagina
// preencher a div normalmente e lemos o resultado final.
async function obterConteudoHtmlReal(url, nomeDocumento) {
  let tab;
  try {
    tab = await chrome.tabs.create({ url, active: false });
    await aguardarCarregamentoAba(tab.id);

    let conteudo = "";
    for (let tentativa = 0; tentativa < 25; tentativa += 1) {
      conteudo = await lerConteudoDivDochtml(tab.id);
      if (conteudo && conteudo.trim()) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    if (!conteudo || !conteudo.trim()) return null;

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${nomeDocumento}</title></head><body>${conteudo}</body></html>`;
  } catch (e) {
    return null;
  } finally {
    if (tab && tab.id) {
      chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
}

function baixarIndice(pastaBase, numeroProcesso, documentos) {
  const indice = {
    numeroProcesso,
    geradoEm: new Date().toISOString(),
    documentos: documentos.map((d, i) => ({
      sequencial: i + 1,
      evento: d.evento,
      nome: d.nome,
      tipo: d.mimetype,
      idDocumento: d.idDocumento,
      url: d.href,
    })),
  };
  const json = JSON.stringify(indice, null, 2);
  return baixarUm(`${pastaBase}/_indice.json`, construirDataUrl("application/json", json));
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

  for (let i = 0; i < documentos.length; i += 1) {
    const doc = documentos[i];
    const filename = montarNomeArquivo(pastaBase, doc, i + 1);
    try {
      const urlReal = await resolverUrlReal(doc.href);

      if (doc.mimetype === "html") {
        const htmlFinal = await obterConteudoHtmlReal(urlReal, doc.nome);
        if (htmlFinal) {
          await baixarUm(filename, construirDataUrl("text/html", htmlFinal));
        } else {
          // Nao foi possivel capturar o conteudo renderizado pela aba;
          // baixa a pagina bruta como ultimo recurso.
          await baixarUm(filename, urlReal);
        }
      } else {
        await baixarUm(filename, urlReal);
      }
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
