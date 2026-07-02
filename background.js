// Service worker: recebe a lista de documentos do painel e dispara os
// downloads via chrome.downloads, um de cada vez, reportando progresso.
// Tambem sabe montar um PDF unico combinando todos os documentos, usando
// a biblioteca vendorizada pdf-lib (libs/pdf-lib.min.js).

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
    function listener(idAtualizado, changeInfo) {
      if (idAtualizado === tabId && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function lerHtmlDivDochtml(tabId) {
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
async function abrirAbaEExtrairHtmlDivDochtml(url) {
  let tab;
  try {
    try {
      tab = await chrome.tabs.create({ url, active: false });
    } catch (e) {
      return { conteudo: null, erro: `Falha ao abrir aba oculta: ${String(e)}` };
    }

    await aguardarCarregamentoAba(tab.id);

    let conteudo = "";
    for (let tentativa = 0; tentativa < 60; tentativa += 1) {
      conteudo = await lerHtmlDivDochtml(tab.id);
      if (conteudo && conteudo.trim()) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    if (!conteudo || !conteudo.trim()) {
      return {
        conteudo: null,
        erro: 'Conteúdo não carregou a tempo (div "#divdochtml" continuou vazia).',
      };
    }
    return { conteudo, erro: null };
  } catch (e) {
    return { conteudo: null, erro: String(e) };
  } finally {
    if (tab && tab.id) {
      chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
}

async function obterConteudoHtmlReal(url, nomeDocumento) {
  const { conteudo, erro } = await abrirAbaEExtrairHtmlDivDochtml(url);
  if (!conteudo) return { html: null, erro };
  return {
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${nomeDocumento}</title></head><body>${conteudo}</body></html>`,
    erro: null,
  };
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
  const { conteudo, erro } = await abrirAbaEExtrairHtmlDivDochtml(url);
  if (!conteudo) return { texto: null, erro };
  const texto = converterHtmlParaTextoSimples(conteudo);
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

// ---- Orquestracao geral ----

async function processarFila(numeroProcesso, documentos, opcoes) {
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

// Roda inteiramente dentro da pagina "Relatorio Geral de Processos" (via
// chrome.scripting.executeScript): marca a situacao pedida no select
// multiplo, consulta o total, depois marca tambem o filtro "Informação
// complementar" = "Petição Urgente - Sim" (campo Tagify:
// id="selDadoComplementar") e consulta de novo para saber quantos desses
// sao urgentes. Precisa ser autocontida: e' serializada e executada no
// contexto da pagina, sem acesso ao escopo deste arquivo.
//
// A parte de urgencia depende do dropdown nativo do Tagify (confirmado
// via inspecao ao vivo com MutationObserver: os itens de sugestao sao
// "div.tagify__dropdown__item" dentro de "div.tagify__dropdown", com o
// valor exato no atributo "value" - nao e' jQuery UI Autocomplete, apesar
// das classes "ui-autocomplete-*" no wrapper). Se a sugestao nao for
// encontrada por algum motivo (ex.: mudanca na pagina), a consulta do
// total ainda funciona normalmente; so' o numero de urgentes fica nulo
// com um aviso explicando o motivo.
function consultarSituacaoComUrgenciaNaPagina(valorOpcao) {
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

  function limparInformacaoComplementar() {
    const wrapper = document.getElementById("selDadoComplementar-wrapper");
    if (!wrapper) return;
    wrapper.querySelectorAll(".tagify__tag__removeBtn").forEach((botao) => botao.click());
  }

  // O campo "Informação complementar" e' um Tagify de verdade, com o
  // dropdown de sugestoes NATIVO da propria biblioteca (confirmado via
  // MutationObserver numa sessao real: os itens aparecem como
  // "div.tagify__dropdown__item" dentro de "div.tagify__dropdown", com o
  // valor exato no atributo "value" - nao e' jQuery UI Autocomplete, as
  // classes "ui-autocomplete-*" no wrapper eram so' nomenclatura, sem o
  // widget de fato instanciado). Simula a digitacao no span editavel do
  // Tagify (que já demonstrado funcionar: o dropdown real reage e filtra
  // ao digitar) e clica no item cujo atributo "value" bate com o alvo.
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

    limparInformacaoComplementar();
    await aguardar(150);

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
    selecionarSituacao(valorOpcao);
    limparInformacaoComplementar();
    // Da' tempo do bootstrap-select/tagify atualizarem visualmente antes
    // de consultar (nao estritamente necessario, mas mais fiel ao fluxo
    // real de uso e evita clicar antes dos componentes reagirem).
    await aguardar(200);

    const total = await clicarConsultarELer();

    let urgentes = null;
    let erroUrgentes = null;
    try {
      await marcarPeticaoUrgente();
      await aguardar(200);
      urgentes = await clicarConsultarELer();
    } catch (e) {
      erroUrgentes = e && e.message ? e.message : String(e);
    } finally {
      limparInformacaoComplementar();
    }

    return { total, urgentes, erroUrgentes };
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

async function gerarRelatorioGeral(aoProgredir) {
  const notificar = (texto) => {
    if (aoProgredir) aoProgredir(texto);
  };

  const [abaAtual] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!abaAtual || !abaAtual.url) {
    throw new Error("Nenhuma aba ativa encontrada. Abra uma página do eproc primeiro.");
  }

  // Abre uma aba oculta (active: false) com a mesma pagina/sessao da aba
  // atual, para nao alterar o que o usuario esta vendo. Todo o fluxo
  // (achar o link, navegar, selecionar situacao, consultar) acontece
  // nessa aba oculta, que e' fechada ao final.
  let abaOculta;
  try {
    notificar("Abrindo aba oculta com a mesma sessão...");
    abaOculta = await chrome.tabs.create({ url: abaAtual.url, active: false });
    await aguardarCarregamentoAba(abaOculta.id);
    await new Promise((resolve) => setTimeout(resolve, 500));

    notificar('Localizando o link "Relatório Geral" no menu...');
    const [{ result: linkEncontrado } = {}] = await chrome.scripting.executeScript({
      target: { tabId: abaOculta.id },
      func: clicarLinkRelatorioGeralNaPagina,
    });

    if (!linkEncontrado) {
      throw new Error(
        'Link "Relatório Geral" não encontrado na página atual. Abra uma página do eproc com o menu lateral (ex.: a tela de um processo) e tente novamente.'
      );
    }

    notificar("Carregando a página do Relatório Geral...");
    await aguardarCarregamentoAba(abaOculta.id);
    // Pequena espera extra para os scripts da pagina (bootstrap-select
    // etc.) terminarem de inicializar apos o carregamento.
    await new Promise((resolve) => setTimeout(resolve, 500));

    notificar('Consultando "MOVIMENTO-AGUARDA DESPACHO" (total e urgentes)...');
    const [{ result: resultadoDespacho } = {}] = await chrome.scripting.executeScript({
      target: { tabId: abaOculta.id },
      func: consultarSituacaoComUrgenciaNaPagina,
      args: [VALOR_SITUACAO_AGUARDA_DESPACHO],
    });

    notificar('Consultando "MOVIMENTO-AGUARDA SENTENÇA" (total e urgentes)...');
    const [{ result: resultadoSentenca } = {}] = await chrome.scripting.executeScript({
      target: { tabId: abaOculta.id },
      func: consultarSituacaoComUrgenciaNaPagina,
      args: [VALOR_SITUACAO_AGUARDA_SENTENCA],
    });

    notificar("Finalizando...");
    return {
      conclusosDespacho: resultadoDespacho ? resultadoDespacho.total : null,
      conclusosDespachoUrgentes: resultadoDespacho ? resultadoDespacho.urgentes : null,
      avisoUrgenciaDespacho: resultadoDespacho ? resultadoDespacho.erroUrgentes : null,
      conclusosSentenca: resultadoSentenca ? resultadoSentenca.total : null,
      conclusosSentencaUrgentes: resultadoSentenca ? resultadoSentenca.urgentes : null,
      avisoUrgenciaSentenca: resultadoSentenca ? resultadoSentenca.erroUrgentes : null,
    };
  } finally {
    if (abaOculta && abaOculta.id) {
      chrome.tabs.remove(abaOculta.id).catch(() => {});
    }
  }
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

chrome.runtime.onMessage.addListener((mensagem, sender, sendResponse) => {
  if (mensagem && mensagem.tipo === "BAIXAR_DOCUMENTOS") {
    const opcoes = mensagem.opcoes || { individuais: true, pdfUnico: false };
    processarFila(mensagem.numeroProcesso, mensagem.documentos, opcoes);
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

  return false;
});
