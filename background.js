// Service worker: recebe a lista de documentos do painel e dispara os
// downloads via chrome.downloads, um de cada vez, reportando progresso.
// Tambem sabe montar um PDF unico (pdf-lib, aqui mesmo no service worker)
// e um MD unico com texto anonimizado - a extracao de texto de PDF (via
// pdf.js) roda numa aba oculta, nao aqui (ver comentario mais abaixo,
// perto de "Construcao do MD unico", sobre o motivo).

importScripts("libs/pdf-lib.min.js");
const { PDFDocument, StandardFonts } = self.PDFLib;

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

// Converte bytes binarios (ex.: PDF final) em base64 em blocos, evitando
// "Maximum call stack size exceeded" ao usar String.fromCharCode com um
// array grande de uma vez so.
function bytesParaBase64(bytes) {
  const TAMANHO_BLOCO = 0x8000;
  let binario = "";
  for (let i = 0; i < bytes.length; i += TAMANHO_BLOCO) {
    const bloco = bytes.subarray(i, i + TAMANHO_BLOCO);
    binario += String.fromCharCode.apply(null, bloco);
  }
  return btoa(binario);
}

function construirDataUrlBinario(mimetype, bytes) {
  return `data:${mimetype};base64,${bytesParaBase64(bytes)}`;
}

function aguardarCarregamentoAba(tabId) {
  return new Promise((resolve) => {
    let resolvido = false;
    function concluir() {
      if (resolvido) return;
      resolvido = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    function listener(idAtualizado, changeInfo) {
      if (idAtualizado === tabId && changeInfo.status === "complete") concluir();
    }
    chrome.tabs.onUpdated.addListener(listener);

    // Corrida rara, mas possivel: se a aba ja tiver terminado de carregar
    // ANTES desse listener ser registrado (ex.: pagina muito rapida/em
    // cache), o evento "complete" ja disparou e nunca mais vai disparar -
    // sem essa checagem extra, a promessa ficaria pendurada para sempre.
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) return;
      if (tab && tab.status === "complete") concluir();
    });
  });
}

// Le' o estado da div "#divdochtml" na aba: existe ou nao, e o
// innerHTML atual (pode ser vazio mesmo que a div exista, enquanto o
// AJAX da pagina ainda nao terminou). Nunca lanca excecao - qualquer erro
// do proprio executeScript (aba fechada, navegacao no meio, etc.) volta
// como "erro" em vez de ser silenciosamente engolido, para aparecer nos
// logs em vez de so' "nao deu certo".
function lerEstadoDivDochtml(tabId) {
  return chrome.scripting
    .executeScript({
      target: { tabId },
      func: () => {
        const div = document.getElementById("divdochtml");
        const textoBody = !div && document.body ? (document.body.innerText || "").trim() : "";
        return {
          existe: !!div,
          conteudo: div ? div.innerHTML : "",
          urlPagina: window.location.href,
          // Se a div nao existir, um pedaco do body ajuda a ver o que a
          // pagina realmente carregou (pagina de erro/login, outra
          // estrutura, etc.) - so' os primeiros 500 caracteres para nao
          // poluir o log.
          amostraBody: !div ? textoBody.slice(0, 500) || null : null,
          // Alguns documentos (ex.: atos ordinatorios ligados ao DJEN) nao
          // usam a div "#divdochtml" nem AJAX - a pagina inteira ja' vem
          // pronta, com o conteudo real direto no body. Guarda o texto
          // completo (nao só a amostra) para usar como conteudo do
          // documento sem precisar esperar uma div que nunca vai existir.
          corpoTextoCompleto: !div ? textoBody : null,
        };
      },
    })
    .then((resultados) => (resultados && resultados[0] ? resultados[0].result : { existe: false, conteudo: "", urlPagina: null }))
    .catch((e) => ({ existe: false, conteudo: "", urlPagina: null, erro: String(e), abaSumiu: /no tab with id/i.test(String(e)) }));
}

