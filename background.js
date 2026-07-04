// Service worker: recebe a lista de documentos do painel e dispara os
// downloads via chrome.downloads, um de cada vez, reportando progresso.
// Tambem sabe montar um PDF unico (pdf-lib, aqui mesmo no service worker)
// e um MD unico com texto anonimizado - a extracao de texto de PDF (via
// pdf.js) roda numa aba oculta, nao aqui (ver comentario mais abaixo,
// perto de "Construcao do MD unico", sobre o motivo).

importScripts("libs/pdf-lib.min.js");
const { PDFDocument, StandardFonts, rgb } = self.PDFLib;

// Identidade visual institucional (TJPR/eProc) reaproveitada em todos os
// PDFs gerados pela extensao (tabelas de Localizadores/Processos/
// Remessas e o resumo do Relatório Gerencial da Unidade) - mesma paleta
// ja' usada nos documentos HTML exportados (Regras de Automação), para
// manter consistencia visual entre os diferentes formatos de saida.
const COR_PRIMARIA_ESCURA = rgb(0x1c / 255, 0x3d / 255, 0x5a / 255); // #1c3d5a
const COR_PRIMARIA = rgb(0x2c / 255, 0x6e / 255, 0xa6 / 255); // #2c6ea6
const COR_CINZA_TEXTO = rgb(0.35, 0.35, 0.35);
const COR_CINZA_CLARO = rgb(0.95, 0.96, 0.97);
const COR_CINZA_BORDA = rgb(0.82, 0.85, 0.87);
const COR_BRANCO = rgb(1, 1, 1);
const COR_ALERTA_VERMELHO = rgb(0.75, 0.1, 0.1);

// ---- Semáforo global de abas ocultas ----
//
// O Relatório da Unidade (e outras rotinas desta extensão) abre várias
// abas ocultas em paralelo (uma por consulta/bloco) para ir mais rápido.
// Sem um limite, nada impede dezenas de abas serem abertas ao mesmo
// tempo, o que pode sobrecarregar o navegador e, principalmente, fazer o
// próprio eproc bloquear/atrasar por excesso de requisições simultâneas
// da mesma sessão. Este semáforo é compartilhado por TODA função que
// abre uma aba oculta (chrome.tabs.create) neste arquivo: cada uma
// adquire um "lugar" antes de criar a aba e libera assim que termina
// (finally), nunca deixando mais de LIMITE_ABAS_SIMULTANEAS rodando ao
// mesmo tempo - o excesso simplesmente espera na fila, na ordem de
// chegada.
const LIMITE_ABAS_SIMULTANEAS = 9;
let abasOcultasEmUso = 0;
const filaDeEsperaPorAba = [];

function adquirirSlotDeAbaOculta() {
  if (abasOcultasEmUso < LIMITE_ABAS_SIMULTANEAS) {
    abasOcultasEmUso += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => filaDeEsperaPorAba.push(resolve));
}

function liberarSlotDeAbaOculta() {
  const proximo = filaDeEsperaPorAba.shift();
  if (proximo) {
    // Repassa o lugar direto para quem esta' esperando ha' mais tempo,
    // sem decrementar o contador (o lugar nunca ficou de fato livre).
    proximo();
  } else {
    abasOcultasEmUso = Math.max(0, abasOcultasEmUso - 1);
  }
}

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

// Nenhuma requisicao de rede desta extensao pode travar a exportacao para
// sempre: se o eproc nao responder em 10s (proxy lento, sessao expirada
// sem redirecionar, etc.), a requisicao especifica e' abortada, o item
// (documento/consulta) e' pulado e o motivo entra nos avisos/erros do
// resultado final, sem impedir os proximos itens de serem processados.
const TIMEOUT_REQUISICAO_MS = 10000;

// Envolve "fetch" com um AbortController que cancela a requisicao (nao so'
// desiste de esperar - cancela de fato a conexao) apos "ms" milissegundos,
// convertendo o timeout num erro tratavel normalmente pelo chamador (em
// vez de a requisicao ficar pendurada indefinidamente).
async function fetchComTimeout(url, opcoes, ms = TIMEOUT_REQUISICAO_MS) {
  const controller = new AbortController();
  const idTimeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...opcoes, signal: controller.signal });
  } catch (e) {
    if (e && e.name === "AbortError") {
      throw new Error(`Tempo esgotado (${Math.round(ms / 1000)}s) aguardando resposta de "${url}".`);
    }
    throw e;
  } finally {
    clearTimeout(idTimeout);
  }
}

