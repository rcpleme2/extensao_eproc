const areaStatus = document.getElementById("area-status");
const btnDetectar = document.getElementById("btn-detectar");
const btnBaixar = document.getElementById("btn-baixar");
const areaProcesso = document.getElementById("area-processo");
const numeroProcessoEl = document.getElementById("numero-processo");
const totalDocumentosEl = document.getElementById("total-documentos");
const listaDocumentosEl = document.getElementById("lista-documentos");
const areaMarcarDocumentos = document.getElementById("area-marcar-documentos");
const btnMarcarTudoDocumentos = document.getElementById("btn-marcar-tudo-documentos");
const btnDesmarcarTudoDocumentos = document.getElementById("btn-desmarcar-tudo-documentos");
const areaOpcoes = document.getElementById("area-opcoes");
const radioIndividuais = document.getElementById("radio-individuais");
const radioPdfUnico = document.getElementById("radio-pdf-unico");
const radioMdUnico = document.getElementById("radio-md-unico");
const avisoMdUnico = document.getElementById("aviso-md-unico");
const areaIncluirMovimentacao = document.getElementById("area-incluir-movimentacao");
const chkIncluirMovimentacao = document.getElementById("chk-incluir-movimentacao");
const areaProgresso = document.getElementById("area-progresso");
const barraProgresso = document.getElementById("barra-progresso");
const textoProgresso = document.getElementById("texto-progresso");
const areaErros = document.getElementById("area-erros");

const areaStatusIA = document.getElementById("area-status-ia");
const btnDetectarIA = document.getElementById("btn-detectar-ia");
const areaProcessoIA = document.getElementById("area-processo-ia");
const numeroProcessoIAEl = document.getElementById("numero-processo-ia");
const totalDocumentosIAEl = document.getElementById("total-documentos-ia");
const areaMarcarDocumentosIA = document.getElementById("area-marcar-documentos-ia");
const btnMarcarTudoDocumentosIA = document.getElementById("btn-marcar-tudo-documentos-ia");
const btnDesmarcarTudoDocumentosIA = document.getElementById("btn-desmarcar-tudo-documentos-ia");
const listaDocumentosIAEl = document.getElementById("lista-documentos-ia");
const areaIncluirMovimentacaoIA = document.getElementById("area-incluir-movimentacao-ia");
const chkIncluirMovimentacaoIA = document.getElementById("chk-incluir-movimentacao-ia");
const areaAnaliseIA = document.getElementById("area-analise-ia");
const selectPromptIA = document.getElementById("select-prompt-ia");
const chkAnonimizarIA = document.getElementById("chk-anonimizar-ia");
const btnAnalisarIA = document.getElementById("btn-analisar-ia");
const btnAdicionarFilaIA = document.getElementById("btn-adicionar-fila-ia");
const areaProgressoIA = document.getElementById("area-progresso-ia");
const textoProgressoIA = document.getElementById("texto-progresso-ia");
const areaEstimativaIA = document.getElementById("area-estimativa-ia");
const textoEstimativaIA = document.getElementById("texto-estimativa-ia");
const btnConfirmarAnaliseIA = document.getElementById("btn-confirmar-analise-ia");
const btnCancelarAnaliseIA = document.getElementById("btn-cancelar-analise-ia");
const areaErrosIA = document.getElementById("area-erros-ia");
const areaResultadoIA = document.getElementById("area-resultado-ia");
const textoResultadoIA = document.getElementById("texto-resultado-ia");
const btnCopiarResultadoIA = document.getElementById("btn-copiar-resultado-ia");

const areaErrosFilaLoteIA = document.getElementById("area-erros-fila-lote-ia");
const listaFilaLoteIA = document.getElementById("lista-fila-lote-ia");
const areaFilaLoteVazia = document.getElementById("area-fila-lote-vazia");
const btnEnviarLoteIA = document.getElementById("btn-enviar-lote-ia");
const areaLotesEnviadosVazio = document.getElementById("area-lotes-enviados-vazio");
const listaLotesEnviadosIA = document.getElementById("lista-lotes-enviados-ia");

// Cadastro de prompts: guardado em chrome.storage.local pelo background
// (que é quem de fato monta a chamada à API) - o painel só mantém uma
// cópia local (id/título/texto) para preencher o <select> e o formulário
// de gerenciar prompts, carregada no início e atualizada a cada
// cadastro/edição/exclusão.
let PROMPTS_IA_PAINEL = [];

function atualizarSelectPromptIA() {
  const valorAtual = selectPromptIA.value;
  selectPromptIA.innerHTML = "";
  for (const prompt of PROMPTS_IA_PAINEL) {
    const option = document.createElement("option");
    option.value = prompt.id;
    option.textContent = prompt.titulo;
    selectPromptIA.appendChild(option);
  }
  if (PROMPTS_IA_PAINEL.some((p) => p.id === valorAtual)) {
    selectPromptIA.value = valorAtual;
  }
}

async function atualizarPromptsIA() {
  const resposta = await chrome.runtime.sendMessage({ tipo: "PROMPTS_IA_LISTAR" });
  PROMPTS_IA_PAINEL = (resposta && resposta.prompts) || [];
  atualizarSelectPromptIA();
  renderizarListaPromptsIA();
}

const FORMATADOR_USD = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 4 });

function nomeAmigavelModelo(modeloId) {
  const todos = [...MODELOS_IA_PAINEL.claude, ...MODELOS_IA_PAINEL.gemini];
  const encontrado = todos.find((m) => m.id === modeloId);
  return encontrado ? encontrado.nome : modeloId;
}

let textoExtraidoParaIA = null;

function resetarAnaliseIA() {
  textoExtraidoParaIA = null;
  areaProgressoIA.hidden = true;
  areaEstimativaIA.hidden = true;
  areaErrosIA.hidden = true;
  areaResultadoIA.hidden = true;
  textoResultadoIA.value = "";
  btnAnalisarIA.disabled = false;
}

btnAnalisarIA.addEventListener("click", async () => {
  const { documentosSelecionados, movimentacaoParaEnviar } = await obterSelecaoAtualParaEnvio();

  if (documentosSelecionados.length === 0 && movimentacaoParaEnviar.length === 0) {
    areaErrosIA.hidden = false;
    areaErrosIA.textContent =
      "Nada para analisar: nenhum documento selecionado e a movimentação está excluída. Marque ao menos um documento ou inclua a movimentação.";
    return;
  }

  const config = await obterConfiguracoes();

  resetarAnaliseIA();
  btnAnalisarIA.disabled = true;
  areaProgressoIA.hidden = false;
  textoProgressoIA.textContent = "Extraindo o conteúdo dos documentos selecionados...";

  chrome.runtime.sendMessage({
    tipo: "ANALISAR_IA_EXTRAIR",
    documentos: documentosSelecionados,
    movimentacao: movimentacaoParaEnviar,
    anonimizar: chkAnonimizarIA.checked,
    provedor: config.provedorIA,
    modelo: config.provedorIA === "gemini" ? config.modeloGemini : config.modeloClaude,
    promptId: selectPromptIA.value,
  });
});

btnCancelarAnaliseIA.addEventListener("click", () => {
  resetarAnaliseIA();
});

btnConfirmarAnaliseIA.addEventListener("click", async () => {
  if (!textoExtraidoParaIA) return;
  const config = await obterConfiguracoes();
  const apiKey = config.provedorIA === "gemini" ? config.chaveGemini : config.chaveClaude;
  const modelo = config.provedorIA === "gemini" ? config.modeloGemini : config.modeloClaude;

  areaEstimativaIA.hidden = true;
  areaProgressoIA.hidden = false;
  textoProgressoIA.textContent = "Aguardando a resposta da IA...";

  chrome.runtime.sendMessage({
    tipo: "ANALISAR_IA_ENVIAR",
    texto: textoExtraidoParaIA,
    promptId: selectPromptIA.value,
    provedor: config.provedorIA,
    modelo,
    apiKey,
  });
});

btnCopiarResultadoIA.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(textoResultadoIA.value);
  } catch (e) {
    textoResultadoIA.select();
    document.execCommand("copy");
  }
});

// ---- Fila em lote (Claude Batches API - processa em até 24h, 50% mais
// barato) ----
//
// Diferente da análise imediata, aqui o TEXTO já é extraído no momento de
// "Adicionar à fila" (o processo pode não estar mais aberto quando o lote
// for de fato enviado) - o background guarda a fila em
// chrome.storage.local, então ela sobrevive a fechar o painel e trocar de
// processo. Só funciona com o provedor Claude (Gemini não tem uma API de
// lote assíncrona equivalente cadastrada aqui ainda).