// Documentos "html" (certidoes, atos ordinatorios, mandados) sao servidos
// via uma pagina com uma div vazia (#divdochtml) que so e' preenchida
// depois que o proprio JavaScript da pagina roda no navegador (uma chamada
// AJAX sincrona disparada no onload). Nao da' para replicar isso com um
// simples fetch (o servidor devolve a mesma casca de novo). Em vez disso,
// abrimos o documento numa aba oculta, deixamos o script da pagina
// preencher a div normalmente e lemos o innerHTML resultante.
//
// Sempre le' innerHTML (nunca innerText): innerText depende de layout
// renderizado, e o Chrome pode nao computar layout numa aba de fundo
// (active: false), fazendo innerText voltar vazio silenciosamente mesmo
// com o conteudo ja preenchido no DOM. innerHTML e' pura serializacao do
// DOM e nao depende de renderizacao.
//
// Retorna sempre { conteudo, erro }, nunca lanca excecao, para o chamador
// poder relatar o motivo exato de uma falha em vez de so' "nao deu certo".
//
// Diagnostico ("[eproc-html]" no console do service worker, em
// chrome://extensions): loga a URL apos o carregamento, se a div
// "#divdochtml" chegou a existir no DOM (independente de ter conteudo) e
// quantas tentativas de poll foram feitas - para descobrir se o problema
// e' a div nunca aparecer (pagina errada/redirecionada) ou aparecer e so'
// nunca ser preenchida (AJAX que nao completa).
async function tentarAbrirAbaEExtrairHtmlDivDochtml(url) {
  let tab;
  try {
    try {
      tab = await chrome.tabs.create({ url, active: false });
    } catch (e) {
      return { conteudo: null, erro: `Falha ao abrir aba oculta: ${String(e)}` };
    }
    console.log("[eproc-html]", "Aba criada", tab.id, "para", url);

    await aguardarCarregamentoAba(tab.id);

    const abaCarregada = await chrome.tabs.get(tab.id).catch(() => null);
    console.log("[eproc-html]", "Aba", tab.id, "carregada. URL atual:", abaCarregada && abaCarregada.url);

    let ultimoEstado = { existe: false, conteudo: "" };
    for (let tentativa = 0; tentativa < 60; tentativa += 1) {
      ultimoEstado = await lerEstadoDivDochtml(tab.id);
      if (tentativa === 0) {
        console.log(
          "[eproc-html]",
          "Primeira leitura - div existe?",
          ultimoEstado.existe,
          "| URL da página:",
          ultimoEstado.urlPagina,
          "| amostra do body:",
          ultimoEstado.amostraBody,
          "| erro:",
          ultimoEstado.erro
        );
        // Se a div nunca existiu mas o body ja' trouxe um texto
        // substancial, essa pagina nao usa o fluxo classico de "casca +
        // AJAX" - o conteudo real ja' esta' pronto de imediato (visto em
        // atos ordinatorios ligados ao DJEN). Usa esse texto direto, sem
        // esperar os 18s de polling por uma div que nunca vai aparecer.
        if (!ultimoEstado.existe && ultimoEstado.corpoTextoCompleto && ultimoEstado.corpoTextoCompleto.length > 30) {
          console.log("[eproc-html]", "Página sem #divdochtml, mas com conteúdo pronto no body - usando direto.");
          return { conteudo: null, textoBruto: ultimoEstado.corpoTextoCompleto, erro: null };
        }
      }
      if (ultimoEstado.conteudo && ultimoEstado.conteudo.trim()) break;
      // Se a aba fechou sozinha (ex.: a propria pagina se fecha por nao
      // estar dentro do iframe que ela espera), nao adianta continuar
      // tentando ler uma aba que nao existe mais pelos proximos segundos
      // - para na hora e relata isso especificamente.
      if (ultimoEstado.abaSumiu) {
        console.warn("[eproc-html]", "A aba fechou sozinha antes de terminar (tentativa", tentativa, ").");
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    if (!ultimoEstado.conteudo || !ultimoEstado.conteudo.trim()) {
      console.warn(
        "[eproc-html]",
        "Div não preencheu a tempo. Existia?",
        ultimoEstado.existe,
        "| URL final:",
        ultimoEstado.urlPagina,
        "| amostra do body:",
        ultimoEstado.amostraBody,
        "| erro:",
        ultimoEstado.erro
      );
      const motivo = ultimoEstado.abaSumiu
        ? "a aba fechou sozinha antes de terminar (a própria página do eproc pode estar se fechando)"
        : !ultimoEstado.existe
        ? 'a div "#divdochtml" nem chegou a existir nesta página - pode ter sido redirecionada para outro lugar'
        : 'a div "#divdochtml" existe mas continuou vazia (o AJAX da página não terminou a tempo)';
      return {
        conteudo: null,
        erro: `Conteúdo não carregou a tempo (${motivo}).`,
      };
    }
    return { conteudo: ultimoEstado.conteudo, erro: null };
  } catch (e) {
    return { conteudo: null, erro: String(e) };
  } finally {
    if (tab && tab.id) {
      chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
}

// Envolve "tentarAbrirAbaEExtrairHtmlDivDochtml" com uma segunda
// tentativa (aba nova do zero) se a primeira falhar por timeout - um
// documento especifico (ex.: um ato ordinatorio) as vezes demora mais
// para a pagina do eproc preencher a div via AJAX do que os 18s da
// primeira tentativa, mas funciona numa segunda tentativa.
async function abrirAbaEExtrairHtmlDivDochtml(url) {
  const primeira = await tentarAbrirAbaEExtrairHtmlDivDochtml(url);
  if (primeira.conteudo || primeira.textoBruto) return primeira;

  console.warn(
    "[eproc-html]",
    "Primeira tentativa falhou, tentando novamente com uma aba nova:",
    primeira.erro
  );
  return tentarAbrirAbaEExtrairHtmlDivDochtml(url);
}

// Ultimo recurso quando a aba oculta falha por completo (ex.: a propria
// pagina fecha a aba sozinha antes de terminar - visto em alguns
// documentos gerados automaticamente, como atos ordinatorios ligados a
// publicacao no DJEN, cuja URL pode nao seguir o fluxo classico de
// "casca + AJAX"). So' um fetch bruto da URL: se vier HTML, tenta
// aproveitar o que vier; se vier um PDF de verdade, avisa claramente em
// vez de devolver bytes binarios como se fossem texto.
async function tentarFallbackFetchHtml(url) {
  try {
    const resposta = await fetch(url, { credentials: "same-origin" });
    if (!resposta.ok) {
      return { html: null, erro: `Falha ao baixar via fetch (HTTP ${resposta.status}).` };
    }
    const tipoConteudo = (resposta.headers.get("content-type") || "").toLowerCase();
    if (tipoConteudo.includes("pdf")) {
      return {
        html: null,
        erro:
          'O documento parece ser um PDF servido diretamente (não uma página HTML do eproc) - use o modo "Arquivos individuais" para baixá-lo corretamente.',
      };
    }
    const html = await resposta.text();
    if (!html || !html.trim()) {
      return { html: null, erro: "O download direto (fetch) voltou vazio." };
    }
    return { html, erro: null };
  } catch (e) {
    return { html: null, erro: `Falha no download direto: ${e && e.message ? e.message : String(e)}` };
  }
}

function escaparHtml(texto) {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function obterConteudoHtmlReal(url, nomeDocumento) {
  const { conteudo, textoBruto, erro } = await abrirAbaEExtrairHtmlDivDochtml(url);
  if (conteudo) {
    return {
      html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${nomeDocumento}</title></head><body>${conteudo}</body></html>`,
      erro: null,
    };
  }
  if (textoBruto) {
    return {
      html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${nomeDocumento}</title></head><body><pre>${escaparHtml(
        textoBruto
      )}</pre></body></html>`,
      erro: null,
    };
  }

  console.warn("[eproc-html]", "Aba oculta falhou (", erro, ") - tentando baixar bruto via fetch como último recurso.");
  const fallback = await tentarFallbackFetchHtml(url);
  if (fallback.html) return fallback;

  return { html: null, erro: erro || fallback.erro };
}

// Converte o HTML do documento para texto simples, preservando quebras de
// linha aproximadas (troca tags de bloco/<br> por "\n" antes de remover as
// demais tags), para uso nas paginas de texto corrido do PDF unico.
function converterHtmlParaTextoSimples(html) {
  return html
    .replace(/<(br|BR)\s*\/?>/g, "\n")
    .replace(/<\/(p|P|div|DIV|li|LI|tr|TR|h[1-6]|H[1-6])>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function obterTextoHtmlReal(url) {
  const { conteudo, textoBruto, erro } = await abrirAbaEExtrairHtmlDivDochtml(url);
  if (textoBruto) return { texto: textoBruto, erro: null };

  let html = conteudo;
  let erroFinal = erro;

  if (!html) {
    console.warn("[eproc-html]", "Aba oculta falhou (", erro, ") - tentando baixar bruto via fetch como último recurso.");
    const fallback = await tentarFallbackFetchHtml(url);
    if (fallback.html) {
      html = fallback.html;
    } else {
      erroFinal = erro || fallback.erro;
    }
  }

  if (!html) return { texto: null, erro: erroFinal };

  const texto = converterHtmlParaTextoSimples(html);
  if (!texto) {
    return {
      texto: null,
      erro: "O conteúdo carregou, mas ficou vazio após remover as tags HTML.",
    };
  }
  return { texto, erro: null };
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

// ---- Geracao do PDF unico combinado ----

const LARGURA_PAGINA_TEXTO = 595.28; // A4 em pontos
const ALTURA_PAGINA_TEXTO = 841.89;
const MARGEM_TEXTO = 40;
const TAMANHO_FONTE_TEXTO = 10;
const TAMANHO_MAXIMO_IMAGEM_PT = 1000;
const MIMETYPES_IMAGEM = new Set(["jpg", "jpeg", "png", "gif", "bmp", "webp"]);

// As fontes padrao do PDF (WinAnsi) nao cobrem todo o Unicode. Troca
// aspas/travessoes tipograficos por equivalentes simples e qualquer outro
// caractere fora do intervalo basico por "?", para nao falhar ao desenhar.
function sanitizarTextoPdf(texto) {
  return String(texto)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/ /g, " ")
    .replace(/[^\x00-\xFF\n\r\t]/g, "?");
}

function quebrarLinhas(texto, fonte, tamanhoFonte, larguraMaxima) {
  const linhasFinal = [];
  const linhasOriginais = texto.split(/\r\n|\r|\n/);

  for (const linhaOriginal of linhasOriginais) {
    if (linhaOriginal.trim() === "") {
      linhasFinal.push("");
      continue;
    }

    const palavras = linhaOriginal.split(/\s+/).filter(Boolean);
    let linhaAtual = "";
    for (const palavra of palavras) {
      const tentativa = linhaAtual ? `${linhaAtual} ${palavra}` : palavra;
      let largura;
      try {
        largura = fonte.widthOfTextAtSize(tentativa, tamanhoFonte);
      } catch (e) {
        largura = 0;
      }
      if (largura > larguraMaxima && linhaAtual) {
        linhasFinal.push(linhaAtual);
        linhaAtual = palavra;
      } else {
        linhaAtual = tentativa;
      }
    }
    if (linhaAtual) linhasFinal.push(linhaAtual);
  }

  return linhasFinal;
}

function adicionarTextoComoPaginas(pdfFinal, fonte, titulo, texto) {
  const larguraUtil = LARGURA_PAGINA_TEXTO - MARGEM_TEXTO * 2;
  const linhas = [
    sanitizarTextoPdf(titulo),
    "",
    ...quebrarLinhas(sanitizarTextoPdf(texto), fonte, TAMANHO_FONTE_TEXTO, larguraUtil),
  ];

  const alturaLinha = TAMANHO_FONTE_TEXTO * 1.4;
  const linhasPorPagina = Math.max(1, Math.floor((ALTURA_PAGINA_TEXTO - MARGEM_TEXTO * 2) / alturaLinha));

  for (let inicio = 0; inicio < linhas.length; inicio += linhasPorPagina) {
    const pagina = pdfFinal.addPage([LARGURA_PAGINA_TEXTO, ALTURA_PAGINA_TEXTO]);
    const bloco = linhas.slice(inicio, inicio + linhasPorPagina);
    let y = ALTURA_PAGINA_TEXTO - MARGEM_TEXTO;
    for (const linha of bloco) {
      try {
        pagina.drawText(linha, { x: MARGEM_TEXTO, y, size: TAMANHO_FONTE_TEXTO, font: fonte });
      } catch (e) {
        // Ignora linha que a fonte padrao nao consiga desenhar.
      }
      y -= alturaLinha;
    }
  }
}

function limitarTamanho(largura, altura, maximo) {
  if (largura <= maximo && altura <= maximo) return { largura, altura };
  const fator = largura > altura ? maximo / largura : maximo / altura;
  return { largura: largura * fator, altura: altura * fator };
}

// Decodifica a imagem original (jpg/png/gif/bmp/webp) via
// createImageBitmap/OffscreenCanvas (disponiveis no service worker) e
// reexporta como PNG, formato que o pdf-lib sabe embutir diretamente.
async function converterImagemParaPng(bytesOriginais, mimetypeOriginal) {
  const blob = new Blob([bytesOriginais], { type: mimetypeOriginal || "image/*" });
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);
  const blobPng = await canvas.convertToBlob({ type: "image/png" });
  const bufferPng = await blobPng.arrayBuffer();
  return { bytes: new Uint8Array(bufferPng), largura: bitmap.width, altura: bitmap.height };
}

async function adicionarDocumentoAoPdf(pdfFinal, fonteTexto, doc, urlReal) {
  if (doc.mimetype === "pdf") {
    const resposta = await fetch(urlReal, { credentials: "same-origin" });
    const bytes = await resposta.arrayBuffer();
    const pdfOrigem = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const paginasCopiadas = await pdfFinal.copyPages(pdfOrigem, pdfOrigem.getPageIndices());
    paginasCopiadas.forEach((pagina) => pdfFinal.addPage(pagina));
    return;
  }

  if (MIMETYPES_IMAGEM.has(doc.mimetype)) {
    const resposta = await fetch(urlReal, { credentials: "same-origin" });
    const bufferOriginal = await resposta.arrayBuffer();
    const { bytes, largura, altura } = await converterImagemParaPng(
      new Uint8Array(bufferOriginal),
      resposta.headers.get("content-type")
    );
    const imagemEmbutida = await pdfFinal.embedPng(bytes);
    const tamanho = limitarTamanho(largura || 1, altura || 1, TAMANHO_MAXIMO_IMAGEM_PT);
    const pagina = pdfFinal.addPage([tamanho.largura, tamanho.altura]);
    pagina.drawImage(imagemEmbutida, { x: 0, y: 0, width: tamanho.largura, height: tamanho.altura });
    return;
  }

  if (doc.mimetype === "html") {
    const { texto, erro } = await obterTextoHtmlReal(urlReal);
    if (texto) {
      adicionarTextoComoPaginas(pdfFinal, fonteTexto, doc.nome, texto);
      return;
    }
    adicionarTextoComoPaginas(
      pdfFinal,
      fonteTexto,
      doc.nome,
      `Não foi possível extrair o conteúdo do documento "${doc.nome}" para o PDF único. Motivo: ${
        erro || "desconhecido"
      }. Consulte o arquivo individual na pasta de exportação.`
    );
    return;
  }

  adicionarTextoComoPaginas(
    pdfFinal,
    fonteTexto,
    doc.nome,
    `Documento "${doc.nome}" (tipo ${doc.mimetype || "desconhecido"}) nao pode ser incorporado a este PDF unico. Consulte o arquivo individual na pasta de exportacao.`
  );
}

async function construirPdfUnico(documentos, resolverUrl, pastaBase, numeroProcesso, aoProgredir) {
  const pdfFinal = await PDFDocument.create();
  const fonteTexto = await pdfFinal.embedFont(StandardFonts.Helvetica);

  for (let i = 0; i < documentos.length; i += 1) {
    const doc = documentos[i];
    try {
      const urlReal = await resolverUrl(doc);
      await adicionarDocumentoAoPdf(pdfFinal, fonteTexto, doc, urlReal);
    } catch (e) {
      adicionarTextoComoPaginas(
        pdfFinal,
        fonteTexto,
        doc.nome,
        `Nao foi possivel incorporar o documento "${doc.nome}" ao PDF unico (${String(e)}). Consulte o arquivo individual.`
      );
    }
    if (aoProgredir) aoProgredir(i + 1, documentos.length);
  }

  const bytesFinais = await pdfFinal.save();
  const dataUrl = construirDataUrlBinario("application/pdf", bytesFinais);
  const nomeArquivo = `${pastaBase}/${sanitizarNomeArquivo(numeroProcesso)}_completo.pdf`;
  await baixarUm(nomeArquivo, dataUrl);
}

// ---- Construcao do MD unico (texto + anonimizacao "melhor esforco") ----
//
// Este modo NAO faz OCR (removido por nao ter funcionado de forma
// confiavel) - so' extrai o texto que ja existe nativamente no
// documento. A extracao de PDF usa pdf.js (vendorizado em
// libs/pdf.min.js), mas NAO roda no service worker: pdf.js precisa de
// "document" (DOM) mesmo so' para ler texto - a tentativa de rodar no
// service worker falhava com "Setting up fake worker failed: document is
// not defined", ja' que service workers nao tem DOM. Por isso roda numa
// ABA OCULTA de verdade (mesmo mecanismo ja' usado para documentos
// "html"), aberta no proprio dominio do eproc, reaproveitada para todos
// os PDFs do processo (uma aba so', nao uma por documento). Imagens
// (jpg/png/etc.) nao tem como ter texto extraido sem OCR, entao entram no
// MD apenas com uma nota indicando isso, sem precisar de aba nenhuma.
//
// Prefixo usado em todos os logs deste modo (console do "Inspect views:
// service worker" em chrome://extensions, e da propria aba oculta), para
// facilitar filtrar ("[eproc-md]") quando algo falhar.
const LOG_MD = "[eproc-md]";

// Impede que uma unica etapa demorada (ex.: um fetch que nunca retorna)
// trave o processo inteiro para sempre - sem isso, uma promessa que nunca
// resolve simplesmente pendura a exportacao no meio, sem nenhum erro
// visivel. Ao estourar, vira um erro tratado normalmente (aparece nos
// avisos do documento final), em vez de travar.
function comTimeout(promessa, ms, mensagem) {
  let idTimeout;
  const timeout = new Promise((_, reject) => {
    idTimeout = setTimeout(() => reject(new Error(mensagem)), ms);
  });
  return Promise.race([promessa, timeout]).finally(() => clearTimeout(idTimeout));
}

const MIMETYPES_IMAGEM_SEM_OCR = ["jpg", "jpeg", "png", "gif", "bmp", "webp"];

// Injetada UMA vez por aba (via files: ["libs/pdf.min.js"] + esta
// funcao). Aponta o worker do pdf.js para o arquivo local e define, no
// escopo global da PAGINA (window.__eproc*), a funcao que extrai o texto
// de um PDF - necessario porque cada chamada de executeScript com "func"
// e' serializada e avaliada isoladamente, sem acesso as demais funcoes
// deste arquivo (background.js).
function prepararAmbientePdfNaPagina() {
  if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("libs/pdf.worker.min.js");
  }

  window.__eprocExtrairTextoPdf = async function (parametros) {
    try {
      const resposta = await fetch(parametros.url, { credentials: "same-origin" });
      if (!resposta.ok) {
        throw new Error(`Falha ao baixar o documento (HTTP ${resposta.status}).`);
      }
      const buffer = await resposta.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;

      const partes = [];
      for (let i = 1; i <= pdf.numPages; i += 1) {
        const pagina = await pdf.getPage(i);
        const conteudoTexto = await pagina.getTextContent();

        // Cada "item" e' um fragmento de texto (nem sempre uma linha
        // inteira); "item.hasEOL" marca quando aquele fragmento termina
        // uma linha visual da pagina. Sem usar isso, juntar tudo so' com
        // espaco faz a pagina inteira virar UMA linha so' - o que e'
        // ruim tanto para leitura quanto para a anonimizacao (que age por
        // linha): uma unica palavra de endereco em qualquer parte da
        // pagina apagaria a pagina inteira. Reconstruir as quebras reais
        // deixa cada linha do PDF como uma linha de texto de verdade.
        let linhaAtual = "";
        const linhas = [];
        for (const item of conteudoTexto.items) {
          linhaAtual += item.str || "";
          if (item.hasEOL) {
            linhas.push(linhaAtual.replace(/\s+/g, " ").trim());
            linhaAtual = "";
          }
        }
        if (linhaAtual.trim()) linhas.push(linhaAtual.replace(/\s+/g, " ").trim());

        const texto = linhas.filter(Boolean).join("\n");
        partes.push(
          texto || "_(sem texto nesta página - o documento pode ser uma imagem digitalizada, sem OCR nesta versão)_"
        );
      }

      return { texto: partes.join("\n\n"), erro: null };
    } catch (e) {
      return { texto: "", erro: e && e.message ? e.message : String(e) };
    }
  };
}

// Chamada uma vez por PDF (executeScript so' aceita passar "args" junto
// de "func", nao junto de "files") - so' repassa para a funcao real ja'
// definida no escopo da pagina por "prepararAmbientePdfNaPagina".
function chamarExtrairTextoPdfNaPagina(parametros) {
  return window.__eprocExtrairTextoPdf(parametros);
}

async function prepararAbaProcessamentoPdfMd(urlOrigemEproc) {
  console.log(LOG_MD, "Abrindo aba oculta de processamento de PDF em:", urlOrigemEproc);
  const aba = await chrome.tabs.create({ url: urlOrigemEproc, active: false });
  await aguardarCarregamentoAba(aba.id);

  await chrome.scripting.executeScript({
    target: { tabId: aba.id },
    files: ["libs/pdf.min.js"],
  });
  await chrome.scripting.executeScript({
    target: { tabId: aba.id },
    func: prepararAmbientePdfNaPagina,
  });
  console.log(LOG_MD, "Aba de processamento de PDF pronta:", aba.id);

  return aba;
}

async function extrairTextoPdfNaAba(tabId, url, nome) {
  console.log(LOG_MD, "Extraindo texto do PDF:", nome);
  try {
    const [{ result } = {}] = await comTimeout(
      chrome.scripting.executeScript({
        target: { tabId },
        func: chamarExtrairTextoPdfNaPagina,
        args: [{ url, nome }],
      }),
      60000,
      `Tempo esgotado (60s) extraindo texto de "${nome}" na aba oculta.`
    );
    console.log(LOG_MD, "Concluído:", nome, "| erro:", result && result.erro);
    return result || { texto: "", erro: "Sem resultado retornado pela aba." };
  } catch (e) {
    console.error(LOG_MD, "Erro extraindo", nome, ":", e);
    return { texto: "", erro: e && e.message ? e.message : String(e) };
  }
}

// Extrai o texto de um documento (PDF ou imagem) para o MD único.
// Documentos "html" NAO passam por aqui - continuam usando
// "obterTextoHtmlReal", ja' existente, que tem seu proprio mecanismo de
// aba oculta (uma por documento).
async function extrairTextoDocumentoMd(tabIdPdf, url, mimetype, nome) {
  if (MIMETYPES_IMAGEM_SEM_OCR.includes(mimetype)) {
    return {
      texto: `_Documento do tipo imagem (${mimetype}) - texto não incluído (sem OCR nesta versão). Consulte o arquivo individual para ver a imagem._`,
      erro: null,
    };
  }

  if (mimetype !== "pdf") {
    return {
      texto: "",
      erro: `Tipo "${mimetype}" não suportado para extração de texto no MD único.`,
    };
  }

  return extrairTextoPdfNaAba(tabIdPdf, url, nome);
}

// ---- Anonimizacao "melhor esforco" ----
//
// IMPORTANTE: isto e' deteccao por padroes (regex) e uma heuristica de
// nomes - nao e' NLP nem usa uma lista real das partes do processo. Serve
// para reduzir a exposicao de dados pessoais mais obvios (CPF/CNPJ,
// telefone, e-mail, linhas de endereco, nomes em Maiuscula+minuscula), mas
// NAO e' uma garantia de anonimizacao completa. Nomes escritos em CAIXA
// ALTA (comuns em petições/certidões) ou formatos atipicos de documento
// podem passar sem ser detectados. Sempre revise o arquivo gerado antes
// de compartilhar externamente.
const REGEX_EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const REGEX_CNPJ = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const REGEX_CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const REGEX_TELEFONE = /\(?\b\d{2}\)?[\s-]?9?\d{4}-?\d{4}\b/g;
const REGEX_CEP = /\b\d{5}-?\d{3}\b/g;
// "\b" nunca da' match logo apos um "." (ponto e o caractere seguinte,
// tipicamente um espaco, sao os dois "nao-palavra" - no ponto de fronteira
// de word boundary): "Av\.\b" ou "Apto\.?\b" simplesmente NUNCA batem
// quando o ponto esta' realmente presente, por mais que pareca que
// deveriam. Por isso as abreviacoes com ponto ficam sem o ponto no
// padrao (so' "Av"/"Apto"): o "\b" ja' delimita a palavra corretamente
// nesse caso (fronteira entre "v"/"o" e o proprio ponto, se houver).
const REGEX_INICIO_ENDERECO = /\b(Rua|Av|Avenida|Alameda|Rodovia|Travessa|Pra[çc]a|Logradouro|Quadra|Lote|Apto|Apartamento|Condom[íi]nio)\b/gi;

// Termina o trecho de endereco assim que encontrar um CEP, um sufixo
// "/UF" (ex.: "/PR") ou uma quebra de paragrafo - o que vier primeiro
// dentro da janela de busca. Pontos e ponto-e-virgula NAO servem de
// terminador aqui: enderecos brasileiros sao cheios de abreviacoes com
// ponto ("n.", "nº", "Av.", "R.") que fariam o corte parar quase
// imediatamente, no meio do proprio inicio do endereco.
const REGEX_TERMINADOR_ENDERECO = /\d{5}-?\d{3}|\/[A-Z]{2}\b|\n\s*\n/;
const JANELA_MAXIMA_ENDERECO = 160;
const LIMITE_SEM_TERMINADOR = 100;

// Substitui so' o TRECHO do endereco (do inicio reconhecido - "Rua",
// "Av", "CEP", etc. - ate' um terminador razoavel logo em seguida), nao a
// linha/paragrafo inteiro. Isso e' importante porque o texto extraido de
// PDF pode ter uma frase inteira numa unica "linha" (ex.: "em face de
// FULANO, residente na Rua X, nº 123, Centro, Cidade/UF") - apagar a
// linha toda destruiria a parte que nao e' endereco. Funciona mesmo
// quando o endereco comeca perto do fim de uma linha e continua na
// linha seguinte (quebra de linha no meio do endereco, comum em PDF).
function redigirEnderecos(texto) {
  let resultado = "";
  let ultimoIndice = 0;
  REGEX_INICIO_ENDERECO.lastIndex = 0;

  let match;
  while ((match = REGEX_INICIO_ENDERECO.exec(texto))) {
    const inicio = match.index;
    if (inicio < ultimoIndice) continue;

    const janela = texto.slice(inicio, inicio + JANELA_MAXIMA_ENDERECO);
    const terminador = janela.match(REGEX_TERMINADOR_ENDERECO);
    const fim = terminador
      ? inicio + terminador.index + terminador[0].length
      : inicio + Math.min(LIMITE_SEM_TERMINADOR, janela.length);

    resultado += texto.slice(ultimoIndice, inicio) + "[endereço removido]";
    ultimoIndice = fim;
    REGEX_INICIO_ENDERECO.lastIndex = fim;
  }

  resultado += texto.slice(ultimoIndice);
  return resultado;
}

// Frases institucionais comuns que o heuristico de nomes (Maiuscula +
// minuscula, 3+ palavras) acertaria por engano - excluidas explicitamente.
const FRASES_NAO_SAO_NOMES = [
  "Poder Judiciário",
  "Tribunal de Justiça",
  "Ministério Público",
  "Justiça Federal",
  "Justiça do Trabalho",
  "Vara Única",
  "Juizado Especial",
  "Diário de Justiça",
  "Secretaria de Vara",
  "Termo de Audiência",
  "Certidão de Publicação",
  "Ato Ordinatório",
];

// Nomes de pessoa reais no Brasil quase sempre tem 3+ palavras (incluindo
// conectivos como "de"/"da"/"dos"). Exigir 3+ (em vez de 2+) reduz bastante
// falsos positivos com termos institucionais de 2 palavras ("Poder
// Judiciário", "Vara Única", etc). Blocos em CAIXA ALTA sao ignorados de
// proposito: no eproc normalmente sao rotulos de evento/situação, nao
// nomes - o efeito colateral e' que nomes de pessoas escritos em CAIXA
// ALTA (comum em petições) nao sao abreviados por este heuristico.
const REGEX_NOME_PROVAVEL =
  /\b[A-ZÀ-Ý][a-zà-ÿ]+(?:\s+(?:de|d[ao]s?|e)\s+[A-ZÀ-Ý][a-zà-ÿ]+|\s+[A-ZÀ-Ý][a-zà-ÿ]+){2,5}\b/g;

// Nomes de parte em CAIXA ALTA (pessoa ou empresa) NAO sao tocados pelo
// heuristico acima de proposito (ver comentario dele) - mas peticoes
// seguem quase sempre um padrao bem especifico logo apos qualificar a
// parte: "NOME EM CAIXA ALTA, brasileiro/brasileira/pessoa jurídica/
// portador(a)/inscrito(a)/residente/domiciliado(a)...". Esse padrao e'
// especifico o suficiente (ao contrario de "CAIXA ALTA" sozinho, que
// pegaria rotulos de evento/situação por engano) para reconhecer com
// seguranca tanto nomes de pessoas quanto de empresas nessa posicao
// especifica, sem exigir uma lista real das partes do processo. Nomes em
// CAIXA ALTA em outros lugares do documento (sem essa qualificação logo
// depois) continuam sem deteccao - e' melhor esforço, nao NLP.
const REGEX_NOME_MAIUSCULO_QUALIFICADO =
  /\b[A-ZÀ-Ý][A-ZÀ-Ý0-9\s.&–-]{3,120}?(?=,\s*(?:pessoa jurídica|pessoa física|brasileiro|brasileira|portador|portadora|inscrit[oa]|residente|domiciliad[oa]))/g;

function abreviarNome(nomeCompleto) {
  const CONECTIVOS = new Set(["de", "da", "do", "dos", "das", "e"]);
  const partes = nomeCompleto.trim().split(/\s+/);
  if (partes.length <= 2) return nomeCompleto;

  const primeiro = partes[0];
  const ultimo = partes[partes.length - 1];
  const meio = partes.slice(1, -1).map((parte) => {
    if (CONECTIVOS.has(parte.toLowerCase())) return parte.toLowerCase();
    if (!/[A-Za-zÀ-ÿ]/.test(parte)) return parte; // pontuação solta (ex.: "–"), mantém como está
    return `${parte[0].toUpperCase()}.`;
  });

  return [primeiro, ...meio, ultimo].join(" ");
}

function anonimizarTexto(texto) {
  let resultado = texto;

  resultado = resultado.replace(REGEX_EMAIL, "[e-mail removido]");
  resultado = resultado.replace(REGEX_CNPJ, "[CNPJ removido]");
  resultado = resultado.replace(REGEX_CPF, "[CPF removido]");
  resultado = resultado.replace(REGEX_TELEFONE, "[telefone removido]");

  // Endereco antes do heuristico de nomes: sem isso, um nome de rua tipo
  // "Rua Conselheiro Antônio Alves Vieira" sobrevivia parcialmente (por
  // nao ter CEP/UF logo ali) e depois era confundido pelo heuristico de
  // nomes, saindo abreviado como se fosse o nome de uma pessoa.
  resultado = redigirEnderecos(resultado);

  // CEP que sobrar solto (sem um inicio de endereco reconhecido por
  // perto) ainda e' removido, so' que sozinho - nao a linha inteira.
  resultado = resultado.replace(REGEX_CEP, "[CEP removido]");

  resultado = resultado.replace(REGEX_NOME_MAIUSCULO_QUALIFICADO, (trecho) => abreviarNome(trecho));

  resultado = resultado.replace(REGEX_NOME_PROVAVEL, (trecho) => {
    if (FRASES_NAO_SAO_NOMES.some((frase) => trecho.includes(frase))) return trecho;
    return abreviarNome(trecho);
  });

  return resultado;
}

// Monta a secao de movimentacao processual (numero do evento, data/hora e
// descricao), sempre a PRIMEIRA secao do documento - antes de qualquer
// anexo, e inclusa mesmo que o processo nao tenha nenhum documento
// anexado. "movimentacao" vem do "listarMovimentacaoProcessual()" do
// content.js (deteccao best-effort, ver comentario la').
// So' usada quando NENHUMA movimentação foi detectada na página (ver
// "listarMovimentacaoProcessual" em content.js) - nesse caso os
// documentos, se houver algum, entram todos no grupo "sem evento
// identificado" de "construirMdUnico".
function construirSecaoMovimentacao(movimentacao) {
  if (!movimentacao || movimentacao.length === 0) {
    return (
      "### Movimentação processual\n\n" +
      "_Não foi possível localizar a tabela de movimentação nesta página " +
      "(ou o processo não possui movimentações registradas)._\n"
    );
  }

  const linhas = movimentacao.map((evento) => {
    const numero = evento.numeroEvento != null ? `Evento ${evento.numeroEvento}` : "Evento";
    return `- **${evento.dataHora}** — ${numero}: ${evento.descricao || "(sem descrição)"}`;
  });

  return `### Movimentação processual\n\n${linhas.join("\n\n")}\n`;
}

// Agrupa os documentos pelo numero do evento a que pertencem (ja'
// detectado em content.js, mesmo campo usado para a numeracao
// sequencial). Documentos cujo evento e' desconhecido, OU cujo numero
// nao bate com nenhum evento realmente detectado na movimentacao (ex.:
// a deteccao de movimentacao falhou nesse tribunal), caem num grupo
// avulso - nenhum documento e' descartado silenciosamente.
function agruparDocumentosPorEvento(documentos, movimentacao) {
  const porEvento = new Map();
  for (const doc of documentos) {
    const chave = doc.evento != null ? doc.evento : null;
    if (!porEvento.has(chave)) porEvento.set(chave, []);
    porEvento.get(chave).push(doc);
  }

  const eventosDetectados = new Set(
    (movimentacao || []).map((e) => e.numeroEvento).filter((n) => n != null)
  );

  const semEvento = [];
  for (const [chave, docs] of Array.from(porEvento.entries())) {
    if (chave == null || !eventosDetectados.has(chave)) {
      semEvento.push(...docs);
      porEvento.delete(chave);
    }
  }

  return { porEvento, semEvento };
}

async function construirMdUnico(documentos, resolverUrl, pastaBase, numeroProcesso, movimentacao, aoProgredir) {
  console.log(LOG_MD, "Iniciando MD único.", documentos.length, "documento(s),", (movimentacao || []).length, "evento(s) de movimentação.");

  const avisos = [];
  const secoesEventos = [];

  // A aba de processamento de PDF so' e' aberta se houver pelo menos um
  // PDF entre os documentos - processos so' com HTML/imagens nao
  // precisam dela.
  let abaPdf = null;
  if (documentos.some((doc) => doc.mimetype === "pdf")) {
    const origemEproc = `${new URL(documentos[0].href).origin}/eproc/controlador.php`;
    abaPdf = await prepararAbaProcessamentoPdfMd(origemEproc);
  }

  const total = documentos.length;
  let concluidos = 0;

  // Processa e devolve o markdown de UM documento (numeracao sequencial
  // global, na ordem em que os documentos vao sendo processados - a
  // mesma ordem cronologica de sempre, so' que agora agrupados por
  // evento em vez de uma lista unica).
  async function processarUmDocumento(doc) {
    const numero = String(concluidos + 1).padStart(4, "0");
    console.log(LOG_MD, `[${concluidos + 1}/${total}]`, doc.nome, `(${doc.mimetype})`);
    if (aoProgredir) aoProgredir(concluidos, total, doc.nome);

    let corpo;
    try {
      const urlReal = await resolverUrl(doc);

      if (doc.mimetype === "html") {
        const { texto, erro } = await obterTextoHtmlReal(urlReal);
        if (texto) {
          corpo = texto;
        } else {
          console.warn(LOG_MD, "Falha ao extrair HTML de", doc.nome, ":", erro);
          corpo = `_Não foi possível extrair o conteúdo deste documento (${erro || "motivo desconhecido"})._`;
          avisos.push(`${doc.nome}: ${erro || "motivo desconhecido"}`);
        }
      } else {
        const resultado = await extrairTextoDocumentoMd(abaPdf && abaPdf.id, urlReal, doc.mimetype, doc.nome);
        if (resultado.erro && !resultado.texto) {
          console.warn(LOG_MD, "Falha ao extrair texto de", doc.nome, ":", resultado.erro);
          corpo = `_Não foi possível extrair o texto deste documento (${resultado.erro})._`;
          avisos.push(`${doc.nome}: ${resultado.erro}`);
        } else {
          corpo = resultado.texto || "_(sem texto identificado)_";
        }
      }
    } catch (e) {
      console.error(LOG_MD, "Erro processando", doc.nome, ":", e);
      corpo = `_Não foi possível processar este documento (${String(e)})._`;
      avisos.push(`${doc.nome}: ${String(e)}`);
    }

    concluidos += 1;
    if (aoProgredir) aoProgredir(concluidos, total, doc.nome);
    return `#### ${numero} — ${doc.nome}\n\n${corpo.trim()}\n`;
  }

  try {
    const { porEvento, semEvento } = agruparDocumentosPorEvento(documentos, movimentacao);

    if (movimentacao && movimentacao.length > 0) {
      for (const evento of movimentacao) {
        const rotuloEvento = evento.numeroEvento != null ? `Evento ${evento.numeroEvento}` : "Evento";
        const linhas = [`### ${rotuloEvento} — ${evento.dataHora} — ${evento.descricao || "(sem descrição)"}`, ""];

        const docsDoEvento = evento.numeroEvento != null ? porEvento.get(evento.numeroEvento) || [] : [];
        if (docsDoEvento.length === 0) {
          linhas.push("_Nenhum documento anexado a este evento._");
        } else {
          for (const doc of docsDoEvento) {
            linhas.push(await processarUmDocumento(doc));
          }
        }
        secoesEventos.push(linhas.join("\n"));
      }
    } else {
      secoesEventos.push(construirSecaoMovimentacao(movimentacao));
    }

    if (semEvento.length > 0) {
      const linhas = ["### Documentos sem evento identificado", ""];
      for (const doc of semEvento) {
        linhas.push(await processarUmDocumento(doc));
      }
      secoesEventos.push(linhas.join("\n"));
    }
  } finally {
    if (abaPdf) {
      console.log(LOG_MD, "Encerrando aba de processamento de PDF", abaPdf.id, "...");
      chrome.tabs.remove(abaPdf.id).catch(() => {});
    }
  }

  console.log(LOG_MD, "Todos os documentos processados. Avisos:", avisos.length);

  const cabecalho = [`# Processo ${numeroProcesso}`, `${new Date().toLocaleString("pt-BR")}`, ""];

  const corpoCompleto = anonimizarTexto([...cabecalho, ...secoesEventos].join("\n\n"));

  const nomeArquivo = `${pastaBase}/${sanitizarNomeArquivo(numeroProcesso)}_completo_anonimizado.md`;
  console.log(LOG_MD, "Baixando arquivo final:", nomeArquivo, `(${corpoCompleto.length} caractere(s))`);
  await baixarUm(nomeArquivo, construirDataUrl("text/markdown", corpoCompleto));
  console.log(LOG_MD, "MD único concluído com sucesso.");
}

// ---- Orquestracao geral ----

async function processarFila(numeroProcesso, documentos, opcoes, movimentacao) {
  const pastaBase = `eproc/${sanitizarNomeArquivo(numeroProcesso)}`;
  const erros = [];

  // As duas fases (individual e PDF unico) precisam da URL real de cada
  // documento; um cache evita buscar a mesma casca duas vezes quando
  // ambas as opcoes estao marcadas. Documentos "html" ficam de fora do
  // cache de propósito: a segunda camada deles (a div preenchida via
  // AJAX) parece nao aceitar bem ser acessada duas vezes com a mesma URL
  // resolvida (a segunda tentativa fica vazia); resolver de novo a cada
  // uso evita reaproveitar uma URL que a outra fase ja tenha consumido.
  const urlsResolvidas = new Map();
  async function obterUrlResolvida(doc) {
    if (doc.mimetype === "html") {
      return resolverUrlReal(doc.href);
    }
    if (urlsResolvidas.has(doc.idDocumento)) return urlsResolvidas.get(doc.idDocumento);
    const urlReal = await resolverUrlReal(doc.href);
    urlsResolvidas.set(doc.idDocumento, urlReal);
    return urlReal;
  }

  if (opcoes.individuais) {
    const total = documentos.length;
    let concluidos = 0;
    const enviarProgresso = () => {
      chrome.runtime.sendMessage({
        tipo: "PROGRESSO_DOWNLOAD",
        fase: "individuais",
        concluidos,
        total,
        erros,
      }).catch(() => {});
    };

    for (let i = 0; i < documentos.length; i += 1) {
      const doc = documentos[i];
      const filename = montarNomeArquivo(pastaBase, doc, i + 1);
      try {
        const urlReal = await obterUrlResolvida(doc);

        if (doc.mimetype === "html") {
          const { html: htmlFinal, erro: erroExtracao } = await obterConteudoHtmlReal(urlReal, doc.nome);
          if (htmlFinal) {
            await baixarUm(filename, construirDataUrl("text/html", htmlFinal));
          } else {
            // Nao foi possivel capturar o conteudo renderizado pela aba;
            // baixa a pagina bruta como ultimo recurso, mas avisa o
            // usuario de que o arquivo pode nao ter o conteudo real.
            erros.push({
              nome: doc.nome,
              mensagem: `Não foi possível extrair o conteúdo renderizado (${
                erroExtracao || "motivo desconhecido"
              }); o arquivo salvo pode não ter o conteúdo real do documento.`,
            });
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
  }

  if (opcoes.pdfUnico) {
    const enviarProgressoPdf = (concluidos, total) => {
      chrome.runtime.sendMessage({
        tipo: "PROGRESSO_DOWNLOAD",
        fase: "pdf-unico",
        concluidos,
        total,
        erros,
      }).catch(() => {});
    };

    try {
      await construirPdfUnico(documentos, obterUrlResolvida, pastaBase, numeroProcesso, enviarProgressoPdf);
    } catch (e) {
      erros.push({ nome: "PDF unico", mensagem: String(e) });
    }
  }

  if (opcoes.mdUnico) {
    const enviarProgressoMd = (concluidos, total, nomeAtual) => {
      chrome.runtime.sendMessage({
        tipo: "PROGRESSO_DOWNLOAD",
        fase: "md-unico",
        concluidos,
        total,
        nomeAtual,
        erros,
      }).catch(() => {});
    };

    try {
      await construirMdUnico(documentos, obterUrlResolvida, pastaBase, numeroProcesso, movimentacao, enviarProgressoMd);
    } catch (e) {
      console.error(LOG_MD, "Erro fatal no MD único:", e);
      erros.push({ nome: "MD unico", mensagem: String(e) });
    }
  }

  chrome.runtime.sendMessage({
    tipo: "DOWNLOAD_FINALIZADO",
    erros,
    pasta: pastaBase,
  }).catch(() => {});
}

// ---- Relatorio Geral (Conclusos para despacho/sentenca) ----

// Valores das opcoes do campo "Situacao" (select#selStatusProcesso) no
// Relatorio Geral, conforme a pagina do eproc analisada.
const VALOR_SITUACAO_AGUARDA_DESPACHO = "M;22;C";
const VALOR_SITUACAO_AGUARDA_SENTENCA = "M;21;C";
const DIAS_LIMITE_ATRASO = 30;

// Faixas usadas no demonstrativo de processos sem movimentação
// (campo #txtDiasSemMovimentacao no Relatório Geral).
const FAIXAS_DIAS_SEM_MOVIMENTACAO = [30, 90, 120];

// Cada consulta (total / urgentes / +30 dias, para cada situacao) agora
// abre sua PROPRIA aba oculta, usada uma unica vez e descartada. Duas
// tentativas anteriores mostraram que reaproveitar a mesma aba para
// interagir duas vezes seguidas com o campo "Informação complementar"
// (Tagify) e' instavel - a primeira consulta na aba sempre funciona, a
// segunda as vezes nao (a tag nao e' adicionada, mesmo esperando a
// remocao da tag anterior terminar). Abrir uma aba nova por consulta
// elimina essa classe de problema por completo (cada aba so' interage
// com esses campos uma unica vez), ao custo de mais alguns segundos por
// consulta (mais um carregamento de pagina).

// Roda inteiramente dentro da pagina "Relatorio Geral de Processos" (via
// chrome.scripting.executeScript): marca a situacao pedida no select
// multiplo, opcionalmente marca o filtro "Informação complementar" =
// "Petição Urgente - Sim" (campo Tagify: id="selDadoComplementar") e/ou
// preenche o campo "Dias na situação" (#txtDiasSituacao), clica em
// "Consultar" e le' o total. Precisa ser autocontida: e' serializada e
// executada no contexto da pagina, sem acesso ao escopo deste arquivo.
// Nunca lanca excecao: sempre resolve com { contagem, erro }.
//
// O dropdown de "Informação complementar" e' nativo do Tagify (confirmado
// via inspecao ao vivo com MutationObserver: os itens de sugestao sao
// "div.tagify__dropdown__item" dentro de "div.tagify__dropdown", com o
// valor exato no atributo "value" - nao e' jQuery UI Autocomplete, apesar
// das classes "ui-autocomplete-*" no wrapper).
function consultarUmaVezNaPagina(parametros) {
  function aguardar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function extrairContagem(texto) {
    const m = (texto || "").match(/\((\d+)\)/);
    return m ? Number(m[1]) : null;
  }

  function selecionarSituacao(valorOpcaoSituacao) {
    const select = document.getElementById("selStatusProcesso");
    if (!select) throw new Error('Campo "Situação" não encontrado nesta página.');

    let encontrouOpcao = false;
    for (const opcao of select.options) {
      const selecionada = opcao.value === valorOpcaoSituacao;
      opcao.selected = selecionada;
      if (selecionada) encontrouOpcao = true;
    }
    if (!encontrouOpcao) {
      throw new Error(`Opção de situação "${valorOpcaoSituacao}" não encontrada na lista.`);
    }
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Usa o setter nativo do HTMLInputElement (em vez de so' "input.value =
  // ...") para garantir que a mudanca seja percebida mesmo se algum
  // framework de formulario estiver "escutando" o proprio setter da
  // propriedade, alem de disparar os eventos nativos "input"/"change".
  function definirDiasSituacao(dias) {
    const input = document.getElementById("txtDiasSituacao");
    if (!input) {
      throw new Error('Campo "Dias na situação" (#txtDiasSituacao) não encontrado nesta página.');
    }
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    nativeSetter.call(input, String(dias));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Mesma logica de "definirDiasSituacao", so' que para o campo "Dias sem
  // movimentação" (#txtDiasSemMovimentacao), usado no demonstrativo de
  // processos parados. Esse campo nao depende de nenhuma situacao
  // selecionada no outro filtro.
  function definirDiasSemMovimentacao(dias) {
    const input = document.getElementById("txtDiasSemMovimentacao");
    if (!input) {
      throw new Error(
        'Campo "Dias sem movimentação" (#txtDiasSemMovimentacao) não encontrado nesta página.'
      );
    }
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    nativeSetter.call(input, String(dias));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Simula a digitacao no span editavel do Tagify e clica no item do
  // dropdown cujo atributo "value" bate com o alvo.
  async function marcarPeticaoUrgente() {
    const wrapper = document.getElementById("selDadoComplementar-wrapper");
    if (!wrapper) {
      throw new Error('Campo "Informação complementar" não encontrado nesta página.');
    }
    const inputSpan = wrapper.querySelector(".tagify__input");
    const tagsEl = wrapper.querySelector("tags.tagify");
    if (!inputSpan || !tagsEl) {
      throw new Error('Estrutura do campo "Informação complementar" não reconhecida.');
    }

    const TEXTO_BUSCA = "Petição Urgente";
    const VALOR_ALVO = "Petição Urgente - Sim";

    inputSpan.focus();
    inputSpan.textContent = TEXTO_BUSCA;
    inputSpan.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText", data: TEXTO_BUSCA })
    );

    let itemAlvo = null;
    for (let tentativa = 0; tentativa < 25; tentativa += 1) {
      await aguardar(200);
      itemAlvo =
        document.querySelector(`.tagify__dropdown__item[value="${VALOR_ALVO}"]`) ||
        Array.from(document.querySelectorAll(".tagify__dropdown__item")).find(
          (el) => (el.textContent || "").trim() === VALOR_ALVO
        );
      if (itemAlvo) break;
    }

    if (!itemAlvo) {
      throw new Error(`Sugestão "${VALOR_ALVO}" não encontrada no dropdown do Tagify.`);
    }

    itemAlvo.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    itemAlvo.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    itemAlvo.click();

    await aguardar(200);

    if (tagsEl.querySelectorAll(".tagify__tag").length === 0) {
      throw new Error('A tag "Petição Urgente - Sim" não foi adicionada ao campo.');
    }
  }

  async function clicarConsultarELer() {
    const botaoConsultar = document.querySelector('button.btnConsultar[form="frmProcessoLista"]');
    if (!botaoConsultar) throw new Error('Botão "Consultar" não encontrado nesta página.');

    const badgeAntes = document.getElementById("tblProcessoLista_info-badge");
    const textoAntes = badgeAntes ? badgeAntes.textContent : null;

    botaoConsultar.click();

    // A consulta e' via AJAX (sem recarregar a pagina); espera o texto do
    // badge mudar (ou, apos um tempo minimo sem estar mais "Processando",
    // aceita o valor atual mesmo que igual ao anterior).
    for (let tentativa = 0; tentativa < 40; tentativa += 1) {
      await aguardar(250);
      const badge = document.getElementById("tblProcessoLista_info-badge");
      const textoAtual = badge ? badge.textContent : null;
      const elementoProcessando = document.getElementById("tblProcessoLista_processing");
      const estaProcessando =
        elementoProcessando && getComputedStyle(elementoProcessando).display !== "none";

      if (badge && !estaProcessando && textoAtual !== textoAntes) {
        return extrairContagem(textoAtual);
      }
      if (badge && !estaProcessando && tentativa > 8) {
        return extrairContagem(textoAtual);
      }
    }

    throw new Error("Tempo esgotado esperando o resultado da consulta.");
  }

  return (async () => {
    try {
      // O filtro "Dias sem movimentação" (demonstrativo de processos
      // parados) e' independente da "Situação": nesse caso
      // "parametros.valorSituacao" vem nulo e o select nao e' tocado.
      if (parametros.valorSituacao) {
        selecionarSituacao(parametros.valorSituacao);
      }

      if (parametros.diasSituacao != null) {
        definirDiasSituacao(parametros.diasSituacao);
      }

      if (parametros.diasSemMovimentacao != null) {
        definirDiasSemMovimentacao(parametros.diasSemMovimentacao);
      }

      if (parametros.urgente) {
        await marcarPeticaoUrgente();
      }

      await aguardar(200);
      const contagem = await clicarConsultarELer();
      return { contagem, erro: null };
    } catch (e) {
      return { contagem: null, erro: e && e.message ? e.message : String(e) };
    }
  })();
}

// Encontra e clica no link "Relatório Geral", que ja existe no DOM mesmo
// com o menu lateral colapsado (o collapse e' so' visual via CSS) -
// entao nao e' preciso simular o clique no item "Relatórios" do menu
// antes. Autocontida, executada via chrome.scripting.executeScript.
function clicarLinkRelatorioGeralNaPagina() {
  const link = document.querySelector('a[href*="acao=relatorio_geral_listar"]');
  if (!link) return false;
  link.click();
  return true;
}

// Roda ja' na tela do Relatório Geral, apos uma consulta ter sido feita:
// abre o menu "Exportar" da tabela de resultados (botao dropdown do
// DataTables Buttons) e clica na opcao "Excel", disparando o download da
// planilha que o proprio eproc gera. Autocontida, executada via
// chrome.scripting.executeScript. Nunca lanca excecao: sempre resolve com
// { ok, erro }.
function exportarExcelNaPagina() {
  function aguardar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  return (async () => {
    try {
      const botaoExportar = document.querySelector(
        'a.btn-acoes-bloco.dropdown-toggle[aria-controls="tblProcessoLista"]'
      );
      if (!botaoExportar) {
        throw new Error('Botão "Exportar" não encontrado nesta página.');
      }
      botaoExportar.click();

      let botaoExcel = null;
      for (let tentativa = 0; tentativa < 25; tentativa += 1) {
        await aguardar(200);
        botaoExcel =
          document.querySelector(
            'a.buttons-excel.buttons-html5[aria-controls="tblProcessoLista"]'
          ) ||
          Array.from(document.querySelectorAll("a.dt-button.dropdown-item")).find(
            (el) => (el.textContent || "").trim() === "Excel"
          );
        if (botaoExcel) break;
      }

      if (!botaoExcel) {
        throw new Error('Opção "Excel" não encontrada no menu de exportação.');
      }

      botaoExcel.click();
      return { ok: true, erro: null };
    } catch (e) {
      return { ok: false, erro: e && e.message ? e.message : String(e) };
    }
  })();
}

// Abre uma aba oculta nova, navega ate' o Relatório Geral e roda UMA
// consulta nela, depois fecha a aba. Ver comentario acima de
// "consultarUmaVezNaPagina" sobre por que cada consulta usa sua propria
// aba em vez de reaproveitar uma so'.
async function abrirAbaEConsultarUmaVez(urlBase, parametros) {
  let aba;
  try {
    aba = await chrome.tabs.create({ url: urlBase, active: false });
    await aguardarCarregamentoAba(aba.id);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const [{ result: linkEncontrado } = {}] = await chrome.scripting.executeScript({
      target: { tabId: aba.id },
      func: clicarLinkRelatorioGeralNaPagina,
    });

    if (!linkEncontrado) {
      return {
        contagem: null,
        erro:
          'Link "Relatório Geral" não encontrado na página atual. Abra uma página do eproc com o menu lateral (ex.: a tela de um processo) e tente novamente.',
      };
    }

    await aguardarCarregamentoAba(aba.id);
    // Pequena espera extra para os scripts da pagina (bootstrap-select,
    // tagify etc.) terminarem de inicializar apos o carregamento.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId: aba.id },
      func: consultarUmaVezNaPagina,
      args: [parametros],
    });

    return result || { contagem: null, erro: "Não foi possível consultar (sem resultado)." };
  } catch (e) {
    return { contagem: null, erro: e && e.message ? e.message : String(e) };
  } finally {
    if (aba && aba.id) {
      chrome.tabs.remove(aba.id).catch(() => {});
    }
  }
}

async function gerarRelatorioGeral(aoProgredir) {
  const notificar = (texto) => {
    if (aoProgredir) aoProgredir(texto);
  };

  const [abaAtual] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!abaAtual || !abaAtual.url) {
    throw new Error("Nenhuma aba ativa encontrada. Abra uma página do eproc primeiro.");
  }

  async function consultarBloco(nomeSituacao, valorSituacao) {
    const bloco = { total: null, urgentes: null, mais30Dias: null, erros: [] };

    notificar(`Consultando ${nomeSituacao}: total...`);
    let r = await abrirAbaEConsultarUmaVez(abaAtual.url, {
      valorSituacao,
      urgente: false,
      diasSituacao: null,
    });
    bloco.total = r.contagem;
    if (r.erro) bloco.erros.push(`total: ${r.erro}`);

    notificar(`Consultando ${nomeSituacao}: urgentes...`);
    r = await abrirAbaEConsultarUmaVez(abaAtual.url, {
      valorSituacao,
      urgente: true,
      diasSituacao: null,
    });
    bloco.urgentes = r.contagem;
    if (r.erro) bloco.erros.push(`urgentes: ${r.erro}`);

    notificar(`Consultando ${nomeSituacao}: há mais de ${DIAS_LIMITE_ATRASO} dias...`);
    r = await abrirAbaEConsultarUmaVez(abaAtual.url, {
      valorSituacao,
      urgente: false,
      diasSituacao: DIAS_LIMITE_ATRASO,
    });
    bloco.mais30Dias = r.contagem;
    if (r.erro) bloco.erros.push(`+${DIAS_LIMITE_ATRASO} dias: ${r.erro}`);

    return bloco;
  }

  const despacho = await consultarBloco("MOVIMENTO-AGUARDA DESPACHO", VALOR_SITUACAO_AGUARDA_DESPACHO);
  const sentenca = await consultarBloco("MOVIMENTO-AGUARDA SENTENÇA", VALOR_SITUACAO_AGUARDA_SENTENCA);

  const semMovimentacao = { erros: [] };
  for (const dias of FAIXAS_DIAS_SEM_MOVIMENTACAO) {
    notificar(`Consultando processos sem movimentação há mais de ${dias} dias...`);
    const r = await abrirAbaEConsultarUmaVez(abaAtual.url, {
      valorSituacao: null,
      urgente: false,
      diasSituacao: null,
      diasSemMovimentacao: dias,
    });
    semMovimentacao[`dias${dias}`] = r.contagem;
    if (r.erro) semMovimentacao.erros.push(`${dias} dias: ${r.erro}`);
  }

  notificar("Finalizando...");
  return { despacho, sentenca, semMovimentacao };
}

// Atalho: navega a aba ATUAL (visivel) direto para a tela do Relatório
// Geral, sem consultar nada - so' um jeito rapido de chegar la'
// manualmente.
async function abrirTelaRelatorioGeral() {
  const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!aba || !aba.id) {
    throw new Error("Nenhuma aba ativa encontrada. Abra uma página do eproc primeiro.");
  }

  const [{ result: linkEncontrado } = {}] = await chrome.scripting.executeScript({
    target: { tabId: aba.id },
    func: clicarLinkRelatorioGeralNaPagina,
  });

  if (!linkEncontrado) {
    throw new Error(
      'Link "Relatório Geral" não encontrado na página atual. Abra uma página do eproc com o menu lateral (ex.: a tela de um processo) e tente novamente.'
    );
  }
}

// Traduz os identificadores usados no painel para os parametros que
// "consultarUmaVezNaPagina" entende. Duas categorias de relatorio:
// - "situacao" (padrao): situacao "despacho"/"sentenca" + filtro
//   "total"/"urgentes"/"mais30Dias".
// - "semMovimentacao": demonstrativo de processos parados, sem situacao
//   nenhuma selecionada; filtro e' a quantidade de dias ("30"/"90"/"120").
function resolverParametrosConsulta(categoria, situacao, filtro) {
  if (categoria === "semMovimentacao") {
    return {
      valorSituacao: null,
      urgente: false,
      diasSituacao: null,
      diasSemMovimentacao: Number(filtro),
    };
  }

  const valorSituacao =
    situacao === "sentenca" ? VALOR_SITUACAO_AGUARDA_SENTENCA : VALOR_SITUACAO_AGUARDA_DESPACHO;

  if (filtro === "urgentes") {
    return { valorSituacao, urgente: true, diasSituacao: null };
  }
  if (filtro === "mais30Dias") {
    return { valorSituacao, urgente: false, diasSituacao: DIAS_LIMITE_ATRASO };
  }
  return { valorSituacao, urgente: false, diasSituacao: null };
}

// Nome amigavel do arquivo Excel exportado, baseado na categoria/situacao/
// filtro escolhidos, para o download sair identificado (em vez do nome
// generico que o DataTables Buttons usa por padrao).
function nomeArquivoRelatorio(categoria, situacao, filtro) {
  if (categoria === "semMovimentacao") {
    return `relatorio_sem_movimentacao_${filtro}dias`;
  }
  const nomeSituacao = situacao === "sentenca" ? "sentenca" : "despacho";
  const nomeFiltro =
    filtro === "urgentes" ? "urgentes" : filtro === "mais30Dias" ? "mais30dias" : "total";
  return `relatorio_${nomeSituacao}_${nomeFiltro}`;
}

// Renomeia o PROXIMO download que comecar (dentro de um prazo curto) para
// "eproc/<nomeArquivo><extensao original>", preservando a extensao que o
// eproc gerou (normalmente .xlsx). Usado logo antes de disparar a
// exportacao Excel, ja que o nome que o DataTables Buttons da ao arquivo
// nao identifica qual relatorio/filtro gerou aquela planilha.
function aguardarERenomearProximoDownload(nomeArquivo) {
  return new Promise((resolve) => {
    let finalizado = false;
    const finalizar = (sucesso) => {
      if (finalizado) return;
      finalizado = true;
      chrome.downloads.onDeterminingFilename.removeListener(listener);
      resolve(sucesso);
    };
    const timeoutId = setTimeout(() => finalizar(false), 15000);
    function listener(downloadItem, suggest) {
      clearTimeout(timeoutId);
      const extensaoOriginal = (downloadItem.filename.match(/\.[^.]+$/) || [".xlsx"])[0];
      suggest({ filename: `eproc/${nomeArquivo}${extensaoOriginal}` });
      finalizar(true);
    }
    chrome.downloads.onDeterminingFilename.addListener(listener);
  });
}

// Clicando num numero do relatorio (ex.: "Conclusos para despacho: 11"):
// abre uma aba NOVA (em primeiro plano, para o usuario poder acompanhar),
// navega ate' o Relatório Geral e deixa ele ja' consultado com o mesmo
// filtro daquele numero, para o usuario conferir a lista de processos por
// tras dele - opcionalmente exportando a planilha Excel tambem. A aba
// ATUAL/principal (de onde o clique partiu) nunca e' navegada nem
// alterada: so' serve para saber a URL base do eproc a reabrir na aba
// nova. Essa aba nova permanece aberta ao final (nao e' fechada), ja que
// o objetivo e' mostrar o resultado (ou o download) para o usuario.
async function abrirRelatorioPreenchido(categoria, situacao, filtro, exportarExcel) {
  const parametros = resolverParametrosConsulta(categoria, situacao, filtro);

  const [abaOrigem] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!abaOrigem || !abaOrigem.url) {
    throw new Error("Nenhuma aba ativa encontrada. Abra uma página do eproc primeiro.");
  }

  const aba = await chrome.tabs.create({ url: abaOrigem.url, active: true });
  await aguardarCarregamentoAba(aba.id);
  await new Promise((resolve) => setTimeout(resolve, 500));

  const [{ result: linkEncontrado } = {}] = await chrome.scripting.executeScript({
    target: { tabId: aba.id },
    func: clicarLinkRelatorioGeralNaPagina,
  });

  if (!linkEncontrado) {
    throw new Error(
      'Link "Relatório Geral" não encontrado na página atual. Abra uma página do eproc com o menu lateral (ex.: a tela de um processo) e tente novamente.'
    );
  }

  await aguardarCarregamentoAba(aba.id);
  // Pequena espera extra para os scripts da pagina (bootstrap-select,
  // tagify etc.) terminarem de inicializar apos o carregamento.
  await new Promise((resolve) => setTimeout(resolve, 500));

  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId: aba.id },
    func: consultarUmaVezNaPagina,
    args: [parametros],
  });

  if (result && result.erro) {
    throw new Error(result.erro);
  }

  if (exportarExcel) {
    const nomeArquivo = nomeArquivoRelatorio(categoria, situacao, filtro);
    const promessaRenomeio = aguardarERenomearProximoDownload(nomeArquivo);

    const [{ result: resultadoExcel } = {}] = await chrome.scripting.executeScript({
      target: { tabId: aba.id },
      func: exportarExcelNaPagina,
    });

    if (resultadoExcel && resultadoExcel.erro) {
      throw new Error(resultadoExcel.erro);
    }

    await promessaRenomeio;
  }
}

chrome.runtime.onMessage.addListener((mensagem, sender, sendResponse) => {
  if (mensagem && mensagem.tipo === "BAIXAR_DOCUMENTOS") {
    const opcoes = mensagem.opcoes || { individuais: true, pdfUnico: false, mdUnico: false };
    processarFila(mensagem.numeroProcesso, mensagem.documentos, opcoes, mensagem.movimentacao);
    sendResponse({ ok: true });
    return true;
  }

  if (mensagem && mensagem.tipo === "GERAR_RELATORIO") {
    // Mesmo padrao de BAIXAR_DOCUMENTOS: confirma o recebimento na hora e
    // avisa o resultado final por uma mensagem separada
    // (RELATORIO_FINALIZADO), em vez de manter a chamada original
    // pendurada esperando uma unica resposta. Esse fluxo demora vários
    // segundos (varias trocas de aba/pagina); manter só um canal de
    // resposta pendente por tanto tempo é frágil - se o service worker
    // for suspenso e reativado no meio do caminho, a promessa original
    // nunca resolve e a UI fica "pendurada".
    gerarRelatorioGeral((texto) => {
      chrome.runtime.sendMessage({ tipo: "PROGRESSO_RELATORIO", texto }).catch(() => {});
    })
      .then((resultado) => {
        chrome.runtime.sendMessage({ tipo: "RELATORIO_FINALIZADO", ok: true, resultado }).catch(() => {});
      })
      .catch((e) => {
        chrome.runtime
          .sendMessage({
            tipo: "RELATORIO_FINALIZADO",
            ok: false,
            erro: e && e.message ? e.message : String(e),
          })
          .catch(() => {});
      });
    sendResponse({ ok: true });
    return true;
  }

  if (mensagem && mensagem.tipo === "ABRIR_TELA_RELATORIO") {
    abrirTelaRelatorioGeral()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, erro: e && e.message ? e.message : String(e) }));
    return true;
  }

  if (mensagem && mensagem.tipo === "ABRIR_RELATORIO_PREENCHIDO") {
    // Mesmo padrao de GERAR_RELATORIO: essa operacao tambem navega a aba e
    // espera o carregamento/consulta terminar (alguns segundos), entao usa
    // confirmacao imediata + mensagem separada de conclusao em vez de um
    // unico sendResponse pendurado.
    abrirRelatorioPreenchido(mensagem.categoria, mensagem.situacao, mensagem.filtro, mensagem.exportarExcel)
      .then(() => {
        chrome.runtime
          .sendMessage({ tipo: "RELATORIO_PREENCHIDO_FINALIZADO", ok: true })
          .catch(() => {});
      })
      .catch((e) => {
        chrome.runtime
          .sendMessage({
            tipo: "RELATORIO_PREENCHIDO_FINALIZADO",
            ok: false,
            erro: e && e.message ? e.message : String(e),
          })
          .catch(() => {});
      });
    sendResponse({ ok: true });
    return true;
  }

  if (mensagem && mensagem.tipo === "ABRIR_PAINEL_LATERAL") {
    // Enviada pelo botao que o content script injeta ao lado da logo do
    // Portal jus.br. sidePanel.open() so' funciona chamado em resposta
    // direta a um gesto do usuario - por isso e' chamado aqui de imediato,
    // sem nenhum "await" antes, na mesma volta de evento em que a
    // mensagem chega (o clique que originou a mensagem ainda conta como o
    // gesto do usuario).
    const tabId = sender && sender.tab && sender.tab.id;
    if (!tabId || !chrome.sidePanel || !chrome.sidePanel.open) {
      sendResponse({ ok: false, erro: "Não foi possível abrir o painel lateral." });
      return false;
    }
    chrome.sidePanel
      .open({ tabId })
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, erro: e && e.message ? e.message : String(e) }));
    return true;
  }

  return false;
});