// A URL do link do documento (acao=acessar_documento) retorna uma pagina
// "casca" em HTML com um <iframe id="conteudoIframe"> cujo src e' quem
// efetivamente serve o arquivo (acao=acessar_documento_implementacao).
// Sem isso, o download salva a casca HTML como se fosse o arquivo real.
async function resolverUrlReal(url) {
  let resposta;
  try {
    resposta = await fetchComTimeout(url, { credentials: "same-origin" });
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
    const resposta = await fetchComTimeout(url, { credentials: "same-origin" });
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
  return String(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
//
// Documentos "html" do eproc (certidoes, mandados, atos ordinatorios) quase
// sempre trazem um <style> de formatacao para impressao embutido no proprio
// "#divdochtml", e ocasionalmente um <script>. Remover so' as TAGS (como a
// versao anterior fazia) apaga "<style>" e "</style>", mas deixa o CONTEUDO
// delas (regras CSS, codigo JS) solto no meio do texto como se fosse parte
// do documento - e' isso que aparecia como "elementos do html" no resultado
// final. Por isso essas duas tags precisam ser removidas por INTEIRO (tag +
// conteudo) antes de qualquer outra substituicao.
function converterHtmlParaTextoSimples(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(br|BR)\s*\/?>/g, "\n")
    .replace(/<\/(p|P|div|DIV|li|LI|tr|TR|h[1-6]|H[1-6])>/g, "\n")
    .replace(/<\/(td|TD|th|TH)>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]{2,}/g, " ")
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
    ...quebrarLinhas(sanitizarTextoPdf(titulo), fonte, TAMANHO_FONTE_TEXTO, larguraUtil),
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
    const resposta = await fetchComTimeout(urlReal, { credentials: "same-origin" });
    const bytes = await resposta.arrayBuffer();
    const pdfOrigem = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const paginasCopiadas = await pdfFinal.copyPages(pdfOrigem, pdfOrigem.getPageIndices());
    paginasCopiadas.forEach((pagina) => pdfFinal.addPage(pagina));
    return;
  }

  if (MIMETYPES_IMAGEM.has(doc.mimetype)) {
    const resposta = await fetchComTimeout(urlReal, { credentials: "same-origin" });
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

// Rotulo de uma linha de movimentacao, reaproveitado tanto na secao de
// movimentacao do MD quanto nas paginas divisorias de evento do PDF
// unico, para manter os dois formatos consistentes entre si.
function rotuloEvento(evento) {
  const numero = evento.numeroEvento != null ? `Evento ${evento.numeroEvento}` : "Evento";
  return `${numero} — ${evento.dataHora} — ${evento.descricao || "(sem descrição)"}`;
}

// Lista, uma por linha, o nome e a descricao (a observacao livre que o
// usuario digita ao anexar o documento - nem todo documento tem uma) de
// cada documento vinculado a um evento, para a pagina divisoria do PDF
// unico mostrar de imediato quais arquivos estao ali dentro.
function listarDocumentosDoEvento(docs) {
  return docs
    .map((doc) => `- ${doc.nome}: ${doc.descricao || "Arquivo sem descrição incluída"}`)
    .join("\n");
}

// Igual a "agruparDocumentosPorEvento" (definida mais abaixo, junto do MD
// unico) - agrupa os documentos por evento e devolve tambem os que nao
// tem evento correspondente, para o PDF unico nao ordenar/juntar tudo
// numa lista so'.
// So' monta os bytes do PDF unico (sem baixar nada) - usado tanto por
// "construirPdfUnico" (exportacao normal, um processo por vez, nome de
// arquivo fixo) quanto pela exportacao em lote por localizador (varios
// processos, cada um com nome de pasta/arquivo proprios), para nao
// duplicar a logica de montagem em dois lugares.
async function montarBytesPdfUnico(documentos, resolverUrl, movimentacao, aoProgredir) {
  const pdfFinal = await PDFDocument.create();
  const fonteTexto = await pdfFinal.embedFont(StandardFonts.Helvetica);

  const total = documentos.length;
  let concluidos = 0;

  async function processarDocumento(doc) {
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
    concluidos += 1;
    if (aoProgredir) aoProgredir(concluidos, total);
  }

  if (movimentacao && movimentacao.length > 0) {
    const { porEvento, semEvento } = agruparDocumentosPorEvento(documentos, movimentacao);

    for (const evento of movimentacao) {
      const docsDoEvento = evento.numeroEvento != null ? porEvento.get(evento.numeroEvento) || [] : [];
      adicionarTextoComoPaginas(
        pdfFinal,
        fonteTexto,
        rotuloEvento(evento),
        docsDoEvento.length === 0 ? "Nenhum documento anexado a este evento." : listarDocumentosDoEvento(docsDoEvento)
      );
      for (const doc of docsDoEvento) {
        await processarDocumento(doc);
      }
    }

    if (semEvento.length > 0) {
      adicionarTextoComoPaginas(pdfFinal, fonteTexto, "Documentos sem evento identificado", listarDocumentosDoEvento(semEvento));
      for (const doc of semEvento) {
        await processarDocumento(doc);
      }
    }
  } else {
    for (const doc of documentos) {
      await processarDocumento(doc);
    }
  }

  return pdfFinal.save();
}

async function construirPdfUnico(documentos, resolverUrl, pastaBase, numeroProcesso, movimentacao, aoProgredir) {
  const bytesFinais = await montarBytesPdfUnico(documentos, resolverUrl, movimentacao, aoProgredir);
  const dataUrl = construirDataUrlBinario("application/pdf", bytesFinais);
  const nomeArquivo = `${pastaBase}/${sanitizarNomeArquivo(numeroProcesso)}_completo.pdf`;
  await baixarUm(nomeArquivo, dataUrl);
}

// Cria um resolvedor de URL com cache proprio (mesma logica ja' usada em
// "processarFila": documentos "html" nunca sao cacheados, pois a segunda
// camada deles parece nao aceitar ser acessada duas vezes com a mesma URL
// resolvida). Extraido para ser reaproveitado pela exportacao em lote por
// localizador, que monta um PDF unico por processo, um processo de cada vez.
function criarResolvedorUrlDocumento() {
  const urlsResolvidas = new Map();
  return async function obterUrlResolvida(doc) {
    if (doc.mimetype === "html") {
      return resolverUrlReal(doc.href);
    }
    if (urlsResolvidas.has(doc.idDocumento)) return urlsResolvidas.get(doc.idDocumento);
    const urlReal = await resolverUrlReal(doc.href);
    urlsResolvidas.set(doc.idDocumento, urlReal);
    return urlReal;
  };
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
      const controladorAbort = new AbortController();
      const idTimeoutAbort = setTimeout(() => controladorAbort.abort(), 10000);
      let resposta;
      try {
        resposta = await fetch(parametros.url, { credentials: "same-origin", signal: controladorAbort.signal });
      } catch (e) {
        if (e && e.name === "AbortError") {
          throw new Error("Tempo esgotado (10s) baixando o documento.");
        }
        throw e;
      } finally {
        clearTimeout(idTimeoutAbort);
      }
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
        const linhas = [`### ${rotuloEvento(evento)}`, ""];

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
  const obterUrlResolvida = criarResolvedorUrlDocumento();

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
      await construirPdfUnico(documentos, obterUrlResolvida, pastaBase, numeroProcesso, movimentacao, enviarProgressoPdf);
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

  // Seleciona TODAS as opcoes de um grupo de situacao de uma vez. Os
  // values de "selStatusProcesso" seguem o formato "status;codigo;grupo"
  // (ex.: "M;02;S") - o sufixo ";S" identifica o grupo SUSPENSÃO, ";M" o
  // grupo MOVIMENTO, etc. Usado pelo Relatório da Unidade (Corregedoria)
  // para contar suspensos/sobrestados (grupo S) e acervo em tramitacao
  // (grupo M) sem precisar enumerar as ~40 opcoes uma a uma.
  function selecionarGrupoSituacao(grupo) {
    const select = document.getElementById("selStatusProcesso");
    if (!select) throw new Error('Campo "Situação" não encontrado nesta página.');

    const sufixo = `;${grupo}`;
    let alguma = false;
    for (const opcao of select.options) {
      const selecionada = (opcao.value || "").endsWith(sufixo);
      opcao.selected = selecionada;
      if (selecionada) alguma = true;
    }
    if (!alguma) {
      throw new Error(`Nenhuma opção de situação do grupo "${grupo}" encontrada na lista.`);
    }
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Seleciona TODAS as opcoes de TODOS os grupos macro do filtro
  // "Situação", EXCETO os grupos informados (ex.: ["B", "S"] para
  // excluir BAIXADO e SUSPENSÃO) - usado pela "Relação de processos
  // ativos" do Relatório da Unidade: em vez de deixar o campo em branco
  // (o que conta TODO processo, inclusive suspensos e baixados, como se
  // fosse "ativo"), marca every macro grupo/subitem exceto os excluidos,
  // do mesmo jeito que "selecionarGrupoSituacao" marca um unico grupo.
  //
  // O select tem duas "camadas" de option: os cabecalhos de cada grupo
  // (value = so' a letra do grupo, ex. "B", "S", "M" - sem ";", exibidos
  // em negrito só para organizar visualmente a lista) e os itens de fato
  // (value no formato "status;codigo;grupo", ex. "M;02;S"). So' os itens
  // de fato entram na selecao (o mesmo padrao ja' usado por
  // "selecionarGrupoSituacao", que casa pelo sufixo ";grupo" e por isso
  // tambem nunca marca o cabecalho) - marcar o cabecalho junto seria
  // redundante e o value dele nao segue o formato "status;codigo;grupo"
  // que o restante do relatório espera.
  function selecionarTodosGruposExceto(gruposExcluir) {
    const select = document.getElementById("selStatusProcesso");
    if (!select) throw new Error('Campo "Situação" não encontrado nesta página.');

    const sufixosExcluidos = (gruposExcluir || []).map((g) => `;${g}`);
    let alguma = false;
    for (const opcao of select.options) {
      const valor = opcao.value || "";
      const ehItemDeGrupo = valor.includes(";");
      const excluida = sufixosExcluidos.some((sufixo) => valor.endsWith(sufixo));
      const selecionada = ehItemDeGrupo && !excluida;
      opcao.selected = selecionada;
      if (selecionada) alguma = true;
    }
    if (!alguma) {
      throw new Error("Nenhuma opção de situação restou selecionada após excluir os grupos informados.");
    }
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Usado pelo Relatório Gerencial da Unidade (Corregedoria): filtra a
  // consulta por uma unidade especifica (Órgão/Juízo), em vez da unidade
  // padrao do perfil logado. Visualmente um dropdown do bootstrap-select,
  // mas o <select> nativo continua no DOM por baixo (so' escondido) com
  // as mesmas <option> - mudar seu valor e disparar "change" atualiza o
  // filtro e o widget visual junto (bootstrap-select escuta esse
  // evento), do mesmo jeito que "selecionarSituacao" ja' faz.
  function selecionarOrgaoJuizo(valorOrgaoJuizo) {
    const select = document.getElementById("selIdOrgaoJuizo");
    if (!select) throw new Error('Campo "Órgão/Juízo" (#selIdOrgaoJuizo) não encontrado nesta página.');

    let encontrouOpcao = false;
    for (const opcao of select.options) {
      const selecionada = opcao.value === valorOrgaoJuizo;
      opcao.selected = selecionada;
      if (selecionada) encontrouOpcao = true;
    }
    if (!encontrouOpcao) {
      throw new Error(`Unidade "${valorOrgaoJuizo}" não encontrada no filtro Órgão/Juízo.`);
    }
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Usa o setter nativo do HTMLInputElement (em vez de so' "input.value =
  // ...") para garantir que a mudanca seja percebida mesmo se algum
  // framework de formulario estiver "escutando" o proprio setter da
  // propriedade, alem de disparar os eventos nativos "input"/"change".
  // Generica: serve "Dias na situação" (#txtDiasSituacao), "Dias sem
  // movimentação" (#txtDiasSemMovimentacao) e "Autuação fim"
  // (#txtDataAutuacaoFim), entre outros campos de texto da tela.
  function definirCampoTexto(idCampo, rotulo, valor) {
    const input = document.getElementById(idCampo);
    if (!input) {
      throw new Error(`Campo "${rotulo}" (#${idCampo}) não encontrado nesta página.`);
    }
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    nativeSetter.call(input, String(valor));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Simula a digitacao no span editavel do Tagify e clica no item do
  // dropdown cujo atributo "value" bate com o alvo.
  // Localiza um campo Tagify pelo aria-label visivel do span editavel
  // (ex.: "Informação complementar", "Localizador") - os dois campos sao
  // construidos pelo mesmo widget (Tagify), so' mudando o rotulo e a
  // lista de sugestoes.
  function localizarCampoTagify(ariaLabel) {
    const inputSpan = document.querySelector(`span.tagify__input[aria-label="${ariaLabel}"]`);
    if (!inputSpan) return null;
    const tagsEl = inputSpan.closest("tags.tagify");
    if (!tagsEl) return null;
    return { inputSpan, tagsEl };
  }

  // Digita "textoDigitado" no campo, espera a sugestao cujo texto/valor
  // bate com "valorAlvo" aparecer no dropdown e clica nela - generaliza o
  // que antes era so' "marcarPeticaoUrgente", reaproveitado agora tambem
  // para selecionar um Localizador especifico no Relatório Gerencial da
  // Unidade (Corregedoria).
  async function selecionarTagify(ariaLabel, textoDigitado, valorAlvo) {
    const campo = localizarCampoTagify(ariaLabel);
    if (!campo) {
      throw new Error(`Campo "${ariaLabel}" não encontrado nesta página.`);
    }
    const { inputSpan, tagsEl } = campo;

    inputSpan.focus();
    inputSpan.textContent = textoDigitado;
    inputSpan.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText", data: textoDigitado })
    );

    let itemAlvo = null;
    for (let tentativa = 0; tentativa < 25; tentativa += 1) {
      await aguardar(200);
      itemAlvo =
        document.querySelector(`.tagify__dropdown__item[value="${valorAlvo}"]`) ||
        Array.from(document.querySelectorAll(".tagify__dropdown__item")).find(
          (el) => (el.textContent || "").trim() === valorAlvo
        );
      if (itemAlvo) break;
    }

    if (!itemAlvo) {
      throw new Error(`Sugestão "${valorAlvo}" não encontrada no dropdown do campo "${ariaLabel}".`);
    }

    itemAlvo.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    itemAlvo.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    itemAlvo.click();

    await aguardar(200);

    if (tagsEl.querySelectorAll(".tagify__tag").length === 0) {
      throw new Error(`A tag "${valorAlvo}" não foi adicionada ao campo "${ariaLabel}".`);
    }
  }

  async function marcarPeticaoUrgente() {
    await selecionarTagify("Informação complementar", "Petição Urgente", "Petição Urgente - Sim");
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

  // Le' a "relação de processos" (linhas da tabela de resultado, nao so'
  // o total) da tabela de resultado "#tblProcessoLista" - usada pelo
  // Relatório da Unidade para trazer a lista de processos ativos/
  // suspensos, alem do total. Nunca lanca excecao: sempre resolve com
  // { cabecalhos, linhas, erro }.
  async function extrairLinhasTblProcessoLista() {
    const LIMITE_COLUNAS = 10;
    const LIMITE_LINHAS = 500;
    try {
      if (typeof jQuery === "undefined" || !jQuery.fn || !jQuery.fn.DataTable) {
        return { cabecalhos: [], linhas: [], erro: "jQuery DataTables não disponível nesta página." };
      }
      const tabelaEl = jQuery("#tblProcessoLista");
      if (tabelaEl.length === 0 || !jQuery.fn.DataTable.isDataTable("#tblProcessoLista")) {
        return { cabecalhos: [], linhas: [], erro: 'Tabela "#tblProcessoLista" não encontrada ou ainda não inicializada.' };
      }
      const dt = tabelaEl.DataTable();

      const aguardarRedesenho = () =>
        Promise.race([
          new Promise((resolve) => tabelaEl.one("draw.dt", () => resolve(true))),
          aguardar(8000).then(() => false),
        ]);

      // Mostra todas as linhas de uma vez (sem paginacao do DataTables)
      // antes de ler - senao so' pegariamos a pagina atual visivel.
      const promessaMostrarTudo = aguardarRedesenho();
      dt.page.len(-1).draw(false);
      await promessaMostrarTudo;

      const tabelaDom = document.getElementById("tblProcessoLista");
      const cabecalhos = Array.from(tabelaDom.querySelectorAll("thead th"))
        .map((th) => (th.textContent || "").replace(/\s+/g, " ").trim())
        .slice(0, LIMITE_COLUNAS);

      // Le' direto das celulas <td> ja' RENDERIZADAS (na mesma ordem
      // visual dos cabecalhos), em vez de "dt.rows().data()": essa API
      // devolve o objeto de dados BRUTO de cada linha, cujas chaves nem
      // sempre seguem a mesma ordem das colunas visiveis na tela -
      // "Object.values()" sobre esse objeto produzia colunas
      // desalinhadas com o cabecalho (ex.: "Situação" saindo vazia e o
      // conteudo de "Sigilo" aparecendo embaixo de "Último Evento").
      // Ler o texto que a propria tabela renderizou evita esse problema
      // por completo.
      const linhasEl = Array.from(tabelaDom.querySelectorAll("tbody tr")).filter(
        (tr) => tr.querySelectorAll("td").length > 0
      );
      const linhas = linhasEl.slice(0, LIMITE_LINHAS).map((tr) =>
        Array.from(tr.querySelectorAll("td"))
          .slice(0, LIMITE_COLUNAS)
          .map((td) => (td.textContent || "").replace(/\s+/g, " ").trim())
      );

      return { cabecalhos, linhas, erro: null };
    } catch (e) {
      return { cabecalhos: [], linhas: [], erro: e && e.message ? e.message : String(e) };
    }
  }

  return (async () => {
    try {
      // Se um Órgão/Juízo especifico foi pedido (Relatório Gerencial da
      // Unidade), seleciona ele ANTES de tudo - a troca de unidade pode
      // recarregar/reajustar outros campos da tela.
      if (parametros.valorOrgaoJuizo) {
        selecionarOrgaoJuizo(parametros.valorOrgaoJuizo);
        await aguardar(300);
      }

      // O filtro "Dias sem movimentação" (demonstrativo de processos
      // parados) e' independente da "Situação": nesse caso
      // "parametros.valorSituacao" vem nulo e o select nao e' tocado.
      if (parametros.valorSituacao) {
        selecionarSituacao(parametros.valorSituacao);
      }

      // Grupo inteiro de situacoes (ex.: "S" = todos os SUSPENSÃO, "M" =
      // todos os MOVIMENTO) - mutuamente exclusivo com "valorSituacao".
      if (parametros.grupoSituacao) {
        selecionarGrupoSituacao(parametros.grupoSituacao);
      }

      // Todos os grupos macro EXCETO os informados (ex.: ["B", "S"] para
      // excluir BAIXADO e SUSPENSÃO) - usado na "Relação de processos
      // ativos", mutuamente exclusivo com "valorSituacao"/"grupoSituacao".
      if (parametros.gruposSituacaoExcluir) {
        selecionarTodosGruposExceto(parametros.gruposSituacaoExcluir);
      }

      if (parametros.diasSituacao != null) {
        definirCampoTexto("txtDiasSituacao", "Dias na situação", parametros.diasSituacao);
      }

      if (parametros.diasSemMovimentacao != null) {
        definirCampoTexto("txtDiasSemMovimentacao", "Dias sem movimentação", parametros.diasSemMovimentacao);
      }

      // Limite superior da data de autuação (formato dd/mm/aaaa) - usado
      // para contar o acervo antigo ("autuados ha' mais de N anos").
      if (parametros.dataAutuacaoFim) {
        definirCampoTexto("txtDataAutuacaoFim", "Autuação (fim)", parametros.dataAutuacaoFim);
      }

      if (parametros.urgente) {
        await marcarPeticaoUrgente();
      }

      // Usado pelo Relatório Gerencial da Unidade (Corregedoria): filtra
      // a consulta por um Localizador especifico (campo Tagify
      // "Localizador", que so' lista os localizadores da unidade depois
      // que um Órgão/Juízo foi selecionado no outro filtro). O Tagify
      // comeca sem nenhuma sugestao carregada - e' preciso clicar em
      // "Listar todos" (id="selLocalizadorPrincipal-listAll") antes,
      // senao nenhum texto digitado encontra opção nenhuma no dropdown.
      if (parametros.valorLocalizador) {
        const botaoListarTodos = document.getElementById("selLocalizadorPrincipal-listAll");
        if (botaoListarTodos) {
          botaoListarTodos.click();
          await aguardar(300);
        }
        await selecionarTagify("Localizador", parametros.valorLocalizador, parametros.valorLocalizador);
      }

      await aguardar(200);
      const contagem = await clicarConsultarELer();

      let tabela = null;
      if (parametros.extrairTabela) {
        tabela = await extrairLinhasTblProcessoLista();
      }

      return { contagem, tabela, erro: null };
    } catch (e) {
      return { contagem: null, tabela: null, erro: e && e.message ? e.message : String(e) };
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

// Seleciona uma unidade (Órgão/Juízo) no Relatório Geral, sem rodar
// nenhuma consulta - usado antes de ler as opcoes do campo "Localizador"
// (que so' lista os localizadores da unidade escolhida depois dessa
// selecao). Autocontida, executada via chrome.scripting.executeScript.
function selecionarOrgaoJuizoRelatorioGeralNaPagina(valorOrgaoJuizo) {
  const select = document.getElementById("selIdOrgaoJuizo");
  if (!select) return { ok: false, erro: 'Campo "Órgão/Juízo" (#selIdOrgaoJuizo) não encontrado nesta página.' };

  let encontrouOpcao = false;
  for (const opcao of select.options) {
    const selecionada = opcao.value === valorOrgaoJuizo;
    opcao.selected = selecionada;
    if (selecionada) encontrouOpcao = true;
  }
  if (!encontrouOpcao) {
    return { ok: false, erro: `Unidade "${valorOrgaoJuizo}" não encontrada no filtro Órgão/Juízo.` };
  }
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, erro: null };
}

// Le' todas as opcoes disponiveis no campo "Localizador" do Relatório
// Geral (widget Tagify) - so' funciona depois que um Órgão/Juízo foi
// selecionado no outro filtro da tela, que e' quando esse campo passa a
// listar os localizadores daquela unidade. Digitar uma string vazia no
// campo (em vez de um texto de busca especifico, como
// "selecionarTagify" faz) e' o que faz o dropdown mostrar a lista
// completa de sugestoes em vez de um resultado filtrado. Autocontida,
// executada via chrome.scripting.executeScript. Nunca lanca excecao:
// sempre resolve com { opcoes, erro }.
function listarLocalizadoresNoFiltroRelatorioGeralNaPagina() {
  function aguardar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  return (async () => {
    try {
      const inputSpan = document.querySelector('span.tagify__input[aria-label="Localizador"]');
      if (!inputSpan) {
        return {
          opcoes: [],
          erro: 'Campo "Localizador" não encontrado nesta página (selecione um Órgão/Juízo primeiro).',
        };
      }

      // O Tagify comeca vazio - nenhuma sugestao carregada, nem mesmo
      // digitando um texto de busca - ate' que o botao "Listar todos"
      // (id="selLocalizadorPrincipal-listAll", companion do <select
      // id="selLocalizadorPrincipal"> por baixo do Tagify) seja clicado.
      // Sem esse clique o dropdown fica sempre vazio.
      const botaoListarTodos = document.getElementById("selLocalizadorPrincipal-listAll");
      if (botaoListarTodos) {
        botaoListarTodos.click();
        await aguardar(300);
      }

      inputSpan.focus();
      inputSpan.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "" }));

      let itens = [];
      for (let tentativa = 0; tentativa < 25; tentativa += 1) {
        await aguardar(200);
        itens = Array.from(document.querySelectorAll(".tagify__dropdown__item"));
        if (itens.length > 0) break;
      }

      if (itens.length === 0) {
        return { opcoes: [], erro: 'Nenhum localizador encontrado no campo "Localizador" (dropdown vazio).' };
      }

      // O eproc costuma mostrar o total de processos junto do nome no
      // proprio item do dropdown (ex.: "GABINETE (42)") - quando isso
      // acontece, nao e' preciso abrir uma aba e rodar uma consulta a
      // mais so' para descobrir esse numero: ele ja' vem pronto aqui.
      // "contagem" fica null quando o texto nao tem esse sufixo (ex.:
      // eproc mudou o formato, ou esse item em especifico nao tem o
      // numero) - nesse caso quem chama decide se consulta por fora.
      // "texto" continua sendo o texto completo do item (com o numero,
      // se houver) - e' o que "selecionarTagify" usa para digitar e
      // reencontrar esse mesmo item depois, entao nao pode mudar; "nome"
      // e' so' o rotulo sem o numero, para exibir no relatório.
      const opcoes = itens.map((el) => {
        const textoCompleto = (el.textContent || "").trim();
        const valorAttr = el.getAttribute("value");
        const matchContagem = textoCompleto.match(/\((\d+)\)\s*$/);
        return {
          valor: valorAttr || textoCompleto,
          texto: textoCompleto,
          nome: matchContagem ? textoCompleto.slice(0, matchContagem.index).trim() : textoCompleto,
          contagem: matchContagem ? Number(matchContagem[1]) : null,
        };
      });

      return { opcoes, erro: null };
    } catch (e) {
      return { opcoes: [], erro: e && e.message ? e.message : String(e) };
    }
  })();
}

// Busca a lista completa de localizadores da unidade direto pelo mesmo
// endpoint JSON que o proprio widget "Listar todos" chama por baixo dos
// panos (confirmado inspecionando a aba de Rede do navegador:
// "acao=relatorio_geral/listar_localizador_orgao&acao_origem=
// relatorio_geral_listar&hash=..."), em vez de clicar no botao e ler o
// dropdown do Tagify depois - um unico fetch, sem esperar nenhuma
// animacao/render de dropdown. O "hash" e' um token por pagina/sessao;
// primeiro tenta achar a URL exata desse endpoint (com o hash certo) em
// algum <script> da propria pagina (e' de la' que o Tagify pega essa URL
// para montar sua propria chamada), e so' cai para reaproveitar o hash
// da URL da pagina atual se essa busca no HTML nao encontrar nada.
//
// Importante: esse endpoint devolve so' os NOMES dos localizadores
// (IdLocalizadorOrgao/SigLocalizador/DesLocalizador) - nao inclui o total
// de processos de cada um. Por isso "contagem" aqui sempre vem null; o
// total continua vindo de uma consulta por localizador (ver
// "consultarLocalizadoresUnidadeViaRelatorioGeral"), ja' que esse numero
// depende da combinacao de filtros da consulta, nao e' um dado fixo do
// localizador em si.
function buscarLocalizadoresViaFetchNaPagina() {
  return (async () => {
    try {
      // Normaliza as formas mais comuns de escapar essa URL dentro do
      // HTML antes de procurar por ela: barra escapada de string JSON
      // embutida num <script> ("\/"), unicode escape do "&" ("&")
      // e entidade HTML do "&" ("&amp;") - sem isso, a URL exata que o
      // Tagify usa (com o "hash" certo) pode nao bater com nenhuma das
      // duas regras de busca abaixo, mesmo estando la' no HTML.
      const htmlPagina = (document.documentElement ? document.documentElement.innerHTML : "")
        .replace(/\\\//g, "/")
        .replace(/\\u0026/gi, "&")
        .replace(/&amp;/g, "&");

      const matchUrl = htmlPagina.match(
        /(controlador\.php\?acao=relatorio_geral(?:%2F|\/)listar_localizador_orgao[^"'\\]*)/i
      );

      let url;
      if (matchUrl) {
        url = matchUrl[1];
      } else {
        const matchHashPagina = window.location.href.match(/[?&]hash=([a-f0-9]+)/i);
        if (!matchHashPagina) {
          return {
            opcoes: [],
            erro: 'Não foi possível localizar a URL (nem o parâmetro "hash") do endpoint de localizadores nesta página.',
          };
        }
        url = `controlador.php?acao=relatorio_geral/listar_localizador_orgao&acao_origem=relatorio_geral_listar&hash=${matchHashPagina[1]}`;
      }

      const urlAbsoluta = new URL(url, window.location.href).toString();
      const controladorAbort = new AbortController();
      const idTimeoutAbort = setTimeout(() => controladorAbort.abort(), 10000);
      let resposta;
      try {
        resposta = await fetch(urlAbsoluta, { credentials: "same-origin", signal: controladorAbort.signal });
      } catch (e) {
        if (e && e.name === "AbortError") {
          return { opcoes: [], erro: "Tempo esgotado (10s) buscando localizadores nesta página." };
        }
        throw e;
      } finally {
        clearTimeout(idTimeoutAbort);
      }
      if (!resposta.ok) {
        return { opcoes: [], erro: `Falha ao buscar localizadores (HTTP ${resposta.status}).` };
      }

      const dados = await resposta.json();
      if (!Array.isArray(dados)) {
        return { opcoes: [], erro: "Resposta inesperada ao buscar localizadores (não é uma lista)." };
      }

      const opcoes = dados.map((item) => {
        const nome = item.DesLocalizador || item.SigLocalizador || String(item.IdLocalizadorOrgao);
        return {
          valor: nome,
          texto: nome,
          nome,
          idLocalizadorOrgao: item.IdLocalizadorOrgao,
          contagem: null,
        };
      });

      return { opcoes, erro: null };
    } catch (e) {
      return { opcoes: [], erro: e && e.message ? e.message : String(e) };
    }
  })();
}

// Abre uma aba oculta, navega ate' o Relatório Geral, seleciona a
// unidade pedida e le' as opcoes disponiveis no campo "Localizador" -
// usado pelo Relatório Gerencial da Unidade antes de consultar o total
// de processos de cada um (uma consulta por localizador, cada uma na
// sua propria aba - ver comentario sobre estabilidade do Tagify acima de
// "gerarRelatorioGeral"). Tenta primeiro o fetch direto do endpoint JSON
// (mais rapido e confiavel); so' cai para a simulacao antiga via Tagify
// ("Listar todos" + ler o dropdown) se o fetch nao encontrar nada.
async function abrirAbaEListarLocalizadoresRelatorioGeral(urlBase, valorOrgaoJuizo) {
  let aba;
  try {
    await adquirirSlotDeAbaOculta();
    aba = await chrome.tabs.create({ url: urlBase, active: false });
    await aguardarCarregamentoAba(aba.id);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const [{ result: linkEncontrado } = {}] = await chrome.scripting.executeScript({
      target: { tabId: aba.id },
      func: clicarLinkRelatorioGeralNaPagina,
    });

    if (!linkEncontrado) {
      return {
        opcoes: [],
        erro:
          'Link "Relatório Geral" não encontrado na página atual. Abra uma página do eproc com o menu lateral (ex.: a tela de um processo) e tente novamente.',
      };
    }

    await aguardarCarregamentoAba(aba.id);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const [{ result: resultadoSelecao } = {}] = await chrome.scripting.executeScript({
      target: { tabId: aba.id },
      func: selecionarOrgaoJuizoRelatorioGeralNaPagina,
      args: [valorOrgaoJuizo],
    });

    if (!resultadoSelecao || !resultadoSelecao.ok) {
      return { opcoes: [], erro: (resultadoSelecao && resultadoSelecao.erro) || "Falha ao selecionar o Órgão/Juízo." };
    }

    // Da' um tempo para o campo "Localizador" (Tagify) atualizar sua
    // lista de sugestoes apos a troca de unidade.
    await new Promise((resolve) => setTimeout(resolve, 800));

    const [{ result: resultadoFetch } = {}] = await chrome.scripting.executeScript({
      target: { tabId: aba.id },
      func: buscarLocalizadoresViaFetchNaPagina,
    });

    if (resultadoFetch && resultadoFetch.opcoes && resultadoFetch.opcoes.length > 0) {
      return resultadoFetch;
    }

    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId: aba.id },
      func: listarLocalizadoresNoFiltroRelatorioGeralNaPagina,
    });

    return (
      result || {
        opcoes: [],
        erro: (resultadoFetch && resultadoFetch.erro) || "Sem resultado ao ler as opções do campo Localizador.",
      }
    );
  } catch (e) {
    return { opcoes: [], erro: e && e.message ? e.message : String(e) };
  } finally {
    if (aba && aba.id) {
      chrome.tabs.remove(aba.id).catch(() => {});
    }
    liberarSlotDeAbaOculta();
  }
}

// Le', SEM CONSULTAR nada, as opcoes de um grupo especifico do filtro
// "Situação" (#selStatusProcesso, value no formato "status;codigo;grupo" -
// o mesmo grupo usado por "selecionarGrupoSituacao"). Usada so' para
// descobrir a lista antes de dividi-la em blocos e consultar em paralelo
// (ver "abrirAbaEConsultarSituacoesGrupo"). Autocontida, executada via
// chrome.scripting.executeScript.
function listarSituacoesDoGrupoNaPagina(grupo) {
  const select = document.getElementById("selStatusProcesso");
  if (!select) {
    return { opcoes: [], erro: 'Campo "Situação" (#selStatusProcesso) não encontrado nesta página.' };
  }
  const sufixo = `;${grupo}`;
  const opcoes = Array.from(select.options)
    .filter((opcao) => (opcao.value || "").endsWith(sufixo))
    .map((opcao) => ({ valor: opcao.value, texto: (opcao.textContent || "").replace(/\s+/g, " ").trim() }));
  if (opcoes.length === 0) {
    return { opcoes: [], erro: `Nenhuma opção de situação do grupo "${grupo}" encontrada na lista.` };
  }
  return { opcoes, erro: null };
}

// Abre uma aba oculta, navega ate' o Relatório Geral, seleciona a unidade
// pedida e le' (sem consultar) as opcoes do grupo indicado do filtro
// "Situação".
async function abrirAbaEListarSituacoesDoGrupo(urlBase, valorOrgaoJuizo, grupo) {
  let aba;
  try {
    await adquirirSlotDeAbaOculta();
    aba = await chrome.tabs.create({ url: urlBase, active: false });
    await aguardarCarregamentoAba(aba.id);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const [{ result: linkEncontrado } = {}] = await chrome.scripting.executeScript({
      target: { tabId: aba.id },
      func: clicarLinkRelatorioGeralNaPagina,
    });
    if (!linkEncontrado) {
      return {
        opcoes: [],
        erro:
          'Link "Relatório Geral" não encontrado na página atual. Abra uma página do eproc com o menu lateral e tente novamente.',
      };
    }

    await aguardarCarregamentoAba(aba.id);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const [{ result: resultadoSelecao } = {}] = await chrome.scripting.executeScript({
      target: { tabId: aba.id },
      func: selecionarOrgaoJuizoRelatorioGeralNaPagina,
      args: [valorOrgaoJuizo],
    });
    if (!resultadoSelecao || !resultadoSelecao.ok) {
      return { opcoes: [], erro: (resultadoSelecao && resultadoSelecao.erro) || "Falha ao selecionar o Órgão/Juízo." };
    }
    await new Promise((resolve) => setTimeout(resolve, 300));

    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId: aba.id },
      func: listarSituacoesDoGrupoNaPagina,
      args: [grupo],
    });
    return result || { opcoes: [], erro: "Sem resultado ao listar as situações do grupo." };
  } catch (e) {
    return { opcoes: [], erro: e && e.message ? e.message : String(e) };
  } finally {
    if (aba && aba.id) {
      chrome.tabs.remove(aba.id).catch(() => {});
    }
    liberarSlotDeAbaOculta();
  }
}

// Roda, para CADA uma das opcoes recebidas (ja' definidas de fora - um
// BLOCO de um grupo maior, nao o grupo inteiro), uma consulta separada
// (so' troca a Situação e clica Consultar de novo - nenhum campo Tagify
// envolvido, entao reaproveita a MESMA aba/pagina para todas as consultas
// do bloco, sem o custo de abrir uma aba nova por item). Usada para
// detalhar o total de suspensos/sobrestados por situação especifica
// (quantos estao em "SUSPENSAO", quantos em "SOBRESTADO CONVENIO", etc.)
// em vez de so' um numero agregado do grupo inteiro - varios blocos rodam
// em ABAS SEPARADAS e em PARALELO (ver "abrirAbaEConsultarSituacoesGrupo"),
// cada um cuidando so' da sua fatia da lista completa. Autocontida,
// executada via chrome.scripting.executeScript. Nunca lanca excecao: cada
// item devolve seu proprio "erro" se algo falhar, sem interromper os
// demais itens do mesmo bloco.
function consultarSituacoesEspecificasNaPagina(opcoesDoBloco) {
  function aguardar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function extrairContagem(texto) {
    const m = (texto || "").match(/\((\d+)\)/);
    return m ? Number(m[1]) : null;
  }

  function selecionarSituacaoEspecifica(valorOpcaoSituacao) {
    const select = document.getElementById("selStatusProcesso");
    let encontrou = false;
    for (const opcao of select.options) {
      const selecionada = opcao.value === valorOpcaoSituacao;
      opcao.selected = selecionada;
      if (selecionada) encontrou = true;
    }
    if (encontrou) select.dispatchEvent(new Event("change", { bubbles: true }));
    return encontrou;
  }

  async function clicarConsultarELer() {
    const botaoConsultar = document.querySelector('button.btnConsultar[form="frmProcessoLista"]');
    if (!botaoConsultar) throw new Error('Botão "Consultar" não encontrado nesta página.');

    const badgeAntes = document.getElementById("tblProcessoLista_info-badge");
    const textoAntes = badgeAntes ? badgeAntes.textContent : null;

    botaoConsultar.click();

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
    const select = document.getElementById("selStatusProcesso");
    if (!select) {
      return { itens: [], erro: 'Campo "Situação" (#selStatusProcesso) não encontrado nesta página.' };
    }

    // Orcamento de tempo INTERNO a este bloco (verificado ENTRE um item e
    // outro): garante que, mesmo se a consulta estiver lenta, o que ja' foi
    // apurado ate' aqui e' devolvido em vez de perdido por completo. Sem
    // isso, um timeout externo (ver "abrirAbaEConsultarSituacoesEspecificas")
    // teria que abandonar esta chamada inteira e descartar TODO o progresso
    // do bloco - mesmo os itens que ja' tinham sido consultados com sucesso
    // antes do estouro.
    const ORCAMENTO_BLOCO_MS = 60000;
    const inicioBloco = Date.now();

    const itens = [];
    let parcial = false;
    for (const opcao of opcoesDoBloco) {
      if (Date.now() - inicioBloco > ORCAMENTO_BLOCO_MS) {
        parcial = true;
        break;
      }
      try {
        const encontrou = selecionarSituacaoEspecifica(opcao.valor);
        if (!encontrou) {
          itens.push({ valor: opcao.valor, texto: opcao.texto, contagem: null, erro: "Opção não encontrada." });
          continue;
        }
        await aguardar(150);
        const contagem = await clicarConsultarELer();
        itens.push({ valor: opcao.valor, texto: opcao.texto, contagem, erro: null });
      } catch (e) {
        itens.push({
          valor: opcao.valor,
          texto: opcao.texto,
          contagem: null,
          erro: e && e.message ? e.message : String(e),
        });
      }
    }

    return {
      itens,
      erro: null,
      parcial,
      motivoParcial: parcial
        ? `Tempo limite (${ORCAMENTO_BLOCO_MS / 1000}s) atingido dentro do bloco - ${
            opcoesDoBloco.length - itens.length
          } de ${opcoesDoBloco.length} situação(ões) deste bloco não consultada(s).`
        : null,
    };
  })();
}

// Abre uma aba oculta PROPRIA, navega ate' o Relatório Geral, seleciona a
// unidade pedida e roda "consultarSituacoesEspecificasNaPagina" so' para o
// bloco recebido - usada para poder chamar varias dessas em PARALELO
// (Promise.all), uma aba por bloco. Tem seu proprio timeout: se essa aba
// especifica travar, so' o bloco dela fica incompleto, sem afetar os
// demais blocos que estao rodando ao mesmo tempo em outras abas.
async function abrirAbaEConsultarSituacoesEspecificas(urlBase, valorOrgaoJuizo, opcoesDoBloco) {
  // So' uma rede de seguranca para casos realmente travados (pagina que
  // nunca recarrega, clique que nunca dispara nada): o orcamento de 60s
  // DENTRO de "consultarSituacoesEspecificasNaPagina" e' quem normalmente
  // decide quando parar, devolvendo o progresso parcial ja' apurado. Esse
  // timeout aqui fica um pouco acima dele de proposito (raramente deve
  // disparar) - se disparar mesmo assim, e' so' esse bloco especifico que
  // sai vazio, sem afetar os demais blocos rodando em paralelo.
  const TIMEOUT_BLOCO_MS = 75000;
  let aba;
  try {
    await adquirirSlotDeAbaOculta();
    aba = await chrome.tabs.create({ url: urlBase, active: false });
    await aguardarCarregamentoAba(aba.id);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const [{ result: linkEncontrado } = {}] = await chrome.scripting.executeScript({
      target: { tabId: aba.id },
      func: clicarLinkRelatorioGeralNaPagina,
    });
    if (!linkEncontrado) {
      return {
        itens: [],
        erro:
          'Link "Relatório Geral" não encontrado na página atual. Abra uma página do eproc com o menu lateral e tente novamente.',
      };
    }

    await aguardarCarregamentoAba(aba.id);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const [{ result: resultadoSelecao } = {}] = await chrome.scripting.executeScript({
      target: { tabId: aba.id },
      func: selecionarOrgaoJuizoRelatorioGeralNaPagina,
      args: [valorOrgaoJuizo],
    });
    if (!resultadoSelecao || !resultadoSelecao.ok) {
      return { itens: [], erro: (resultadoSelecao && resultadoSelecao.erro) || "Falha ao selecionar o Órgão/Juízo." };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));

    const [{ result } = {}] = await comTimeout(
      chrome.scripting.executeScript({
        target: { tabId: aba.id },
        func: consultarSituacoesEspecificasNaPagina,
        args: [opcoesDoBloco],
      }),
      TIMEOUT_BLOCO_MS,
      `Tempo esgotado (${TIMEOUT_BLOCO_MS / 1000}s) consultando um bloco de ${opcoesDoBloco.length} situação(ões).`
    );

    return result || { itens: [], erro: "Sem resultado ao consultar o bloco de situações." };
  } catch (e) {
    return { itens: [], erro: e && e.message ? e.message : String(e) };
  } finally {
    if (aba && aba.id) {
      chrome.tabs.remove(aba.id).catch(() => {});
    }
    liberarSlotDeAbaOculta();
  }
}

// Divide uma lista em ate' "numBlocos" blocos (round-robin), descartando
// blocos vazios - usado para repartir as ~40 opcoes de situação em (por
// padrao) 5 fatias de ~8, uma por aba/consulta em paralelo.
function dividirEmBlocos(lista, numBlocos) {
  const total = Math.max(1, Math.min(numBlocos, lista.length));
  const blocos = Array.from({ length: total }, () => []);
  lista.forEach((item, indice) => {
    blocos[indice % total].push(item);
  });
  return blocos.filter((bloco) => bloco.length > 0);
}

// Mesmo valor de LIMITE_ABAS_SIMULTANEAS: o detalhamento de suspensos e'
// so' mais um consumidor do semaforo global de abas ocultas, entao pode
// pedir ate' o maximo permitido de blocos/abas simultaneas sem estourar
// o limite combinado com as demais consultas do relatório.
const NUM_BLOCOS_PARALELOS_SITUACOES = LIMITE_ABAS_SIMULTANEAS;

// Detalha todas as situações especificas de um grupo (ex.: cada variante
// de suspensão/sobrestamento dentro do grupo "S") em PARALELO: primeiro
// lista as opcoes do grupo (uma aba rapida, so' leitura), depois divide
// em ate' NUM_BLOCOS_PARALELOS_SITUACOES blocos e consulta cada bloco
// numa aba PROPRIA, todas ao mesmo tempo (Promise.all, respeitando o
// semaforo global de abas ocultas) - em vez de uma unica aba consultando
// as ~40 opcoes uma de cada vez. Cada bloco tem um orcamento interno de
// 60s (verificado ENTRE um item e outro, preservando o que ja' foi
// apurado) e um timeout externo de 75s como rede de seguranca; se algum
// bloco nao terminar a tempo, o resultado sai "parcial" (com o que os
// demais blocos conseguiram apurar), mas nunca trava a exportação - o
// TOTAL de suspensos (consultado à parte, fora desta função) nunca é
// afetado por
// esse limite.
async function abrirAbaEConsultarSituacoesGrupo(urlBase, valorOrgaoJuizo, grupo) {
  const { opcoes, erro: erroListagem } = await abrirAbaEListarSituacoesDoGrupo(urlBase, valorOrgaoJuizo, grupo);
  if (opcoes.length === 0) {
    return { itens: [], erro: erroListagem || `Nenhuma opção de situação do grupo "${grupo}" encontrada.` };
  }

  const blocos = dividirEmBlocos(opcoes, NUM_BLOCOS_PARALELOS_SITUACOES);
  const resultadosBlocos = await Promise.all(
    blocos.map((bloco) => abrirAbaEConsultarSituacoesEspecificas(urlBase, valorOrgaoJuizo, bloco))
  );

  const itens = [];
  const errosBlocos = [];
  let itensEsperados = 0;
  for (let i = 0; i < blocos.length; i += 1) {
    itensEsperados += blocos[i].length;
    const { itens: itensBloco, erro: erroBloco } = resultadosBlocos[i];
    itens.push(...itensBloco);
    if (erroBloco) errosBlocos.push(erroBloco);
  }

  const parcial = itens.length < itensEsperados || errosBlocos.length > 0;
  return {
    itens,
    erro: null,
    parcial,
    motivoParcial: parcial
      ? `Consulta em paralelo (${blocos.length} bloco(s) simultâneos) não concluiu a tempo - ${
          itensEsperados - itens.length
        } de ${itensEsperados} situação(ões) não consultada(s)${
          errosBlocos.length > 0 ? ` (${errosBlocos.join(" | ")})` : ""
        }.`
      : null,
  };
}


// ---- Relatório Geral da Corregedoria (panorama de todas as unidades) ----

// Links de menu das duas telas panoramicas usadas nesse relatorio (acao=
// confirmados no menu lateral do perfil CORREGEDORIA da pagina real de
// Remessas em Aberto enviada pelo usuario).
function clicarLinkSemMovimentacaoTodasVarasNaPagina() {
  const link = document.querySelector('a[href*="acao=relatorio_sem_movimentacao_listar_geral"]');
  if (!link) return false;
  link.click();
  return true;
}

function clicarLinkAtuacaoJuizLeigoNaPagina() {
  const link = document.querySelector('a[href*="acao=relatorio_atuacao_auxiliar_justica"]');
  if (!link) return false;
  link.click();
  return true;
}

// Extrator GENERICO de tabela de resultado, best-effort - usado nas duas
// telas panoramicas ("Processos sem Movimentação N Dias (todas Varas)" e
// "Relatório de Atuação Conciliador/Juiz Leigo"), das quais NAO temos
// amostra HTML (diferente das demais telas desta extensao, calibradas
// contra paginas reais). Estrategia defensiva, com log "[eproc]"
// detalhado para calibrar depois com o HTML real se falhar:
// 1. Se "diasPreencher" vier, tenta achar um campo de dias (input number
//    ou id/name contendo "dias") e preenche.
// 2. Clica num botao "Consultar" se existir (a tela pode ja' abrir
//    consultada), esperando um tempo para o resultado carregar.
// 3. Extrai a tabela: primeiro via API do DataTables (mesmo dual-path
//    das Remessas em Aberto); senao, a maior tabela visivel com <th> e
//    linhas de dados (.infraTable ou table generica).
// Retorna { cabecalhos: [..], linhas: [[..]], erro } - colunas limitadas
// as 8 primeiras para caber no PDF. Nunca lanca excecao.
function extrairTabelaGenericaNaPagina(diasPreencher) {
  const LIMITE_COLUNAS = 8;
  const LIMITE_LINHAS = 400;

  function aguardar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function textoLimpo(el) {
    return (el && el.textContent ? el.textContent : "").replace(/\s+/g, " ").trim();
  }

  function extrairDeDataTable() {
    if (typeof jQuery === "undefined" || !jQuery.fn || !jQuery.fn.DataTable) return null;
    const tabelas = Array.from(document.querySelectorAll("table")).filter((t) =>
      jQuery.fn.DataTable.isDataTable(t)
    );
    if (tabelas.length === 0) return null;
    const dt = jQuery(tabelas[0]).DataTable();
    const cabecalhos = Array.from(tabelas[0].querySelectorAll("thead th"))
      .map(textoLimpo)
      .slice(0, LIMITE_COLUNAS);
    // page.len(-1) mostra tudo; rows().data() pode conter objetos ou
    // arrays dependendo da configuracao da tela - normaliza para texto.
    try {
      dt.page.len(-1).draw(false);
    } catch (e) {
      // paginacao pode nao existir - segue com o que estiver visivel
    }
    const div = document.createElement("div");
    const linhas = dt
      .rows({ search: "applied" })
      .data()
      .toArray()
      .slice(0, LIMITE_LINHAS)
      .map((linha) => {
        const valores = Array.isArray(linha) ? linha : Object.values(linha);
        return valores.slice(0, LIMITE_COLUNAS).map((v) => {
          div.innerHTML = v == null ? "" : String(v);
          return (div.textContent || "").replace(/\s+/g, " ").trim();
        });
      });
    return { cabecalhos, linhas };
  }

  function extrairDeTabelaHtml() {
    const candidatas = Array.from(document.querySelectorAll("table.infraTable, table.eproc-table, table"))
      .map((t) => ({ tabela: t, linhas: t.querySelectorAll("tbody tr, tr").length }))
      .filter((c) => c.linhas > 1)
      .sort((a, b) => b.linhas - a.linhas);
    if (candidatas.length === 0) return null;
    const tabela = candidatas[0].tabela;

    const ths = Array.from(tabela.querySelectorAll("th"));
    const cabecalhos = ths.map(textoLimpo).filter(Boolean).slice(0, LIMITE_COLUNAS);

    const linhas = Array.from(tabela.querySelectorAll("tr"))
      .filter((tr) => tr.querySelectorAll("td").length > 0)
      .slice(0, LIMITE_LINHAS)
      .map((tr) =>
        Array.from(tr.querySelectorAll("td"))
          .slice(0, LIMITE_COLUNAS)
          .map(textoLimpo)
      );
    if (linhas.length === 0) return null;
    return { cabecalhos, linhas };
  }

  return (async () => {
    try {
      if (diasPreencher != null) {
        const candidatos = Array.from(
          document.querySelectorAll('input[type="number"], input[id*="ias" i], input[name*="ias" i]')
        );
        const campoDias = candidatos.find((el) => /dia/i.test(el.id + " " + el.name));
        const alvo = campoDias || candidatos[0];
        if (alvo) {
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
          nativeSetter.call(alvo, String(diasPreencher));
          alvo.dispatchEvent(new Event("input", { bubbles: true }));
          alvo.dispatchEvent(new Event("change", { bubbles: true }));
          console.log("[eproc]", "Campo de dias preenchido:", alvo.id || alvo.name);
        } else {
          console.warn("[eproc]", "Nenhum campo de dias encontrado nesta tela - seguindo sem preencher.");
        }
      }

      const botaoConsultar = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"]')).find(
        (el) => /consultar/i.test(el.textContent || el.value || "")
      );
      if (botaoConsultar) {
        console.log("[eproc]", "Clicando em Consultar...");
        botaoConsultar.click();
        // A consulta pode ser AJAX ou recarregar a pagina; espera um
        // tempo generoso e segue - se recarregar, este script morre e o
        // chamador retenta a extracao numa nova chamada.
        await aguardar(4000);
      } else {
        console.log("[eproc]", "Nenhum botão Consultar encontrado - a tela pode já abrir consultada.");
      }

      const resultado = extrairDeDataTable() || extrairDeTabelaHtml();
      if (!resultado || resultado.linhas.length === 0) {
        console.warn("[eproc]", "Nenhuma tabela de resultado encontrada. Título da página:", document.title);
        return {
          cabecalhos: [],
          linhas: [],
          erro: "Nenhuma tabela de resultado encontrada nesta tela (envie o HTML da página para calibrar a extração).",
        };
      }
      console.log("[eproc]", "Tabela extraída:", resultado.linhas.length, "linha(s),", resultado.cabecalhos.length, "coluna(s).");
      return { cabecalhos: resultado.cabecalhos, linhas: resultado.linhas, erro: null };
    } catch (e) {
      return { cabecalhos: [], linhas: [], erro: e && e.message ? e.message : String(e) };
    }
  })();
}

// Abre uma aba oculta, clica no link de menu indicado, espera carregar e
// roda o extrator generico de tabela. Se a primeira extracao falhar por
// navegacao no meio (o Consultar de algumas telas recarrega a pagina,
// matando o script injetado), tenta extrair de novo na pagina ja'
// consultada.
async function abrirAbaEExtrairTabelaRelatorio(urlBase, funcClicarLink, nomeRelatorio, diasPreencher) {
  let aba;
  try {
    await adquirirSlotDeAbaOculta();
    aba = await chrome.tabs.create({ url: urlBase, active: false });
    await aguardarCarregamentoAba(aba.id);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const [{ result: linkEncontrado } = {}] = await chrome.scripting.executeScript({
      target: { tabId: aba.id },
      func: funcClicarLink,
    });

    if (!linkEncontrado) {
      return {
        cabecalhos: [],
        linhas: [],
        erro: `Link "${nomeRelatorio}" não encontrado no menu lateral. Abra uma página do eproc com o menu lateral e tente novamente.`,
      };
    }

    await aguardarCarregamentoAba(aba.id);
    await new Promise((resolve) => setTimeout(resolve, 800));

    let resultado = null;
    try {
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId: aba.id },
        world: "MAIN",
        func: extrairTabelaGenericaNaPagina,
        args: [diasPreencher != null ? diasPreencher : null],
      });
      resultado = result;
    } catch (e) {
      console.warn("[eproc]", nomeRelatorio, "- primeira extração interrompida (provável recarregamento):", String(e));
    }

    if (!resultado || (resultado.erro && resultado.linhas.length === 0)) {
      // Retentativa na pagina ja' consultada/recarregada, sem preencher
      // dias de novo (o filtro persiste no formulário reenviado).
      await aguardarCarregamentoAba(aba.id).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId: aba.id },
        world: "MAIN",
        func: extrairTabelaGenericaNaPagina,
        args: [null],
      });
      if (result && result.linhas.length > 0) resultado = result;
      else if (!resultado) resultado = result;
    }

    return resultado || { cabecalhos: [], linhas: [], erro: "Sem resultado ao ler a tabela do relatório." };
  } catch (e) {
    return { cabecalhos: [], linhas: [], erro: e && e.message ? e.message : String(e) };
  } finally {
    if (aba && aba.id) {
      chrome.tabs.remove(aba.id).catch(() => {});
    }
    liberarSlotDeAbaOculta();
  }
}