async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
  } catch (e) {
    const area = document.createElement("textarea");
    area.value = texto;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

function renderizarFilaLoteIA(fila) {
  listaFilaLoteIA.innerHTML = "";
  const itens = fila || [];
  areaFilaLoteVazia.hidden = itens.length > 0;
  listaFilaLoteIA.hidden = itens.length === 0;
  btnEnviarLoteIA.disabled = itens.length === 0;
  btnEnviarLoteIA.textContent = `Enviar lote${itens.length > 0 ? ` (${itens.length})` : ""}`;

  for (const item of itens) {
    const li = document.createElement("li");
    li.className = "item-fila-lote-ia";
    const prompt = PROMPTS_IA_PAINEL.find((p) => p.id === item.promptId);
    li.innerHTML = `
      <span>${item.numeroProcesso} — ${prompt ? prompt.titulo : item.promptId}
        <small>${nomeAmigavelModelo(item.modelo)} — ~${(item.estimativa && item.estimativa.tokensEntradaEstimados || 0).toLocaleString("pt-BR")} tokens, até ${FORMATADOR_USD.format((item.estimativa && item.estimativa.custoEstimadoUsd || 0) * 0.5)} com desconto de lote</small>
      </span>
      <button type="button" class="btn-ghost" data-remover-item="${item.id}">Remover</button>
    `;
    listaFilaLoteIA.appendChild(li);
  }

  listaFilaLoteIA.querySelectorAll("[data-remover-item]").forEach((botao) => {
    botao.addEventListener("click", () => {
      chrome.runtime.sendMessage({ tipo: "IA_LOTE_REMOVER", id: botao.dataset.removerItem });
    });
  });
}

function renderizarLotesEnviadosIA(lotes) {
  listaLotesEnviadosIA.innerHTML = "";
  const itens = lotes || [];
  areaLotesEnviadosVazio.hidden = itens.length > 0;
  listaLotesEnviadosIA.hidden = itens.length === 0;

  for (const lote of [...itens].reverse()) {
    const li = document.createElement("li");
    li.className = "item-lote-ia";

    const contagens = lote.contagens || {};
    const resumoContagens = lote.status === "ended"
      ? `${contagens.succeeded || 0} concluído(s), ${contagens.errored || 0} com erro(s)`
      : "processando...";

    let resultadosHtml = "";
    if (lote.status === "ended") {
      resultadosHtml = (lote.itens || [])
        .map((item) => {
          const resultado = (lote.resultadosPorItem || {})[item.customId];
          if (!resultado) return "";
          const textoResultado = resultado.erro ? `Erro: ${resultado.erro}` : resultado.resposta || "";
          const idResultado = `resultado-lote-${lote.batchId}-${item.customId}`;
          return `
            <div class="resultado-lote-item">
              <p><strong>${item.numeroProcesso}</strong></p>
              <textarea id="${idResultado}" class="campo-resultado-ia" readonly rows="6">${textoResultado.replace(/</g, "&lt;")}</textarea>
              <button type="button" class="btn-secundario" data-copiar-resultado="${idResultado}">Copiar</button>
            </div>
          `;
        })
        .join("");
    }

    li.innerHTML = `
      <details>
        <summary>Lote ${lote.batchId} — ${new Date(lote.criadoEm).toLocaleString("pt-BR")} (${resumoContagens})</summary>
        ${lote.status !== "ended" ? '<button type="button" class="btn-ghost" data-verificar-lote="' + lote.batchId + '">Verificar agora</button>' : ""}
        ${resultadosHtml}
      </details>
    `;
    listaLotesEnviadosIA.appendChild(li);
  }

  listaLotesEnviadosIA.querySelectorAll("[data-verificar-lote]").forEach((botao) => {
    botao.addEventListener("click", () => {
      chrome.runtime.sendMessage({ tipo: "IA_LOTE_VERIFICAR", batchId: botao.dataset.verificarLote });
    });
  });
  listaLotesEnviadosIA.querySelectorAll("[data-copiar-resultado]").forEach((botao) => {
    botao.addEventListener("click", () => {
      const area = document.getElementById(botao.dataset.copiarResultado);
      if (area) copiarTexto(area.value);
    });
  });
}

function atualizarListaCompletaIA() {
  chrome.runtime.sendMessage({ tipo: "IA_LOTE_LISTAR" }).then((resposta) => {
    if (!resposta) return;
    renderizarFilaLoteIA(resposta.fila);
    renderizarLotesEnviadosIA(resposta.lotes);
  });
}

btnAdicionarFilaIA.addEventListener("click", async () => {
  const { documentosSelecionados, movimentacaoParaEnviar } = await obterSelecaoAtualParaEnvio();

  if (documentosSelecionados.length === 0 && movimentacaoParaEnviar.length === 0) {
    areaErrosFilaLoteIA.hidden = false;
    areaErrosFilaLoteIA.textContent =
      "Nada para adicionar à fila: nenhum documento selecionado e a movimentação está excluída.";
    return;
  }

  const config = await obterConfiguracoes();

  areaErrosFilaLoteIA.hidden = true;
  btnAdicionarFilaIA.disabled = true;
  const resposta = await chrome.runtime.sendMessage({
    tipo: "IA_LOTE_ADICIONAR",
    numeroProcesso: estadoAtual.numeroProcesso,
    documentos: documentosSelecionados,
    movimentacao: movimentacaoParaEnviar,
    anonimizar: chkAnonimizarIA.checked,
    promptId: selectPromptIA.value,
    modelo: config.modeloClaude,
  });
  btnAdicionarFilaIA.disabled = false;

  if (resposta && resposta.ok) {
    renderizarFilaLoteIA(resposta.fila);
  } else {
    areaErrosFilaLoteIA.hidden = false;
    areaErrosFilaLoteIA.textContent = (resposta && resposta.erro) || "Falha ao adicionar à fila.";
  }
});

btnEnviarLoteIA.addEventListener("click", async () => {
  const config = await obterConfiguracoes();
  if (!config.chaveClaude) {
    areaErrosFilaLoteIA.hidden = false;
    areaErrosFilaLoteIA.textContent = 'A fila em lote usa a API da Claude - configure a "Chave de API da Claude" nas configurações.';
    return;
  }

  areaErrosFilaLoteIA.hidden = true;
  btnEnviarLoteIA.disabled = true;
  const resposta = await chrome.runtime.sendMessage({ tipo: "IA_LOTE_ENVIAR", apiKey: config.chaveClaude });

  if (resposta && resposta.ok) {
    renderizarFilaLoteIA([]);
    atualizarListaCompletaIA();
  } else {
    areaErrosFilaLoteIA.hidden = false;
    areaErrosFilaLoteIA.textContent = (resposta && resposta.erro) || "Falha ao enviar o lote.";
    btnEnviarLoteIA.disabled = false;
  }
});

const ROTULO_FASE = {
  individuais: "Arquivos individuais",
  "pdf-unico": "PDF único",
  "md-unico": "MD único",
};

// Configurações do painel (engrenagem no cabeçalho) - guardadas em
// chrome.storage.local (não sync: é preferência local deste navegador,
// não precisa seguir o usuário entre máquinas). O valor padrão preserva
// o comportamento de antes dessa opção existir (substituir a sigla já
// era feito sempre). A ordenação alfabética das listas em dropdowns NÃO
// é configurável - é sempre aplicada, direto onde cada dropdown é
// preenchido (handlers de UNIDADES_RELATORIO_FINALIZADO e
// LISTAR_LOCALIZADORES_FINALIZADO mais abaixo).
// Catálogo de modelos espelhado do MODELOS_IA_DISPONIVEIS em background.js
// - só id/nome precisam existir aqui (os preços usados na estimativa de
// custo ficam só no background). O primeiro de cada lista é sempre o mais
// barato, usado como padrão.
const MODELOS_IA_PAINEL = {
  claude: [
    { id: "claude-haiku-4-5", nome: "Claude Haiku 4.5 (mais barato)" },
    { id: "claude-sonnet-5", nome: "Claude Sonnet 5" },
    { id: "claude-sonnet-4-6", nome: "Claude Sonnet 4.6" },
  ],
  gemini: [
    { id: "gemini-3.1-flash-lite", nome: "Gemini 3.1 Flash-Lite (mais barato)" },
    { id: "gemini-3.1-pro", nome: "Gemini 3.1 Pro" },
  ],
};

const CONFIG_PADRAO = {
  substituirSigla: true,
  separarOrgaoJuizoPorComarca: false,
  anexarMagistradoConclusos: true,
  provedorIA: "claude",
  chaveClaude: "",
  chaveGemini: "",
  modeloClaude: MODELOS_IA_PAINEL.claude[0].id,
  modeloGemini: MODELOS_IA_PAINEL.gemini[0].id,
};

function obterConfiguracoes() {
  return new Promise((resolve) => {
    chrome.storage.local.get(CONFIG_PADRAO, (itens) => resolve(itens));
  });
}

function salvarConfiguracao(chave, valor) {
  chrome.storage.local.set({ [chave]: valor });
}

const btnAbrirConfiguracoes = document.getElementById("btn-abrir-configuracoes");
const modalConfiguracoes = document.getElementById("modal-configuracoes");
const chkConfigSubstituirSigla = document.getElementById("chk-config-substituir-sigla");
const chkConfigSepararOrgaoJuizo = document.getElementById("chk-config-separar-orgao-juizo");
const chkConfigAnexarMagistradoConclusos = document.getElementById("chk-config-anexar-magistrado-conclusos");
const modalConfigFechar = document.getElementById("modal-config-fechar");
const radioConfigProvedorClaude = document.getElementById("radio-config-provedor-claude");
const radioConfigProvedorGemini = document.getElementById("radio-config-provedor-gemini");
const inputConfigChaveClaude = document.getElementById("config-chave-claude");
const inputConfigChaveGemini = document.getElementById("config-chave-gemini");
const selectConfigModeloClaude = document.getElementById("select-config-modelo-claude");
const selectConfigModeloGemini = document.getElementById("select-config-modelo-gemini");

for (const modelo of MODELOS_IA_PAINEL.claude) {
  const option = document.createElement("option");
  option.value = modelo.id;
  option.textContent = modelo.nome;
  selectConfigModeloClaude.appendChild(option);
}
for (const modelo of MODELOS_IA_PAINEL.gemini) {
  const option = document.createElement("option");
  option.value = modelo.id;
  option.textContent = modelo.nome;
  selectConfigModeloGemini.appendChild(option);
}

btnAbrirConfiguracoes.addEventListener("click", async () => {
  const config = await obterConfiguracoes();
  chkConfigSubstituirSigla.checked = config.substituirSigla;
  chkConfigSepararOrgaoJuizo.checked = config.separarOrgaoJuizoPorComarca;
  chkConfigAnexarMagistradoConclusos.checked = config.anexarMagistradoConclusos;
  radioConfigProvedorClaude.checked = config.provedorIA !== "gemini";
  radioConfigProvedorGemini.checked = config.provedorIA === "gemini";
  inputConfigChaveClaude.value = config.chaveClaude || "";
  inputConfigChaveGemini.value = config.chaveGemini || "";
  selectConfigModeloClaude.value = config.modeloClaude || CONFIG_PADRAO.modeloClaude;
  selectConfigModeloGemini.value = config.modeloGemini || CONFIG_PADRAO.modeloGemini;
  modalConfiguracoes.hidden = false;
});

selectConfigModeloClaude.addEventListener("change", () => {
  salvarConfiguracao("modeloClaude", selectConfigModeloClaude.value);
});

selectConfigModeloGemini.addEventListener("change", () => {
  salvarConfiguracao("modeloGemini", selectConfigModeloGemini.value);
});

radioConfigProvedorClaude.addEventListener("change", () => {
  if (radioConfigProvedorClaude.checked) salvarConfiguracao("provedorIA", "claude");
});

radioConfigProvedorGemini.addEventListener("change", () => {
  if (radioConfigProvedorGemini.checked) salvarConfiguracao("provedorIA", "gemini");
});

inputConfigChaveClaude.addEventListener("change", () => {
  salvarConfiguracao("chaveClaude", inputConfigChaveClaude.value.trim());
});

inputConfigChaveGemini.addEventListener("change", () => {
  salvarConfiguracao("chaveGemini", inputConfigChaveGemini.value.trim());
});

chkConfigSubstituirSigla.addEventListener("change", () => {
  salvarConfiguracao("substituirSigla", chkConfigSubstituirSigla.checked);
});

chkConfigSepararOrgaoJuizo.addEventListener("change", () => {
  salvarConfiguracao("separarOrgaoJuizoPorComarca", chkConfigSepararOrgaoJuizo.checked);
});

chkConfigAnexarMagistradoConclusos.addEventListener("change", () => {
  salvarConfiguracao("anexarMagistradoConclusos", chkConfigAnexarMagistradoConclusos.checked);
});

modalConfigFechar.addEventListener("click", () => {
  modalConfiguracoes.hidden = true;
});

// ---- Gerenciar prompts de análise (editar, excluir, cadastrar) ----
const btnAbrirGerenciarPrompts = document.getElementById("btn-abrir-gerenciar-prompts");
const modalGerenciarPrompts = document.getElementById("modal-gerenciar-prompts");
const modalGerenciarPromptsFechar = document.getElementById("modal-gerenciar-prompts-fechar");
const listaPromptsIA = document.getElementById("lista-prompts-ia");
const tituloFormPrompt = document.getElementById("titulo-form-prompt");
const inputPromptTitulo = document.getElementById("input-prompt-titulo");
const inputPromptTexto = document.getElementById("input-prompt-texto");
const btnSalvarPrompt = document.getElementById("btn-salvar-prompt");
const btnCancelarEdicaoPrompt = document.getElementById("btn-cancelar-edicao-prompt");
const areaErrosPrompt = document.getElementById("area-erros-prompt");

let promptEmEdicaoId = null;

function limparFormularioPrompt() {
  promptEmEdicaoId = null;
  tituloFormPrompt.textContent = "Novo prompt";
  inputPromptTitulo.value = "";
  inputPromptTexto.value = "";
  btnCancelarEdicaoPrompt.hidden = true;
  areaErrosPrompt.hidden = true;
}

function renderizarListaPromptsIA() {
  listaPromptsIA.innerHTML = "";
  for (const prompt of PROMPTS_IA_PAINEL) {
    const li = document.createElement("li");
    li.className = "item-fila-lote-ia";
    li.innerHTML = `
      <span>${prompt.titulo}</span>
      <span>
        <button type="button" class="btn-ghost" data-editar-prompt="${prompt.id}">Editar</button>
        <button type="button" class="btn-ghost" data-excluir-prompt="${prompt.id}">Excluir</button>
      </span>
    `;
    listaPromptsIA.appendChild(li);
  }

  listaPromptsIA.querySelectorAll("[data-editar-prompt]").forEach((botao) => {
    botao.addEventListener("click", () => {
      const prompt = PROMPTS_IA_PAINEL.find((p) => p.id === botao.dataset.editarPrompt);
      if (!prompt) return;
      promptEmEdicaoId = prompt.id;
      tituloFormPrompt.textContent = `Editando: ${prompt.titulo}`;
      inputPromptTitulo.value = prompt.titulo;
      inputPromptTexto.value = prompt.texto;
      btnCancelarEdicaoPrompt.hidden = false;
      areaErrosPrompt.hidden = true;
    });
  });

  listaPromptsIA.querySelectorAll("[data-excluir-prompt]").forEach((botao) => {
    botao.addEventListener("click", async () => {
      const prompt = PROMPTS_IA_PAINEL.find((p) => p.id === botao.dataset.excluirPrompt);
      if (!prompt) return;
      if (!confirm(`Excluir o prompt "${prompt.titulo}"? Essa ação não pode ser desfeita.`)) return;

      const resposta = await chrome.runtime.sendMessage({ tipo: "PROMPTS_IA_REMOVER", id: prompt.id });
      if (resposta && resposta.ok) {
        PROMPTS_IA_PAINEL = resposta.prompts;
        atualizarSelectPromptIA();
        renderizarListaPromptsIA();
        if (promptEmEdicaoId === prompt.id) limparFormularioPrompt();
      } else {
        areaErrosPrompt.hidden = false;
        areaErrosPrompt.textContent = (resposta && resposta.erro) || "Falha ao excluir o prompt.";
      }
    });
  });
}

btnAbrirGerenciarPrompts.addEventListener("click", async () => {
  limparFormularioPrompt();
  await atualizarPromptsIA();
  modalGerenciarPrompts.hidden = false;
});

btnSalvarPrompt.addEventListener("click", async () => {
  const titulo = inputPromptTitulo.value.trim();
  const texto = inputPromptTexto.value.trim();
  if (!titulo || !texto) {
    areaErrosPrompt.hidden = false;
    areaErrosPrompt.textContent = "Preencha o título e o texto do prompt.";
    return;
  }

  const resposta = await chrome.runtime.sendMessage({
    tipo: "PROMPTS_IA_SALVAR",
    prompt: { id: promptEmEdicaoId, titulo, texto },
  });

  if (resposta && resposta.ok) {
    PROMPTS_IA_PAINEL = resposta.prompts;
    atualizarSelectPromptIA();
    renderizarListaPromptsIA();
    limparFormularioPrompt();
  } else {
    areaErrosPrompt.hidden = false;
    areaErrosPrompt.textContent = (resposta && resposta.erro) || "Falha ao salvar o prompt.";
  }
});

btnCancelarEdicaoPrompt.addEventListener("click", () => {
  limparFormularioPrompt();
});

modalGerenciarPromptsFechar.addEventListener("click", () => {
  modalGerenciarPrompts.hidden = true;
});

let estadoAtual = { numeroProcesso: null, documentos: [], movimentacao: [], movimentacaoIncluida: true };

// Os tres modos sao mutuamente exclusivos (radio buttons), entao sempre
// ha' exatamente um marcado. O botao "Baixar" fica habilitado se houver
// documentos OU movimentacao detectados - o "MD único" sozinho consegue
// gerar um arquivo so' com a movimentação, mesmo sem nenhum documento
// anexado.
function atualizarEstadoBotaoBaixar() {
  const temDocumentos = estadoAtual.documentos.length > 0;
  const temMovimentacao = estadoAtual.movimentacao.length > 0;
  btnBaixar.disabled = !temDocumentos && !temMovimentacao;
}

// "Arquivos individuais" e "PDF único" não tem o que gerar sem nenhum
// documento anexado - reaplicado tanto apos detectar quanto apos um
// download terminar, para nao reabilitar por engano essas duas opcoes
// quando o processo so' tem movimentação.
function atualizarEstadoRadiosConformeDocumentos() {
  const semDocumentos = estadoAtual.documentos.length === 0;
  radioIndividuais.disabled = semDocumentos;
  radioPdfUnico.disabled = semDocumentos;
  radioMdUnico.disabled = false;
}

// O aviso sobre extração de texto/anonimização so' aparece quando esse
// modo esta' selecionado, para nao poluir a interface quando o usuario
// nao vai usa-lo.
function atualizarAvisoMdUnico() {
  avisoMdUnico.hidden = !radioMdUnico.checked;
}
radioIndividuais.addEventListener("change", atualizarAvisoMdUnico);
radioPdfUnico.addEventListener("change", atualizarAvisoMdUnico);
radioMdUnico.addEventListener("change", atualizarAvisoMdUnico);

// Cronometro discreto: mede quanto tempo uma operacao que gera ARQUIVO
// EXTERNO (PDF/Excel/documentos baixados) esta' levando, mostrado ao
// lado do proprio texto de status (sem UI separada). So' liga para quem
// chama "iniciarCronometroStatus" explicitamente ANTES da primeira
// mensagem de andamento - simples carregamento/leitura de informacao
// (Carregar unidades, Carregar localizadores, Gerar relatório-painel,
// Navegar/Abrir tela) nunca liga o cronometro, so' os botoes que de fato
// baixam um arquivo no fim (Exportar Documentos, Exportar Relatório,
// Exportar Regras, Exportar Localizadores, Exportar processos/documentos
// do localizador). Uma entrada por elemento de status - cada area de
// progresso do painel tem a sua propria contagem independente.
const cronometros = new WeakMap();
const LIMITE_CRONOMETRO_SEGUNDOS = 600; // trava o ticking apos 10min (operacao "orfa", sem ok/erro final)

function formatarDuracao(segundos) {
  if (segundos < 60) return `${segundos}s`;
  const minutos = Math.floor(segundos / 60);
  const resto = segundos % 60;
  return `${minutos}min ${resto}s`;
}

function renderizarStatusComCronometro(el, cron) {
  el.textContent = "";
  el.appendChild(document.createTextNode(el.dataset.statusTexto || ""));
  if (cron) {
    const tempo = document.createElement("span");
    tempo.className = "status-tempo";
    tempo.textContent = ` (${formatarDuracao(Math.round((Date.now() - cron.inicio) / 1000))})`;
    el.appendChild(tempo);
  }
}

// Liga o cronometro de uma area de status - chamado so' pelos handlers de
// clique que de fato geram um arquivo para baixar, logo antes da
// primeira mensagem "Iniciando..."/"Gerando..." daquele fluxo. Idempotente
// (chamar de novo com um cronometro ja' rodando não reinicia a contagem).
function iniciarCronometroStatus(el) {
  if (cronometros.has(el)) return;
  const cron = { inicio: Date.now() };
  cron.intervalId = setInterval(() => {
    if (Date.now() - cron.inicio > LIMITE_CRONOMETRO_SEGUNDOS * 1000) {
      clearInterval(cron.intervalId);
      return;
    }
    renderizarStatusComCronometro(el, cron);
  }, 1000);
  cronometros.set(el, cron);
}

// Aplica texto + estado visual a uma area de status. "tipo" opcional:
// "ok" (verde, operacao concluida), "erro" (vermelho) ou ausente
// (neutro, andamento/ajuda). Compartilhado por todos os setStatus* do
// painel, para sucesso e erro terem cara de sucesso e erro em vez de
// ficarem identicos ao texto de ajuda. So' mexe no cronometro para
// DESLIGAR (mostrando o total decorrido) quando chega um "ok"/"erro" e
// havia um rodando - nunca liga um cronometro sozinho (ver
// "iniciarCronometroStatus").
function aplicarStatus(el, texto, tipo, abrirCartao = true) {
  const finalizado = tipo === "ok" || tipo === "erro";
  el.dataset.statusTexto = texto;

  const cron = cronometros.get(el);
  if (finalizado && cron) {
    clearInterval(cron.intervalId);
    cronometros.delete(el);
  }

  renderizarStatusComCronometro(el, cron);
  el.classList.toggle("status--ok", tipo === "ok");
  el.classList.toggle("status--erro", tipo === "erro");
  // Atividade numa secao (progresso/resultado/erro) abre o cartao dela,
  // para nada acontecer escondido atras de um cartao colapsado - so'
  // quando "abrirCartao" nao foi explicitamente desligado (ver "setStatus",
  // que atualiza DUAS areas de status ao mesmo tempo mas so' deve abrir o
  // cartao de quem realmente originou a acao).
  if (abrirCartao) abrirCartaoDe(el);
}

// Garante que o cartao (details) que contem o elemento esteja aberto -
// chamado ao iniciar operacoes/receber resultados, para o usuario nunca
// perder um progresso ou erro escondido num cartao colapsado.
// Sobe por TODOS os <details> ancestrais (nao so' o mais proximo) - o
// cartão "Gestão Gabinete" tem subseções colapsáveis próprias (<details>
// aninhado dentro do <details> do cartão), entao atividade lá dentro
// precisa abrir tanto a subseção quanto o cartão em si.
function abrirCartaoDe(el) {
  let atual = el.closest("details");
  while (atual) {
    atual.open = true;
    atual = atual.parentElement ? atual.parentElement.closest("details") : null;
  }
}

// Aplica em AMBOS os status ("Exportar Documentos" e "Analisar com IA") -
// as duas subseções compartilham a mesma detecção/seleção de documentos,
// então mostram sempre a mesma mensagem. So' abre o CARTAO de quem
// originou a acao ("origem": "exportar", padrão, ou "ia") - sem isso,
// detectar pela subseção "Analisar com IA" abriria também "Exportar
// Documentos" (e vice-versa), já que as duas áreas de status são
// atualizadas juntas.
function setStatus(texto, tipo, origem = "exportar") {
  aplicarStatus(areaStatus, texto, tipo, origem !== "ia");
  aplicarStatus(areaStatusIA, texto, tipo, origem === "ia");
}

async function getAbaAtiva() {
  const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
  return aba;
}

// Envia a selecao (documento individual ou "todos") para o content
// script, que reflete no(s) checkbox(es) injetado(s) na propria pagina
// do processo - mantem a pagina e o painel em sincronia nos dois
// sentidos. Silencioso se a aba nao responder (ex.: usuario navegou
// para outro lugar) - a selecao so' fica desatualizada ate' o proximo
// "Detectar", sem travar a interacao no painel.
async function enviarSelecaoDocumentoParaPagina(idDocumento, selecionado) {
  try {
    const aba = await getAbaAtiva();
    await chrome.tabs.sendMessage(aba.id, { tipo: "DEFINIR_SELECAO_DOCUMENTO", idDocumento, selecionado });
  } catch (e) {
    /* aba sem content script ativo - segue so' com o estado local */
  }
}

async function enviarSelecaoTodosDocumentosParaPagina(selecionado) {
  try {
    const aba = await getAbaAtiva();
    await chrome.tabs.sendMessage(aba.id, { tipo: "DEFINIR_SELECAO_TODOS_DOCUMENTOS", selecionado });
  } catch (e) {
    /* aba sem content script ativo - segue so' com o estado local */
  }
}

// "Exportar Documentos" e "Analisar com IA" mostram a MESMA lista/seleção
// de documentos (compartilham "estadoAtual") - só a UI é repetida nas duas
// subseções, por isso toda renderização/atualização de checkbox acontece
// nos dois containers ao mesmo tempo.
const CONTAINERS_LISTA_DOCUMENTOS = [listaDocumentosEl, listaDocumentosIAEl];

function renderizarLista(documentos) {
  for (const container of CONTAINERS_LISTA_DOCUMENTOS) {
    container.innerHTML = "";
    for (const doc of documentos) {
      const li = document.createElement("li");
      li.dataset.idDocumento = doc.idDocumento;

      const rotulo = document.createElement("label");
      rotulo.className = "item-documento";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = doc.selecionado !== false;
      checkbox.addEventListener("change", () => {
        doc.selecionado = checkbox.checked;
        atualizarCheckboxNaListaDocumentos(doc.idDocumento, checkbox.checked);
        enviarSelecaoDocumentoParaPagina(doc.idDocumento, checkbox.checked);
      });
      rotulo.appendChild(checkbox);

      const nome = document.createElement("span");
      nome.textContent = doc.nome;
      rotulo.appendChild(nome);

      const tipo = document.createElement("span");
      tipo.className = "tipo";
      tipo.textContent = doc.mimetype || "";

      li.appendChild(rotulo);
      li.appendChild(tipo);
      container.appendChild(li);
    }
  }
}

// Atualiza so' o checkbox de UM item da lista, nos DOIS containers (sem
// reconstruir a lista inteira, o que resetaria a posição do scroll) -
// usado tanto quando o usuário marca/desmarca num dos containers (para
// refletir no outro) quanto quando o painel recebe um aviso de que a
// seleção mudou direto na página (ver "SELECAO_DOCUMENTO_ALTERADA_NA_PAGINA"
// mais abaixo).
function atualizarCheckboxNaListaDocumentos(idDocumento, selecionado) {
  for (const container of CONTAINERS_LISTA_DOCUMENTOS) {
    const li = container.querySelector(`li[data-id-documento="${CSS.escape(idDocumento)}"]`);
    const checkbox = li && li.querySelector('input[type="checkbox"]');
    if (checkbox) checkbox.checked = selecionado;
  }
}

function marcarTodosDocumentos(selecionado) {
  estadoAtual.documentos.forEach((doc) => {
    doc.selecionado = selecionado;
  });
  renderizarLista(estadoAtual.documentos);
  enviarSelecaoTodosDocumentosParaPagina(selecionado);
}

btnMarcarTudoDocumentos.addEventListener("click", () => marcarTodosDocumentos(true));
btnDesmarcarTudoDocumentos.addEventListener("click", () => marcarTodosDocumentos(false));
btnMarcarTudoDocumentosIA.addEventListener("click", () => marcarTodosDocumentos(true));
btnDesmarcarTudoDocumentosIA.addEventListener("click", () => marcarTodosDocumentos(false));

// Mesmo padrao de sincronizacao dos documentos, so' que para o
// checkbox UNICO "incluir a movimentacao" (a linha do tempo entra ou sai
// da exportacao como um todo, nao evento por evento).
async function enviarSelecaoMovimentacaoParaPagina(incluida) {
  try {
    const aba = await getAbaAtiva();
    await chrome.tabs.sendMessage(aba.id, { tipo: "DEFINIR_SELECAO_MOVIMENTACAO", incluida });
  } catch (e) {
    /* aba sem content script ativo - segue so' com o estado local */
  }
}

function definirMovimentacaoIncluida(incluida) {
  estadoAtual.movimentacaoIncluida = incluida;
  chkIncluirMovimentacao.checked = incluida;
  chkIncluirMovimentacaoIA.checked = incluida;
  enviarSelecaoMovimentacaoParaPagina(incluida);
}

chkIncluirMovimentacao.addEventListener("change", () => definirMovimentacaoIncluida(chkIncluirMovimentacao.checked));
chkIncluirMovimentacaoIA.addEventListener("change", () => definirMovimentacaoIncluida(chkIncluirMovimentacaoIA.checked));

// Compartilhada pelos dois botões "Detectar documentos" ("Exportar
// Documentos" e "Analisar com IA") - as duas subseções mostram a mesma
// detecção/seleção, só a UI é repetida.
async function executarDeteccao(origem = "exportar") {
  areaErros.hidden = true;
  setStatus("Detectando documentos na pagina...", undefined, origem);
  try {
    const aba = await getAbaAtiva();
    const resposta = await chrome.tabs.sendMessage(aba.id, { tipo: "LISTAR_DOCUMENTOS" });

    const documentos = (resposta && resposta.documentos) || [];
    const movimentacao = (resposta && resposta.movimentacao) || [];

    if (!resposta || (documentos.length === 0 && movimentacao.length === 0)) {
      setStatus(
        "Nenhum documento nem movimentação encontrados. Confirme que você está na página de detalhes do processo no eproc.",
        undefined,
        origem
      );
      estadoAtual = { numeroProcesso: null, documentos: [], movimentacao: [], movimentacaoIncluida: true };
      atualizarEstadoBotaoBaixar();
      areaProcesso.hidden = true;
      areaProcessoIA.hidden = true;
      areaOpcoes.hidden = true;
      areaMarcarDocumentos.hidden = true;
      areaMarcarDocumentosIA.hidden = true;
      areaIncluirMovimentacao.hidden = true;
      areaIncluirMovimentacaoIA.hidden = true;
      listaDocumentosEl.hidden = true;
      listaDocumentosEl.innerHTML = "";
      listaDocumentosIAEl.hidden = true;
      listaDocumentosIAEl.innerHTML = "";
      areaAnaliseIA.hidden = true;
      resetarAnaliseIA();
      return;
    }

    const movimentacaoIncluida = resposta.movimentacaoIncluida !== false;
    estadoAtual = { numeroProcesso: resposta.numeroProcesso, documentos, movimentacao, movimentacaoIncluida };
    numeroProcessoEl.textContent = resposta.numeroProcesso;
    totalDocumentosEl.textContent = String(documentos.length);
    numeroProcessoIAEl.textContent = resposta.numeroProcesso;
    totalDocumentosIAEl.textContent = String(documentos.length);
    areaProcesso.hidden = false;
    areaProcessoIA.hidden = false;
    areaOpcoes.hidden = false;
    areaAnaliseIA.hidden = false;
    resetarAnaliseIA();

    // Sem nenhum documento anexado (so' movimentação), os modos
    // "Arquivos individuais" e "PDF único" não têm o que gerar - só "MD
    // único" consegue produzir algo (a linha do tempo de movimentação).
    const semDocumentos = documentos.length === 0;
    atualizarEstadoRadiosConformeDocumentos();
    if (semDocumentos) {
      radioMdUnico.checked = true;
    }
    atualizarAvisoMdUnico();

    // O checkbox so' faz sentido quando ha' movimentação para incluir ou
    // excluir - sem nenhum evento detectado, não há nada para alternar.
    areaIncluirMovimentacao.hidden = movimentacao.length === 0;
    areaIncluirMovimentacaoIA.hidden = movimentacao.length === 0;
    chkIncluirMovimentacao.checked = movimentacaoIncluida;
    chkIncluirMovimentacaoIA.checked = movimentacaoIncluida;

    if (semDocumentos) {
      listaDocumentosEl.hidden = true;
      listaDocumentosEl.innerHTML = "";
      listaDocumentosIAEl.hidden = true;
      listaDocumentosIAEl.innerHTML = "";
      areaMarcarDocumentos.hidden = true;
      areaMarcarDocumentosIA.hidden = true;
    } else {
      listaDocumentosEl.hidden = false;
      listaDocumentosIAEl.hidden = false;
      areaMarcarDocumentos.hidden = false;
      areaMarcarDocumentosIA.hidden = false;
      renderizarLista(documentos);
    }

    atualizarEstadoBotaoBaixar();
    setStatus(
      semDocumentos
        ? `Nenhum documento anexado, mas ${movimentacao.length} evento(s) de movimentação encontrado(s) - só "MD único" está disponível.`
        : 'Documentos detectados. Escolha o que baixar e clique em "Baixar".',
      undefined,
      origem
    );
  } catch (e) {
    setStatus(
      "Nao foi possivel ler a pagina. Verifique se voce esta em uma pagina de processo do eproc e tente novamente.",
      undefined,
      origem
    );
  }
}

btnDetectar.addEventListener("click", () => executarDeteccao("exportar"));
btnDetectarIA.addEventListener("click", () => executarDeteccao("ia"));

// Confere o estado ATUAL dos checkboxes direto na página do processo antes
// de usar a seleção - cobre o caso do usuário ter ajustado a seleção lá
// (marcar/desmarcar um documento, ou o checkbox de movimentação) depois do
// último "Detectar", sem precisar clicar em "Detectar" de novo só para
// isso. Sem resposta da aba (ex.: usuário navegou para outro lugar), cai
// para o que já está marcado no próprio painel. Compartilhada entre
// "Baixar" e "Analisar com IA", que partem da mesma seleção de documentos.
async function obterSelecaoAtualParaEnvio() {
  let idsSelecionados = null;
  try {
    const aba = await getAbaAtiva();
    const resposta = await chrome.tabs.sendMessage(aba.id, { tipo: "OBTER_SELECAO_DOCUMENTOS" });
    if (resposta && Array.isArray(resposta.selecionados)) {
      idsSelecionados = new Set(resposta.selecionados);
    }
  } catch (e) {
    /* segue com a seleção já conhecida pelo painel */
  }

  const documentosSelecionados = idsSelecionados
    ? estadoAtual.documentos.filter((doc) => idsSelecionados.has(doc.idDocumento))
    : estadoAtual.documentos.filter((doc) => doc.selecionado !== false);

  let movimentacaoIncluida = estadoAtual.movimentacaoIncluida !== false;
  try {
    const aba = await getAbaAtiva();
    const respostaMov = await chrome.tabs.sendMessage(aba.id, { tipo: "OBTER_SELECAO_MOVIMENTACAO" });
    if (respostaMov && typeof respostaMov.incluida === "boolean") {
      movimentacaoIncluida = respostaMov.incluida;
    }
  } catch (e) {
    /* segue com a seleção já conhecida pelo painel */
  }
  const movimentacaoParaEnviar = movimentacaoIncluida ? estadoAtual.movimentacao : [];

  return { documentosSelecionados, movimentacaoParaEnviar };
}

btnBaixar.addEventListener("click", async () => {
  if (!estadoAtual.documentos.length && !estadoAtual.movimentacao.length) return;

  const { documentosSelecionados, movimentacaoParaEnviar } = await obterSelecaoAtualParaEnvio();

  const opcoes = {
    individuais: radioIndividuais.checked,
    pdfUnico: radioPdfUnico.checked,
    mdUnico: radioMdUnico.checked,
  };

  // "MD único" ainda consegue gerar algo só com a movimentação, mesmo
  // sem nenhum documento selecionado - mas os outros dois modos não têm
  // o que baixar sem ao menos 1 documento marcado.
  if (documentosSelecionados.length === 0 && estadoAtual.documentos.length > 0 && !opcoes.mdUnico) {
    setStatus(
      'Nenhum documento selecionado. Marque ao menos um documento (na lista abaixo ou na própria página do processo), ou use "MD único" para exportar só a movimentação.',
      "erro"
    );
    return;
  }

  // Sem nenhum documento selecionado E com a movimentação excluída, "MD
  // único" também não tem mais nada para gerar.
  if (documentosSelecionados.length === 0 && !movimentacaoParaEnviar.length && opcoes.mdUnico) {
    setStatus(
      "Nada para exportar: nenhum documento selecionado e a movimentação está excluída. Marque ao menos um documento ou inclua a movimentação.",
      "erro"
    );
    return;
  }

  btnBaixar.disabled = true;
  btnDetectar.disabled = true;
  radioIndividuais.disabled = true;
  radioPdfUnico.disabled = true;
  radioMdUnico.disabled = true;
  areaProgresso.hidden = false;
  barraProgresso.value = 0;
  barraProgresso.max = Math.max(documentosSelecionados.length, 1);
  textoProgresso.textContent = `0 / ${documentosSelecionados.length}`;
  areaErros.hidden = true;
  iniciarCronometroStatus(areaStatus);
  setStatus("Baixando...");

  chrome.runtime.sendMessage({
    tipo: "BAIXAR_DOCUMENTOS",
    numeroProcesso: estadoAtual.numeroProcesso,
    documentos: documentosSelecionados,
    movimentacao: movimentacaoParaEnviar,
    opcoes,
  });
});

const cardCorregedoria = document.getElementById("card-corregedoria");
const areaCorregedoriaInfo = document.getElementById("area-corregedoria-info");
const btnRelatorioGerencialUnidade = document.getElementById("btn-relatorio-gerencial-unidade");
const areaProgressoUnidades = document.getElementById("area-progresso-unidades");
const textoProgressoUnidades = document.getElementById("texto-progresso-unidades");
const areaSelectComarca = document.getElementById("area-select-comarca");
const selectComarcaRelatorio = document.getElementById("select-comarca-relatorio");
const areaSelectUnidade = document.getElementById("area-select-unidade");
const selectUnidadeRelatorio = document.getElementById("select-unidade-relatorio");
const areaUnidadeSelecionada = document.getElementById("area-unidade-selecionada");
const areaPersonalizarRelatorio = document.getElementById("area-personalizar-relatorio");
const chkRelProcessosAtivos = document.getElementById("chk-rel-processos-ativos");
const chkRelSuspensos = document.getElementById("chk-rel-suspensos");
const chkRelConclusosDecisao = document.getElementById("chk-rel-conclusos-decisao");
const chkRelConclusosSentenca = document.getElementById("chk-rel-conclusos-sentenca");
const chkRelSemMovimentacao = document.getElementById("chk-rel-sem-movimentacao");
const chkRelParalisados = document.getElementById("chk-rel-paralisados");
const chkRelRemessasJuizesLeigos = document.getElementById("chk-rel-remessas-juizes-leigos");
const chkRelRegrasAutomacao = document.getElementById("chk-rel-regras-automacao");
const chkRelLocalizadores = document.getElementById("chk-rel-localizadores");
const btnMarcarTudoRelatorio = document.getElementById("btn-marcar-tudo-relatorio");
const btnDesmarcarTudoRelatorio = document.getElementById("btn-desmarcar-tudo-relatorio");
const areaBtnExportarGerencial = document.getElementById("area-btn-exportar-gerencial");
const btnExportarRelatorioGerencial = document.getElementById("btn-exportar-relatorio-gerencial");
const areaProgressoRelatorioGerencial = document.getElementById("area-progresso-relatorio-gerencial");
const textoProgressoRelatorioGerencial = document.getElementById("texto-progresso-relatorio-gerencial");
const areaBtnCompararUnidades = document.getElementById("area-btn-comparar-unidades");
const btnCompararUnidades = document.getElementById("btn-comparar-unidades");
const areaProgressoComparacaoUnidades = document.getElementById("area-progresso-comparacao-unidades");
const textoProgressoComparacaoUnidades = document.getElementById("texto-progresso-comparacao-unidades");
// Relatório Geral (panorama) desativado por enquanto - ver comentário em
// popup.html no lugar do botão. Refs comentadas junto para não quebrar
// (document.getElementById de um id que não existe mais no DOM).
// const btnRelatorioPanoramico = document.getElementById("btn-relatorio-panoramico");
// const areaProgressoPanoramico = document.getElementById("area-progresso-panoramico");
// const textoProgressoPanoramico = document.getElementById("texto-progresso-panoramico");
const areaErrosCorregedoria = document.getElementById("area-erros-corregedoria");

// As unidades escolhidas no dropdown (nome + valor do filtro Órgão/Juízo,
// uma ou mais - o select agora e' multiplo) - e' o "campo com a escolha
// da unidade" que todo relatório deste painel da Corregedoria precisa
// conferir antes de rodar (ver "exigirUnidadesSelecionadas" abaixo).
// Cada item: { valor, nome }.
let unidadesSelecionadasCorregedoria = [];

// Algumas comarcas do Paraná tem "de" no PRÓPRIO nome (ex.: "Cândido de
// Abreu") - separar pelo ÚLTIMO " de " cortaria errado nesses casos (ex.:
// "... do Juízo Único de Cândido de Abreu" viraria comarca "Abreu" em vez
// de "Cândido de Abreu", já que o último " de " fica DENTRO do próprio
// nome da comarca). Lista de exceções conhecidas: quando o nome termina
// com uma delas, a comarca é a exceção inteira, sem tentar nenhum split.
const COMARCAS_COM_DE_NO_NOME = ["Cândido de Abreu", "Primeiro de Maio"];

// Nomes de unidade do eproc seguem o padrão "<Juízo/Vara> de <Comarca>"
// (ex.: "Juizado Especial Cível, Criminal e da Fazenda Pública de
// Piraquara") - separa a Comarca (tudo depois do ÚLTIMO " de ") do nome
// do Juízo/Vara propriamente dito, para o painel poder oferecer uma
// escolha em duas etapas (Comarca primeiro, Juízo depois) em vez de uma
// lista única com centenas de unidades. Se o padrão não for encontrado
// (nome sem " de " nenhum), a unidade cai numa comarca "(Outras)" e o
// nome completo é mantido como está.
function separarComarcaDoJuizo(nomeCompleto) {
  const texto = (nomeCompleto || "").trim();

  for (const comarcaExcecao of COMARCAS_COM_DE_NO_NOME) {
    const sufixo = ` de ${comarcaExcecao}`;
    if (texto.toLowerCase().endsWith(sufixo.toLowerCase())) {
      return {
        comarca: comarcaExcecao,
        juizo: texto.slice(0, texto.length - sufixo.length).trim() || texto,
      };
    }
  }

  const marcador = " de ";
  const indice = texto.lastIndexOf(marcador);
  if (indice === -1) {
    return { comarca: "(Outras)", juizo: texto };
  }
  return {
    comarca: texto.slice(indice + marcador.length).trim() || "(Outras)",
    juizo: texto.slice(0, indice).trim() || texto,
  };
}

// Lista bruta (valor + nome completo) recebida de UNIDADES_RELATORIO_FINALIZADO,
// já com comarca/juízo separados - guardada para filtrar o select de
// Juízo quando uma Comarca é escolhida, sem precisar pedir a lista de
// novo ao eproc a cada troca.
let unidadesRelatorioCorregedoria = [];

function setStatusCorregedoria(texto, tipo) {
  aplicarStatus(areaCorregedoriaInfo, texto, tipo);
}

// Todo relatório do painel da Corregedoria (hoje so' o Relatório
// Gerencial da Unidade consolidado, mas a mesma checagem vale para
// qualquer outro que venha a ser adicionado aqui) precisa conferir se
// ao menos uma unidade foi escolhida antes de rodar - lanca erro com uma
// mensagem clara em vez de deixar a operacao seguir sem saber de qual(is)
// unidade(s) extrair os dados. Retorna sempre um array (1+ unidades),
// ja' que o select agora permite escolher varias.
function exigirUnidadesSelecionadas() {
  if (!unidadesSelecionadasCorregedoria || unidadesSelecionadasCorregedoria.length === 0) {
    throw new Error('Selecione ao menos uma unidade na lista antes de gerar este relatório.');
  }
  return unidadesSelecionadasCorregedoria;
}

// O cartão "Corregedoria" so' aparece quando o perfil ativo da aba atual
// (select#selInfraUnidades no cabecalho do eproc) e' "CORREGEDORIA" -
// reavaliado sempre que o usuario troca de aba ou navega, ja' que o
// painel lateral permanece aberto durante isso.
async function atualizarCardCorregedoria() {
  try {
    const aba = await getAbaAtiva();
    if (!aba || !aba.id) {
      cardCorregedoria.hidden = true;
      return;
    }
    const resposta = await chrome.tabs.sendMessage(aba.id, { tipo: "LER_PERFIL_ATUAL" }).catch(() => null);
    const ehCorregedoria = Boolean(resposta && resposta.perfil === "CORREGEDORIA");
    cardCorregedoria.hidden = !ehCorregedoria;
  } catch (e) {
    cardCorregedoria.hidden = true;
  }
}

btnRelatorioGerencialUnidade.addEventListener("click", async () => {
  // Some assim que clicado - so' serve para um carregamento inicial (o
  // dropdown de unidades que ele preenche continua ali depois); manter o
  // botao visivel (so' desabilitado) enquanto ja' tem uma lista carregada
  // parecia sugerir que clicar de novo faria algo diferente. So' volta a
  // aparecer se der erro, para o usuario poder tentar de novo.
  btnRelatorioGerencialUnidade.hidden = true;
  areaErrosCorregedoria.hidden = true;
  areaSelectComarca.hidden = true;
  areaSelectUnidade.hidden = true;
  areaUnidadeSelecionada.hidden = true;
  areaPersonalizarRelatorio.hidden = true;
  areaBtnExportarGerencial.hidden = true;
  areaBtnCompararUnidades.hidden = true;
  unidadesSelecionadasCorregedoria = [];
  areaProgressoUnidades.hidden = false;
  textoProgressoUnidades.textContent = "Iniciando...";
  setStatusCorregedoria("Abrindo o Relatório Geral e lendo as unidades disponíveis (sua aba atual será navegada)...");

  // Mesmo padrao das demais operacoes em segundo plano: so' confirma que
  // comecou; o resultado final chega pela mensagem
  // UNIDADES_RELATORIO_FINALIZADO.
  try {
    const resposta = await chrome.runtime.sendMessage({ tipo: "LISTAR_UNIDADES_RELATORIO_GERAL" });
    if (!resposta || !resposta.ok) {
      throw new Error((resposta && resposta.erro) || "Falha desconhecida ao iniciar o carregamento.");
    }
  } catch (e) {
    setStatusCorregedoria("Erro ao carregar as unidades.", "erro");
    areaErrosCorregedoria.hidden = false;
    areaErrosCorregedoria.textContent = e && e.message ? e.message : String(e);
    areaProgressoUnidades.hidden = true;
    btnRelatorioGerencialUnidade.hidden = false;
  }
});

// Ao escolher uma Comarca, preenche o select de Juízo/Vara so' com as
// unidades daquela comarca (mostrando o nome SEM o sufixo "de <Comarca>",
// ja' que a comarca escolhida acima deixa isso implicito e repetir so'
// deixaria a lista mais poluida).
selectComarcaRelatorio.addEventListener("change", () => {
  const comarca = selectComarcaRelatorio.value;
  unidadesSelecionadasCorregedoria = [];
  areaUnidadeSelecionada.hidden = true;
  areaPersonalizarRelatorio.hidden = true;
  areaBtnExportarGerencial.hidden = true;
  areaBtnCompararUnidades.hidden = true;

  selectUnidadeRelatorio.innerHTML = '<option value="" disabled>Selecione um juízo/vara...</option>';
  if (!comarca) {
    areaSelectUnidade.hidden = true;
    return;
  }

  const unidadesDaComarca = unidadesRelatorioCorregedoria
    .filter((u) => u.comarca === comarca)
    .sort((a, b) => a.juizo.localeCompare(b.juizo, "pt-BR"));
  for (const unidade of unidadesDaComarca) {
    const opcao = document.createElement("option");
    opcao.value = unidade.valor;
    opcao.textContent = unidade.juizo;
    opcao.dataset.nomeCompleto = unidade.texto;
    selectUnidadeRelatorio.appendChild(opcao);
  }
  areaSelectUnidade.hidden = false;
});

// Ao escolher uma ou mais unidades no dropdown (agora multiplo), preenche
// o campo indicando de onde a informação será extraída (e' esse campo
// que "exigirUnidadesSelecionadas" confere antes de qualquer relatório
// deste painel) e libera o botao de exportar o(s) relatorio(s)
// consolidado(s) - um PDF por unidade, gerados em sequência.
selectUnidadeRelatorio.addEventListener("change", () => {
  const opcoesSelecionadas = Array.from(selectUnidadeRelatorio.selectedOptions).filter((o) => o.value);
  if (opcoesSelecionadas.length === 0) {
    unidadesSelecionadasCorregedoria = [];
    areaUnidadeSelecionada.hidden = true;
    areaPersonalizarRelatorio.hidden = true;
    areaBtnExportarGerencial.hidden = true;
    areaBtnCompararUnidades.hidden = true;
    return;
  }
  unidadesSelecionadasCorregedoria = opcoesSelecionadas.map((opcaoSelecionada) => ({
    valor: opcaoSelecionada.value,
    // O nome completo original (com "de <Comarca>") e' o que identifica a
    // unidade sem ambiguidade nos relatórios/PDFs - o texto exibido no
    // dropdown, so' o Juízo/Vara, e' so' pra' facilitar a escolha visual.
    nome: opcaoSelecionada.dataset.nomeCompleto || opcaoSelecionada.textContent,
  }));
  areaUnidadeSelecionada.hidden = false;
  areaUnidadeSelecionada.textContent =
    unidadesSelecionadasCorregedoria.length === 1
      ? `Informações serão extraídas de: ${unidadesSelecionadasCorregedoria[0].nome}`
      : `${unidadesSelecionadasCorregedoria.length} unidades selecionadas: ${unidadesSelecionadasCorregedoria
          .map((u) => u.nome)
          .join("; ")}`;
  areaPersonalizarRelatorio.hidden = false;
  areaBtnExportarGerencial.hidden = false;
  // A comparação exige pelo menos 2 unidades (não faz sentido "comparar"
  // uma so' unidade consigo mesma) - o botão só aparece a partir daí.
  areaBtnCompararUnidades.hidden = unidadesSelecionadasCorregedoria.length < 2;
});

// Le' o estado atual dos checkboxes de "Itens a incluir no PDF" - as
// chaves batem exatamente com as de "OPCOES_RELATORIO_UNIDADE_PADRAO" no
// background.js, entao a mensagem so' precisa repassar esse objeto sem
// nenhuma traducao a mais.
function lerOpcoesRelatorioUnidade() {
  return {
    processosAtivos: chkRelProcessosAtivos.checked,
    suspensos: chkRelSuspensos.checked,
    conclusosDecisao: chkRelConclusosDecisao.checked,
    conclusosSentenca: chkRelConclusosSentenca.checked,
    semMovimentacao: chkRelSemMovimentacao.checked,
    paralisados: chkRelParalisados.checked,
    remessasJuizesLeigos: chkRelRemessasJuizesLeigos.checked,
    regrasAutomacao: chkRelRegrasAutomacao.checked,
    localizadores: chkRelLocalizadores.checked,
  };
}

const CHECKBOXES_ITENS_RELATORIO_UNIDADE = [
  chkRelProcessosAtivos,
  chkRelSuspensos,
  chkRelConclusosDecisao,
  chkRelConclusosSentenca,
  chkRelSemMovimentacao,
  chkRelParalisados,
  chkRelRemessasJuizesLeigos,
  chkRelRegrasAutomacao,
  chkRelLocalizadores,
];

btnMarcarTudoRelatorio.addEventListener("click", () => {
  CHECKBOXES_ITENS_RELATORIO_UNIDADE.forEach((chk) => {
    chk.checked = true;
  });
});

btnDesmarcarTudoRelatorio.addEventListener("click", () => {
  CHECKBOXES_ITENS_RELATORIO_UNIDADE.forEach((chk) => {
    chk.checked = false;
  });
});

btnExportarRelatorioGerencial.addEventListener("click", async () => {
  areaErrosCorregedoria.hidden = true;

  let unidades;
  try {
    unidades = exigirUnidadesSelecionadas();
  } catch (e) {
    areaErrosCorregedoria.hidden = false;
    areaErrosCorregedoria.textContent = e && e.message ? e.message : String(e);
    return;
  }

  const opcoes = lerOpcoesRelatorioUnidade();
  if (!Object.values(opcoes).some(Boolean)) {
    areaErrosCorregedoria.hidden = false;
    areaErrosCorregedoria.textContent = "Marque ao menos um item do relatório antes de exportar.";
    return;
  }

  btnExportarRelatorioGerencial.disabled = true;
  areaProgressoRelatorioGerencial.hidden = false;
  textoProgressoRelatorioGerencial.textContent = "Iniciando...";
  iniciarCronometroStatus(areaCorregedoriaInfo);
  setStatusCorregedoria(
    unidades.length === 1
      ? `Gerando o Relatório para Correição de "${unidades[0].nome}" em segundo plano...`
      : `Gerando ${unidades.length} relatórios para Correição em segundo plano, um por vez (arquivos separados)...`
  );

  // Mesmo padrao das demais operacoes em segundo plano: so' confirma que
  // comecou; o resultado final chega pela mensagem
  // RELATORIO_GERENCIAL_FINALIZADO. Sempre usa a mensagem "multiplas
  // unidades" (mesmo com uma so' unidade) - o background.js gera os PDFs
  // sequencialmente, um por unidade, em arquivos separados.
  try {
    const resposta = await chrome.runtime.sendMessage({
      tipo: "EXPORTAR_RELATORIO_GERENCIAL_MULTIPLAS_UNIDADES",
      unidades: unidades.map((u) => ({ valor: u.valor, nome: u.nome })),
      opcoes,
    });
    if (!resposta || !resposta.ok) {
      throw new Error((resposta && resposta.erro) || "Falha desconhecida ao iniciar a exportação.");
    }
  } catch (e) {
    setStatusCorregedoria("Erro ao gerar o relatório gerencial.", "erro");
    areaErrosCorregedoria.hidden = false;
    areaErrosCorregedoria.textContent = e && e.message ? e.message : String(e);
    areaProgressoRelatorioGerencial.hidden = true;
    btnExportarRelatorioGerencial.disabled = false;
  }
});

// Compara so' os dados de RESUMO (contagens - sem tabelas, sem
// localizadores/remessas/regras) de 2+ unidades escolhidas, num único
// PDF com uma linha por unidade - não usa os checkboxes de "Itens a
// incluir no PDF" (esses valem so' para o Relatório da Unidade acima).
btnCompararUnidades.addEventListener("click", async () => {
  areaErrosCorregedoria.hidden = true;

  let unidades;
  try {
    unidades = exigirUnidadesSelecionadas();
  } catch (e) {
    areaErrosCorregedoria.hidden = false;
    areaErrosCorregedoria.textContent = e && e.message ? e.message : String(e);
    return;
  }
  if (unidades.length < 2) {
    areaErrosCorregedoria.hidden = false;
    areaErrosCorregedoria.textContent = "Selecione ao menos duas unidades para comparar.";
    return;
  }

  btnCompararUnidades.disabled = true;
  areaProgressoComparacaoUnidades.hidden = false;
  textoProgressoComparacaoUnidades.textContent = "Iniciando...";
  iniciarCronometroStatus(areaCorregedoriaInfo);
  setStatusCorregedoria(`Comparando ${unidades.length} unidades em segundo plano...`);

  // Mesmo padrao das demais operacoes em segundo plano: so' confirma que
  // comecou; o resultado final chega pela mensagem
  // COMPARACAO_UNIDADES_FINALIZADO.
  try {
    const resposta = await chrome.runtime.sendMessage({
      tipo: "EXPORTAR_COMPARACAO_UNIDADES",
      unidades: unidades.map((u) => ({ valor: u.valor, nome: u.nome })),
    });
    if (!resposta || !resposta.ok) {
      throw new Error((resposta && resposta.erro) || "Falha desconhecida ao iniciar a comparação.");
    }
  } catch (e) {
    setStatusCorregedoria("Erro ao gerar a comparação entre unidades.", "erro");
    areaErrosCorregedoria.hidden = false;
    areaErrosCorregedoria.textContent = e && e.message ? e.message : String(e);
    areaProgressoComparacaoUnidades.hidden = true;
    btnCompararUnidades.disabled = false;
  }
});

// ---- Gestão da Unidade (alternativo) - experimental ----
// Mesmo Relatório para Correição do cartão Corregedoria, mas sem
// dropdown de unidade nenhum: reaproveita o filtro que a própria tela do
// eproc já aplica sozinha para o perfil logado (MAGISTRADO/GESTÃO DA
// UNIDADE), ja' restrito a' unidade habilitada na sessão - ver
// "exportarRelatorioUnidadeAtual" em background.js.
const areaRelatorioUnidadeAltInfo = document.getElementById("area-relatorio-unidade-alt-info");
const radioUnidadeIntegralAlt = document.getElementById("radio-unidade-integral-alt");
const radioSeparacaoCompetenciaAlt = document.getElementById("radio-separacao-competencia-alt");
const chkRelAltProcessosAtivos = document.getElementById("chk-relalt-processos-ativos");
const chkRelAltSuspensos = document.getElementById("chk-relalt-suspensos");
const chkRelAltConclusosDecisao = document.getElementById("chk-relalt-conclusos-decisao");
const chkRelAltConclusosSentenca = document.getElementById("chk-relalt-conclusos-sentenca");
const chkRelAltSemMovimentacao = document.getElementById("chk-relalt-sem-movimentacao");
const chkRelAltMandados = document.getElementById("chk-relalt-mandados");
const chkRelAltParalisados = document.getElementById("chk-relalt-paralisados");
const chkRelAltRemessasJuizesLeigos = document.getElementById("chk-relalt-remessas-juizes-leigos");
const chkRelAltRegrasAutomacao = document.getElementById("chk-relalt-regras-automacao");
const chkRelAltLocalizadores = document.getElementById("chk-relalt-localizadores");
const btnExportarRelatorioUnidadeAlt = document.getElementById("btn-exportar-relatorio-unidade-alt");
const areaProgressoRelatorioUnidadeAlt = document.getElementById("area-progresso-relatorio-unidade-alt");
const textoProgressoRelatorioUnidadeAlt = document.getElementById("texto-progresso-relatorio-unidade-alt");
const areaErrosUnidadeAlt = document.getElementById("area-erros-unidade-alt");

function setStatusUnidadeAlt(texto, tipo) {
  aplicarStatus(areaRelatorioUnidadeAltInfo, texto, tipo);
}

function lerOpcoesRelatorioUnidadeAlt() {
  return {
    processosAtivos: chkRelAltProcessosAtivos.checked,
    suspensos: chkRelAltSuspensos.checked,
    conclusosDecisao: chkRelAltConclusosDecisao.checked,
    conclusosSentenca: chkRelAltConclusosSentenca.checked,
    semMovimentacao: chkRelAltSemMovimentacao.checked,
    mandados: chkRelAltMandados.checked,
    paralisados: chkRelAltParalisados.checked,
    remessasJuizesLeigos: chkRelAltRemessasJuizesLeigos.checked,
    regrasAutomacao: chkRelAltRegrasAutomacao.checked,
    localizadores: chkRelAltLocalizadores.checked,
  };
}

btnExportarRelatorioUnidadeAlt.addEventListener("click", async () => {
  areaErrosUnidadeAlt.hidden = true;

  const opcoes = lerOpcoesRelatorioUnidadeAlt();
  if (!Object.values(opcoes).some(Boolean)) {
    areaErrosUnidadeAlt.hidden = false;
    areaErrosUnidadeAlt.textContent = "Marque ao menos um item do relatório antes de exportar.";
    return;
  }

  const separarPorCompetencia = radioSeparacaoCompetenciaAlt.checked;

  btnExportarRelatorioUnidadeAlt.disabled = true;
  areaProgressoRelatorioUnidadeAlt.hidden = false;
  textoProgressoRelatorioUnidadeAlt.textContent = "Iniciando...";
  iniciarCronometroStatus(areaRelatorioUnidadeAltInfo);
  setStatusUnidadeAlt("Gerando o Relatório da Unidade em segundo plano...");

  // Mesmo padrao das demais operacoes em segundo plano: so' confirma que
  // comecou; o resultado final chega pela mensagem
  // RELATORIO_UNIDADE_ATUAL_FINALIZADO.
  try {
    const resposta = await chrome.runtime.sendMessage({
      tipo: "EXPORTAR_RELATORIO_UNIDADE_ATUAL",
      opcoes,
      separarPorCompetencia,
    });
    if (!resposta || !resposta.ok) {
      throw new Error((resposta && resposta.erro) || "Falha desconhecida ao iniciar a exportação.");
    }
  } catch (e) {
    setStatusUnidadeAlt("Erro ao gerar o relatório da unidade.", "erro");
    areaErrosUnidadeAlt.hidden = false;
    areaErrosUnidadeAlt.textContent = e && e.message ? e.message : String(e);
    areaProgressoRelatorioUnidadeAlt.hidden = true;
    btnExportarRelatorioUnidadeAlt.disabled = false;
  }
});

// Relatório Geral da Corregedoria (panorama de TODAS as unidades) -
// desativado por enquanto (precisa de melhorias antes de voltar). Handler
// inteiro comentado junto com o botão em popup.html.
// btnRelatorioPanoramico.addEventListener("click", async () => {
//   areaErrosCorregedoria.hidden = true;
//   btnRelatorioPanoramico.disabled = true;
//   areaProgressoPanoramico.hidden = false;
//   textoProgressoPanoramico.textContent = "Iniciando...";
//   setStatusCorregedoria("Gerando o Relatório Geral (todas as unidades) em segundo plano...");
//
//   // Mesmo padrao das demais operacoes em segundo plano: so' confirma que
//   // comecou; o resultado final chega pela mensagem
//   // RELATORIO_PANORAMICO_FINALIZADO.
//   try {
//     const resposta = await chrome.runtime.sendMessage({ tipo: "EXPORTAR_RELATORIO_PANORAMICO" });
//     if (!resposta || !resposta.ok) {
//       throw new Error((resposta && resposta.erro) || "Falha desconhecida ao iniciar a exportação.");
//     }
//   } catch (e) {
//     setStatusCorregedoria("Erro ao gerar o relatório geral.", "erro");
//     areaErrosCorregedoria.hidden = false;
//     areaErrosCorregedoria.textContent = e && e.message ? e.message : String(e);
//     areaProgressoPanoramico.hidden = true;
//     btnRelatorioPanoramico.disabled = false;
//   }
// });

chrome.tabs.onActivated.addListener(atualizarCardCorregedoria);
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") atualizarCardCorregedoria();
});
atualizarCardCorregedoria();

