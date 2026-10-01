// Log unificado da extensão. Tudo que a extensão faz aparece no console do
// navegador com o prefixo [ext_eproc] (acrescido do contexto: background,
// content, popup, preview). Valores sensíveis (chaves de API, textos de
// documentos/prompts) nunca são impressos - só o nome do campo e o tamanho.
(function (escopo) {
  const PREFIXO = "[ext_eproc]";
  const CAMPOS_SENSIVEIS = /key|chave|senha|token|segredo|texto|prompt|conteudo|html|base64/i;
  let contexto = "geral";

  function resumirValor(chave, valor) {
    if (valor === null || valor === undefined) return valor;
    if (CAMPOS_SENSIVEIS.test(chave) && typeof valor === "string") {
      return /key|chave|senha|token|segredo/i.test(chave) ? "<oculto>" : `<${valor.length} caractere(s)>`;
    }
    if (typeof valor === "string") return valor.length > 120 ? valor.slice(0, 120) + "…" : valor;
    if (Array.isArray(valor)) return `[${valor.length} item(ns)]`;
    if (typeof valor === "object") return "{…}";
    return valor;
  }

  function resumirObjeto(obj) {
    if (!obj || typeof obj !== "object") return obj;
    const saida = {};
    for (const k of Object.keys(obj)) saida[k] = resumirValor(k, obj[k]);
    return saida;
  }

  function semQuery(url) {
    try {
      const u = new URL(url);
      return u.origin + u.pathname + (u.search ? "?…" : "");
    } catch (e) {
      return String(url).split("?")[0];
    }
  }

  function emitir(nivel, args) {
    try {
      console[nivel](PREFIXO + "[" + contexto + "]", ...args);
    } catch (e) {}
  }

  const logExt = (...a) => emitir("log", a);
  logExt.warn = (...a) => emitir("warn", a);
  logExt.error = (...a) => emitir("error", a);
  logExt.resumir = resumirObjeto;
  logExt.semQuery = semQuery;

  // Envolve funções das APIs do chrome.* para registrar cada chamada.
  function envolver(objeto, nome, descrever) {
    try {
      if (!objeto || typeof objeto[nome] !== "function" || objeto[nome].__extEprocLog) return;
      const original = objeto[nome];
      const envolvida = function (...args) {
        try {
          logExt(...descrever(args));
        } catch (e) {}
        return original.apply(this, args);
      };
      envolvida.__extEprocLog = true;
      objeto[nome] = envolvida;
    } catch (e) {}
  }

  logExt.instrumentar = function (nomeContexto) {
    contexto = nomeContexto;
    escopo.addEventListener("error", (ev) => logExt.error("Erro não tratado:", ev.message, ev.filename + ":" + ev.lineno));
    escopo.addEventListener("unhandledrejection", (ev) =>
      logExt.error("Promise rejeitada sem tratamento:", (ev.reason && ev.reason.message) || ev.reason)
    );
    if (typeof chrome === "undefined" || !chrome.runtime) return;
    const rt = chrome.runtime;
    envolver(rt, "sendMessage", (a) => {
      const m = a[0];
      return ["Mensagem enviada →", (m && m.tipo) || "(sem tipo)", resumirObjeto(m)];
    });
    if (chrome.tabs) {
      envolver(chrome.tabs, "sendMessage", (a) => ["Mensagem para aba", a[0], "→", (a[1] && a[1].tipo) || "(sem tipo)", resumirObjeto(a[1])]);
      envolver(chrome.tabs, "create", (a) => ["Abrindo aba", a[0] && a[0].url ? semQuery(a[0].url) : "", a[0] && a[0].active === false ? "(oculta)" : ""]);
      envolver(chrome.tabs, "remove", (a) => ["Fechando aba", a[0]]);
    }
    if (chrome.downloads) {
      envolver(chrome.downloads, "download", (a) => ["Iniciando download:", a[0] && a[0].filename]);
    }
    if (chrome.windows) {
      envolver(chrome.windows, "create", (a) => ["Abrindo janela", a[0] && a[0].url ? semQuery(a[0].url) : ""]);
    }
    // Mensagens recebidas (qualquer contexto que tenha ouvinte).
    try {
      rt.onMessage.addListener((mensagem) => {
        logExt("Mensagem recebida ←", (mensagem && mensagem.tipo) || "(sem tipo)", resumirObjeto(mensagem));
        return false;
      });
    } catch (e) {}
    // Chamadas de rede feitas a partir do contexto (service worker/painel).
    if (typeof escopo.fetch === "function" && !escopo.fetch.__extEprocLog) {
      const fetchOriginal = escopo.fetch.bind(escopo);
      const fetchLog = async function (entrada, opcoes) {
        const url = typeof entrada === "string" ? entrada : entrada && entrada.url;
        const metodo = (opcoes && opcoes.method) || "GET";
        const t0 = Date.now();
        logExt("fetch", metodo, semQuery(url));
        try {
          const r = await fetchOriginal(entrada, opcoes);
          logExt("fetch concluído", r.status, semQuery(url), `${Date.now() - t0}ms`);
          return r;
        } catch (e) {
          logExt.warn("fetch falhou", semQuery(url), String(e));
          throw e;
        }
      };
      fetchLog.__extEprocLog = true;
      escopo.fetch = fetchLog;
    }
    logExt("Inicializado.", escopo.location ? semQuery(escopo.location.href) : "");
  };

  escopo.logExt = logExt;
})(typeof self !== "undefined" ? self : window);