// Monta um PDF-tabela a partir de cabecalhos/linhas dinamicos (colunas
// descobertas em tempo de execucao, diferente das tabelas fixas de
// Localizadores/Remessas): distribui a largura util igualmente entre as
// colunas e converte cada linha (array) num objeto para o formato que
// "construirPdfTabela" espera.
function construirPdfTabelaDinamica(cabecalhos, linhas, tituloDocumento) {
  const larguraUtil = PDF_LOCALIZADORES_LARGURA_PAGINA - PDF_LOCALIZADORES_MARGEM * 2;
  const num = Math.max(1, cabecalhos.length);
  const colunas = cabecalhos.map((titulo, i) => ({
    titulo: titulo || `Coluna ${i + 1}`,
    largura: larguraUtil / num,
    campo: `c${i}`,
  }));
  const itens = linhas.map((linha) => {
    const item = {};
    linha.forEach((valor, i) => {
      if (i < num) item[`c${i}`] = valor;
    });
    return item;
  });
  return construirPdfTabela(itens, colunas, tituloDocumento);
}

// Orquestra o Relatório Geral da Corregedoria (panorama de TODAS as
// unidades - nao exige unidade escolhida, diferente do Relatório da
// Unidade): extrai as duas telas panoramicas e gera um unico PDF com
// capa institucional + as duas tabelas.
async function exportarRelatorioPanoramico(aoProgredir) {
  const notificar = (texto) => {
    if (aoProgredir) aoProgredir(texto);
  };

  const [abaAtual] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!abaAtual || !abaAtual.url) {
    throw new Error("Nenhuma aba ativa encontrada. Abra uma página do eproc primeiro.");
  }

  notificar(`Extraindo processos sem movimentação há mais de ${DIAS_PANORAMA_SEM_MOVIMENTACAO} dias (todas as varas)...`);
  const semMov = await abrirAbaEExtrairTabelaRelatorio(
    abaAtual.url,
    clicarLinkSemMovimentacaoTodasVarasNaPagina,
    "Processos sem Movimentação N Dias (todas Varas)",
    DIAS_PANORAMA_SEM_MOVIMENTACAO
  );

  notificar("Extraindo o Relatório de Atuação Conciliador/Juiz Leigo...");
  const atuacao = await abrirAbaEExtrairTabelaRelatorio(
    abaAtual.url,
    clicarLinkAtuacaoJuizLeigoNaPagina,
    "Relatório de Atuação Conciliador/Juiz Leigo",
    null
  );

  if (semMov.linhas.length === 0 && atuacao.linhas.length === 0) {
    throw new Error(
      `Nenhum dado extraído. Sem movimentação: ${semMov.erro || "vazio"}. Atuação: ${atuacao.erro || "vazio"}.`
    );
  }

  notificar("Gerando PDF...");
  const dataInformacao = new Date().toLocaleString("pt-BR");

  const secoesResumo = [
    {
      titulo: "CONTEÚDO DESTE RELATÓRIO",
      linhas: [
        {
          rotulo: `Processos sem movimentação há mais de ${DIAS_PANORAMA_SEM_MOVIMENTACAO} dias (todas as varas)`,
          valor: semMov.linhas.length,
        },
        { rotulo: "Atuação Conciliador/Juiz Leigo (linhas)", valor: atuacao.linhas.length },
      ],
    },
  ];
  const avisos = [];
  if (semMov.erro) avisos.push(`Sem movimentação (todas as varas): ${semMov.erro}`);
  if (atuacao.erro) avisos.push(`Atuação Conciliador/Juiz Leigo: ${atuacao.erro}`);

  const bytesCapa = await construirCapaRelatorioGerencial(
    "Todas as unidades",
    dataInformacao,
    secoesResumo,
    avisos
  );
  const pdfFinal = await PDFDocument.create();
  const pdfCapa = await PDFDocument.load(bytesCapa);
  const paginasCapa = await pdfFinal.copyPages(pdfCapa, pdfCapa.getPageIndices());
  paginasCapa.forEach((pagina) => pdfFinal.addPage(pagina));

  if (semMov.linhas.length > 0) {
    const bytes = await construirPdfTabelaDinamica(
      semMov.cabecalhos,
      semMov.linhas,
      `Processos sem movimentação há mais de ${DIAS_PANORAMA_SEM_MOVIMENTACAO} dias (todas as varas) — ${semMov.linhas.length} linha(s)`
    );
    const pdf = await PDFDocument.load(bytes);
    const paginas = await pdfFinal.copyPages(pdf, pdf.getPageIndices());
    paginas.forEach((pagina) => pdfFinal.addPage(pagina));
  }

  if (atuacao.linhas.length > 0) {
    const bytes = await construirPdfTabelaDinamica(
      atuacao.cabecalhos,
      atuacao.linhas,
      `Atuação Conciliador/Juiz Leigo — ${atuacao.linhas.length} linha(s)`
    );
    const pdf = await PDFDocument.load(bytes);
    const paginas = await pdfFinal.copyPages(pdf, pdf.getPageIndices());
    paginas.forEach((pagina) => pdfFinal.addPage(pagina));
  }

  const bytesFinais = await pdfFinal.save();
  const nomeArquivo = `eproc/relatorio_geral_corregedoria_${new Date().toISOString().slice(0, 10)}.pdf`;
  await baixarUm(nomeArquivo, construirDataUrlBinario("application/pdf", bytesFinais));

  notificar("Finalizando...");
  return {
    totalSemMovimentacao: semMov.linhas.length,
    totalAtuacao: atuacao.linhas.length,
  };
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
    await adquirirSlotDeAbaOculta();
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
      world: "MAIN",
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
    liberarSlotDeAbaOculta();
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

  // Cada bloco (despacho/sentença) tem 3 sub-consultas independentes,
  // rodando em paralelo entre si - e os proprios blocos, mais o
  // demonstrativo de sem movimentação e os totais de ativos/suspensos,
  // tambem rodam todos ao mesmo tempo (Promise.all), respeitando o
  // semaforo global de abas ocultas (LIMITE_ABAS_SIMULTANEAS) - bem mais
  // rapido que consultar uma coisa de cada vez.
  async function consultarBloco(nomeSituacao, valorSituacao) {
    const bloco = { total: null, urgentes: null, mais30Dias: null, erros: [] };

    const [rTotal, rUrgentes, rAtraso] = await Promise.all([
      abrirAbaEConsultarUmaVez(abaAtual.url, { valorSituacao, urgente: false, diasSituacao: null }),
      abrirAbaEConsultarUmaVez(abaAtual.url, { valorSituacao, urgente: true, diasSituacao: null }),
      abrirAbaEConsultarUmaVez(abaAtual.url, { valorSituacao, urgente: false, diasSituacao: DIAS_LIMITE_ATRASO }),
    ]);

    bloco.total = rTotal.contagem;
    if (rTotal.erro) bloco.erros.push(`total: ${rTotal.erro}`);
    bloco.urgentes = rUrgentes.contagem;
    if (rUrgentes.erro) bloco.erros.push(`urgentes: ${rUrgentes.erro}`);
    bloco.mais30Dias = rAtraso.contagem;
    if (rAtraso.erro) bloco.erros.push(`+${DIAS_LIMITE_ATRASO} dias: ${rAtraso.erro}`);

    return bloco;
  }

  notificar("Consultando conclusos, sem movimentação, ativos e suspensos...");
  const [despacho, sentenca, resultadosSemMovimentacao, rAtivos, rSuspensos] = await Promise.all([
    consultarBloco("MOVIMENTO-AGUARDA DESPACHO", VALOR_SITUACAO_AGUARDA_DESPACHO),
    consultarBloco("MOVIMENTO-AGUARDA SENTENÇA", VALOR_SITUACAO_AGUARDA_SENTENCA),
    Promise.all(
      FAIXAS_DIAS_SEM_MOVIMENTACAO.map((dias) =>
        abrirAbaEConsultarUmaVez(abaAtual.url, {
          valorSituacao: null,
          urgente: false,
          diasSituacao: null,
          diasSemMovimentacao: dias,
        })
      )
    ),
    // Relação de processos ativos e suspensos/sobrestados - so' o total
    // (sem "relação de processos"), na unidade atual (sem filtro de
    // Órgão/Juízo: esse relatório roda sempre na unidade ja' habilitada
    // no perfil logado).
    abrirAbaEConsultarUmaVez(abaAtual.url, { valorSituacao: null, urgente: false, diasSituacao: null }),
    abrirAbaEConsultarUmaVez(abaAtual.url, { grupoSituacao: "S", urgente: false, diasSituacao: null }),
  ]);

  const semMovimentacao = { erros: [] };
  FAIXAS_DIAS_SEM_MOVIMENTACAO.forEach((dias, indice) => {
    const r = resultadosSemMovimentacao[indice];
    semMovimentacao[`dias${dias}`] = r.contagem;
    if (r.erro) semMovimentacao.erros.push(`${dias} dias: ${r.erro}`);
  });

  const processosAtivos = { total: rAtivos.contagem, erros: rAtivos.erro ? [rAtivos.erro] : [] };
  const suspensos = { total: rSuspensos.contagem, erros: rSuspensos.erro ? [rSuspensos.erro] : [] };

  notificar("Finalizando...");
  return { despacho, sentenca, semMovimentacao, processosAtivos, suspensos };
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

// Le', na tela do Relatório Geral, todas as opcoes do filtro
// "Órgão/Juízo" (select#selIdOrgaoJuizo) - visualmente um dropdown do
// bootstrap-select (o botao com texto "Selecione" e o menu que abre ao
// clicar), mas o bootstrap-select so' e' uma casca visual em cima do
// <select> nativo original, que continua existindo no DOM (so' fica
// escondido) com as mesmas <option> - por isso a leitura e' direto no
// <select>, sem precisar simular nenhum clique/abertura do dropdown
// visual. Autocontida, executada via chrome.scripting.executeScript.
function lerUnidadesRelatorioGeralNaPagina() {
  const select = document.getElementById("selIdOrgaoJuizo");
  if (!select) {
    return { unidades: [], erro: 'Campo "Órgão/Juízo" (#selIdOrgaoJuizo) não encontrado nesta página.' };
  }
  const unidades = Array.from(select.options)
    .filter((opcao) => opcao.value && opcao.value !== "null")
    .map((opcao) => ({
      valor: opcao.value,
      texto: (opcao.textContent || opcao.getAttribute("title") || "").trim(),
    }));
  return { unidades, erro: null };
}

// Navega a aba ATUAL (visivel) ate' o Relatório Geral (mesmo mecanismo
// de "abrirTelaRelatorioGeral") e le' as unidades disponiveis no filtro
// "Órgão/Juízo" dessa tela - usado pelo botao "Relatório Gerencial da
// Unidade" (so' aparece no painel quando o perfil ativo e'
// "CORREGEDORIA"). Por enquanto so' lista as unidades num dropdown no
// painel; nenhuma consulta/relatorio adicional e' disparado a partir
// delas ainda.
async function listarUnidadesRelatorioGeral(aoProgredir) {
  const notificar = (texto) => {
    if (aoProgredir) aoProgredir(texto);
  };

  const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!aba || !aba.id) {
    throw new Error("Nenhuma aba ativa encontrada. Abra uma página do eproc primeiro.");
  }

  notificar("Abrindo o Relatório Geral...");
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
  // Pequena espera extra para os scripts da pagina (bootstrap-select
  // etc.) terminarem de inicializar apos o carregamento.
  await new Promise((resolve) => setTimeout(resolve, 500));

  notificar("Lendo as unidades disponíveis...");
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId: aba.id },
    func: lerUnidadesRelatorioGeralNaPagina,
  });

  if (!result || result.erro) {
    throw new Error((result && result.erro) || "Não foi possível ler as unidades disponíveis.");
  }

  notificar("Finalizando...");
  return { unidades: result.unidades };
}

// Dias de atraso usados no Relatório Gerencial da Unidade (diferente do
// DIAS_LIMITE_ATRASO de 30 dias usado no relatorio "rapido" do painel -
// aqui o pedido foi especificamente "aguardando há mais de 90 dias").
const DIAS_LIMITE_ATRASO_UNIDADE = 90;

// Dias sem movimentação usados no panorama de todas as varas (Relatório
// Geral da Corregedoria).
const DIAS_PANORAMA_SEM_MOVIMENTACAO = 90;

// Consulta total/urgentes/+90 dias de uma situacao (despacho ou
// sentenca) filtrada por uma unidade especifica - reaproveita
// "abrirAbaEConsultarUmaVez"/"consultarUmaVezNaPagina" (mesmas funcoes
// do relatorio rapido do painel), so' que com "valorOrgaoJuizo" preenchido
// e o limite de dias em 90 em vez de 30. "Não urgentes" e' calculado
// aqui mesmo (total - urgentes) para nao precisar de mais uma consulta -
// nao ha' filtro de "não urgente" na tela do eproc.
async function consultarBlocoUnidade(urlBase, valorOrgaoJuizo, nomeSituacao, valorSituacao, notificar) {
  const bloco = { total: null, urgentes: null, naoUrgentes: null, mais90Dias: null, erros: [] };

  // As 3 consultas sao independentes entre si (cada uma abre sua propria
  // aba oculta) - rodam em PARALELO via Promise.all em vez de uma de cada
  // vez, respeitando o semaforo global de abas ocultas (LIMITE_ABAS_SIMULTANEAS).
  notificar(`Consultando ${nomeSituacao}: total, urgentes e atraso...`);
  const [rTotal, rUrgentes, rAtraso] = await Promise.all([
    abrirAbaEConsultarUmaVez(urlBase, { valorSituacao, urgente: false, diasSituacao: null, valorOrgaoJuizo }),
    abrirAbaEConsultarUmaVez(urlBase, { valorSituacao, urgente: true, diasSituacao: null, valorOrgaoJuizo }),
    abrirAbaEConsultarUmaVez(urlBase, {
      valorSituacao,
      urgente: false,
      diasSituacao: DIAS_LIMITE_ATRASO_UNIDADE,
      valorOrgaoJuizo,
    }),
  ]);

  bloco.total = rTotal.contagem;
  if (rTotal.erro) bloco.erros.push(`total: ${rTotal.erro}`);

  bloco.urgentes = rUrgentes.contagem;
  if (rUrgentes.erro) bloco.erros.push(`urgentes: ${rUrgentes.erro}`);

  if (bloco.total != null && bloco.urgentes != null) {
    bloco.naoUrgentes = Math.max(0, bloco.total - bloco.urgentes);
  }

  bloco.mais90Dias = rAtraso.contagem;
  if (rAtraso.erro) bloco.erros.push(`+${DIAS_LIMITE_ATRASO_UNIDADE} dias: ${rAtraso.erro}`);

  return bloco;
}


// ---- Remessas aos juízes leigos (tela "Relatório de remessas em aberto") ----

// Link de menu confirmado no HTML real da tela (menu lateral > Relatórios
// > "Relatório de remessas em aberto"). Autocontida, executada via
// chrome.scripting.executeScript.
function clicarLinkRemessasJuizesLeigosNaPagina() {
  const link = document.querySelector('a[href*="acao=relatorio_remessas_em_aberto/listar"]');
  if (!link) return false;
  link.click();
  return true;
}

// Seleciona o órgão julgador no filtro "Órgão Julgador" (#IdOrgaoSecretaria)
// dessa tela - um <select> simples por baixo do bootstrap-select, mesmo
// mecanismo ja' usado em "selecionarOrgaoJuizoRelatorioGeralNaPagina".
function selecionarOrgaoRemessasJuizesLeigosNaPagina(valorOrgao) {
  const select = document.getElementById("IdOrgaoSecretaria");
  if (!select) {
    return { ok: false, erro: 'Campo "Órgão Julgador" (#IdOrgaoSecretaria) não encontrado nesta página.' };
  }

  let encontrouOpcao = false;
  for (const opcao of select.options) {
    const selecionada = opcao.value === valorOrgao;
    opcao.selected = selecionada;
    if (selecionada) encontrouOpcao = true;
  }
  if (!encontrouOpcao) {
    return { ok: false, erro: `Órgão "${valorOrgao}" não encontrado no filtro Órgão Julgador.` };
  }
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, erro: null };
}

// Clica no botão "Consultar" do formulário de filtro (form="frmFiltroRemessasEmAberto").
function clicarConsultarRemessasJuizesLeigosNaPagina() {
  const botao =
    document.querySelector('button[onclick*="submeterFrmFiltroRemessasEmAberto"]') ||
    Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"]')).find((el) =>
      /consultar/i.test(el.textContent || el.value || "")
    );
  if (!botao) return false;
  botao.click();
  return true;
}

// Le' a tabela "#tbl_remessas_em_aberto" (DataTables), com as colunas
// pedidas (Nome do Juiz Leigo, Número do Processo, Classe Processual,
// Data Remessa, Dias da Remessa), casando pelo texto do cabecalho para
// nao depender da ordem exata das colunas. Le' direto do DOM ja'
// renderizado (apos "page.len(-1).draw(false)" mostrar todas as linhas),
// em vez da API "rows().data()" - essa devolveria o objeto bruto da linha
// (com campos como "LinkProcesso" que nao interessam aqui), enquanto o
// DOM ja' traz exatamente o texto formatado que aparece na tela (ex.: "5
// Dia(s)"). Best-effort, nunca lanca excecao.
//
// Processos com prioridade legal (idoso, doente grave, etc.) aparecem na
// celula de Classe Processual com um <label style="color:red;..."> extra
// junto da classe (confirmado no HTML real da tela) - ex.:
// "PROCEDIMENTO DO JUIZADO ESPECIAL CÍVEL<br><label ...>Idoso</label>".
// O motivo (texto do <label>) e' extraido separadamente do texto da
// classe (clonando a celula e removendo o <label> antes de ler o
// textContent), para poder destacar o processo no PDF sem misturar o
// motivo dentro do nome da classe.
async function extrairLinhasRemessasJuizesLeigosNaPagina() {
  const LIMITE_LINHAS = 1000;

  function aguardar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function textoLimpo(el) {
    return (el && el.textContent ? el.textContent : "").replace(/\s+/g, " ").trim();
  }

  try {
    if (typeof jQuery === "undefined" || !jQuery.fn || !jQuery.fn.DataTable) {
      return { linhas: [], erro: "jQuery DataTables não disponível nesta página." };
    }
    const tabelaEl = jQuery("#tbl_remessas_em_aberto");
    if (tabelaEl.length === 0 || !jQuery.fn.DataTable.isDataTable("#tbl_remessas_em_aberto")) {
      return { linhas: [], erro: 'Tabela "#tbl_remessas_em_aberto" não encontrada ou ainda não inicializada.' };
    }

    const dt = tabelaEl.DataTable();
    const aguardarRedesenho = () =>
      Promise.race([
        new Promise((resolve) => tabelaEl.one("draw.dt", () => resolve(true))),
        aguardar(8000).then(() => false),
      ]);
    const promessaMostrarTudo = aguardarRedesenho();
    dt.page.len(-1).draw(false);
    await promessaMostrarTudo;

    const tabelaDom = document.getElementById("tbl_remessas_em_aberto");
    const cabecalhos = Array.from(tabelaDom.querySelectorAll("thead th")).map(textoLimpo);
    const idxJuiz = cabecalhos.findIndex((h) => /juiz/i.test(h));
    const idxProcesso = cabecalhos.findIndex((h) => /processo/i.test(h));
    const idxClasse = cabecalhos.findIndex((h) => /classe/i.test(h));
    const idxData = cabecalhos.findIndex((h) => /data remessa/i.test(h));
    const idxDias = cabecalhos.findIndex((h) => /dias/i.test(h));

    const linhasEl = Array.from(tabelaDom.querySelectorAll("tbody tr")).filter(
      (tr) => tr.querySelectorAll("td").length > 0
    );

    const linhas = linhasEl.slice(0, LIMITE_LINHAS).map((tr) => {
      const celulas = Array.from(tr.querySelectorAll("td"));
      const valor = (idx) => (idx >= 0 && celulas[idx] ? textoLimpo(celulas[idx]) : "");
      const diasTexto = valor(idxDias);
      const diasNumero = parseInt((diasTexto.match(/\d+/) || [])[0], 10);

      let classe = "";
      let prioridade = null;
      if (idxClasse >= 0 && celulas[idxClasse]) {
        const celulaClasse = celulas[idxClasse].cloneNode(true);
        const labelEl = celulaClasse.querySelector("label");
        if (labelEl) {
          prioridade = textoLimpo(labelEl) || null;
          labelEl.remove();
        }
        classe = textoLimpo(celulaClasse);
      }

      return {
        juiz: valor(idxJuiz),
        processo: valor(idxProcesso),
        classe,
        prioridade,
        dataRemessa: valor(idxData),
        diasRemessa: diasTexto,
        diasRemessaNumero: Number.isNaN(diasNumero) ? 0 : diasNumero,
      };
    });

    return { linhas, erro: null };
  } catch (e) {
    return { linhas: [], erro: e && e.message ? e.message : String(e) };
  }
}