chrome.runtime.onMessage.addListener((mensagem) => {
  if (!mensagem) return;

  // Avisos vindos do content script quando o usuário desmarca/marca um
  // checkbox DIRETO na página (em vez de pelo painel) - sem isso, o
  // painel só descobria essa mudança no próximo "Detectar"/"Baixar" (a
  // exportação em si já respeitava a escolha porque "Baixar" relê o
  // estado da página antes de exportar; só o CHECKBOX DO PAINEL ficava
  // visualmente desatualizado até lá).
  if (mensagem.tipo === "SELECAO_DOCUMENTO_ALTERADA_NA_PAGINA") {
    const doc = estadoAtual.documentos.find((d) => d.idDocumento === mensagem.idDocumento);
    if (doc) {
      doc.selecionado = mensagem.selecionado;
      atualizarCheckboxNaListaDocumentos(mensagem.idDocumento, mensagem.selecionado);
    }
  }

  if (mensagem.tipo === "SELECAO_MOVIMENTACAO_ALTERADA_NA_PAGINA") {
    estadoAtual.movimentacaoIncluida = mensagem.incluida;
    chkIncluirMovimentacao.checked = mensagem.incluida;
    chkIncluirMovimentacaoIA.checked = mensagem.incluida;
  }

  if (mensagem.tipo === "PROGRESSO_DOWNLOAD") {
    barraProgresso.value = mensagem.concluidos;
    barraProgresso.max = mensagem.total;
    const rotulo = ROTULO_FASE[mensagem.fase] || "";
    const sufixoDocumento = mensagem.nomeAtual ? ` (${mensagem.nomeAtual})` : "";
    textoProgresso.textContent = `${rotulo ? rotulo + ": " : ""}${mensagem.concluidos} / ${mensagem.total}${sufixoDocumento}`;
    if (rotulo) setStatus(`Gerando ${rotulo.toLowerCase()}...`);
  }

  if (mensagem.tipo === "DOWNLOAD_FINALIZADO") {
    btnBaixar.disabled = false;
    btnDetectar.disabled = false;
    atualizarEstadoRadiosConformeDocumentos();
    atualizarEstadoBotaoBaixar();
    setStatus(`Concluido! Arquivos salvos em Downloads/${mensagem.pasta}`, "ok");
    if (mensagem.erros && mensagem.erros.length > 0) {
      areaErros.hidden = false;
      areaErros.textContent =
        `${mensagem.erros.length} erro(s): ` +
        mensagem.erros.map((e) => `${e.nome} (${e.mensagem})`).join("; ");
    }
  }

  if (mensagem.tipo === "PROGRESSO_ANALISE_IA") {
    textoProgressoIA.textContent = mensagem.texto || "Processando...";
  }

  if (mensagem.tipo === "ANALISE_IA_TEXTO_PRONTO") {
    areaProgressoIA.hidden = true;
    if (mensagem.ok) {
      textoExtraidoParaIA = mensagem.texto;
      const est = mensagem.estimativa || {};
      areaEstimativaIA.hidden = false;
      textoEstimativaIA.textContent =
        `Tamanho estimado: ~${(est.tokensEntradaEstimados || 0).toLocaleString("pt-BR")} tokens de entrada ` +
        `(modelo ${nomeAmigavelModelo(est.modelo)}). Custo estimado: até ${FORMATADOR_USD.format(est.custoEstimadoUsd || 0)}. ` +
        `Confirme para enviar de verdade à IA.`;
    } else {
      btnAnalisarIA.disabled = false;
      areaErrosIA.hidden = false;
      areaErrosIA.textContent = mensagem.erro || "Falha desconhecida ao extrair o conteúdo dos documentos.";
    }
  }

  if (mensagem.tipo === "ANALISE_IA_RESULTADO") {
    areaProgressoIA.hidden = true;
    btnAnalisarIA.disabled = false;
    if (mensagem.ok) {
      areaResultadoIA.hidden = false;
      textoResultadoIA.value = mensagem.resposta || "";
      if (mensagem.custoRealUsd != null) {
        textoProgressoIA.textContent = "";
        areaEstimativaIA.hidden = false;
        areaEstimativaIA.querySelector(".modal-botoes").hidden = true;
        textoEstimativaIA.textContent = `Custo real desta chamada: ${FORMATADOR_USD.format(mensagem.custoRealUsd)}.`;
      }
    } else {
      areaErrosIA.hidden = false;
      areaErrosIA.textContent = mensagem.erro || "Falha desconhecida ao consultar a IA.";
    }
  }

  if (mensagem.tipo === "IA_LOTE_ATUALIZADA_STATUS") {
    atualizarListaCompletaIA();
  }

  if (mensagem.tipo === "PROGRESSO_UNIDADES_RELATORIO") {
    textoProgressoUnidades.textContent = mensagem.texto || "Processando...";
    setStatusCorregedoria(mensagem.texto || "Processando...");
  }

  if (mensagem.tipo === "UNIDADES_RELATORIO_FINALIZADO") {
    areaProgressoUnidades.hidden = true;

    if (mensagem.ok) {
      const unidades = (mensagem.resultado && mensagem.resultado.unidades) || [];
      unidadesRelatorioCorregedoria = unidades.map((u) => ({
        ...u,
        ...separarComarcaDoJuizo(u.texto),
      }));

      const comarcas = [...new Set(unidadesRelatorioCorregedoria.map((u) => u.comarca))].sort((a, b) =>
        a.localeCompare(b, "pt-BR")
      );

      selectComarcaRelatorio.innerHTML = '<option value="" selected disabled>Selecione uma comarca...</option>';
      for (const comarca of comarcas) {
        const opcao = document.createElement("option");
        opcao.value = comarca;
        opcao.textContent = comarca;
        selectComarcaRelatorio.appendChild(opcao);
      }
      selectUnidadeRelatorio.innerHTML = '<option value="" disabled>Selecione um juízo/vara...</option>';
      areaSelectUnidade.hidden = true;
      areaSelectComarca.hidden = comarcas.length === 0;
      // Sem nenhuma unidade encontrada nao ha' nada mais a fazer com a
      // lista carregada - reaparece o botao para o usuario poder tentar
      // de novo (ex.: depois de navegar para uma pagina com o menu
      // lateral disponivel).
      if (comarcas.length === 0) btnRelatorioGerencialUnidade.hidden = false;
      setStatusCorregedoria(
        comarcas.length > 0
          ? `${unidadesRelatorioCorregedoria.length} unidade(s) em ${comarcas.length} comarca(s) - selecione uma comarca.`
          : "Nenhuma unidade encontrada no filtro Órgão/Juízo."
      );
    } else {
      setStatusCorregedoria("Erro ao carregar as unidades.", "erro");
      areaErrosCorregedoria.hidden = false;
      areaErrosCorregedoria.textContent =
        mensagem.erro || "Falha desconhecida ao carregar as unidades.";
      btnRelatorioGerencialUnidade.hidden = false;
    }
  }

  if (mensagem.tipo === "PROGRESSO_RELATORIO_GERENCIAL") {
    // So' a linha do spinner mostra o passo atual, em detalhe - o texto de
    // status (acima do botao) fica parado na mensagem inicial (+ o
    // cronometro, que segue contando por cima dela) para as duas areas
    // nao mostrarem o mesmo texto duplicado uma embaixo da outra.
    textoProgressoRelatorioGerencial.textContent = mensagem.texto || "Processando...";
  }

  if (mensagem.tipo === "RELATORIO_GERENCIAL_FINALIZADO") {
    areaProgressoRelatorioGerencial.hidden = true;
    btnExportarRelatorioGerencial.disabled = false;

    if (mensagem.ok) {
      const resultados = mensagem.resultados || [];
      const sucessos = resultados.filter((r) => r.ok);
      const falhas = resultados.filter((r) => !r.ok);

      if (resultados.length <= 1) {
        const unico = resultados[0] || {};
        const resultado = unico.resultado || {};
        setStatusCorregedoria(
          `Concluído! Relatório para Correição de "${unico.unidade || resultado.unidade || ""}" salvo em Downloads/eproc/ (${
            resultado.totalLocalizadores || 0
          } localizador(es)).`,
          "ok"
        );
      } else {
        setStatusCorregedoria(
          `Concluído! ${sucessos.length} de ${resultados.length} relatório(s) gerado(s) em Downloads/eproc/ (arquivos separados por unidade)${
            falhas.length > 0 ? `, ${falhas.length} com erro` : ""
          }.`,
          falhas.length > 0 ? "erro" : "ok"
        );
      }

      if (falhas.length > 0) {
        areaErrosCorregedoria.hidden = false;
        areaErrosCorregedoria.textContent = falhas
          .map((f) => `${f.unidade}: ${f.erro || "falha desconhecida"}`)
          .join("; ");
      }
    } else {
      setStatusCorregedoria("Erro ao gerar o relatório gerencial.", "erro");
      areaErrosCorregedoria.hidden = false;
      areaErrosCorregedoria.textContent =
        mensagem.erro || "Falha desconhecida ao gerar o relatório gerencial.";
    }
  }

  if (mensagem.tipo === "PROGRESSO_COMPARACAO_UNIDADES") {
    textoProgressoComparacaoUnidades.textContent = mensagem.texto || "Processando...";
  }

  if (mensagem.tipo === "COMPARACAO_UNIDADES_FINALIZADO") {
    areaProgressoComparacaoUnidades.hidden = true;
    btnCompararUnidades.disabled = false;

    if (mensagem.ok) {
      const resultado = mensagem.resultado || {};
      setStatusCorregedoria(
        `Concluído! Comparação de ${resultado.totalUnidades || 0} unidade(s) salva em Downloads/eproc/${
          resultado.totalComErro > 0 ? ` (${resultado.totalComErro} com erro na consulta)` : ""
        }.`,
        resultado.totalComErro > 0 ? "erro" : "ok"
      );
    } else {
      setStatusCorregedoria("Erro ao gerar a comparação entre unidades.", "erro");
      areaErrosCorregedoria.hidden = false;
      areaErrosCorregedoria.textContent =
        mensagem.erro || "Falha desconhecida ao gerar a comparação entre unidades.";
    }
  }

  if (mensagem.tipo === "PROGRESSO_RELATORIO_UNIDADE_ATUAL") {
    // Mesma razao do PROGRESSO_RELATORIO_GERENCIAL acima: so' a linha do
    // spinner mostra o passo atual, para nao duplicar o mesmo texto no
    // status (que fica so' com a mensagem inicial + cronometro).
    textoProgressoRelatorioUnidadeAlt.textContent = mensagem.texto || "Processando...";
  }

  if (mensagem.tipo === "RELATORIO_UNIDADE_ATUAL_FINALIZADO") {
    areaProgressoRelatorioUnidadeAlt.hidden = true;
    btnExportarRelatorioUnidadeAlt.disabled = false;

    if (mensagem.ok) {
      const resultado = mensagem.resultado || {};
      setStatusUnidadeAlt(
        `Concluído! Relatório da unidade salvo em Downloads/eproc/ (${resultado.totalLocalizadores || 0} localizador(es)).`,
        "ok"
      );
    } else {
      setStatusUnidadeAlt("Erro ao gerar o relatório da unidade.", "erro");
      areaErrosUnidadeAlt.hidden = false;
      areaErrosUnidadeAlt.textContent = mensagem.erro || "Falha desconhecida ao gerar o relatório da unidade.";
    }
  }

  // Relatório Geral (panorama) desativado por enquanto - ver comentário
  // acima do botão em popup.html. Como nada mais envia
  // "EXPORTAR_RELATORIO_PANORAMICO", estas mensagens nunca chegam, mas
  // ficam comentadas junto por clareza/consistência.
  // if (mensagem.tipo === "PROGRESSO_RELATORIO_PANORAMICO") {
  //   textoProgressoPanoramico.textContent = mensagem.texto || "Processando...";
  //   setStatusCorregedoria(mensagem.texto || "Processando...");
  // }
  //
  // if (mensagem.tipo === "RELATORIO_PANORAMICO_FINALIZADO") {
  //   areaProgressoPanoramico.hidden = true;
  //   btnRelatorioPanoramico.disabled = false;
  //
  //   if (mensagem.ok) {
  //     const resultado = mensagem.resultado || {};
  //     setStatusCorregedoria(
  //       `Concluído! Relatório Geral salvo em Downloads/eproc/ (${
  //         resultado.totalSemMovimentacao || 0
  //       } linha(s) de sem movimentação, ${resultado.totalAtuacao || 0} linha(s) de atuação).`,
  //       "ok"
  //     );
  //   } else {
  //     setStatusCorregedoria("Erro ao gerar o relatório geral.", "erro");
  //     areaErrosCorregedoria.hidden = false;
  //     areaErrosCorregedoria.textContent =
  //       mensagem.erro || "Falha desconhecida ao gerar o relatório geral.";
  //   }
  // }
});

