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
async function abrirAbaEExtrairHtmlDivDochtml(url) {
  let tab;
  try {
    tab = await chrome.tabs.create({ url, active: false });
    await aguardarCarregamentoAba(tab.id);

    let conteudo = "";
    for (let tentativa = 0; tentativa < 25; tentativa += 1) {
      conteudo = await lerHtmlDivDochtml(tab.id);
      if (conteudo && conteudo.trim()) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    return conteudo && conteudo.trim() ? conteudo : null;
  } catch (e) {
    return null;
  } finally {
    if (tab && tab.id) {
      chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
}

async function obterConteudoHtmlReal(url, nomeDocumento) {
  const conteudo = await abrirAbaEExtrairHtmlDivDochtml(url);
  if (!conteudo) return null;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${nomeDocumento}</title></head><body>${conteudo}</body></html>`;
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
  const html = await abrirAbaEExtrairHtmlDivDochtml(url);
  if (!html) return null;
  return converterHtmlParaTextoSimples(html);
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
    const texto = await obterTextoHtmlReal(urlReal);
    if (texto) {
      adicionarTextoComoPaginas(pdfFinal, fonteTexto, doc.nome, texto);
      return;
    }
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
  // ambas as opcoes estao marcadas.
  const urlsResolvidas = new Map();
  async function obterUrlResolvida(doc) {
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
// chrome.scripting.executeScript): para cada valor de situacao, marca so'
// aquela opcao no select multiplo, dispara "change" (o bootstrap-select e
// os handlers do eproc dependem desse evento nativo do <select>), clica
// em "Consultar" e espera o badge de contagem "(N)" mudar antes de ler o
// numero. Precisa ser uma funcao autocontida: e' serializada e executada
// no contexto da pagina, sem acesso ao escopo deste arquivo.
function coletarContagensRelatorioGeralNaPagina(valoresSituacao) {
  function aguardar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function extrairContagem(texto) {
    const m = (texto || "").match(/\((\d+)\)/);
    return m ? Number(m[1]) : null;
  }

  async function selecionarSituacaoEConsultar(valorOpcao) {
    const select = document.getElementById("selStatusProcesso");
    if (!select) throw new Error('Campo "Situação" não encontrado nesta página.');

    let encontrouOpcao = false;
    for (const opcao of select.options) {
      const selecionada = opcao.value === valorOpcao;
      opcao.selected = selecionada;
      if (selecionada) encontrouOpcao = true;
    }
    if (!encontrouOpcao) {
      throw new Error(`Opção de situação "${valorOpcao}" não encontrada na lista.`);
    }
    select.dispatchEvent(new Event("change", { bubbles: true }));

    // Da' tempo do bootstrap-select atualizar visualmente antes de
    // consultar (nao estritamente necessario, mas mais fiel ao fluxo real
    // de uso e evita clicar antes do componente terminar de reagir).
    await aguardar(200);

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
    const resultado = {};
    for (const [chave, valorOpcao] of Object.entries(valoresSituacao)) {
      resultado[chave] = await selecionarSituacaoEConsultar(valorOpcao);
    }
    return resultado;
  })();
}

async function gerarRelatorioGeral() {
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
    abaOculta = await chrome.tabs.create({ url: abaAtual.url, active: false });
    await aguardarCarregamentoAba(abaOculta.id);
    await new Promise((resolve) => setTimeout(resolve, 500));

    // O link "Relatório Geral" ja existe no DOM mesmo com o menu lateral
    // colapsado (o collapse e' so' visual via CSS), entao nao e' preciso
    // simular o clique no item "Relatórios" do menu antes.
    const [{ result: linkEncontrado } = {}] = await chrome.scripting.executeScript({
      target: { tabId: abaOculta.id },
      func: () => {
        const link = document.querySelector('a[href*="acao=relatorio_geral_listar"]');
        if (!link) return false;
        link.click();
        return true;
      },
    });

    if (!linkEncontrado) {
      throw new Error(
        'Link "Relatório Geral" não encontrado na página atual. Abra uma página do eproc com o menu lateral (ex.: a tela de um processo) e tente novamente.'
      );
    }

    await aguardarCarregamentoAba(abaOculta.id);
    // Pequena espera extra para os scripts da pagina (bootstrap-select
    // etc.) terminarem de inicializar apos o carregamento.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const [{ result: contagens } = {}] = await chrome.scripting.executeScript({
      target: { tabId: abaOculta.id },
      func: coletarContagensRelatorioGeralNaPagina,
      args: [
        {
          conclusosDespacho: VALOR_SITUACAO_AGUARDA_DESPACHO,
          conclusosSentenca: VALOR_SITUACAO_AGUARDA_SENTENCA,
        },
      ],
    });

    if (!contagens) {
      throw new Error("Não foi possível coletar os dados do Relatório Geral.");
    }

    return contagens;
  } finally {
    if (abaOculta && abaOculta.id) {
      chrome.tabs.remove(abaOculta.id).catch(() => {});
    }
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
    gerarRelatorioGeral()
      .then((resultado) => sendResponse({ ok: true, resultado }))
      .catch((e) => sendResponse({ ok: false, erro: e && e.message ? e.message : String(e) }));
    return true;
  }

  return false;
});