// Orquestra a consulta de remessas aos juízes leigos de uma unidade: abre
// uma aba oculta, clica no link de menu, seleciona o órgão julgador,
// consulta e extrai a tabela de resultado - mesmo padrao de aba
// oculta/timeout ja' usado nas demais consultas do relatório gerencial.
// Nunca lanca excecao: sempre resolve com { linhas, erro }.
async function consultarRemessasJuizesLeigosUmaVez(urlBase, valorUnidade) {
  let aba;
  try {
    await adquirirSlotDeAbaOculta();
    aba = await chrome.tabs.create({ url: urlBase, active: false });
    await aguardarCarregamentoAba(aba.id);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const [{ result: linkEncontrado } = {}] = await chrome.scripting.executeScript({
      target: { tabId: aba.id },
      func: clicarLinkRemessasJuizesLeigosNaPagina,
    });
    if (!linkEncontrado) {
      return {
        linhas: [],
        erro: 'Link "Relatório de remessas em aberto" não encontrado no menu lateral desta página.',
      };
    }
    await aguardarCarregamentoAba(aba.id);
    await new Promise((resolve) => setTimeout(resolve, 800));

    const [{ result: selecaoOrgao } = {}] = await chrome.scripting.executeScript({
      target: { tabId: aba.id },
      func: selecionarOrgaoRemessasJuizesLeigosNaPagina,
      args: [valorUnidade],
    });
    if (!selecaoOrgao || !selecaoOrgao.ok) {
      return { linhas: [], erro: (selecaoOrgao && selecaoOrgao.erro) || 'Falha ao selecionar o "Órgão Julgador".' };
    }
    await new Promise((resolve) => setTimeout(resolve, 300));

    await chrome.scripting.executeScript({
      target: { tabId: aba.id },
      func: clicarConsultarRemessasJuizesLeigosNaPagina,
    });
    await new Promise((resolve) => setTimeout(resolve, 2500));

    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId: aba.id },
      world: "MAIN",
      func: extrairLinhasRemessasJuizesLeigosNaPagina,
    });
    return result || { linhas: [], erro: "Sem resultado ao ler a tabela de remessas aos juízes leigos." };
  } catch (e) {
    return { linhas: [], erro: e && e.message ? e.message : String(e) };
  } finally {
    if (aba && aba.id) {
      chrome.tabs.remove(aba.id).catch(() => {});
    }
    liberarSlotDeAbaOculta();
  }
}

const REMESSAS_TAMANHO_FONTE = 8.5;
const REMESSAS_ALTURA_LINHA = REMESSAS_TAMANHO_FONTE * 1.35;

// Monta o PDF (A4 RETRATO, diferente das demais tabelas desta extensao -
// que usam pagina virada) do relatório de remessas aos juízes leigos:
// total geral no topo, depois um bloco por juiz leigo (subtitulo com o
// nome + total daquele juiz, seguido da tabela com todos os processos
// dele, ordenados do mais antigo para o mais novo - maior quantidade de
// dias em remessa primeiro). Processos com prioridade legal (campo
// "prioridade" preenchido, vindo do <label> da celula de Classe
// Processual) tem o numero do processo desenhado em vermelho, com o
// motivo entre parenteses logo depois.
async function construirPdfRemessasJuizesLeigos(linhas, nomeUnidade) {
  const pdf = await PDFDocument.create();
  const fonteNormal = await pdf.embedFont(StandardFonts.Helvetica);
  const fonteNegrito = await pdf.embedFont(StandardFonts.HelveticaBold);

  const largura = LARGURA_PAGINA_TEXTO;
  const altura = ALTURA_PAGINA_TEXTO;
  const margem = MARGEM_TEXTO;
  const larguraUtil = largura - margem * 2;

  const colunas = [
    { titulo: "Juiz Leigo", largura: larguraUtil * 0.18, campo: "juiz" },
    { titulo: "Número do Processo", largura: larguraUtil * 0.25, campo: "processo" },
    { titulo: "Classe Processual", largura: larguraUtil * 0.25, campo: "classe" },
    { titulo: "Data Remessa", largura: larguraUtil * 0.16, campo: "dataRemessa" },
    { titulo: "Dias Remessa", largura: larguraUtil * 0.16, campo: "diasRemessa" },
  ];

  let pagina = null;
  let y = 0;
  let indiceLinhaZebra = 0;

  function novaPagina() {
    pagina = pdf.addPage([largura, altura]);
    desenharCabecalhoInstitucional(pagina, fonteNegrito, fonteNormal, largura, margem);
    y = altura - PDF_ALTURA_CABECALHO_INSTITUCIONAL - margem;
  }

  function garantirEspaco(alturaNecessaria) {
    if (y - alturaNecessaria < PDF_ALTURA_RODAPE + margem) {
      novaPagina();
    }
  }

  function desenharCabecalhoColunas() {
    const alturaFaixa = REMESSAS_ALTURA_LINHA * 1.7;
    garantirEspaco(alturaFaixa + REMESSAS_ALTURA_LINHA * 2);
    pagina.drawRectangle({ x: margem, y: y - alturaFaixa, width: larguraUtil, height: alturaFaixa, color: COR_PRIMARIA_ESCURA });
    let x = margem + 4;
    for (const coluna of colunas) {
      pagina.drawText(sanitizarTextoPdf(coluna.titulo), {
        x,
        y: y - alturaFaixa + alturaFaixa * 0.32,
        size: REMESSAS_TAMANHO_FONTE,
        font: fonteNegrito,
        color: COR_BRANCO,
      });
      x += coluna.largura;
    }
    y -= alturaFaixa + 10;
    indiceLinhaZebra = 0;
  }

  novaPagina();

  const tituloRemessas = quebrarLinhas(
    `Remessas aos juízes leigos da unidade "${sanitizarTextoPdf(nomeUnidade)}"`,
    fonteNegrito,
    13,
    larguraUtil
  );
  for (const linhaTitulo of tituloRemessas) {
    pagina.drawText(linhaTitulo, {
      x: margem,
      y,
      size: 13,
      font: fonteNegrito,
      color: COR_PRIMARIA_ESCURA,
    });
    y -= 17;
  }
  y -= 3;
  pagina.drawText(`Total geral: ${linhas.length} processo(s)`, {
    x: margem,
    y,
    size: 10,
    font: fonteNegrito,
    color: COR_CINZA_TEXTO,
  });
  y -= 16;
  if (linhas.some((l) => l.prioridade)) {
    pagina.drawText("Em vermelho: processos com prioridade legal (motivo entre parênteses).", {
      x: margem,
      y,
      size: 8,
      font: fonteNormal,
      color: COR_ALERTA_VERMELHO,
    });
    y -= 14;
  }
  y -= 8;

  const porJuiz = new Map();
  for (const linha of linhas) {
    const chave = linha.juiz || "(sem nome)";
    if (!porJuiz.has(chave)) porJuiz.set(chave, []);
    porJuiz.get(chave).push(linha);
  }
  const grupos = Array.from(porJuiz.entries())
    .map(([juiz, itens]) => ({
      juiz,
      itens: [...itens].sort((a, b) => (b.diasRemessaNumero || 0) - (a.diasRemessaNumero || 0)),
    }))
    .sort((a, b) => b.itens.length - a.itens.length || a.juiz.localeCompare(b.juiz, "pt-BR"));

  for (const grupo of grupos) {
    garantirEspaco(120);
    pagina.drawText(`${sanitizarTextoPdf(grupo.juiz)} — Total: ${grupo.itens.length} processo(s)`, {
      x: margem,
      y,
      size: 10.5,
      font: fonteNegrito,
      color: COR_PRIMARIA,
    });
    y -= REMESSAS_ALTURA_LINHA * 1.8;

    desenharCabecalhoColunas();

    for (const item of grupo.itens) {
      const valoresLinha = {
        juiz: item.juiz,
        processo: item.prioridade ? `${item.processo} (${item.prioridade})` : item.processo,
        classe: item.classe || "",
        dataRemessa: item.dataRemessa,
        diasRemessa: item.diasRemessa,
      };
      const linhasPorColuna = colunas.map((coluna) =>
        quebrarLinhas(sanitizarTextoPdf(String(valoresLinha[coluna.campo] ?? "")), fonteNormal, REMESSAS_TAMANHO_FONTE, coluna.largura - 4)
      );
      const maxLinhas = Math.max(1, ...linhasPorColuna.map((l) => l.length));
      const alturaLinha = maxLinhas * REMESSAS_ALTURA_LINHA + REMESSAS_ALTURA_LINHA * 0.4;

      if (y - alturaLinha < PDF_ALTURA_RODAPE + margem) {
        novaPagina();
        desenharCabecalhoColunas();
      }

      if (indiceLinhaZebra % 2 === 1) {
        pagina.drawRectangle({
          x: margem,
          y: y - alturaLinha + REMESSAS_ALTURA_LINHA * 0.3,
          width: larguraUtil,
          height: alturaLinha,
          color: COR_CINZA_CLARO,
        });
      }
      indiceLinhaZebra += 1;

      let x = margem + 4;
      for (let i = 0; i < colunas.length; i += 1) {
        const corColuna = colunas[i].campo === "processo" && item.prioridade ? COR_ALERTA_VERMELHO : COR_CINZA_TEXTO;
        let yColuna = y;
        for (const linhaTexto of linhasPorColuna[i]) {
          try {
            pagina.drawText(linhaTexto, { x, y: yColuna, size: REMESSAS_TAMANHO_FONTE, font: fonteNormal, color: corColuna });
          } catch (e) {
            // Ignora linha que a fonte padrao nao consiga desenhar.
          }
          yColuna -= REMESSAS_ALTURA_LINHA;
        }
        x += colunas[i].largura;
      }
      y -= alturaLinha;
    }

    y -= REMESSAS_ALTURA_LINHA * 0.8;
  }

  desenharRodapePaginas(pdf, fonteNormal, largura, margem);

  return pdf.save();
}

// Acha o indice de uma coluna pelo texto do cabecalho (regex, case
// insensitive) - devolve -1 se nao encontrar, para o chamador decidir o
// que fazer (campo vazio) em vez de estourar.
function indiceColunaPorCabecalho(cabecalhos, regex) {
  return cabecalhos.findIndex((h) => regex.test(h));
}

// Converte um texto de data (dd/mm/aaaa, com ou sem hora) num numero
// ordenavel (timestamp) - usado para classificar processos do mais
// antigo para o mais novo pela Data de Autuação. Texto sem uma data
// reconhecivel vira 0 (fica no inicio da ordenacao, mas nunca quebra).
function paraDataOrdenavel(texto) {
  const m = (texto || "").match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
  if (!m) return 0;
  const [, dia, mes, ano, hora = "00", minuto = "00", segundo = "00"] = m;
  const data = new Date(`${ano}-${mes}-${dia}T${hora}:${minuto}:${segundo}`);
  const tempo = data.getTime();
  return Number.isNaN(tempo) ? 0 : tempo;
}

// Monta o PDF (A4 RETRATO) da relação de processos ativos: so' os 5
// campos pedidos (Nº do Processo, Data da Autuação, Situação, Classe e
// Último Evento - o "#tblProcessoLista" real traz mais colunas, como
// Sigilo e Localizador, que ficam de fora aqui), ordenados pela Data de
// Autuação do mais antigo para o mais novo. Casa cada campo pelo texto
// do cabecalho (nao pela posicao), para nao depender da ordem exata das
// colunas na tela.
// Gerador generico de PDF (A4 RETRATO) para uma "relação de processos"
// curada: recebe os ITENS ja' prontos (um objeto por linha, com as
// chaves batendo com "campo" de cada coluna) e as definicoes de coluna
// (titulo + largura em pontos), desenha titulo + tabela com cabecalho
// repetido/zebrado, igual as demais tabelas desta extensao - reaproveitado
// por "construirPdfProcessosAtivos" e "construirPdfSuspensos" para nao
// duplicar a logica de desenho.
async function construirPdfTabelaCuradaRetrato(itens, colunas, tituloDocumento) {
  const pdf = await PDFDocument.create();
  const fonteNormal = await pdf.embedFont(StandardFonts.Helvetica);
  const fonteNegrito = await pdf.embedFont(StandardFonts.HelveticaBold);

  const largura = LARGURA_PAGINA_TEXTO;
  const altura = ALTURA_PAGINA_TEXTO;
  const margem = MARGEM_TEXTO;
  const larguraUtil = largura - margem * 2;
  const TAMANHO_FONTE = 8.5;
  const ALTURA_LINHA = TAMANHO_FONTE * 1.35;

  let pagina = null;
  let y = 0;
  let indiceLinhaZebra = 0;

  function novaPagina() {
    pagina = pdf.addPage([largura, altura]);
    desenharCabecalhoInstitucional(pagina, fonteNegrito, fonteNormal, largura, margem);
    y = altura - PDF_ALTURA_CABECALHO_INSTITUCIONAL - margem;
  }

  function garantirEspaco(alturaNecessaria) {
    if (y - alturaNecessaria < PDF_ALTURA_RODAPE + margem) {
      novaPagina();
    }
  }

  function desenharCabecalhoColunas() {
    const alturaFaixa = ALTURA_LINHA * 1.7;
    garantirEspaco(alturaFaixa + ALTURA_LINHA * 2);
    pagina.drawRectangle({ x: margem, y: y - alturaFaixa, width: larguraUtil, height: alturaFaixa, color: COR_PRIMARIA_ESCURA });
    let x = margem + 4;
    for (const coluna of colunas) {
      pagina.drawText(sanitizarTextoPdf(coluna.titulo), {
        x,
        y: y - alturaFaixa + alturaFaixa * 0.32,
        size: TAMANHO_FONTE,
        font: fonteNegrito,
        color: COR_BRANCO,
      });
      x += coluna.largura;
    }
    y -= alturaFaixa + 10;
    indiceLinhaZebra = 0;
  }

  novaPagina();

  const linhasTitulo = quebrarLinhas(sanitizarTextoPdf(tituloDocumento), fonteNegrito, 13, larguraUtil);
  for (const linhaTitulo of linhasTitulo) {
    pagina.drawText(linhaTitulo, { x: margem, y, size: 13, font: fonteNegrito, color: COR_PRIMARIA_ESCURA });
    y -= 17;
  }
  y -= 8;

  desenharCabecalhoColunas();

  for (const item of itens) {
    const linhasPorColuna = colunas.map((coluna) =>
      quebrarLinhas(sanitizarTextoPdf(String(item[coluna.campo] ?? "")), fonteNormal, TAMANHO_FONTE, coluna.largura - 4)
    );
    const maxLinhas = Math.max(1, ...linhasPorColuna.map((l) => l.length));
    const alturaLinha = maxLinhas * ALTURA_LINHA + ALTURA_LINHA * 0.4;

    if (y - alturaLinha < PDF_ALTURA_RODAPE + margem) {
      novaPagina();
      desenharCabecalhoColunas();
    }

    if (indiceLinhaZebra % 2 === 1) {
      pagina.drawRectangle({
        x: margem,
        y: y - alturaLinha + ALTURA_LINHA * 0.3,
        width: larguraUtil,
        height: alturaLinha,
        color: COR_CINZA_CLARO,
      });
    }
    indiceLinhaZebra += 1;

    let x = margem + 4;
    for (let i = 0; i < colunas.length; i += 1) {
      let yColuna = y;
      for (const linhaTexto of linhasPorColuna[i]) {
        try {
          pagina.drawText(linhaTexto, { x, y: yColuna, size: TAMANHO_FONTE, font: fonteNormal, color: COR_CINZA_TEXTO });
        } catch (e) {
          // Ignora linha que a fonte padrao nao consiga desenhar.
        }
        yColuna -= ALTURA_LINHA;
      }
      x += colunas[i].largura;
    }
    y -= alturaLinha;
  }

  desenharRodapePaginas(pdf, fonteNormal, largura, margem);

  return pdf.save();
}

// Monta o PDF (A4 RETRATO) da relação de processos ativos: so' os 5
// campos pedidos (Nº do Processo, Data da Autuação, Situação, Classe e
// Último Evento - o "#tblProcessoLista" real traz mais colunas, como
// Sigilo e Localizador, que ficam de fora aqui), ordenados pela Data de
// Autuação do mais antigo para o mais novo. Casa cada campo pelo texto
// do cabecalho (nao pela posicao), para nao depender da ordem exata das
// colunas na tela.
async function construirPdfProcessosAtivos(tabela, nomeUnidade) {
  const idxProcesso = indiceColunaPorCabecalho(tabela.cabecalhos, /processo/i);
  const idxAutuacao = indiceColunaPorCabecalho(tabela.cabecalhos, /autua/i);
  const idxSituacao = indiceColunaPorCabecalho(tabela.cabecalhos, /situa/i);
  const idxClasse = indiceColunaPorCabecalho(tabela.cabecalhos, /classe/i);
  const idxEvento = indiceColunaPorCabecalho(tabela.cabecalhos, /evento/i);
  const idxDataHora = indiceColunaPorCabecalho(tabela.cabecalhos, /data\s*\/?\s*hora/i);

  const valorDe = (linha, idx) => (idx >= 0 && linha[idx] != null ? linha[idx] : "");
  const itens = tabela.linhas
    .map((linha) => {
      const autuacao = valorDe(linha, idxAutuacao);
      return {
        processo: valorDe(linha, idxProcesso),
        autuacao,
        situacao: valorDe(linha, idxSituacao),
        classe: valorDe(linha, idxClasse),
        ultimoEvento: valorDe(linha, idxEvento),
        dataHora: valorDe(linha, idxDataHora),
        autuacaoOrdenavel: paraDataOrdenavel(autuacao),
      };
    })
    .sort((a, b) => a.autuacaoOrdenavel - b.autuacaoOrdenavel);

  const colunas = [
    { titulo: "Nº do Processo", largura: (LARGURA_PAGINA_TEXTO - MARGEM_TEXTO * 2) * 0.22, campo: "processo" },
    { titulo: "Data da Autuação", largura: (LARGURA_PAGINA_TEXTO - MARGEM_TEXTO * 2) * 0.15, campo: "autuacao" },
    { titulo: "Situação", largura: (LARGURA_PAGINA_TEXTO - MARGEM_TEXTO * 2) * 0.16, campo: "situacao" },
    { titulo: "Classe", largura: (LARGURA_PAGINA_TEXTO - MARGEM_TEXTO * 2) * 0.15, campo: "classe" },
    { titulo: "Último Evento", largura: (LARGURA_PAGINA_TEXTO - MARGEM_TEXTO * 2) * 0.16, campo: "ultimoEvento" },
    { titulo: "Data/Hora", largura: (LARGURA_PAGINA_TEXTO - MARGEM_TEXTO * 2) * 0.16, campo: "dataHora" },
  ];

  return construirPdfTabelaCuradaRetrato(
    itens,
    colunas,
    `Processos ativos da unidade "${nomeUnidade}" — ${itens.length} processo(s), do mais antigo ao mais novo`
  );
}

// Monta o PDF (A4 RETRATO) da relação de suspensos/sobrestados: so' os 4
// campos pedidos (Nº do Processo, Data da Autuação, Situação e
// Localizador - a tabela real do "#tblProcessoLista" traz mais colunas,
// como Sigilo e Classe, que ficam de fora aqui). Mesma tecnica de casar
// pelo texto do cabecalho usada em "construirPdfProcessosAtivos".
async function construirPdfSuspensos(tabela, nomeUnidade) {
  const idxProcesso = indiceColunaPorCabecalho(tabela.cabecalhos, /processo/i);
  const idxAutuacao = indiceColunaPorCabecalho(tabela.cabecalhos, /autua/i);
  const idxSituacao = indiceColunaPorCabecalho(tabela.cabecalhos, /situa/i);
  const idxLocalizador = indiceColunaPorCabecalho(tabela.cabecalhos, /localizador/i);
  const idxDataHora = indiceColunaPorCabecalho(tabela.cabecalhos, /data\s*\/?\s*hora/i);

  const valorDe = (linha, idx) => (idx >= 0 && linha[idx] != null ? linha[idx] : "");
  const itens = tabela.linhas.map((linha) => ({
    processo: valorDe(linha, idxProcesso),
    autuacao: valorDe(linha, idxAutuacao),
    situacao: valorDe(linha, idxSituacao),
    localizador: valorDe(linha, idxLocalizador),
    dataHora: valorDe(linha, idxDataHora),
  }));

  const larguraUtil = LARGURA_PAGINA_TEXTO - MARGEM_TEXTO * 2;
  const colunas = [
    { titulo: "Nº do Processo", largura: larguraUtil * 0.24, campo: "processo" },
    { titulo: "Data da Autuação", largura: larguraUtil * 0.15, campo: "autuacao" },
    { titulo: "Situação", largura: larguraUtil * 0.22, campo: "situacao" },
    { titulo: "Localizador", largura: larguraUtil * 0.22, campo: "localizador" },
    { titulo: "Data/Hora", largura: larguraUtil * 0.17, campo: "dataHora" },
  ];

  return construirPdfTabelaCuradaRetrato(
    itens,
    colunas,
    `Suspensos/sobrestados da unidade "${nomeUnidade}" — ${itens.length} processo(s)`
  );
}

// Le' os nomes dos Localizadores de uma unidade - DIFERENTE do resto do
// painel (que usa a tela "Localizadores do Órgão"): aqui a extracao e'
// feita direto no Relatório Geral, ja' que e' onde o campo "Localizador"
// (Tagify) fica disponivel apos escolher um Órgão/Juízo (necessario para
// listar os localizadores de QUALQUER unidade, nao so' a do perfil
// logado - "Localizadores do Órgão" só mostra os da unidade habilitada
// no momento).
//
// NAO traz o total de processos de cada um: obter esse numero exigiria
// uma consulta a parte por localizador (uma aba nova cada), o que ficava
// lento demais para unidades com muitos localizadores, e nao existe (até
// onde verificamos) nenhum endpoint que devolva os totais de todos de
// uma vez so' para uma unidade arbitraria. Por ora, quem precisar do
// total por localizador de uma unidade especifica precisa se habilitar
// nela e usar a ferramenta "Localizadores do Órgão" do painel - o
// relatório ja' avisa isso (ver "avisos" em
// "exportarRelatorioGerencialUnidade").
async function consultarLocalizadoresUnidadeViaRelatorioGeral(urlBase, valorOrgaoJuizo, notificar) {
  notificar("Lendo os localizadores disponíveis no Relatório Geral...");
  const { opcoes, erro: erroListagem } = await abrirAbaEListarLocalizadoresRelatorioGeral(urlBase, valorOrgaoJuizo);

  if (opcoes.length === 0) {
    return {
      localizadores: [],
      erro: erroListagem || 'Nenhum localizador encontrado no campo "Localizador" do Relatório Geral.',
    };
  }

  const localizadores = opcoes.map((opcao) => ({ nome: opcao.nome }));
  return { localizadores, erro: erroListagem || null };
}

// Orquestra o Relatório Gerencial da Unidade: navega a aba atual ate' o
// Relatório Geral, roda as consultas de despacho/sentenca e de processos
// sem movimentação filtradas pela unidade escolhida (reaproveitando as
// mesmas funcoes do relatorio rapido do painel), consulta o total de
// processos de cada Localizador dessa unidade (via campo "Localizador"
// do proprio Relatório Geral) e gera tudo num unico PDF.
// Um item por checkbox do painel ("Personalizar relatório") - todos
// habilitados por padrao (compatibilidade com quem chamava a funcao sem
// passar "opcoes" nenhuma). Desmarcar um item pula tanto a(s) consulta(s)
// dele quanto o trecho correspondente no PDF, ao inves de so' esconder a
// secao depois de consultar tudo mesmo assim - o ganho e' pular as
// consultas lentas dos itens que o usuario nao quer, nao so' o espaço no
// PDF.
const OPCOES_RELATORIO_UNIDADE_PADRAO = {
  processosAtivos: true,
  suspensos: true,
  conclusosDecisao: true,
  conclusosSentenca: true,
  semMovimentacao: true,
  remessasJuizesLeigos: true,
  localizadores: true,
};