chrome.runtime.onMessage.addListener((mensagem) => {
  if (!mensagem) return;

  if (mensagem.tipo === "PROGRESSO_LISTAR_LOCALIZADORES") {
    textoProgressoNavLocalizadores.textContent = mensagem.texto || "Processando...";
    setStatusNavLocalizadores(mensagem.texto || "Processando...");
  }

  if (mensagem.tipo === "LISTAR_LOCALIZADORES_FINALIZADO") {
    areaProgressoNavLocalizadores.hidden = true;

    if (mensagem.ok) {
      const resultado = mensagem.resultado || {};
      const localizadores = [...(resultado.localizadores || [])].sort((a, b) =>
        a.nome.localeCompare(b.nome, "pt-BR")
      );
      localizadoresCarregados = localizadores;
      areaAcoesLocalizador.hidden = true;

      selectLocalizadorProcessos.innerHTML =
        '<option value="" selected disabled>Selecione um localizador...</option>';
      for (const loc of localizadores) {
        const opcao = document.createElement("option");
        opcao.value = loc.urlProcessos;
        opcao.textContent = `${loc.nome} (${loc.totalProcessos})`;
        selectLocalizadorProcessos.appendChild(opcao);
      }
      areaSelectLocalizador.hidden = localizadores.length === 0;
      // Sem nenhum localizador encontrado nao ha' nada mais a fazer com
      // a lista carregada - reaparece o botao para tentar de novo.
      if (localizadores.length === 0) btnCarregarLocalizadores.hidden = false;

      setStatusNavLocalizadores(
        localizadores.length > 0
          ? `${localizadores.length} localizador(es) com processos - selecione um para navegar até ele ou exportar um relatório.`
          : "Nenhum localizador com processos foi encontrado."
      );
      if (resultado.erroColeta) {
        areaErrosNavLocalizadores.hidden = false;
        areaErrosNavLocalizadores.textContent = `Aviso: ${resultado.erroColeta}`;
      }
    } else {
      setStatusNavLocalizadores("Erro ao carregar os localizadores.", "erro");
      areaErrosNavLocalizadores.hidden = false;
      areaErrosNavLocalizadores.textContent =
        mensagem.erro || "Falha desconhecida ao carregar os localizadores.";
      btnCarregarLocalizadores.hidden = false;
    }
  }

  if (mensagem.tipo === "PROGRESSO_PROCESSOS_LOCALIZADOR") {
    // So' a linha do spinner mostra o passo atual (ver comentário
    // equivalente em PROGRESSO_RELATORIO_GERENCIAL, acima).
    textoProgressoProcessosLocalizador.textContent = mensagem.texto || "Processando...";
  }

  if (mensagem.tipo === "PROCESSOS_LOCALIZADOR_FINALIZADO") {
    areaProgressoProcessosLocalizador.hidden = true;
    btnExportarProcessosLocalizador.disabled = false;

    if (mensagem.ok) {
      const resultado = mensagem.resultado || {};
      setStatusNavLocalizadores(
        `Concluído! ${resultado.total || 0} processo(s) exportado(s) para Downloads/eproc/.` +
          (resultado.erroColeta ? ` Aviso: ${resultado.erroColeta}` : ""),
        "ok"
      );
    } else {
      setStatusNavLocalizadores("Erro ao exportar os processos do localizador.", "erro");
      areaErrosNavLocalizadores.hidden = false;
      areaErrosNavLocalizadores.textContent =
        mensagem.erro || "Falha desconhecida ao exportar os processos do localizador.";
    }
  }

  if (mensagem.tipo === "PROGRESSO_DOCUMENTOS_LOCALIZADOR") {
    // So' a linha do spinner mostra o passo atual (ver comentário
    // equivalente em PROGRESSO_RELATORIO_GERENCIAL, acima).
    textoProgressoDocumentosLocalizador.textContent = mensagem.texto || "Processando...";
  }

  if (mensagem.tipo === "DOCUMENTOS_LOCALIZADOR_FINALIZADO") {
    areaProgressoDocumentosLocalizador.hidden = true;
    btnExportarDocumentosLocalizador.disabled = false;

    if (mensagem.ok) {
      const resultado = mensagem.resultado || {};
      const erros = resultado.erros || [];
      setStatusNavLocalizadores(
        `Concluído! ${resultado.concluidos || 0} de ${resultado.total || 0} processo(s) processado(s) para Downloads/eproc/` +
          (erros.length > 0 ? ` (${erros.length} com aviso/erro - veja abaixo).` : "."),
        erros.length > 0 ? "erro" : "ok"
      );
      if (erros.length > 0 || resultado.erroColeta) {
        areaErrosNavLocalizadores.hidden = false;
        const linhas = erros.map((e) => `${e.nome}: ${e.mensagem}`);
        if (resultado.erroColeta) linhas.unshift(`Aviso: ${resultado.erroColeta}`);
        areaErrosNavLocalizadores.textContent = linhas.join("\n");
      }
    } else {
      setStatusNavLocalizadores("Erro ao exportar os documentos dos processos.", "erro");
      areaErrosNavLocalizadores.hidden = false;
      areaErrosNavLocalizadores.textContent =
        mensagem.erro || "Falha desconhecida ao exportar os documentos dos processos.";
    }
  }
});

const areaNavLocalizadoresInfo = document.getElementById("area-nav-localizadores-info");
const btnCarregarLocalizadores = document.getElementById("btn-carregar-localizadores");
const areaProgressoNavLocalizadores = document.getElementById("area-progresso-nav-localizadores");
const textoProgressoNavLocalizadores = document.getElementById("texto-progresso-nav-localizadores");
const areaSelectLocalizador = document.getElementById("area-select-localizador");
const selectLocalizadorProcessos = document.getElementById("select-localizador-processos");
const areaErrosNavLocalizadores = document.getElementById("area-erros-nav-localizadores");
const areaAcoesLocalizador = document.getElementById("area-acoes-localizador");
const btnIrParaProcessosLocalizador = document.getElementById("btn-ir-para-processos-localizador");
const chkProcessosLocalizadorPdf = document.getElementById("chk-processos-localizador-pdf");
const chkProcessosLocalizadorExcel = document.getElementById("chk-processos-localizador-excel");
const btnExportarProcessosLocalizador = document.getElementById("btn-exportar-processos-localizador");
const areaProgressoProcessosLocalizador = document.getElementById("area-progresso-processos-localizador");
const textoProgressoProcessosLocalizador = document.getElementById("texto-progresso-processos-localizador");
const btnExportarDocumentosLocalizador = document.getElementById("btn-exportar-documentos-localizador");
const areaProgressoDocumentosLocalizador = document.getElementById("area-progresso-documentos-localizador");
const textoProgressoDocumentosLocalizador = document.getElementById("texto-progresso-documentos-localizador");