async function exportarRelatorioGerencialUnidade(valorUnidade, nomeUnidade, opcoes, aoProgredir) {
  const notificar = (texto) => {
    if (aoProgredir) aoProgredir(texto);
  };

  const opcoesFinais = { ...OPCOES_RELATORIO_UNIDADE_PADRAO, ...(opcoes || {}) };

  if (!valorUnidade) {
    throw new Error("Selecione uma unidade antes de exportar o relatório.");
  }

  if (!Object.values(opcoesFinais).some(Boolean)) {
    throw new Error("Selecione ao menos um item do relatório antes de exportar.");
  }

  const [abaAtual] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!abaAtual || !abaAtual.url) {
    throw new Error("Nenhuma aba ativa encontrada. Abra uma página do eproc primeiro.");
  }

  const blocoVazio = () => ({ total: null, urgentes: null, naoUrgentes: null, mais90Dias: null, erros: [] });

  // A ordem das consultas abaixo segue a ordem em que as seções aparecem
  // no relatório final (e nos checkboxes do painel): processos ativos,
  // suspensos/sobrestados, conclusos (decisão/sentença), sem
  // movimentação, remessas aos juízes leigos e, por último, localizadores.

  // Relação de processos ativos: todos os grupos macro do filtro
  // "Situação" EXCETO BAIXADO e SUSPENSÃO (e os respectivos subitens) -
  // em vez de deixar o campo em branco, o que contava TODO processo da
  // unidade (inclusive suspensos/sobrestados e baixados) como se fosse
  // "ativo". "extrairTabela" pede pra' ler as linhas reais do resultado
  // (nao so' o total).
  const processosAtivos = { total: null, tabela: null, erros: [] };
  if (opcoesFinais.processosAtivos) {
    notificar("Consultando a relação de processos ativos...");
    const r = await abrirAbaEConsultarUmaVez(abaAtual.url, {
      gruposSituacaoExcluir: ["B", "S"],
      urgente: false,
      diasSituacao: null,
      valorOrgaoJuizo: valorUnidade,
      extrairTabela: true,
    });
    processosAtivos.total = r.contagem;
    processosAtivos.tabela = r.tabela;
    if (r.erro) processosAtivos.erros.push(r.erro);
    if (r.tabela && r.tabela.erro) processosAtivos.erros.push(r.tabela.erro);
  }

  // Suspensos/sobrestados: grupo "S" inteiro do filtro Situação (todas
  // as ~40 variantes de suspensão/sobrestamento de uma vez).
  const suspensos = { total: null, mais90Dias: null, detalhamento: [], tabela: null, erros: [], avisoDetalhamentoParcial: null };
  if (opcoesFinais.suspensos) {
    notificar("Consultando suspensos/sobrestados: total e relação de processos...");
    {
      const r = await abrirAbaEConsultarUmaVez(abaAtual.url, {
        grupoSituacao: "S",
        urgente: false,
        diasSituacao: null,
        valorOrgaoJuizo: valorUnidade,
        extrairTabela: true,
      });
      suspensos.total = r.contagem;
      suspensos.tabela = r.tabela;
      if (r.erro) suspensos.erros.push(`total: ${r.erro}`);
      if (r.tabela && r.tabela.erro) suspensos.erros.push(`relação de processos: ${r.tabela.erro}`);
    }
    notificar(`Consultando suspensos/sobrestados: há mais de ${DIAS_LIMITE_ATRASO_UNIDADE} dias...`);
    {
      const r = await abrirAbaEConsultarUmaVez(abaAtual.url, {
        grupoSituacao: "S",
        urgente: false,
        diasSituacao: DIAS_LIMITE_ATRASO_UNIDADE,
        valorOrgaoJuizo: valorUnidade,
      });
      suspensos.mais90Dias = r.contagem;
      if (r.erro) suspensos.erros.push(`+${DIAS_LIMITE_ATRASO_UNIDADE} dias: ${r.erro}`);
    }
    notificar("Consultando suspensos/sobrestados: detalhamento por situação específica...");
    {
      const { itens, erro, parcial, motivoParcial } = await abrirAbaEConsultarSituacoesGrupo(abaAtual.url, valorUnidade, "S");
      // So' entram na capa as situações com pelo menos 1 processo - listar
      // as dezenas de variantes zeradas so' faria o relatório mais dificil
      // de ler, sem nenhuma informação a mais.
      suspensos.detalhamento = itens
        .filter((item) => (item.contagem || 0) > 0)
        .sort((a, b) => (b.contagem || 0) - (a.contagem || 0));
      if (erro) suspensos.erros.push(`Detalhamento por situação: ${erro}`);
      // Diferente dos "erros" (que aparecem destacados como falha), isso
      // e' so' uma nota discreta: o TOTAL de suspensos continua correto
      // (veio de uma consulta separada, à parte) - so' o detalhamento por
      // situação especifica ficou incompleto por demorar demais.
      if (parcial) {
        suspensos.avisoDetalhamentoParcial =
          motivoParcial ||
          "O detalhamento por situação específica não foi concluído a tempo - apenas o total de suspensos foi informado.";
      }
    }
  }

  // Despacho e sentença sao blocos independentes entre si (cada um com
  // suas proprias 3 consultas, ja' paralelizadas dentro de
  // "consultarBlocoUnidade") - rodam em paralelo um com o outro tambem,
  // sempre respeitando o semaforo global de abas ocultas.
  notificar("Consultando conclusos para decisão e para sentença...");
  const [despacho, sentenca] = await Promise.all([
    opcoesFinais.conclusosDecisao
      ? consultarBlocoUnidade(abaAtual.url, valorUnidade, "conclusos para decisão", VALOR_SITUACAO_AGUARDA_DESPACHO, notificar)
      : Promise.resolve(blocoVazio()),
    opcoesFinais.conclusosSentenca
      ? consultarBlocoUnidade(abaAtual.url, valorUnidade, "conclusos para sentença", VALOR_SITUACAO_AGUARDA_SENTENCA, notificar)
      : Promise.resolve(blocoVazio()),
  ]);

  const semMovimentacao = { erros: [] };
  if (opcoesFinais.semMovimentacao) {
    notificar("Consultando processos sem movimentação (30/90/120 dias)...");
    // As 3 faixas de dias sao consultas independentes - em paralelo em
    // vez de uma de cada vez.
    const resultadosPorFaixa = await Promise.all(
      FAIXAS_DIAS_SEM_MOVIMENTACAO.map((dias) =>
        abrirAbaEConsultarUmaVez(abaAtual.url, {
          valorSituacao: null,
          urgente: false,
          diasSituacao: null,
          diasSemMovimentacao: dias,
          valorOrgaoJuizo: valorUnidade,
        })
      )
    );
    FAIXAS_DIAS_SEM_MOVIMENTACAO.forEach((dias, indice) => {
      const r = resultadosPorFaixa[indice];
      semMovimentacao[`dias${dias}`] = r.contagem;
      if (r.erro) semMovimentacao.erros.push(`${dias} dias: ${r.erro}`);
    });
  }

  // Remessas aos juízes leigos: tela própria (menu "Relatórios" >
  // "Relatório de remessas em aberto"), filtrada pelo mesmo órgão
  // julgador da unidade escolhida.
  const remessasJuizesLeigos = { linhas: [], erros: [] };
  if (opcoesFinais.remessasJuizesLeigos) {
    notificar("Consultando remessas aos juízes leigos...");
    const r = await consultarRemessasJuizesLeigosUmaVez(abaAtual.url, valorUnidade);
    remessasJuizesLeigos.linhas = r.linhas || [];
    if (r.erro) remessasJuizesLeigos.erros.push(r.erro);
  }

  let localizadoresOrdenados = [];
  let erroLocalizadores = null;
  if (opcoesFinais.localizadores) {
    const resultado = await consultarLocalizadoresUnidadeViaRelatorioGeral(abaAtual.url, valorUnidade, notificar);
    // Sem total de processos para ordenar por ele (ver comentario em
    // "consultarLocalizadoresUnidadeViaRelatorioGeral") - so' resta a
    // ordem alfabetica.
    localizadoresOrdenados = [...resultado.localizadores].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    erroLocalizadores = resultado.erro;
  }

  notificar("Gerando PDF...");

  const dataInformacao = new Date().toLocaleString("pt-BR");
  const linhasBloco = (bloco) => [
    { rotulo: "Urgentes", valor: bloco.urgentes == null ? "?" : bloco.urgentes },
    { rotulo: "Não urgentes", valor: bloco.naoUrgentes == null ? "?" : bloco.naoUrgentes },
    {
      rotulo: `Aguardando há mais de ${DIAS_LIMITE_ATRASO_UNIDADE} dias`,
      valor: bloco.mais90Dias == null ? "?" : bloco.mais90Dias,
    },
    { rotulo: "Total", valor: bloco.total == null ? "?" : bloco.total },
  ];

  // So' entram no PDF as seções que o usuario marcou - nao so' esconder o
  // resultado de uma consulta que rodou mesmo assim (essa ja' nem rodou,
  // ver os "if (opcoesFinais.xxx)" acima). Ordem: processos ativos,
  // suspensos, conclusos (decisão/sentença), sem movimentação e remessas
  // aos juízes leigos - a mesma ordem dos checkboxes no painel.
  // Localizadores fica de fora daqui: sua lista de nomes é desenhada em
  // páginas próprias, no final do PDF (ver "construirPaginaListaLocalizadores").
  const secoesResumo = [];
  if (opcoesFinais.processosAtivos) {
    secoesResumo.push({
      titulo: "PROCESSOS ATIVOS",
      linhas: [{ rotulo: "Total", valor: processosAtivos.total == null ? "?" : processosAtivos.total }],
    });
  }
  if (opcoesFinais.suspensos) {
    secoesResumo.push({
      titulo: "SUSPENSOS / SOBRESTADOS",
      linhas: [
        {
          rotulo: `Suspensos há mais de ${DIAS_LIMITE_ATRASO_UNIDADE} dias`,
          valor: suspensos.mais90Dias == null ? "?" : suspensos.mais90Dias,
        },
        ...(suspensos.detalhamento || []).map((item) => ({ rotulo: item.texto, valor: item.contagem })),
        { rotulo: "Total", valor: suspensos.total == null ? "?" : suspensos.total },
      ],
    });
  }
  if (opcoesFinais.conclusosDecisao) {
    secoesResumo.push({ titulo: "CONCLUSOS PARA DECISÃO", linhas: linhasBloco(despacho) });
  }
  if (opcoesFinais.conclusosSentenca) {
    secoesResumo.push({ titulo: "CONCLUSOS PARA SENTENÇA", linhas: linhasBloco(sentenca) });
  }
  if (opcoesFinais.semMovimentacao) {
    secoesResumo.push({
      titulo: "PROCESSOS SEM MOVIMENTAÇÃO",
      linhas: [
        { rotulo: "Há mais de 30 dias", valor: semMovimentacao.dias30 == null ? "?" : semMovimentacao.dias30 },
        { rotulo: "Há mais de 90 dias", valor: semMovimentacao.dias90 == null ? "?" : semMovimentacao.dias90 },
        { rotulo: "Há mais de 120 dias", valor: semMovimentacao.dias120 == null ? "?" : semMovimentacao.dias120 },
      ],
    });
  }
  if (opcoesFinais.remessasJuizesLeigos) {
    secoesResumo.push({
      titulo: "REMESSAS AOS JUÍZES LEIGOS",
      linhas: [{ rotulo: "Total de processos em remessa", valor: remessasJuizesLeigos.linhas.length }],
    });
  }

  const avisos = [];
  if (opcoesFinais.processosAtivos && processosAtivos.erros.length > 0) {
    avisos.push(`Processos ativos: ${processosAtivos.erros.join(" | ")}`);
  }
  if (opcoesFinais.suspensos && suspensos.erros.length > 0) {
    avisos.push(`Suspensos/sobrestados: ${suspensos.erros.join(" | ")}`);
  }
  if (opcoesFinais.suspensos && suspensos.avisoDetalhamentoParcial) {
    avisos.push(`Suspensos/sobrestados: ${suspensos.avisoDetalhamentoParcial}`);
  }
  if (opcoesFinais.conclusosDecisao && despacho.erros.length > 0) {
    avisos.push(`Conclusos para decisão: ${despacho.erros.join(" | ")}`);
  }
  if (opcoesFinais.conclusosSentenca && sentenca.erros.length > 0) {
    avisos.push(`Conclusos para sentença: ${sentenca.erros.join(" | ")}`);
  }
  if (opcoesFinais.semMovimentacao && semMovimentacao.erros.length > 0) {
    avisos.push(`Processos sem movimentação: ${semMovimentacao.erros.join(" | ")}`);
  }
  if (opcoesFinais.remessasJuizesLeigos && remessasJuizesLeigos.erros.length > 0) {
    avisos.push(`Remessas aos juízes leigos: ${remessasJuizesLeigos.erros.join(" | ")}`);
  }
  if (opcoesFinais.localizadores && erroLocalizadores) avisos.push(`Localizadores: ${erroLocalizadores}`);

  const bytesCapa = await construirCapaRelatorioGerencial(nomeUnidade, dataInformacao, secoesResumo, avisos);
  const pdfCapa = await PDFDocument.load(bytesCapa);
  const pdfFinal = await PDFDocument.create();
  const paginasCapa = await pdfFinal.copyPages(pdfCapa, pdfCapa.getPageIndices());
  paginasCapa.forEach((pagina) => pdfFinal.addPage(pagina));

  // Tabelas com a "relação de processos" propriamente dita (linhas reais
  // do resultado, nao so' o total) - anexadas como paginas extras, uma
  // tabela por secao, so' quando a extracao encontrou alguma linha
  // (best-effort: ver "extrairLinhasTblProcessoLista"; se falhar, o
  // aviso correspondente ja' foi acrescentado acima e a secao so' fica
  // de fora, sem quebrar o resto do relatório). Mesma ordem das seções
  // acima: ativos, suspensos e, por fim, remessas aos juízes leigos.
  if (opcoesFinais.processosAtivos && processosAtivos.tabela && processosAtivos.tabela.linhas.length > 0) {
    const bytesTabela = await construirPdfProcessosAtivos(processosAtivos.tabela, nomeUnidade);
    const pdfTabela = await PDFDocument.load(bytesTabela);
    const paginas = await pdfFinal.copyPages(pdfTabela, pdfTabela.getPageIndices());
    paginas.forEach((pagina) => pdfFinal.addPage(pagina));
  }
  if (opcoesFinais.suspensos && suspensos.tabela && suspensos.tabela.linhas.length > 0) {
    const bytesTabela = await construirPdfSuspensos(suspensos.tabela, nomeUnidade);
    const pdfTabela = await PDFDocument.load(bytesTabela);
    const paginas = await pdfFinal.copyPages(pdfTabela, pdfTabela.getPageIndices());
    paginas.forEach((pagina) => pdfFinal.addPage(pagina));
  }

  if (opcoesFinais.remessasJuizesLeigos && remessasJuizesLeigos.linhas.length > 0) {
    const bytesRemessas = await construirPdfRemessasJuizesLeigos(remessasJuizesLeigos.linhas, nomeUnidade);
    const pdfRemessas = await PDFDocument.load(bytesRemessas);
    const paginas = await pdfFinal.copyPages(pdfRemessas, pdfRemessas.getPageIndices());
    paginas.forEach((pagina) => pdfFinal.addPage(pagina));
  }

  // Localizadores: so' a lista de nomes (sem total de processos - ver
  // aviso acima), em páginas próprias no final do PDF, depois de todas as
  // demais seções (inclusive as tabelas de remessas aos juízes leigos).
  if (opcoesFinais.localizadores && localizadoresOrdenados.length > 0) {
    const bytesLocalizadores = await construirPaginaListaLocalizadores(
      nomeUnidade,
      localizadoresOrdenados.map((l) => l.nome)
    );
    const pdfLocalizadores = await PDFDocument.load(bytesLocalizadores);
    const paginas = await pdfFinal.copyPages(pdfLocalizadores, pdfLocalizadores.getPageIndices());
    paginas.forEach((pagina) => pdfFinal.addPage(pagina));
  }

  const bytesFinais = await pdfFinal.save();
  const nomeArquivo = `eproc/Relatório_${sanitizarNomeArquivo(nomeUnidade)}.pdf`;
  await baixarUm(nomeArquivo, construirDataUrlBinario("application/pdf", bytesFinais));

  notificar("Finalizando...");
  return {
    unidade: nomeUnidade,
    totalLocalizadores: localizadoresOrdenados.length,
  };
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
    world: "MAIN",
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

// ---- Localizadores do Órgão (exportar em PDF/Excel) ----

// Igual a "clicarLinkRelatorioGeralNaPagina": o link para a tela de
// Localizadores do Órgão ja' existe no DOM (menu lateral), mesmo com o
// submenu "Localizadores" colapsado - o collapse e' so' visual via CSS.
// Autocontida, executada via chrome.scripting.executeScript.
function clicarLinkLocalizadoresNaPagina() {
  const link = document.querySelector('a[href*="acao=localizador_orgao_listar"]');
  if (!link) return false;
  link.click();
  return true;
}

// Raspa a tabela da pagina ATUAL (colunas confirmadas numa pagina real do
// eproc: [0] checkbox, [1] Localizador, [2] Nome do Localizador, [3]
// Descrição do Localizador, [4] Localizador Sistema, [5] Data Inclusão,
// [6] Total de processos, [7] Ações), o texto da legenda (para detectar
// quando a pagina seguinte terminou de carregar) e se o botao "Próxima
// Página" esta' disponivel. Inteiramente SINCRONA de proposito (nada de
// async/await/clique aqui dentro): clicar em "Próxima Página" pode
// disparar uma navegacao de verdade (nao so' AJAX), o que destroi o
// frame no meio d euma execucao assincrona e derruba a chamada inteira
// com "Frame with ID 0 was removed". Cada etapa (raspar / clicar
// próximo / raspar de novo) roda como uma chamada de
// chrome.scripting.executeScript separada e curta, orquestrada pelo
// background.js - nunca um loop assincrono unico rodando dentro da
// pagina. Autocontida, executada via chrome.scripting.executeScript.
function raspaerLocalizadoresNaPagina() {
  function localizarTabela() {
    const tabelas = Array.from(document.querySelectorAll("table.infraTable"));
    return (
      tabelas.find((t) => {
        const caption = t.querySelector("caption");
        return caption && /localizadores/i.test(caption.textContent || "");
      }) || null
    );
  }

  const tabela = localizarTabela();
  if (!tabela) {
    return { itens: [], caption: null, temProxima: false, erro: "Tabela de Localizadores do Órgão não encontrada nesta página." };
  }

  const linhas = Array.from(tabela.querySelectorAll("tr.infraTrClara, tr.infraTrEscura"));
  const itens = [];
  for (const tr of linhas) {
    const celulas = Array.from(tr.querySelectorAll(":scope > td"));
    if (celulas.length < 8) continue;
    const nome = (celulas[1].textContent || "").replace(/\s+/g, " ").trim();
    const descricao = (celulas[3].textContent || "").replace(/\s+/g, " ").trim();
    const totalTexto = (celulas[6].textContent || "").replace(/\s+/g, " ").trim();
    const totalMatch = totalTexto.match(/\d+/);
    // Quando ha' pelo menos 1 processo, o numero na coluna "Total de
    // processos" e' um link (acao=localizador_processos_lista) que leva
    // direto para a lista de processos daquele localizador - usado pela
    // navegacao rapida do painel. ".href" (em vez do atributo "href" cru)
    // devolve a URL ja' absoluta, resolvida pelo proprio navegador.
    const linkProcessos = celulas[6].querySelector("a");
    itens.push({
      nome,
      descricao,
      totalProcessos: totalMatch ? Number(totalMatch[0]) : 0,
      urlProcessos: linkProcessos ? linkProcessos.href : null,
    });
  }

  const caption = tabela.querySelector("caption");
  const liProxima = document.getElementById("lnkInfraProximaPaginaSuperior");
  const temProxima = !!(liProxima && !liProxima.classList.contains("disabled"));
  // O eproc lembra a ultima pagina vista na listagem e reabre a tela
  // nela (nao sempre na pagina 1) - "Primeira Página" so' fica
  // desabilitada quando ja' estamos nela, entao serve para detectar isso
  // e a exportacao precisa voltar para a pagina 1 antes de comecar a
  // coletar, senao perde os localizadores das paginas anteriores.
  // Quando ha' poucos itens (menos que o tamanho de uma pagina), o eproc
  // nem chega a desenhar os controles de paginacao - "Primeira Página"
  // simplesmente nao existe no DOM. Sem essa lista nula, ela contava
  // como "nao esta' na primeira pagina" (por engano) e a extensao ficava
  // tentando clicar num link inexistente e esperando por uma mudanca de
  // legenda que nunca acontece, ate' estourar o tempo.
  const liPrimeira = document.getElementById("lnkInfraPrimeiraPaginaSuperior");
  const estaNaPrimeiraPagina = !liPrimeira || liPrimeira.classList.contains("disabled");

  return {
    itens,
    caption: caption ? (caption.textContent || "").trim() : "",
    temProxima,
    estaNaPrimeiraPagina,
    erro: null,
  };
}

// Raspa a tabela da tela "Processos por Localizador"
// (acao=localizador_processos_lista), aberta ao navegar direto pela URL
// que ja' vem da coluna "Total de processos" da listagem de
// Localizadores. Colunas confirmadas numa pagina real do eproc: [0]
// checkbox, [1] Número Processo (link + "Sem Sigilo..."), [2] Classe
// (span "span-classe-judicial-contraste", isolado para nao misturar com
// avisos extras tipo "Doença Grave" que aparecem na mesma celula), [3]
// Autores Principais, [4] Réus Principais, [5] Localizadores, [6]
// Último Evento, [7] Inclusão no localizador (data pura, sem link).
// Mesmo formato de retorno de "raspaerLocalizadoresNaPagina", para
// reaproveitar "coletarTodasPaginasInfraTable".
function raspaerProcessosDoLocalizadorNaPagina() {
  const tabela = document.getElementById("tabelaLocalizadores");
  if (!tabela) {
    return {
      itens: [],
      caption: null,
      temProxima: false,
      erro: "Tabela de processos do localizador não encontrada nesta página.",
    };
  }

  const linhas = Array.from(tabela.querySelectorAll("tr.infraTrClara, tr.infraTrEscura"));
  const itens = [];
  for (const tr of linhas) {
    const celulas = Array.from(tr.querySelectorAll(":scope > td"));
    if (celulas.length < 8) continue;

    const linkProcesso = celulas[1].querySelector("a");
    const numeroProcesso = (linkProcesso ? linkProcesso.textContent : celulas[1].textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    // "linkProcesso.href" (e nao getAttribute) para pegar a URL ja'
    // absoluta (com sessao/hash inclusos), pronta para abrir numa aba
    // oculta sem depender de nenhum contexto de navegacao adicional.
    const url = linkProcesso ? linkProcesso.href : "";

    const spanClasse = celulas[2].querySelector(".span-classe-judicial-contraste");
    const classe = (spanClasse ? spanClasse.textContent : celulas[2].textContent || "")
      .replace(/\s+/g, " ")
      .trim();

    const inclusao = (celulas[7].textContent || "").replace(/\s+/g, " ").trim();

    itens.push({ numeroProcesso, classe, inclusao, url });
  }

  const caption = tabela.querySelector("caption");
  const liProxima = document.getElementById("lnkInfraProximaPaginaSuperior");
  const temProxima = !!(liProxima && !liProxima.classList.contains("disabled"));
  // Quando ha' poucos itens (menos que o tamanho de uma pagina), o eproc
  // nem chega a desenhar os controles de paginacao - "Primeira Página"
  // simplesmente nao existe no DOM. Sem essa lista nula, ela contava
  // como "nao esta' na primeira pagina" (por engano) e a extensao ficava
  // tentando clicar num link inexistente e esperando por uma mudanca de
  // legenda que nunca acontece, ate' estourar o tempo.
  const liPrimeira = document.getElementById("lnkInfraPrimeiraPaginaSuperior");
  const estaNaPrimeiraPagina = !liPrimeira || liPrimeira.classList.contains("disabled");

  return {
    itens,
    caption: caption ? (caption.textContent || "").trim() : "",
    temProxima,
    estaNaPrimeiraPagina,
    erro: null,
  };
}

// So' clica em "Próxima Página" e retorna - nao espera nada aqui dentro
// (ver comentario de "raspaerLocalizadoresNaPagina" sobre o motivo).
// Generica: reaproveitada por qualquer listagem baseada no mesmo widget
// de paginacao do eproc (ids "lnkInfraProximaPaginaSuperior"/
// "lnkInfraPrimeiraPaginaSuperior" - o mesmo em "Localizadores do Órgão"
// e em "Processos por Localizador", entre outras telas).
function clicarProximaPaginaInfra() {
  const link = document.querySelector("#lnkInfraProximaPaginaSuperior a");
  if (!link) return false;
  link.click();
  return true;
}

// So' clica em "Primeira Página" e retorna - mesmo motivo de
// "clicarProximaPaginaInfra".
function clicarPrimeiraPaginaInfra() {
  const link = document.querySelector("#lnkInfraPrimeiraPaginaSuperior a");
  if (!link) return false;
  link.click();
  return true;
}

// Abre uma aba oculta a partir da URL da aba atual (mesmo padrao ja'
// usado no Relatório Geral), navega ate' a tela de Localizadores do
// Órgão e coleta todas as paginas, depois fecha a aba. A paginacao e'
// conduzida DAQUI (background.js), nao de dentro da pagina: cada
// raspagem/clique e' uma chamada de executeScript curta e independente,
// entao se "Próxima Página" navegar a pagina de verdade (em vez de so'
// atualizar a tabela via AJAX), o pior que acontece e' uma chamada
// individual falhar (frame destruido no meio dela) e ser re-tentada,
// nunca o processo inteiro cair com "Frame with ID 0 was removed".
// Coleta generica de todas as paginas de uma listagem baseada no mesmo
// widget de paginacao do eproc (usado tanto em "Localizadores do Órgão"
// quanto em "Processos por Localizador"): recebe uma aba ja' carregada
// na tela da listagem e a funcao de raspagem especifica daquela tabela
// (mesmo formato de retorno de "raspaerLocalizadoresNaPagina": { itens,
// caption, temProxima, estaNaPrimeiraPagina, erro }). Corrige sozinha o
// caso do eproc reabrir a listagem numa pagina que nao e' a primeira
// (ele lembra a ultima pagina vista), voltando para a pagina 1 antes de
// comecar a coletar. Cada raspagem/clique roda como uma chamada de
// executeScript curta e independente (nunca um loop assincrono unico
// dentro da propria pagina), para nao quebrar com "Frame with ID 0 was
// removed" caso a paginacao dispare uma navegacao de verdade em vez de
// so' atualizar a tabela via AJAX.
async function coletarTodasPaginasInfraTable(tabId, funcRaspar) {
  async function raspaerPaginaAtualComRetentativa() {
    let ultimoErro;
    for (let tentativa = 0; tentativa < 5; tentativa += 1) {
      try {
        const [{ result } = {}] = await chrome.scripting.executeScript({
          target: { tabId },
          func: funcRaspar,
        });
        if (result) return result;
      } catch (e) {
        ultimoErro = e;
        // O frame pode estar no meio de uma navegacao disparada pelo
        // clique em "Próxima Página" - espera um pouco e tenta de novo
        // em vez de desistir na primeira falha.
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
    throw ultimoErro || new Error("Sem resultado ao ler a página.");
  }

  let leituraAtual;
  try {
    leituraAtual = await raspaerPaginaAtualComRetentativa();
  } catch (e) {
    return { itens: [], erro: `Falha ao ler a página inicial: ${e && e.message ? e.message : String(e)}` };
  }
  if (leituraAtual.erro) return { itens: [], erro: leituraAtual.erro };

  // A tela pode ter aberto numa pagina que nao e' a primeira (o eproc
  // lembra a ultima pagina vista) - volta para a pagina 1 antes de
  // comecar a coletar, senao os itens das paginas anteriores ficam de
  // fora.
  if (!leituraAtual.estaNaPrimeiraPagina) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, func: clicarPrimeiraPaginaInfra });
    } catch (e) {
      return {
        itens: [],
        erro: `Falha ao voltar para a primeira página: ${e && e.message ? e.message : String(e)}`,
      };
    }

    await aguardarCarregamentoAba(tabId).catch(() => {});

    const captionAntes = leituraAtual.caption;
    let mudou = false;
    for (let tentativa = 0; tentativa < 40; tentativa += 1) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      try {
        leituraAtual = await raspaerPaginaAtualComRetentativa();
      } catch (e) {
        continue;
      }
      if (leituraAtual && leituraAtual.caption !== captionAntes) {
        mudou = true;
        break;
      }
    }
    if (!mudou) {
      return {
        itens: [],
        erro: 'A tela não voltou para a primeira página a tempo (botão "Primeira Página").',
      };
    }
  }

  const todos = [];
  let pagina = 1;
  const LIMITE_PAGINAS = 200; // seguranca contra loop infinito

  while (pagina <= LIMITE_PAGINAS) {
    const leitura = leituraAtual;
    leituraAtual = null;

    if (leitura.erro) return { itens: todos, erro: leitura.erro };
    todos.push(...leitura.itens);

    if (!leitura.temProxima) break;

    try {
      await chrome.scripting.executeScript({ target: { tabId }, func: clicarProximaPaginaInfra });
    } catch (e) {
      return {
        itens: todos,
        erro: `Falha ao clicar em "Próxima Página" (página ${pagina}): ${e && e.message ? e.message : String(e)}`,
      };
    }

    // Cobre os dois jeitos possiveis dessa paginacao: se for uma
    // navegacao de verdade, espera o "complete" da aba; se for so' AJAX
    // no mesmo documento (a aba nunca sai de "complete"), essa espera
    // e' praticamente um no-op e o polling abaixo (pela mudanca no
    // texto da legenda) e' quem realmente detecta o fim do carregamento.
    await aguardarCarregamentoAba(tabId).catch(() => {});

    const captionAntes = leitura.caption;
    let mudou = false;
    let leituraNova = null;
    for (let tentativa = 0; tentativa < 40; tentativa += 1) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      try {
        const [{ result } = {}] = await chrome.scripting.executeScript({ target: { tabId }, func: funcRaspar });
        leituraNova = result;
      } catch (e) {
        continue; // frame ainda se recuperando de uma navegacao - tenta de novo
      }
      if (leituraNova && leituraNova.caption !== captionAntes) {
        mudou = true;
        break;
      }
    }

    if (!mudou) {
      return {
        itens: todos,
        erro: `Parou na página ${pagina} - a página seguinte não terminou de carregar a tempo.`,
      };
    }

    leituraAtual = leituraNova;
    pagina += 1;
  }

  return { itens: todos, erro: null };
}