// Guarda a ultima lista carregada (nome + urlProcessos de cada
// localizador) para poder identificar qual localizador esta' selecionado
// no dropdown na hora de exportar o relatorio de processos dele.
let localizadoresCarregados = [];

function setStatusNavLocalizadores(texto, tipo) {
  aplicarStatus(areaNavLocalizadoresInfo, texto, tipo);
}

btnCarregarLocalizadores.addEventListener("click", async () => {
  // Some assim que clicado, mesmo padrao do botao "Carregar unidades" do
  // Relatório da Unidade - so' serve para um carregamento inicial (o
  // dropdown que ele preenche continua ali depois); so' volta a
  // aparecer se o carregamento falhar, para tentar de novo.
  btnCarregarLocalizadores.hidden = true;
  areaErrosNavLocalizadores.hidden = true;
  areaSelectLocalizador.hidden = true;
  areaAcoesLocalizador.hidden = true;
  areaProgressoNavLocalizadores.hidden = false;
  textoProgressoNavLocalizadores.textContent = "Iniciando...";
  setStatusNavLocalizadores(
    "Carregando localizadores em segundo plano (percorrendo todas as páginas da listagem)..."
  );

  // A mensagem so' confirma que comecou; o resultado final chega pela
  // mensagem LISTAR_LOCALIZADORES_FINALIZADO.
  try {
    const resposta = await chrome.runtime.sendMessage({ tipo: "LISTAR_LOCALIZADORES_COM_PROCESSOS" });
    if (!resposta || !resposta.ok) {
      throw new Error((resposta && resposta.erro) || "Falha desconhecida ao iniciar o carregamento.");
    }
  } catch (e) {
    setStatusNavLocalizadores("Erro ao iniciar o carregamento.", "erro");
    areaErrosNavLocalizadores.hidden = false;
    areaErrosNavLocalizadores.textContent = e && e.message ? e.message : String(e);
    areaProgressoNavLocalizadores.hidden = true;
    btnCarregarLocalizadores.hidden = false;
  }
});

// Ao escolher um localizador no dropdown, so' libera as duas acoes
// disponiveis para ele (ir para o relatorio / exportar) - a navegacao em
// si so' acontece quando o usuario clica em "Ir para o relatório"
// (nunca automaticamente so' por selecionar a opcao).
selectLocalizadorProcessos.addEventListener("change", () => {
  const url = selectLocalizadorProcessos.value;
  areaErrosNavLocalizadores.hidden = true;
  areaAcoesLocalizador.hidden = !url || !localizadoresCarregados.some((loc) => loc.urlProcessos === url);
});

// Navega a aba ATUAL (a mesma de onde o painel foi aberto) direto para a
// lista de processos do localizador selecionado - a URL ja' vem absoluta
// e pronta (com hash/sessao inclusos) da propria raspagem feita na aba
// oculta.
btnIrParaProcessosLocalizador.addEventListener("click", async () => {
  const url = selectLocalizadorProcessos.value;
  if (!url) return;

  areaErrosNavLocalizadores.hidden = true;
  try {
    const aba = await getAbaAtiva();
    if (!aba || !aba.id) {
      throw new Error("Nenhuma aba ativa encontrada.");
    }
    await chrome.tabs.update(aba.id, { url });
    setStatusNavLocalizadores("Navegando até os processos do localizador selecionado...");
  } catch (e) {
    areaErrosNavLocalizadores.hidden = false;
    areaErrosNavLocalizadores.textContent = e && e.message ? e.message : String(e);
  }
});