async function abrirAbaEColetarLocalizadores(urlBase) {
  let aba;
  try {
    await adquirirSlotDeAbaOculta();
    aba = await chrome.tabs.create({ url: urlBase, active: false });
    await aguardarCarregamentoAba(aba.id);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const [{ result: linkEncontrado } = {}] = await chrome.scripting.executeScript({
      target: { tabId: aba.id },
      func: clicarLinkLocalizadoresNaPagina,
    });

    if (!linkEncontrado) {
      return {
        itens: [],
        erro:
          'Link "Localizadores do Órgão" não encontrado na página atual. Abra uma página do eproc com o menu lateral (ex.: a tela de um processo) e tente novamente.',
      };
    }

    await aguardarCarregamentoAba(aba.id);
    await new Promise((resolve) => setTimeout(resolve, 500));

    return await coletarTodasPaginasInfraTable(aba.id, raspaerLocalizadoresNaPagina);
  } catch (e) {
    return { itens: [], erro: e && e.message ? e.message : String(e) };
  } finally {
    if (aba && aba.id) {
      chrome.tabs.remove(aba.id).catch(() => {});
    }
    liberarSlotDeAbaOculta();
  }
}

// Abre uma aba oculta direto na URL de "Processos por Localizador" (ja'
// capturada durante a raspagem de "Localizadores do Órgão" - vem pronta
// da coluna "Total de processos", com sessao/hash inclusos), coleta
// todas as paginas e fecha a aba. Mais simples que
// "abrirAbaEColetarLocalizadores": nao precisa clicar em nenhum link do
// menu, ja' que a URL de destino e' conhecida de antemao.
async function abrirAbaEColetarProcessosDoLocalizador(urlProcessos) {
  let aba;
  try {
    await adquirirSlotDeAbaOculta();
    aba = await chrome.tabs.create({ url: urlProcessos, active: false });
    await aguardarCarregamentoAba(aba.id);
    await new Promise((resolve) => setTimeout(resolve, 500));

    return await coletarTodasPaginasInfraTable(aba.id, raspaerProcessosDoLocalizadorNaPagina);
  } catch (e) {
    return { itens: [], erro: e && e.message ? e.message : String(e) };
  } finally {
    if (aba && aba.id) {
      chrome.tabs.remove(aba.id).catch(() => {});
    }
    liberarSlotDeAbaOculta();
  }
}

// Tabela em paginas de PDF (A4 paisagem, para caber a coluna de
// descricao) com cabecalho repetido em cada pagina - reaproveita
// "quebrarLinhas" (ja' usado no PDF unico) para cada coluna
// separadamente, alinhando as colunas por posicao X fixa.
const PDF_LOCALIZADORES_LARGURA_PAGINA = 841.89; // A4 paisagem
const PDF_LOCALIZADORES_ALTURA_PAGINA = 595.28;
const PDF_LOCALIZADORES_MARGEM = 36;
const PDF_LOCALIZADORES_TAMANHO_FONTE = 9;
const PDF_LOCALIZADORES_ALTURA_LINHA = PDF_LOCALIZADORES_TAMANHO_FONTE * 1.35;

// Altura reservada no topo de cada pagina para o cabecalho institucional
// (barra colorida + "TRIBUNAL DE JUSTIÇA DO ESTADO DO PARANÁ" + "Sistema
// eProc" + linha separadora) e no rodape para o numero da pagina - o
// conteudo de cada pagina (titulo, tabela) comeca/termina respeitando
// essas faixas, em vez de usar a altura da folha inteira.
const PDF_ALTURA_CABECALHO_INSTITUCIONAL = 40;
const PDF_ALTURA_RODAPE = 22;

// Desenha o cabecalho institucional (barra + TJPR + eProc + linha) no
// topo de uma pagina - reaproveitado em toda pagina de todo PDF gerado
// pela extensao (tabelas de Localizadores/Processos/Remessas e o resumo
// do Relatório Gerencial da Unidade), para dar uma identidade visual
// unica e profissional em vez de paginas so' com texto corrido.
function desenharCabecalhoInstitucional(pagina, fonteNegrito, fonteNormal, largura, margem) {
  const alturaPagina = pagina.getHeight();

  pagina.drawRectangle({
    x: 0,
    y: alturaPagina - 6,
    width: largura,
    height: 6,
    color: COR_PRIMARIA,
  });

  pagina.drawText("TRIBUNAL DE JUSTIÇA DO ESTADO DO PARANÁ", {
    x: margem,
    y: alturaPagina - 20,
    size: 10,
    font: fonteNegrito,
    color: COR_PRIMARIA_ESCURA,
  });
  pagina.drawText("Sistema eProc", {
    x: margem,
    y: alturaPagina - 32,
    size: 8,
    font: fonteNormal,
    color: COR_CINZA_TEXTO,
  });

  pagina.drawLine({
    start: { x: margem, y: alturaPagina - 38 },
    end: { x: largura - margem, y: alturaPagina - 38 },
    thickness: 0.75,
    color: COR_CINZA_BORDA,
  });
}

// Desenha o rodape (linha + "eProc/TJPR" + numero da pagina) - chamado
// so' no final, depois de todas as paginas prontas, ja' que o total de
// paginas so' e' conhecido nesse momento.
function desenharRodapePaginas(pdf, fonteNormal, largura, margem) {
  const paginas = pdf.getPages();
  paginas.forEach((pagina, indice) => {
    const y = PDF_ALTURA_RODAPE - 10;
    pagina.drawLine({
      start: { x: margem, y: PDF_ALTURA_RODAPE },
      end: { x: largura - margem, y: PDF_ALTURA_RODAPE },
      thickness: 0.5,
      color: COR_CINZA_BORDA,
    });
    // So' a paginacao no rodape (sem texto de identificacao da extensao) -
    // centralizada, ja' que nao ha' mais nenhum outro texto disputando a
    // faixa com ela.
    const textoPagina = `Página ${indice + 1} de ${paginas.length}`;
    const larguraTexto = fonteNormal.widthOfTextAtSize(textoPagina, 7);
    pagina.drawText(textoPagina, {
      x: (largura - larguraTexto) / 2,
      y,
      size: 7,
      font: fonteNormal,
      color: COR_CINZA_TEXTO,
    });
  });
}

// Gerador generico de PDF-tabela reaproveitado tanto pelos Localizadores
// do Órgão quanto pelos Processos por Localizador e Remessas em Aberto:
// recebe as colunas ja' com a largura em pontos (nao fracao) para poder
// ser reaproveitado com qualquer numero/tamanho de colunas.
async function construirPdfTabela(itens, colunas, tituloDocumento) {
  const pdf = await PDFDocument.create();
  const fonteNormal = await pdf.embedFont(StandardFonts.Helvetica);
  const fonteNegrito = await pdf.embedFont(StandardFonts.HelveticaBold);

  const larguraPagina = PDF_LOCALIZADORES_LARGURA_PAGINA;
  const margem = PDF_LOCALIZADORES_MARGEM;
  const alturaLinhaCabecalhoColunas = PDF_LOCALIZADORES_ALTURA_LINHA * 1.7;

  let pagina = null;
  let y = 0;
  let indiceLinhaZebra = 0;

  function desenharCabecalhoColunas() {
    const alturaFaixa = alturaLinhaCabecalhoColunas;
    pagina.drawRectangle({
      x: margem,
      y: y - alturaFaixa,
      width: larguraPagina - margem * 2,
      height: alturaFaixa,
      color: COR_PRIMARIA_ESCURA,
    });
    let x = margem + 4;
    for (const coluna of colunas) {
      pagina.drawText(sanitizarTextoPdf(coluna.titulo), {
        x,
        y: y - alturaFaixa + alturaFaixa * 0.32,
        size: PDF_LOCALIZADORES_TAMANHO_FONTE,
        font: fonteNegrito,
        color: COR_BRANCO,
      });
      x += coluna.largura;
    }
    // Gap extra apos a faixa do cabecalho, para a primeira linha de
    // dados nunca encostar/sobrepor visualmente na faixa colorida - o
    // "y" das linhas e' a BASELINE do texto, e os ascendentes sobem
    // ~7pt acima dela na fonte de 9pt, entao o gap precisa ser maior
    // que isso.
    y -= alturaFaixa + 11;
    indiceLinhaZebra = 0;
  }

  function novaPagina(comTitulo) {
    pagina = pdf.addPage([PDF_LOCALIZADORES_LARGURA_PAGINA, PDF_LOCALIZADORES_ALTURA_PAGINA]);
    desenharCabecalhoInstitucional(pagina, fonteNegrito, fonteNormal, larguraPagina, margem);
    y = PDF_LOCALIZADORES_ALTURA_PAGINA - PDF_ALTURA_CABECALHO_INSTITUCIONAL - PDF_LOCALIZADORES_MARGEM;
    if (comTitulo) {
      const linhasTitulo = quebrarLinhas(sanitizarTextoPdf(tituloDocumento), fonteNegrito, 13, larguraPagina - margem * 2);
      for (const linhaTitulo of linhasTitulo) {
        pagina.drawText(linhaTitulo, {
          x: margem,
          y,
          size: 13,
          font: fonteNegrito,
          color: COR_PRIMARIA_ESCURA,
        });
        y -= 17;
      }
      y -= PDF_LOCALIZADORES_ALTURA_LINHA * 2.2 - 17;
    }
    desenharCabecalhoColunas();
  }

  novaPagina(true);

  for (const item of itens) {
    const linhasPorColuna = colunas.map((coluna) =>
      quebrarLinhas(sanitizarTextoPdf(String(item[coluna.campo] ?? "")), fonteNormal, PDF_LOCALIZADORES_TAMANHO_FONTE, coluna.largura - 4)
    );
    const maxLinhas = Math.max(1, ...linhasPorColuna.map((l) => l.length));
    const alturaLinha = maxLinhas * PDF_LOCALIZADORES_ALTURA_LINHA + PDF_LOCALIZADORES_ALTURA_LINHA * 0.4;

    if (y - alturaLinha < PDF_ALTURA_RODAPE + PDF_LOCALIZADORES_MARGEM) {
      novaPagina(false);
    }

    // Faixa zebrada (linhas pares com fundo cinza claro) para facilitar
    // acompanhar cada linha visualmente numa tabela longa.
    if (indiceLinhaZebra % 2 === 1) {
      pagina.drawRectangle({
        x: margem,
        y: y - alturaLinha + PDF_LOCALIZADORES_ALTURA_LINHA * 0.3,
        width: larguraPagina - margem * 2,
        height: alturaLinha,
        color: COR_CINZA_CLARO,
      });
    }
    indiceLinhaZebra += 1;

    let x = margem + 4;
    for (let i = 0; i < colunas.length; i += 1) {
      let yColuna = y;
      for (const linha of linhasPorColuna[i]) {
        try {
          pagina.drawText(linha, { x, y: yColuna, size: PDF_LOCALIZADORES_TAMANHO_FONTE, font: fonteNormal, color: COR_CINZA_TEXTO });
        } catch (e) {
          // Ignora linha que a fonte padrao nao consiga desenhar.
        }
        yColuna -= PDF_LOCALIZADORES_ALTURA_LINHA;
      }
      x += colunas[i].largura;
    }
    y -= alturaLinha;
  }

  desenharRodapePaginas(pdf, fonteNormal, larguraPagina, margem);

  return pdf.save();
}

// Na pratica, a maioria dos localizadores de uma unidade NAO tem
// descricao preenchida (e' um campo opcional) - com a coluna "Descrição"
// sempre presente e ocupando 58% da largura da pagina, o resultado
// tipico era uma tabela com uma faixa enorme em branco no meio,
// desequilibrada e esquisita de olhar. Quando NENHUM item tem descricao,
// a coluna e' omitida por completo (so' Localizador + Total de
// processos, com o espaco redistribuido); ela so' aparece quando pelo
// menos um localizador realmente tem algo preenchido ali.
function construirPdfLocalizadores(itens, tituloDocumento) {
  const larguraUtil = PDF_LOCALIZADORES_LARGURA_PAGINA - PDF_LOCALIZADORES_MARGEM * 2;
  const temAlgumaDescricao = itens.some((item) => (item.descricao || "").trim() !== "");

  const colunas = temAlgumaDescricao
    ? [
        { titulo: "Localizador", largura: larguraUtil * 0.26, campo: "nome" },
        { titulo: "Descrição", largura: larguraUtil * 0.58, campo: "descricao" },
        { titulo: "Total de processos", largura: larguraUtil * 0.16, campo: "totalProcessos" },
      ]
    : [
        { titulo: "Localizador", largura: larguraUtil * 0.8, campo: "nome" },
        { titulo: "Total de processos", largura: larguraUtil * 0.2, campo: "totalProcessos" },
      ];
  return construirPdfTabela(itens, colunas, tituloDocumento);
}

function construirPdfProcessosLocalizador(itens, tituloDocumento) {
  const larguraUtil = PDF_LOCALIZADORES_LARGURA_PAGINA - PDF_LOCALIZADORES_MARGEM * 2;
  const colunas = [
    { titulo: "Número Processo", largura: larguraUtil * 0.28, campo: "numeroProcesso" },
    { titulo: "Classe", largura: larguraUtil * 0.52, campo: "classe" },
    { titulo: "Inclusão no localizador", largura: larguraUtil * 0.2, campo: "inclusao" },
  ];
  return construirPdfTabela(itens, colunas, tituloDocumento);
}

// Desenha uma "secao" do resumo do Relatório Gerencial da Unidade: uma
// barra de titulo (fundo escuro, texto branco) seguida de linhas
// rotulo/valor (rotulo a esquerda em cinza, valor em negrito e destacado
// a direita), com faixas zebradas - mesma linguagem visual das tabelas
// de Localizadores/Processos/Remessas, so' que no formato rotulo-valor
// em vez de colunas. Devolve o "y" seguinte, apos a secao.
function desenharSecaoResumo(pagina, fonteNegrito, fonteNormal, x, yInicial, largura, titulo, linhas) {
  let y = yInicial;
  const alturaCabecalho = 18;

  pagina.drawRectangle({ x, y: y - alturaCabecalho, width: largura, height: alturaCabecalho, color: COR_PRIMARIA_ESCURA });
  pagina.drawText(sanitizarTextoPdf(titulo), {
    x: x + 6,
    y: y - alturaCabecalho + 5,
    size: 10,
    font: fonteNegrito,
    color: COR_BRANCO,
  });
  y -= alturaCabecalho;

  const alturaLinha = 16;
  linhas.forEach((linha, indice) => {
    if (indice % 2 === 1) {
      pagina.drawRectangle({ x, y: y - alturaLinha, width: largura, height: alturaLinha, color: COR_CINZA_CLARO });
    }
    pagina.drawText(sanitizarTextoPdf(linha.rotulo), {
      x: x + 6,
      y: y - alturaLinha + 5,
      size: 9.5,
      font: fonteNormal,
      color: COR_CINZA_TEXTO,
    });
    const textoValor = sanitizarTextoPdf(String(linha.valor));
    const larguraValor = fonteNegrito.widthOfTextAtSize(textoValor, 9.5);
    pagina.drawText(textoValor, {
      x: x + largura - 6 - larguraValor,
      y: y - alturaLinha + 5,
      size: 9.5,
      font: fonteNegrito,
      color: COR_PRIMARIA_ESCURA,
    });
    y -= alturaLinha;
  });

  pagina.drawRectangle({ x, y, width: largura, height: 0.75, color: COR_CINZA_BORDA });
  return y - 16;
}

// Monta a capa/resumo do Relatório Gerencial da Unidade: cabecalho
// institucional, titulo, unidade/data e uma secao por bloco de dados
// (conclusos para decisão/sentença, sem movimentação, remessas em
// aberto), cada uma no formato rotulo/valor. Avisos (falhas parciais em
// alguma consulta) entram no final, em texto simples. Devolve um PDF a
// parte (bytes), depois copiado para dentro do PDF final junto com as
// tabelas de Localizadores/Remessas - mesmo padrao ja' usado para
// combinar os PDFs de cada secao num unico arquivo.
async function construirCapaRelatorioGerencial(nomeUnidade, dataInformacao, secoes, avisos) {
  const pdf = await PDFDocument.create();
  const fonteNormal = await pdf.embedFont(StandardFonts.Helvetica);
  const fonteNegrito = await pdf.embedFont(StandardFonts.HelveticaBold);

  const largura = LARGURA_PAGINA_TEXTO;
  const altura = ALTURA_PAGINA_TEXTO;
  const margem = MARGEM_TEXTO;
  const larguraUtil = largura - margem * 2;

  function novaPagina() {
    const pagina = pdf.addPage([largura, altura]);
    desenharCabecalhoInstitucional(pagina, fonteNegrito, fonteNormal, largura, margem);
    return { pagina, y: altura - PDF_ALTURA_CABECALHO_INSTITUCIONAL - margem };
  }

  let { pagina, y } = novaPagina();

  pagina.drawText("Relatório para Correição", {
    x: margem,
    y,
    size: 18,
    font: fonteNegrito,
    color: COR_PRIMARIA_ESCURA,
  });
  y -= 24;
  const linhasUnidade = quebrarLinhas(`Unidade: ${sanitizarTextoPdf(nomeUnidade)}`, fonteNegrito, 11, larguraUtil);
  for (const linhaUnidade of linhasUnidade) {
    pagina.drawText(linhaUnidade, {
      x: margem,
      y,
      size: 11,
      font: fonteNegrito,
      color: COR_CINZA_TEXTO,
    });
    y -= 15;
  }
  pagina.drawText(`Data da informação: ${dataInformacao}`, {
    x: margem,
    y,
    size: 9.5,
    font: fonteNormal,
    color: COR_CINZA_TEXTO,
  });
  y -= 22;

  for (const secao of secoes) {
    const alturaEstimada = 18 + secao.linhas.length * 16 + 16;
    if (y - alturaEstimada < PDF_ALTURA_RODAPE + margem) {
      ({ pagina, y } = novaPagina());
    }
    y = desenharSecaoResumo(pagina, fonteNegrito, fonteNormal, margem, y, larguraUtil, secao.titulo, secao.linhas);
  }

  if (avisos.length > 0) {
    if (y - 14 * (avisos.length + 1) < PDF_ALTURA_RODAPE + margem) {
      ({ pagina, y } = novaPagina());
    }
    pagina.drawText("Avisos", { x: margem, y, size: 10, font: fonteNegrito, color: COR_PRIMARIA_ESCURA });
    y -= 14;
    for (const aviso of avisos) {
      const linhasAviso = quebrarLinhas(sanitizarTextoPdf(aviso), fonteNormal, 8.5, larguraUtil);
      for (const linhaAviso of linhasAviso) {
        pagina.drawText(linhaAviso, { x: margem, y, size: 8.5, font: fonteNormal, color: COR_CINZA_TEXTO });
        y -= 11;
      }
    }
  }

  desenharRodapePaginas(pdf, fonteNormal, largura, margem);

  return pdf.save();
}

// Paginas proprias (portrait) so' com a lista de nomes dos Localizadores -
// extraida da capa (que hoje termina em "PROCESSOS SEM MOVIMENTAÇÃO"/
// "REMESSAS AOS JUÍZES LEIGOS") para poder ficar sempre por ultimo no PDF,
// depois de todas as demais seções e tabelas, conforme a ordem pedida para
// o Relatório da Unidade. Mesmo layout "um nome por linha" de antes.
async function construirPaginaListaLocalizadores(nomeUnidade, localizadores) {
  const pdf = await PDFDocument.create();
  const fonteNormal = await pdf.embedFont(StandardFonts.Helvetica);
  const fonteNegrito = await pdf.embedFont(StandardFonts.HelveticaBold);

  const largura = LARGURA_PAGINA_TEXTO;
  const altura = ALTURA_PAGINA_TEXTO;
  const margem = MARGEM_TEXTO;
  const larguraUtil = largura - margem * 2;

  function novaPagina() {
    const pagina = pdf.addPage([largura, altura]);
    desenharCabecalhoInstitucional(pagina, fonteNegrito, fonteNormal, largura, margem);
    return { pagina, y: altura - PDF_ALTURA_CABECALHO_INSTITUCIONAL - margem };
  }

  let { pagina, y } = novaPagina();

  const tituloLocalizadores = `Localizadores da unidade "${sanitizarTextoPdf(nomeUnidade)}" (${localizadores.length})`;
  const linhasTitulo = quebrarLinhas(tituloLocalizadores, fonteNegrito, 12, larguraUtil);
  for (const linhaTitulo of linhasTitulo) {
    if (y - 16 < PDF_ALTURA_RODAPE + margem) {
      ({ pagina, y } = novaPagina());
    }
    pagina.drawText(linhaTitulo, {
      x: margem,
      y,
      size: 12,
      font: fonteNegrito,
      color: COR_PRIMARIA_ESCURA,
    });
    y -= 16;
  }
  y -= 2;

  // Subtitulo discreto (sem destaque, fonte pequena e cinza) explicando a
  // limitação desta lista - antes ficava misturado na seção "Avisos" no
  // início do relatório; agora fica junto da própria seção que ele
  // explica, sem chamar mais atenção do que o necessário.
  const subtituloLocalizadores = quebrarLinhas(
    "A lista abaixo traz só os nomes - por enquanto, a única forma de obter o total de processos de cada " +
      'localizador é se habilitar na própria unidade e usar a ferramenta "Localizadores do Órgão" do painel.',
    fonteNormal,
    8.5,
    larguraUtil
  );
  for (const linhaSubtitulo of subtituloLocalizadores) {
    if (y - 12 < PDF_ALTURA_RODAPE + margem) {
      ({ pagina, y } = novaPagina());
    }
    pagina.drawText(linhaSubtitulo, {
      x: margem,
      y,
      size: 8.5,
      font: fonteNormal,
      color: COR_CINZA_TEXTO,
    });
    y -= 12;
  }
  y -= 6;

  const alturaLinha = 12;
  // Um localizador por linha, com um marcador "-" e recuo pendurado
  // (linhas de continuacao de um nome muito longo alinham embaixo do
  // TEXTO, nao do marcador) - lista comprida em texto corrido virava
  // um paragrafo unico dificil de escanear; um nome por linha e' bem
  // mais facil de ler, mesmo custando mais altura de pagina.
  const marcador = "-  ";
  const larguraMarcador = fonteNormal.widthOfTextAtSize(marcador, 8.5);
  const larguraTextoLocalizador = larguraUtil - larguraMarcador;

  for (const nome of localizadores) {
    const linhasNome = quebrarLinhas(sanitizarTextoPdf(nome), fonteNormal, 8.5, larguraTextoLocalizador);
    linhasNome.forEach((linhaTexto, indice) => {
      if (y - alturaLinha < PDF_ALTURA_RODAPE + margem) {
        ({ pagina, y } = novaPagina());
      }
      if (indice === 0) {
        pagina.drawText("-", { x: margem, y, size: 8.5, font: fonteNormal, color: COR_CINZA_TEXTO });
      }
      pagina.drawText(linhaTexto, {
        x: margem + larguraMarcador,
        y,
        size: 8.5,
        font: fonteNormal,
        color: COR_CINZA_TEXTO,
      });
      y -= alturaLinha;
    });
  }

  desenharRodapePaginas(pdf, fonteNormal, largura, margem);

  return pdf.save();
}

// Planilha em formato "Excel XML Spreadsheet" (SpreadsheetML, o mesmo
// formato de arquivo unico usado pelo Excel 2003-2007 para abrir uma
// planilha nativa sem precisar gerar um .xlsx de verdade, que e' um zip -
// nao ha' nenhuma biblioteca de zip vendorizada nesta extensao). E' texto
// XML puro, salvo com extensao .xls: o Excel reconhece o conteudo pelo
// cabecalho "mso-application" e abre normalmente, sem aviso de formato
// incompatível (diferente do truque antigo de salvar uma tabela HTML
// com extensao .xls, que dispara esse aviso).
function escaparXml(texto) {
  return String(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Gerador generico de planilha-tabela reaproveitado tanto pelos
// Localizadores do Órgão quanto pelos Processos por Localizador. Cada
// coluna: { titulo, largura (em pontos, mesma unidade do SpreadsheetML),
// campo, tipo: "String" (padrao) ou "Number" }.
function construirExcelTabela(nomeAba, colunas, itens) {
  const linhaCabecalho = `<Row>
${colunas.map((c) => `   <Cell ss:StyleID="Cabecalho"><Data ss:Type="String">${escaparXml(c.titulo)}</Data></Cell>`).join("\n")}
  </Row>`;

  const linhasDados = itens
    .map((item) => {
      const celulas = colunas
        .map((c) => {
          const tipo = c.tipo || "String";
          const valor = tipo === "Number" ? Number(item[c.campo]) || 0 : escaparXml(item[c.campo]);
          return `   <Cell><Data ss:Type="${tipo}">${valor}</Data></Cell>`;
        })
        .join("\n");
      return `<Row>\n${celulas}\n  </Row>`;
    })
    .join("\n");

  const colunasXml = colunas.map((c) => `   <Column ss:Width="${c.largura}"/>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Cabecalho">
   <Font ss:Bold="1"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="${escaparXml(nomeAba)}">
  <Table>
${colunasXml}
   ${linhaCabecalho}
${linhasDados}
  </Table>
 </Worksheet>
</Workbook>
`;
}

function construirExcelLocalizadores(itens) {
  const colunas = [
    { titulo: "Localizador", largura: 220, campo: "nome" },
    { titulo: "Descrição", largura: 420, campo: "descricao" },
    { titulo: "Total de processos", largura: 110, campo: "totalProcessos", tipo: "Number" },
  ];
  return construirExcelTabela("Localizadores", colunas, itens);
}

function construirExcelProcessosLocalizador(itens) {
  const colunas = [
    { titulo: "Número Processo", largura: 160, campo: "numeroProcesso" },
    { titulo: "Classe", largura: 340, campo: "classe" },
    { titulo: "Inclusão no localizador", largura: 160, campo: "inclusao" },
  ];
  return construirExcelTabela("Processos", colunas, itens);
}

// Orquestra tudo: abre a aba oculta, coleta os localizadores de todas as
// paginas e gera os formatos marcados (pdf/excel), baixando cada um.
// Reporta progresso pelo mesmo callback usado no resto da extensao.
async function exportarLocalizadores(formatos, aoProgredir) {
  const notificar = (texto) => {
    if (aoProgredir) aoProgredir(texto);
  };

  const [abaAtual] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!abaAtual || !abaAtual.url) {
    throw new Error("Nenhuma aba ativa encontrada. Abra uma página do eproc primeiro.");
  }

  notificar("Abrindo a tela de Localizadores do Órgão...");
  const { itens, erro } = await abrirAbaEColetarLocalizadores(abaAtual.url);

  if (itens.length === 0) {
    throw new Error(erro || "Nenhum localizador encontrado.");
  }

  // Classificado por total de processos (do maior para o menor), para
  // destacar de imediato os localizadores mais usados - vale tanto para
  // o PDF quanto para a planilha.
  const itensOrdenados = [...itens].sort((a, b) => (b.totalProcessos || 0) - (a.totalProcessos || 0));

  const tituloDocumento = `Localizadores do Órgão — ${itensOrdenados.length} registro(s) — gerado em ${new Date().toLocaleString("pt-BR")}`;
  const nomeBase = `eproc/localizadores_orgao_${new Date().toISOString().slice(0, 10)}`;

  if (formatos.pdf) {
    notificar("Gerando PDF...");
    const bytes = await construirPdfLocalizadores(itensOrdenados, tituloDocumento);
    await baixarUm(`${nomeBase}.pdf`, construirDataUrlBinario("application/pdf", bytes));
  }

  if (formatos.excel) {
    notificar("Gerando planilha Excel...");
    const xml = construirExcelLocalizadores(itensOrdenados);
    await baixarUm(`${nomeBase}.xls`, construirDataUrl("application/vnd.ms-excel", xml));
  }

  notificar("Finalizando...");
  return { total: itensOrdenados.length, erroColeta: erro };
}

// Reaproveita a mesma coleta multi-pagina de "Localizadores do Órgão"
// (abrirAbaEColetarLocalizadores) para alimentar o dropdown de navegacao
// rapida do painel: so' os localizadores com pelo menos 1 processo
// atribuido (os outros nao tem link nenhum para navegar). Devolve na
// ORDEM ORIGINAL da coleta (nao ordena por nome aqui) - quem decide se
// ordena ou nao antes de exibir no dropdown e' o popup.js, respeitando a
// configuracao "ordenarListas" (engrenagem do painel).
async function listarLocalizadoresComProcessos(aoProgredir) {
  const notificar = (texto) => {
    if (aoProgredir) aoProgredir(texto);
  };

  const [abaAtual] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!abaAtual || !abaAtual.url) {
    throw new Error("Nenhuma aba ativa encontrada. Abra uma página do eproc primeiro.");
  }

  notificar("Abrindo a tela de Localizadores do Órgão...");
  const { itens, erro } = await abrirAbaEColetarLocalizadores(abaAtual.url);

  if (itens.length === 0) {
    throw new Error(erro || "Nenhum localizador encontrado.");
  }

  const comProcessos = itens.filter((item) => item.totalProcessos > 0 && item.urlProcessos);

  notificar("Finalizando...");
  return { localizadores: comProcessos, erroColeta: erro };
}

// Converte "dd/mm/aaaa HH:MM:SS" (formato usado na coluna "Inclusão no
// localizador") num timestamp para poder ordenar - retorna null se o
// texto nao bater com o formato esperado (nunca deveria acontecer, mas
// evita quebrar a ordenacao caso a pagina mude).
function parseDataHoraBr(texto) {
  const m = (texto || "").match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, dia, mes, ano, hora, min, seg] = m;
  return new Date(Number(ano), Number(mes) - 1, Number(dia), Number(hora), Number(min), Number(seg)).getTime();
}

// Abre uma aba oculta direto na URL de processos de UM localizador
// (recebida do painel, ja' capturada durante a listagem de
// Localizadores do Órgão), coleta todas as paginas e gera os arquivos
// marcados (pdf/excel), ordenados por "Inclusão no localizador" da data
// mais antiga para a mais nova.
async function exportarProcessosDoLocalizador(nomeLocalizador, urlProcessos, formatos, aoProgredir) {
  const notificar = (texto) => {
    if (aoProgredir) aoProgredir(texto);
  };

  if (!urlProcessos) {
    throw new Error("URL do localizador não informada.");
  }

  notificar(`Abrindo a lista de processos de "${nomeLocalizador}"...`);
  const { itens, erro } = await abrirAbaEColetarProcessosDoLocalizador(urlProcessos);

  if (itens.length === 0) {
    throw new Error(erro || "Nenhum processo encontrado para esse localizador.");
  }

  // Da data mais antiga para a mais nova; processos sem data reconhecida
  // (nunca deveria acontecer) vao para o final, sem embaralhar os demais.
  const itensOrdenados = [...itens].sort((a, b) => {
    const ta = parseDataHoraBr(a.inclusao);
    const tb = parseDataHoraBr(b.inclusao);
    if (ta == null && tb == null) return 0;
    if (ta == null) return 1;
    if (tb == null) return -1;
    return ta - tb;
  });

  const tituloDocumento = `Processos do Localizador "${nomeLocalizador}" — ${itensOrdenados.length} processo(s) — gerado em ${new Date().toLocaleString("pt-BR")}`;
  const nomeBase = `eproc/processos_localizador_${sanitizarNomeArquivo(nomeLocalizador)}_${new Date()
    .toISOString()
    .slice(0, 10)}`;

  if (formatos.pdf) {
    notificar("Gerando PDF...");
    const bytes = await construirPdfProcessosLocalizador(itensOrdenados, tituloDocumento);
    await baixarUm(`${nomeBase}.pdf`, construirDataUrlBinario("application/pdf", bytes));
  }

  if (formatos.excel) {
    notificar("Gerando planilha Excel...");
    const xml = construirExcelProcessosLocalizador(itensOrdenados);
    await baixarUm(`${nomeBase}.xls`, construirDataUrl("application/vnd.ms-excel", xml));
  }

  notificar("Finalizando...");
  return { total: itensOrdenados.length, erroColeta: erro };
}

// Abre um processo numa aba oculta e pede ao content script (ja' injetado
// automaticamente por ser controlador.php) a lista de documentos - mesma
// mensagem "LISTAR_DOCUMENTOS" usada quando o usuario clica em "Detectar
// documentos" com o processo aberto na aba ativa, so' que aqui a aba e'
// controlada inteiramente pela extensao. Espera um pouco apos o
// carregamento porque a tabela de eventos/documentos e' montada por
// JavaScript da propria pagina do eproc, nao esta' pronta no instante
// exato do "complete".
async function abrirAbaEListarDocumentosDoProcesso(urlProcesso) {
  let aba;
  try {
    await adquirirSlotDeAbaOculta();
    aba = await chrome.tabs.create({ url: urlProcesso, active: false });
    await aguardarCarregamentoAba(aba.id);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const resposta = await chrome.tabs.sendMessage(aba.id, { tipo: "LISTAR_DOCUMENTOS" });
    return {
      numeroProcesso: (resposta && resposta.numeroProcesso) || "",
      documentos: (resposta && resposta.documentos) || [],
      movimentacao: (resposta && resposta.movimentacao) || [],
      erro: null,
    };
  } catch (e) {
    return { numeroProcesso: "", documentos: [], movimentacao: [], erro: e && e.message ? e.message : String(e) };
  } finally {
    if (aba && aba.id) {
      chrome.tabs.remove(aba.id).catch(() => {});
    }
    liberarSlotDeAbaOculta();
  }
}

// Exportacao em lote: para cada processo da lista de UM localizador
// (recebida do painel, ja' capturada durante a listagem de "Processos
// por Localizador"), abre o processo numa aba oculta, coleta todos os
// documentos e monta um PDF unico combinado (mesma logica de
// "construirPdfUnico"/"processarFila", com movimentacao intercalada entre
// os documentos). Ao contrario da exportacao "Arquivos individuais"/"PDF
// unico" de um processo so' (que roda na aba ativa, ja' aberta pelo
// usuario), aqui cada processo e' navegado pela propria extensao, um de
// cada vez (nunca em paralelo, para nao sobrecarregar o eproc nem abrir
// dezenas de abas ocultas simultaneas).
//
// Estrutura de pastas pedida: uma pasta por processo (nome = numero do
// processo, direto dentro de "eproc/", igual as outras exportacoes de
// processo desta extensao) e, dentro dela, um unico arquivo "Exportado -
// <localizador>.pdf" - assim, ao exportar o mesmo processo por
// localizadores diferentes, cada exportacao fica em seu proprio arquivo
// dentro da mesma pasta do processo, sem sobrescrever a anterior.
async function exportarDocumentosProcessosLocalizador(nomeLocalizador, urlProcessos, aoProgredir) {
  const notificar = (texto) => {
    if (aoProgredir) aoProgredir(texto);
  };

  if (!urlProcessos) {
    throw new Error("URL do localizador não informada.");
  }

  notificar(`Abrindo a lista de processos de "${nomeLocalizador}"...`);
  const { itens, erro: erroColeta } = await abrirAbaEColetarProcessosDoLocalizador(urlProcessos);

  if (itens.length === 0) {
    throw new Error(erroColeta || "Nenhum processo encontrado para esse localizador.");
  }

  const nomeLocalizadorArquivo = sanitizarNomeArquivo(nomeLocalizador);
  const total = itens.length;
  const erros = [];
  let concluidos = 0;

  for (const item of itens) {
    const numeroProcesso = item.numeroProcesso || `processo_${concluidos + 1}`;
    notificar(`Processando processo ${concluidos + 1} de ${total}: ${numeroProcesso}...`);

    if (!item.url) {
      erros.push({ nome: numeroProcesso, mensagem: "Link do processo não encontrado na listagem." });
      concluidos += 1;
      continue;
    }

    try {
      const { documentos, movimentacao, erro: erroAba } = await abrirAbaEListarDocumentosDoProcesso(item.url);

      if (erroAba) {
        erros.push({ nome: numeroProcesso, mensagem: erroAba });
        concluidos += 1;
        continue;
      }
      if (documentos.length === 0) {
        erros.push({ nome: numeroProcesso, mensagem: "Nenhum documento encontrado neste processo." });
        concluidos += 1;
        continue;
      }

      const obterUrlResolvida = criarResolvedorUrlDocumento();
      const bytesFinais = await montarBytesPdfUnico(documentos, obterUrlResolvida, movimentacao, (feitosDoc, totalDoc) => {
        notificar(
          `Processando processo ${concluidos + 1} de ${total}: ${numeroProcesso} (documento ${feitosDoc} de ${totalDoc})...`
        );
      });

      const nomeArquivo = `eproc/${sanitizarNomeArquivo(numeroProcesso)}/Exportado - ${nomeLocalizadorArquivo}.pdf`;
      await baixarUm(nomeArquivo, construirDataUrlBinario("application/pdf", bytesFinais));
    } catch (e) {
      erros.push({ nome: numeroProcesso, mensagem: e && e.message ? e.message : String(e) });
    }

    concluidos += 1;
  }

  notificar("Finalizando...");
  return { total, concluidos, erros, erroColeta };
}

// ---- Regras de Automação (exportar sem precisar estar na página) ----

// O link para "Automatizar Localizadores do Órgão" (menu Localizadores >
// Automatizar Localizadores do Órgão) ja' existe no DOM mesmo com o
// submenu colapsado - mesmo padrao ja' usado para "Localizadores do
// Órgão"/"Relatório Geral". O "&" no final evita casar por engano com
// outras acoes que comecam com o mesmo prefixo (ex.:
// "automatizar_localizadores_alterar" dos links de editar regra).
// Autocontida, executada via chrome.scripting.executeScript.
function clicarLinkAutomatizarLocalizadoresNaPagina() {
  const link = document.querySelector('a[href*="acao=automatizar_localizadores&"]');
  if (!link) return false;
  link.click();
  return true;
}

// Abre uma aba oculta a partir da URL da aba atual, navega ate' a tela
// "Automatizar Tramitação Processual" e pede ao content script (ja'
// injetado automaticamente nela, por ser controlador.php) a lista de
// regras ativas via LISTAR_REGRAS_AUTOMACAO - reaproveitando a mesma
// logica de raspagem ja' usada quando o usuario estava manualmente
// nessa tela, so' que agora rodando numa aba que a propria extensao
// controla, sem exigir navegacao manual.
async function abrirAbaEListarRegrasAutomacao(urlBase) {
  let aba;
  try {
    await adquirirSlotDeAbaOculta();
    aba = await chrome.tabs.create({ url: urlBase, active: false });
    await aguardarCarregamentoAba(aba.id);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const [{ result: linkEncontrado } = {}] = await chrome.scripting.executeScript({
      target: { tabId: aba.id },
      func: clicarLinkAutomatizarLocalizadoresNaPagina,
    });

    if (!linkEncontrado) {
      return {
        regras: [],
        tituloPagina: "",
        erro:
          'Link "Automatizar Localizadores do Órgão" não encontrado na página atual (menu lateral: Localizadores > Automatizar Localizadores do Órgão). Abra uma página do eproc com o menu lateral e tente novamente.',
      };
    }

    await aguardarCarregamentoAba(aba.id);
    // Pequena espera extra para os switches "Ativa"/"Inativar" e os
    // selects de prioridade da tabela terminarem de inicializar apos o
    // carregamento (mesmo padrao usado no Relatório Geral).
    await new Promise((resolve) => setTimeout(resolve, 500));

    const resposta = await chrome.tabs.sendMessage(aba.id, { tipo: "LISTAR_REGRAS_AUTOMACAO" });
    return {
      regras: (resposta && resposta.regras) || [],
      tituloPagina: (resposta && resposta.tituloPagina) || "",
      erro: null,
    };
  } catch (e) {
    return { regras: [], tituloPagina: "", erro: e && e.message ? e.message : String(e) };
  } finally {
    if (aba && aba.id) {
      chrome.tabs.remove(aba.id).catch(() => {});
    }
    liberarSlotDeAbaOculta();
  }
}