btnExportarProcessosLocalizador.addEventListener("click", async () => {
  const url = selectLocalizadorProcessos.value;
  const localizador = localizadoresCarregados.find((loc) => loc.urlProcessos === url);
  if (!localizador) return;

  const formatos = {
    pdf: chkProcessosLocalizadorPdf.checked,
    excel: chkProcessosLocalizadorExcel.checked,
  };
  if (!formatos.pdf && !formatos.excel) {
    areaErrosNavLocalizadores.hidden = false;
    areaErrosNavLocalizadores.textContent = "Marque ao menos um formato (PDF ou Excel).";
    return;
  }

  btnExportarProcessosLocalizador.disabled = true;
  areaErrosNavLocalizadores.hidden = true;
  areaProgressoProcessosLocalizador.hidden = false;
  textoProgressoProcessosLocalizador.textContent = "Iniciando...";
  iniciarCronometroStatus(areaNavLocalizadoresInfo);
  setStatusNavLocalizadores(
    `Exportando os processos de "${localizador.nome}" em segundo plano...`
  );

  // Mesmo padrao das demais exportacoes: so' confirma que comecou; o
  // resultado final chega pela mensagem PROCESSOS_LOCALIZADOR_FINALIZADO.
  try {
    const resposta = await chrome.runtime.sendMessage({
      tipo: "EXPORTAR_PROCESSOS_LOCALIZADOR",
      nomeLocalizador: localizador.nome,
      urlProcessos: localizador.urlProcessos,
      formatos,
    });
    if (!resposta || !resposta.ok) {
      throw new Error((resposta && resposta.erro) || "Falha desconhecida ao iniciar a exportação.");
    }
  } catch (e) {
    setStatusNavLocalizadores("Erro ao iniciar a exportação.", "erro");
    areaErrosNavLocalizadores.hidden = false;
    areaErrosNavLocalizadores.textContent = e && e.message ? e.message : String(e);
    areaProgressoProcessosLocalizador.hidden = true;
    btnExportarProcessosLocalizador.disabled = false;
  }
});

// Exporta, para cada processo do localizador selecionado, um PDF unico
// combinado com todos os documentos do processo - uma pasta por processo
// (nome = numero do processo), o arquivo dentro dela nomeado com o
// localizador escolhido. Roda um processo de cada vez, entao pode
// demorar bastante para localizadores com muitos processos.
btnExportarDocumentosLocalizador.addEventListener("click", async () => {
  const url = selectLocalizadorProcessos.value;
  const localizador = localizadoresCarregados.find((loc) => loc.urlProcessos === url);
  if (!localizador) return;

  btnExportarDocumentosLocalizador.disabled = true;
  areaErrosNavLocalizadores.hidden = true;
  areaProgressoDocumentosLocalizador.hidden = false;
  textoProgressoDocumentosLocalizador.textContent = "Iniciando...";
  iniciarCronometroStatus(areaNavLocalizadoresInfo);
  setStatusNavLocalizadores(
    `Exportando os documentos de cada processo de "${localizador.nome}" em segundo plano (pode demorar)...`
  );

  // Mesmo padrao das demais exportacoes: so' confirma que comecou; o
  // resultado final chega pela mensagem DOCUMENTOS_LOCALIZADOR_FINALIZADO.
  try {
    const resposta = await chrome.runtime.sendMessage({
      tipo: "EXPORTAR_DOCUMENTOS_LOCALIZADOR",
      nomeLocalizador: localizador.nome,
      urlProcessos: localizador.urlProcessos,
    });
    if (!resposta || !resposta.ok) {
      throw new Error((resposta && resposta.erro) || "Falha desconhecida ao iniciar a exportação.");
    }
  } catch (e) {
    setStatusNavLocalizadores("Erro ao iniciar a exportação.", "erro");
    areaErrosNavLocalizadores.hidden = false;
    areaErrosNavLocalizadores.textContent = e && e.message ? e.message : String(e);
    areaProgressoDocumentosLocalizador.hidden = true;
    btnExportarDocumentosLocalizador.disabled = false;
  }
});

// ---- Reordenar os cartões de perfil arrastando com o mouse ----
//
// A ordem padrão (Corregedoria > Gestão da Unidade > Magistrado, já
// refletida na ordem dos <details> no HTML) pode ser alterada pelo
// usuário arrastando a alça (⠿) de cada cartão; a ordem escolhida é
// persistida no chrome.storage.local e reaplicada toda vez que o painel
// é reaberto. Só a alça inicia o arraste - clicar no resto do <summary>
// continua abrindo/fechando o cartão normalmente.
const CHAVE_ORDEM_CARDS = "ordemCardsPerfil";
const listaCardsPerfil = document.getElementById("lista-cards-perfil");

function aplicarOrdemCards(ordemIds) {
  if (!ordemIds || ordemIds.length === 0) return;
  for (const id of ordemIds) {
    const card = document.getElementById(id);
    if (card) listaCardsPerfil.appendChild(card);
  }
}

function salvarOrdemCards() {
  const ordemIds = Array.from(listaCardsPerfil.children)
    .filter((el) => el.classList && el.classList.contains("card"))
    .map((el) => el.id);
  chrome.storage.local.set({ [CHAVE_ORDEM_CARDS]: ordemIds });
}

chrome.storage.local.get([CHAVE_ORDEM_CARDS], (dados) => {
  aplicarOrdemCards(dados && dados[CHAVE_ORDEM_CARDS]);
});

let cardArrastando = null;

listaCardsPerfil.querySelectorAll(".card-alca").forEach((alca) => {
  alca.addEventListener("dragstart", (evento) => {
    cardArrastando = alca.closest(".card");
    cardArrastando.classList.add("card--arrastando");
    evento.dataTransfer.effectAllowed = "move";
    evento.dataTransfer.setData("text/plain", cardArrastando.id);
  });

  alca.addEventListener("dragend", () => {
    if (cardArrastando) cardArrastando.classList.remove("card--arrastando");
    listaCardsPerfil
      .querySelectorAll(".card--alvo-de-drop")
      .forEach((el) => el.classList.remove("card--alvo-de-drop"));
    cardArrastando = null;
  });
});

listaCardsPerfil.querySelectorAll(".card").forEach((card) => {
  card.addEventListener("dragover", (evento) => {
    if (!cardArrastando || cardArrastando === card) return;
    evento.preventDefault();
    evento.dataTransfer.dropEffect = "move";
    card.classList.add("card--alvo-de-drop");
  });

  card.addEventListener("dragleave", () => {
    card.classList.remove("card--alvo-de-drop");
  });

  card.addEventListener("drop", (evento) => {
    evento.preventDefault();
    card.classList.remove("card--alvo-de-drop");
    if (!cardArrastando || cardArrastando === card) return;

    const cards = Array.from(listaCardsPerfil.children).filter(
      (el) => el.classList && el.classList.contains("card")
    );
    const indiceOrigem = cards.indexOf(cardArrastando);
    const indiceDestino = cards.indexOf(card);
    if (indiceOrigem < indiceDestino) {
      card.after(cardArrastando);
    } else {
      card.before(cardArrastando);
    }
    salvarOrdemCards();
  });
});

atualizarPromptsIA();
atualizarListaCompletaIA();