// Monta um documento HTML autocontido, um "cartao" por regra ativa,
// reaproveitando o HTML original das colunas "Tipo de Controle/Critério",
// "Localizador DESTINO/Ação" e "Outros Critérios" (que ja' contem negrito
// e quebras de linha da propria pagina do eproc) para mostrar de forma
// completa o que cada regra faz, so' que num layout bem mais legivel que
// a tabela apertada original.
function construirDocumentoRegras(regras, tituloPagina) {
  const cartoes = regras
    .map((r) => {
      const links = [];
      if (r.linkEditar) links.push(`<a href="${escaparHtml(r.linkEditar)}" target="_blank" rel="noopener">Editar regra</a>`);
      if (r.linkLog) links.push(`<a href="${escaparHtml(r.linkLog)}" target="_blank" rel="noopener">Ver histórico</a>`);

      const outros = r.outrosCriteriosResumo || [];
      const fluxoExtra =
        outros.length > 0
          ? `<div class="fluxo-extra">+ ${escaparHtml(outros[0])}${
              outros.length > 1 ? ` <span class="fluxo-badge">(+${outros.length - 1})</span>` : ""
            }</div>`
          : "";

      // Sequencia vertical numerada (1 Origem -> 2 Critério -> 3 Destino
      // -> 4 Ação automatizada, quando existir), em vez de caixas numa
      // linha horizontal com "flex-wrap": com textos de tamanhos bem
      // diferentes (nome de localizador curto, criterio longo, etc.), o
      // wrap quebrava as caixas de forma imprevisivel e as setas ficavam
      // soltas entre linhas - a leitura ficava confusa. Empilhado e
      // numerado, a ordem de execucao fica clara independente do
      // tamanho de cada texto, e sempre continua legivel no popup.
      // Texto da Ação Automatizada em linhas SEPARADAS (uma por informação
      // - ação programada, evento, texto etc.), cada uma com um divisor
      // sutil entre si, em vez de um paragrafo corrido colando tudo num
      // bloco so' (o que ficava dificil de escanear, especialmente quando
      // a pagina do eproc nao usa <br> entre essas informações).
      const linhasAcao = r.acaoLinhas && r.acaoLinhas.length > 0 ? r.acaoLinhas : r.acaoResumo ? [r.acaoResumo] : [];
      const acaoHtml = linhasAcao.map((linha) => `<div class="fluxo-acao-linha">${escaparHtml(linha)}</div>`).join("");

      // Todos os critérios levados em consideração (quando a regra aceita
      // mais de um, ligados por "OU"), um por linha com um divisor sutil
      // entre eles - em vez de só o primeiro com um badge "+N
      // alternativa(s)" escondendo quais são os demais.
      const criteriosLista = r.criteriosLista && r.criteriosLista.length > 0 ? r.criteriosLista : [r.criterioResumo];
      const criterioHtmlFluxo = criteriosLista.map((linha) => `<div class="fluxo-criterio-linha">${escaparHtml(linha)}</div>`).join("");

      const passos = [
        { classe: "fluxo-origem", titulo: "Origem", texto: r.localizadorOrigem, extra: "" },
        {
          classe: "fluxo-criterio",
          titulo: "Critério",
          texto: null,
          extra: criterioHtmlFluxo + fluxoExtra,
        },
        { classe: "fluxo-destino", titulo: "Destino", texto: r.destinoResumo, extra: "" },
      ];
      if (linhasAcao.length > 0) {
        passos.push({ classe: "fluxo-acao", titulo: "Ação automatizada", texto: null, extra: acaoHtml });
      }

      // A caixa da Ação Automatizada, quando a regra tem um "Localizador
      // de Erro" definido, ganha uma seta LATERAL apontando para uma
      // caixa vermelha à parte com esse localizador - destacando
      // visualmente para onde o processo vai se a ação automatizada
      // falhar, em vez de misturar essa informação no meio do texto
      // corrido da ação.
      const caixaErro = r.localizadorErro
        ? `
      <div class="fluxo-seta-lateral" aria-hidden="true">&rarr;</div>
      <div class="fluxo-caixa fluxo-erro">
        <div class="fluxo-caixa-titulo">Localizador de Erro</div>
        <div>${escaparHtml(r.localizadorErro)}</div>
      </div>`
        : "";

      const fluxo = `
    <div class="fluxo">
      ${passos
        .map((passo, indice) => {
          const seta = indice > 0 ? `<div class="fluxo-seta" aria-hidden="true">&darr;</div>` : "";
          const caixa = `
      <div class="fluxo-caixa ${passo.classe}">
        <div class="fluxo-caixa-titulo"><span class="fluxo-numero">${indice + 1}</span> ${escaparHtml(passo.titulo)}</div>
        ${passo.texto !== null ? `<div>${escaparHtml(passo.texto)}</div>` : ""}
        ${passo.extra}
      </div>`;
          // So' a caixa da Ação Automatizada (ultimo passo, quando tem
          // Localizador de Erro) entra numa linha horizontal junto com a
          // seta lateral e a caixa vermelha - as demais seguem empilhadas
          // normalmente.
          if (passo.classe === "fluxo-acao" && caixaErro) {
            return `${seta}<div class="fluxo-linha-com-erro">${caixa}${caixaErro}</div>`;
          }
          return `${seta}${caixa}`;
        })
        .join("")}
    </div>`;

      return `
    <article class="regra">
      <header class="regra-cabecalho">
        <span class="regra-numero">Regra ${escaparHtml(r.numero || "?")}</span>
        <span class="regra-prioridade">${escaparHtml(r.prioridade || "")}</span>
      </header>
      ${fluxo}
      <dl>
        <dt>Grupo</dt>
        <dd>${escaparHtml(r.grupo)}</dd>
        <dt>Localizador ORIGEM</dt>
        <dd>${escaparHtml(r.localizadorOrigem)}</dd>
        <dt>Tipo de Controle / Critério</dt>
        <dd>${r.criterioHtml || "<em>-</em>"}</dd>
        <dt>Localizador DESTINO / Ação</dt>
        <dd>${r.destinoAcaoHtml || "<em>-</em>"}</dd>
        <dt>Outros Critérios</dt>
        <dd>${r.outrosCriteriosHtml || "<em>Nenhum</em>"}</dd>
      </dl>
      ${links.length > 0 ? `<footer class="regra-links">${links.join("")}</footer>` : ""}
    </article>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="UTF-8" />
<title>Regras de automação ativas</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; background:#f4f6f8; color:#222; margin:0; padding:24px; }
  h1 { font-size:20px; color:#1c3d5a; margin:0 0 4px; }
  .subtitulo { color:#666; font-size:13px; margin-bottom:20px; }
  .regra { background:#fff; border:1px solid #d8dee4; border-radius:8px; padding:16px 20px; margin-bottom:16px; box-shadow:0 1px 3px rgba(0,0,0,0.06); max-width:760px; }
  .regra-cabecalho { display:flex; justify-content:space-between; align-items:baseline; border-bottom:2px solid #2c6ea6; padding-bottom:8px; margin-bottom:12px; }
  .regra-numero { font-size:16px; font-weight:700; color:#1c3d5a; }
  .regra-prioridade { font-size:12.5px; color:#2c6ea6; font-weight:600; }
  .fluxo { display:flex; flex-direction:column; align-items:stretch; gap:2px; margin-bottom:14px; max-width:560px; }
  .fluxo-caixa { background:#f4f7fa; border:1px solid #c8d6e0; border-left-width:4px; border-radius:6px; padding:8px 12px; font-size:13px; line-height:1.4; }
  .fluxo-caixa-titulo { display:flex; align-items:center; gap:6px; font-size:9.5px; text-transform:uppercase; letter-spacing:0.03em; font-weight:700; color:#2c6ea6; margin-bottom:3px; }
  .fluxo-numero { display:inline-flex; align-items:center; justify-content:center; width:15px; height:15px; border-radius:50%; background:#2c6ea6; color:#fff; font-size:9.5px; font-weight:700; }
  .fluxo-origem { background:#eef1f5; border-color:#c3cdd6; }
  .fluxo-criterio { background:#fff6e0; border-color:#f0d68a; }
  .fluxo-criterio .fluxo-caixa-titulo { color:#8a6d00; }
  .fluxo-criterio .fluxo-numero { background:#8a6d00; color:#fff; }
  .fluxo-destino { background:#e9f7ee; border-color:#a9dcb9; }
  .fluxo-destino .fluxo-caixa-titulo { color:#1a7f37; }
  .fluxo-destino .fluxo-numero { background:#1a7f37; color:#fff; }
  .fluxo-acao { background:#eef1fd; border-color:#c2caf5; }
  .fluxo-acao .fluxo-caixa-titulo { color:#3d4fc4; }
  .fluxo-acao .fluxo-numero { background:#3d4fc4; color:#fff; }
  .fluxo-seta { font-size:14px; color:#9aa7b0; text-align:center; line-height:1; margin:-2px 0; padding-left:8px; }
  .fluxo-acao-linha { padding-top:4px; margin-top:4px; }
  .fluxo-acao-linha:first-child { padding-top:0; margin-top:0; border-top:none; }
  .fluxo-acao-linha + .fluxo-acao-linha { border-top:1px dashed #c2caf5; }
  .fluxo-criterio-linha { padding-top:4px; margin-top:4px; }
  .fluxo-criterio-linha:first-child { padding-top:0; margin-top:0; border-top:none; }
  .fluxo-criterio-linha + .fluxo-criterio-linha { border-top:1px dashed #f0d68a; }
  .fluxo-linha-com-erro { display:flex; align-items:stretch; gap:4px; }
  .fluxo-linha-com-erro .fluxo-caixa.fluxo-acao { flex:1 1 auto; min-width:0; }
  .fluxo-seta-lateral { flex:0 0 auto; display:flex; align-items:center; font-size:16px; color:#c0392b; padding:0 2px; }
  .fluxo-erro { flex:0 0 auto; max-width:170px; background:#fdecea; border-color:#f1a9a0; }
  .fluxo-erro .fluxo-caixa-titulo { color:#c0392b; }
  .fluxo-extra { font-size:11.5px; color:#666; margin-top:5px; padding-top:5px; border-top:1px dashed #d8dee4; }
  .fluxo-badge { display:inline-block; font-size:10px; color:#888; margin-top:3px; }
  dl { margin:0; }
  dt { font-size:11.5px; text-transform:uppercase; letter-spacing:0.03em; color:#888; font-weight:700; margin-top:10px; }
  dt:first-child { margin-top:0; }
  dd { margin:2px 0 0; font-size:13.5px; line-height:1.5; }
  .regra-links { margin-top:12px; padding-top:10px; border-top:1px solid #eee; display:flex; gap:16px; }
  .regra-links a { font-size:12.5px; color:#1a5fb4; text-decoration:none; }
  .regra-links a:hover { text-decoration:underline; }
</style>
</head>
<body>
  <h1>Regras de automação ativas</h1>
  <div class="subtitulo">${escaparHtml(tituloPagina)} — ${regras.length} regra(s) ativa(s) — gerado em ${new Date().toLocaleString("pt-BR")}</div>
  ${cartoes}
</body>
</html>`;
}

// ---- Geracao do PDF de Regras de Automação ----
//
// Mesma informacao do documento HTML (construirDocumentoRegras), redesenhada
// com pdf-lib: cada regra vira um "cartao" com o fluxo Origem -> Critério ->
// Destino -> Ação Automatizada empilhado (caixas coloridas + setas), e,
// quando a regra tem Localizador de Erro, uma caixa vermelha ao lado da
// Ação Automatizada ligada por uma seta lateral - mesma linguagem visual
// da versao HTML, para quem preferir baixar/arquivar em PDF em vez de
// abrir a aba com o HTML.
const PDF_REGRAS_CORES = {
  origem: { fundo: rgb(0xee / 255, 0xf1 / 255, 0xf5 / 255), acento: rgb(0x8b / 255, 0x99 / 255, 0xa6 / 255), titulo: COR_PRIMARIA },
  criterio: { fundo: rgb(0xff / 255, 0xf6 / 255, 0xe0 / 255), acento: rgb(0x8a / 255, 0x6d / 255, 0x00 / 255), titulo: rgb(0x8a / 255, 0x6d / 255, 0x00 / 255) },
  destino: { fundo: rgb(0xe9 / 255, 0xf7 / 255, 0xee / 255), acento: rgb(0x1a / 255, 0x7f / 255, 0x37 / 255), titulo: rgb(0x1a / 255, 0x7f / 255, 0x37 / 255) },
  acao: { fundo: rgb(0xee / 255, 0xf1 / 255, 0xfd / 255), acento: rgb(0x3d / 255, 0x4f / 255, 0xc4 / 255), titulo: rgb(0x3d / 255, 0x4f / 255, 0xc4 / 255) },
  erro: { fundo: rgb(0xfd / 255, 0xec / 255, 0xea / 255), acento: COR_ALERTA_VERMELHO, titulo: COR_ALERTA_VERMELHO },
};

// Desenha uma caixa do fluxo (Origem/Critério/Destino/Ação/Erro): faixa de
// acento a esquerda, circulo numerado (quando "numero" e' informado - a
// caixa de erro nao tem numero, so' o titulo), titulo e um ou mais
// paragrafos de texto, opcionalmente separados por um traço fino entre si
// (usado na Ação Automatizada, para nao colar as informações num bloco so').
// Devolve a altura ocupada, para o chamador avançar o "y".
function desenharCaixaFluxoPdf(pagina, { x, yTopo, largura, numero, titulo, paragrafos, cores, fonteNormal, fonteNegrito, comDivisores }) {
  const padX = 8;
  const padY = 7;
  const larguraTexto = largura - padX * 2 - (numero !== null ? 16 : 0);
  const xTexto = x + padX + (numero !== null ? 16 : 0);
  const tamanhoTexto = 8.5;
  const alturaLinhaTexto = 11.5;

  const linhasPorParagrafo = paragrafos
    .filter((p) => (p || "").trim() !== "")
    .map((p) => quebrarLinhas(sanitizarTextoPdf(p), fonteNormal, tamanhoTexto, larguraTexto));

  const alturaTitulo = 20;
  const totalLinhasTexto = linhasPorParagrafo.reduce((soma, ls) => soma + Math.max(ls.length, 1), 0);
  const alturaDivisores = comDivisores && linhasPorParagrafo.length > 1 ? (linhasPorParagrafo.length - 1) * 6 : 0;
  const alturaCaixa = padY * 2 + alturaTitulo + totalLinhasTexto * alturaLinhaTexto + alturaDivisores;

  pagina.drawRectangle({
    x,
    y: yTopo - alturaCaixa,
    width: largura,
    height: alturaCaixa,
    color: cores.fundo,
    borderColor: cores.acento,
    borderWidth: 0.75,
  });
  pagina.drawRectangle({ x, y: yTopo - alturaCaixa, width: 3, height: alturaCaixa, color: cores.acento });

  const yTituloBase = yTopo - padY - 9;
  if (numero !== null) {
    const cx = x + padX + 7;
    const cy = yTituloBase + 2.5;
    pagina.drawEllipse({ x: cx, y: cy, xScale: 6.5, yScale: 6.5, color: cores.acento });
    pagina.drawText(String(numero), {
      x: cx - (String(numero).length > 1 ? 4.5 : 2.3),
      y: cy - 3,
      size: 8,
      font: fonteNegrito,
      color: COR_BRANCO,
    });
  }
  pagina.drawText(sanitizarTextoPdf(titulo).toUpperCase(), {
    x: x + padX + (numero !== null ? 16 : 0),
    y: yTituloBase,
    size: 8,
    font: fonteNegrito,
    color: cores.titulo,
  });

  let y = yTopo - padY - alturaTitulo;
  linhasPorParagrafo.forEach((linhas, indice) => {
    if (indice > 0 && comDivisores) {
      pagina.drawLine({
        start: { x: xTexto, y: y + 4 },
        end: { x: x + largura - padX, y: y + 4 },
        thickness: 0.5,
        color: COR_CINZA_BORDA,
      });
      y -= 6;
    }
    linhas.forEach((linha) => {
      pagina.drawText(linha, { x: xTexto, y, size: tamanhoTexto, font: fonteNormal, color: COR_CINZA_TEXTO });
      y -= alturaLinhaTexto;
    });
  });

  return alturaCaixa;
}

// Seta simples (linha + ponta em "V") entre duas caixas - vertical (entre
// os passos empilhados) ou horizontal (da Ação Automatizada para a caixa
// de erro), conforme "direcao".
function desenharSetaPdf(pagina, { x, y, comprimento, direcao, cor }) {
  if (direcao === "baixo") {
    pagina.drawLine({ start: { x, y }, end: { x, y: y - comprimento }, thickness: 1, color: cor });
    pagina.drawLine({ start: { x: x - 3, y: y - comprimento + 4 }, end: { x, y: y - comprimento }, thickness: 1, color: cor });
    pagina.drawLine({ start: { x: x + 3, y: y - comprimento + 4 }, end: { x, y: y - comprimento }, thickness: 1, color: cor });
  } else {
    pagina.drawLine({ start: { x, y }, end: { x: x + comprimento, y }, thickness: 1, color: cor });
    pagina.drawLine({ start: { x: x + comprimento - 4, y: y + 3 }, end: { x: x + comprimento, y }, thickness: 1, color: cor });
    pagina.drawLine({ start: { x: x + comprimento - 4, y: y - 3 }, end: { x: x + comprimento, y }, thickness: 1, color: cor });
  }
}

async function construirPdfRegras(regras, tituloPagina) {
  const pdf = await PDFDocument.create();
  const fonteNormal = await pdf.embedFont(StandardFonts.Helvetica);
  const fonteNegrito = await pdf.embedFont(StandardFonts.HelveticaBold);

  const largura = LARGURA_PAGINA_TEXTO;
  const altura = ALTURA_PAGINA_TEXTO;
  const margem = MARGEM_TEXTO;
  const larguraUtil = largura - margem * 2;

  let pagina = null;
  let y = 0;

  function novaPagina(comTitulo) {
    pagina = pdf.addPage([largura, altura]);
    desenharCabecalhoInstitucional(pagina, fonteNegrito, fonteNormal, largura, margem);
    y = altura - PDF_ALTURA_CABECALHO_INSTITUCIONAL - margem;
    if (comTitulo) {
      pagina.drawText(sanitizarTextoPdf("Regras de automação ativas"), {
        x: margem,
        y,
        size: 14,
        font: fonteNegrito,
        color: COR_PRIMARIA_ESCURA,
      });
      y -= 16;
      pagina.drawText(sanitizarTextoPdf(`${tituloPagina} — ${regras.length} regra(s) ativa(s)`), {
        x: margem,
        y,
        size: 9,
        font: fonteNormal,
        color: COR_CINZA_TEXTO,
      });
      y -= 22;
    }
  }
  novaPagina(true);

  function garantirEspaco(alturaNecessaria) {
    if (y - alturaNecessaria < PDF_ALTURA_RODAPE + margem) {
      novaPagina(false);
    }
  }

  for (const r of regras) {
    garantirEspaco(60);

    pagina.drawText(sanitizarTextoPdf(`Regra ${r.numero || "?"}`), { x: margem, y, size: 12, font: fonteNegrito, color: COR_PRIMARIA_ESCURA });
    const textoPrioridade = sanitizarTextoPdf(r.prioridade || "");
    if (textoPrioridade) {
      const larguraPrioridade = fonteNegrito.widthOfTextAtSize(textoPrioridade, 9.5);
      pagina.drawText(textoPrioridade, { x: margem + larguraUtil - larguraPrioridade, y: y + 1, size: 9.5, font: fonteNegrito, color: COR_PRIMARIA });
    }
    y -= 6;
    pagina.drawLine({ start: { x: margem, y }, end: { x: margem + larguraUtil, y }, thickness: 1.25, color: COR_PRIMARIA });
    y -= 14;

    const linhasAcao = r.acaoLinhas && r.acaoLinhas.length > 0 ? r.acaoLinhas : r.acaoResumo ? [r.acaoResumo] : [];
    const criteriosLista = r.criteriosLista && r.criteriosLista.length > 0 ? r.criteriosLista : [r.criterioResumo];
    const temErro = Boolean(r.localizadorErro);
    const larguraAcao = temErro ? larguraUtil * 0.62 : larguraUtil;
    const larguraErro = larguraUtil * 0.3;

    const passos = [
      { titulo: "Origem", cores: PDF_REGRAS_CORES.origem, paragrafos: [r.localizadorOrigem], largura: larguraUtil },
      {
        titulo: "Critério",
        cores: PDF_REGRAS_CORES.criterio,
        paragrafos: criteriosLista,
        largura: larguraUtil,
        comDivisores: true,
      },
      { titulo: "Destino", cores: PDF_REGRAS_CORES.destino, paragrafos: [r.destinoResumo], largura: larguraUtil },
    ];
    if (linhasAcao.length > 0) {
      passos.push({ titulo: "Ação automatizada", cores: PDF_REGRAS_CORES.acao, paragrafos: linhasAcao, largura: larguraAcao, comDivisores: true });
    }

    passos.forEach((passo, indice) => {
      garantirEspaco(30);
      if (indice > 0) {
        desenharSetaPdf(pagina, { x: margem + larguraUtil / 2, y, comprimento: 8, direcao: "baixo", cor: rgb(0.6, 0.65, 0.68) });
        y -= 11;
      }
      const ehAcaoComErro = passo.titulo === "Ação automatizada" && temErro;
      const alturaCaixa = desenharCaixaFluxoPdf(pagina, {
        x: margem,
        yTopo: y,
        largura: passo.largura,
        numero: indice + 1,
        titulo: passo.titulo,
        paragrafos: passo.paragrafos,
        cores: passo.cores,
        fonteNormal,
        fonteNegrito,
        comDivisores: passo.comDivisores,
      });
      if (ehAcaoComErro) {
        const xErro = margem + larguraAcao + 26;
        desenharSetaPdf(pagina, {
          x: margem + larguraAcao + 4,
          y: y - alturaCaixa / 2,
          comprimento: 18,
          direcao: "direita",
          cor: COR_ALERTA_VERMELHO,
        });
        desenharCaixaFluxoPdf(pagina, {
          x: xErro,
          yTopo: y,
          largura: larguraErro,
          numero: null,
          titulo: "Localizador de Erro",
          paragrafos: [r.localizadorErro],
          cores: PDF_REGRAS_CORES.erro,
          fonteNormal,
          fonteNegrito,
        });
      }
      y -= alturaCaixa;
    });

    y -= 8;

    const camposTexto = [
      ["Grupo", r.grupo],
      ["Localizador Origem", r.localizadorOrigem],
      ["Tipo de Controle / Critério", r.criterioResumo],
      ["Localizador Destino / Ação", r.destinoResumo],
      ["Outros Critérios", (r.outrosCriteriosResumo || []).join(" — ") || "Nenhum"],
    ];
    for (const [rotulo, valor] of camposTexto) {
      const linhasRotulo = quebrarLinhas(sanitizarTextoPdf(rotulo), fonteNegrito, 8, larguraUtil);
      const linhasValor = quebrarLinhas(sanitizarTextoPdf(String(valor || "-")), fonteNormal, 9.5, larguraUtil);
      garantirEspaco(14 + linhasValor.length * 12);
      pagina.drawText(linhasRotulo[0] || rotulo, { x: margem, y, size: 8, font: fonteNegrito, color: COR_CINZA_TEXTO });
      y -= 12;
      linhasValor.forEach((linha) => {
        pagina.drawText(linha, { x: margem, y, size: 9.5, font: fonteNormal, color: rgb(0.13, 0.13, 0.13) });
        y -= 12;
      });
      y -= 2;
    }

    y -= 6;
    pagina.drawLine({ start: { x: margem, y }, end: { x: margem + larguraUtil, y }, thickness: 0.5, color: COR_CINZA_BORDA });
    y -= 16;
  }

  desenharRodapePaginas(pdf, fonteNormal, largura, margem);

  return pdf.save();
}

// Orquestra tudo: abre a aba oculta, coleta as regras ativas uma unica vez
// e entrega o resultado nos formatos marcados - "html" (aba nova, como
// antes) e/ou "pdf" (baixa um arquivo, mesmo padrao dos demais PDFs da
// extensao). Reporta progresso pelo mesmo callback usado no resto da
// extensao.
async function exportarRegrasAutomacao(aoProgredir) {
  const notificar = (texto) => {
    if (aoProgredir) aoProgredir(texto);
  };

  const [abaAtual] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!abaAtual || !abaAtual.url) {
    throw new Error("Nenhuma aba ativa encontrada. Abra uma página do eproc primeiro.");
  }

  notificar("Abrindo a tela de Automatizar Tramitação Processual...");
  const { regras, tituloPagina, erro } = await abrirAbaEListarRegrasAutomacao(abaAtual.url);

  if (erro) throw new Error(erro);
  if (regras.length === 0) throw new Error("Nenhuma regra ativa encontrada.");

  notificar("Gerando documento...");
  // Exportação em HTML desativada por enquanto - o PDF passou a ser o
  // único formato oferecido no painel (mais fácil de arquivar/anexar do
  // que uma aba aberta no navegador). O código abaixo continua no lugar,
  // só comentado, para poder reativar rapidamente se for necessário.
  // const html = construirDocumentoRegras(regras, tituloPagina);
  // await chrome.tabs.create({ url: "data:text/html;charset=utf-8," + encodeURIComponent(html) });

  const bytes = await construirPdfRegras(regras, tituloPagina);
  const dataAtual = new Date().toISOString().slice(0, 10);
  await baixarUm(`eproc/regras_automacao_${dataAtual}.pdf`, construirDataUrlBinario("application/pdf", bytes));

  notificar("Finalizando...");
  return { total: regras.length };
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

  if (mensagem && mensagem.tipo === "LISTAR_UNIDADES_RELATORIO_GERAL") {
    // Mesmo padrao das demais operacoes em segundo plano: confirma o
    // recebimento na hora e avisa o resultado final por uma mensagem
    // separada, ja' que essa operacao navega a aba e demora alguns
    // segundos.
    listarUnidadesRelatorioGeral((texto) => {
      chrome.runtime.sendMessage({ tipo: "PROGRESSO_UNIDADES_RELATORIO", texto }).catch(() => {});
    })
      .then((resultado) => {
        chrome.runtime
          .sendMessage({ tipo: "UNIDADES_RELATORIO_FINALIZADO", ok: true, resultado })
          .catch(() => {});
      })
      .catch((e) => {
        chrome.runtime
          .sendMessage({
            tipo: "UNIDADES_RELATORIO_FINALIZADO",
            ok: false,
            erro: e && e.message ? e.message : String(e),
          })
          .catch(() => {});
      });
    sendResponse({ ok: true });
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

  if (mensagem && mensagem.tipo === "EXPORTAR_LOCALIZADORES") {
    // Mesmo padrao de GERAR_RELATORIO: a operacao percorre varias paginas
    // e demora, entao confirma o recebimento na hora e avisa o resultado
    // final por uma mensagem separada.
    exportarLocalizadores(mensagem.formatos, (texto) => {
      chrome.runtime.sendMessage({ tipo: "PROGRESSO_LOCALIZADORES", texto }).catch(() => {});
    })
      .then((resultado) => {
        chrome.runtime
          .sendMessage({ tipo: "LOCALIZADORES_FINALIZADO", ok: true, resultado })
          .catch(() => {});
      })
      .catch((e) => {
        chrome.runtime
          .sendMessage({
            tipo: "LOCALIZADORES_FINALIZADO",
            ok: false,
            erro: e && e.message ? e.message : String(e),
          })
          .catch(() => {});
      });
    sendResponse({ ok: true });
    return true;
  }

  if (mensagem && mensagem.tipo === "LISTAR_LOCALIZADORES_COM_PROCESSOS") {
    // Mesmo padrao de EXPORTAR_LOCALIZADORES: percorre varias paginas e
    // demora, entao confirma o recebimento na hora e avisa o resultado
    // final por uma mensagem separada.
    listarLocalizadoresComProcessos((texto) => {
      chrome.runtime.sendMessage({ tipo: "PROGRESSO_LISTAR_LOCALIZADORES", texto }).catch(() => {});
    })
      .then((resultado) => {
        chrome.runtime
          .sendMessage({ tipo: "LISTAR_LOCALIZADORES_FINALIZADO", ok: true, resultado })
          .catch(() => {});
      })
      .catch((e) => {
        chrome.runtime
          .sendMessage({
            tipo: "LISTAR_LOCALIZADORES_FINALIZADO",
            ok: false,
            erro: e && e.message ? e.message : String(e),
          })
          .catch(() => {});
      });
    sendResponse({ ok: true });
    return true;
  }

  if (mensagem && mensagem.tipo === "EXPORTAR_PROCESSOS_LOCALIZADOR") {
    // Mesmo padrao das demais exportacoes em segundo plano.
    exportarProcessosDoLocalizador(mensagem.nomeLocalizador, mensagem.urlProcessos, mensagem.formatos, (texto) => {
      chrome.runtime.sendMessage({ tipo: "PROGRESSO_PROCESSOS_LOCALIZADOR", texto }).catch(() => {});
    })
      .then((resultado) => {
        chrome.runtime
          .sendMessage({ tipo: "PROCESSOS_LOCALIZADOR_FINALIZADO", ok: true, resultado })
          .catch(() => {});
      })
      .catch((e) => {
        chrome.runtime
          .sendMessage({
            tipo: "PROCESSOS_LOCALIZADOR_FINALIZADO",
            ok: false,
            erro: e && e.message ? e.message : String(e),
          })
          .catch(() => {});
      });
    sendResponse({ ok: true });
    return true;
  }

  if (mensagem && mensagem.tipo === "EXPORTAR_DOCUMENTOS_LOCALIZADOR") {
    // Mesmo padrao das demais exportacoes em segundo plano; pode demorar
    // bastante (um processo de cada vez, cada um com sua propria aba
    // oculta), entao confirma o recebimento na hora e avisa o resultado
    // final por uma mensagem separada.
    exportarDocumentosProcessosLocalizador(mensagem.nomeLocalizador, mensagem.urlProcessos, (texto) => {
      chrome.runtime.sendMessage({ tipo: "PROGRESSO_DOCUMENTOS_LOCALIZADOR", texto }).catch(() => {});
    })
      .then((resultado) => {
        chrome.runtime
          .sendMessage({ tipo: "DOCUMENTOS_LOCALIZADOR_FINALIZADO", ok: true, resultado })
          .catch(() => {});
      })
      .catch((e) => {
        chrome.runtime
          .sendMessage({
            tipo: "DOCUMENTOS_LOCALIZADOR_FINALIZADO",
            ok: false,
            erro: e && e.message ? e.message : String(e),
          })
          .catch(() => {});
      });
    sendResponse({ ok: true });
    return true;
  }

  if (mensagem && mensagem.tipo === "EXPORTAR_REGRAS_AUTOMACAO") {
    // Mesmo padrao de EXPORTAR_LOCALIZADORES/GERAR_RELATORIO: navega uma
    // aba oculta e demora alguns segundos, entao confirma o recebimento
    // na hora e avisa o resultado final por uma mensagem separada.
    exportarRegrasAutomacao((texto) => {
      chrome.runtime.sendMessage({ tipo: "PROGRESSO_REGRAS", texto }).catch(() => {});
    })
      .then((resultado) => {
        chrome.runtime.sendMessage({ tipo: "REGRAS_FINALIZADO", ok: true, resultado }).catch(() => {});
      })
      .catch((e) => {
        chrome.runtime
          .sendMessage({
            tipo: "REGRAS_FINALIZADO",
            ok: false,
            erro: e && e.message ? e.message : String(e),
          })
          .catch(() => {});
      });
    sendResponse({ ok: true });
    return true;
  }

  if (mensagem && mensagem.tipo === "EXPORTAR_RELATORIO_GERENCIAL_UNIDADE") {
    // Mesmo padrao das demais operacoes em segundo plano.
    exportarRelatorioGerencialUnidade(
      mensagem.valorUnidade,
      mensagem.nomeUnidade,
      mensagem.opcoes,
      (texto) => {
        chrome.runtime.sendMessage({ tipo: "PROGRESSO_RELATORIO_GERENCIAL", texto }).catch(() => {});
      }
    )
      .then((resultado) => {
        chrome.runtime
          .sendMessage({ tipo: "RELATORIO_GERENCIAL_FINALIZADO", ok: true, resultado })
          .catch(() => {});
      })
      .catch((e) => {
        chrome.runtime
          .sendMessage({
            tipo: "RELATORIO_GERENCIAL_FINALIZADO",
            ok: false,
            erro: e && e.message ? e.message : String(e),
          })
          .catch(() => {});
      });
    sendResponse({ ok: true });
    return true;
  }

  if (mensagem && mensagem.tipo === "EXPORTAR_RELATORIO_PANORAMICO") {
    // Mesmo padrao das demais operacoes em segundo plano.
    exportarRelatorioPanoramico((texto) => {
      chrome.runtime.sendMessage({ tipo: "PROGRESSO_RELATORIO_PANORAMICO", texto }).catch(() => {});
    })
      .then((resultado) => {
        chrome.runtime
          .sendMessage({ tipo: "RELATORIO_PANORAMICO_FINALIZADO", ok: true, resultado })
          .catch(() => {});
      })
      .catch((e) => {
        chrome.runtime
          .sendMessage({
            tipo: "RELATORIO_PANORAMICO_FINALIZADO",
            ok: false,
            erro: e && e.message ? e.message : String(e),
          })
          .catch(() => {});
      });
    sendResponse({ ok: true });
    return true;
  }

  return false;
});
