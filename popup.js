const areaStatus = document.getElementById("area-status");
const btnDetectar = document.getElementById("btn-detectar");
const btnBaixar = document.getElementById("btn-baixar");
const areaProcesso = document.getElementById("area-processo");
const numeroProcessoEl = document.getElementById("numero-processo");
const totalDocumentosEl = document.getElementById("total-documentos");
const listaDocumentosEl = document.getElementById("lista-documentos");
const areaOpcoes = document.getElementById("area-opcoes");
const radioIndividuais = document.getElementById("radio-individuais");
const radioPdfUnico = document.getElementById("radio-pdf-unico");
const radioMdUnico = document.getElementById("radio-md-unico");
const avisoMdUnico = document.getElementById("aviso-md-unico");
const areaProgresso = document.getElementById("area-progresso");
const barraProgresso = document.getElementById("barra-progresso");
const textoProgresso = document.getElementById("texto-progresso");
const areaErros = document.getElementById("area-erros");

const ROTULO_FASE = {
  individuais: "Arquivos individuais",
  "pdf-unico": "PDF único",
  "md-unico": "MD único",
};

let estadoAtual = { numeroProcesso: null, documentos: [], movimentacao: [] };

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

function setStatus(texto) {
  areaStatus.textContent = texto;
}

async function getAbaAtiva() {
  const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
  return aba;
}

function renderizarLista(documentos) {
  listaDocumentosEl.innerHTML = "";
  for (const doc of documentos) {
    const li = document.createElement("li");
    const nome = document.createElement("span");
    nome.textContent = `${doc.nome}`;
    const tipo = document.createElement("span");
    tipo.className = "tipo";
    tipo.textContent = doc.mimetype || "";
    li.appendChild(nome);
    li.appendChild(tipo);
    listaDocumentosEl.appendChild(li);
  }
}

btnDetectar.addEventListener("click", async () => {
  areaErros.hidden = true;
  setStatus("Detectando documentos na pagina...");
  try {
    const aba = await getAbaAtiva();
    const resposta = await chrome.tabs.sendMessage(aba.id, { tipo: "LISTAR_DOCUMENTOS" });

    const documentos = (resposta && resposta.documentos) || [];
    const movimentacao = (resposta && resposta.movimentacao) || [];

    if (!resposta || (documentos.length === 0 && movimentacao.length === 0)) {
      setStatus(
        "Nenhum documento nem movimentação encontrados. Confirme que você está na página de detalhes do processo no eproc."
      );
      estadoAtual = { numeroProcesso: null, documentos: [], movimentacao: [] };
      atualizarEstadoBotaoBaixar();
      areaProcesso.hidden = true;
      areaOpcoes.hidden = true;
      listaDocumentosEl.hidden = true;
      listaDocumentosEl.innerHTML = "";
      return;
    }

    estadoAtual = { numeroProcesso: resposta.numeroProcesso, documentos, movimentacao };
    numeroProcessoEl.textContent = resposta.numeroProcesso;
    totalDocumentosEl.textContent = String(documentos.length);
    areaProcesso.hidden = false;
    areaOpcoes.hidden = false;

    // Sem nenhum documento anexado (so' movimentação), os modos
    // "Arquivos individuais" e "PDF único" não têm o que gerar - só "MD
    // único" consegue produzir algo (a linha do tempo de movimentação).
    const semDocumentos = documentos.length === 0;
    atualizarEstadoRadiosConformeDocumentos();
    if (semDocumentos) {
      radioMdUnico.checked = true;
    }
    atualizarAvisoMdUnico();

    if (semDocumentos) {
      listaDocumentosEl.hidden = true;
      listaDocumentosEl.innerHTML = "";
    } else {
      listaDocumentosEl.hidden = false;
      renderizarLista(documentos);
    }

    atualizarEstadoBotaoBaixar();
    setStatus(
      semDocumentos
        ? `Nenhum documento anexado, mas ${movimentacao.length} evento(s) de movimentação encontrado(s) - só "MD único" está disponível.`
        : 'Documentos detectados. Escolha o que baixar e clique em "Baixar".'
    );
  } catch (e) {
    setStatus(
      "Nao foi possivel ler a pagina. Verifique se voce esta em uma pagina de processo do eproc e tente novamente."
    );
  }
});

btnBaixar.addEventListener("click", async () => {
  if (!estadoAtual.documentos.length && !estadoAtual.movimentacao.length) return;
  const opcoes = {
    individuais: radioIndividuais.checked,
    pdfUnico: radioPdfUnico.checked,
    mdUnico: radioMdUnico.checked,
  };

  btnBaixar.disabled = true;
  btnDetectar.disabled = true;
  radioIndividuais.disabled = true;
  radioPdfUnico.disabled = true;
  radioMdUnico.disabled = true;
  areaProgresso.hidden = false;
  barraProgresso.value = 0;
  barraProgresso.max = Math.max(estadoAtual.documentos.length, 1);
  textoProgresso.textContent = `0 / ${estadoAtual.documentos.length}`;
  areaErros.hidden = true;
  setStatus("Baixando...");

  chrome.runtime.sendMessage({
    tipo: "BAIXAR_DOCUMENTOS",
    numeroProcesso: estadoAtual.numeroProcesso,
    documentos: estadoAtual.documentos,
    movimentacao: estadoAtual.movimentacao,
    opcoes,
  });
});

const areaRelatorioInfo = document.getElementById("area-relatorio-info");
const btnRelatorios = document.getElementById("btn-relatorios");
const btnAbrirTelaRelatorio = document.getElementById("btn-abrir-tela-relatorio");
const areaRelatorio = document.getElementById("area-relatorio");
const valorDespachoEl = document.getElementById("valor-despacho");
const valorSentencaEl = document.getElementById("valor-sentenca");
const valorDespachoUrgentesEl = document.getElementById("valor-despacho-urgentes");
const valorSentencaUrgentesEl = document.getElementById("valor-sentenca-urgentes");
const valorDespachoMais30DiasEl = document.getElementById("valor-despacho-mais30dias");
const valorSentencaMais30DiasEl = document.getElementById("valor-sentenca-mais30dias");
const valorSemMov30El = document.getElementById("valor-sem-mov-30");
const valorSemMov90El = document.getElementById("valor-sem-mov-90");
const valorSemMov120El = document.getElementById("valor-sem-mov-120");
const avisoUrgenciaEl = document.getElementById("aviso-urgencia");
const areaProgressoRelatorio = document.getElementById("area-progresso-relatorio");
const textoProgressoRelatorio = document.getElementById("texto-progresso-relatorio");
const areaErrosRelatorio = document.getElementById("area-erros-relatorio");

// Cada cartao (Exportar Documentos / Relatórios) tem sua propria area de
// status e de erros - mante-los separados evita que uma acao numa secao
// sobrescreva a mensagem que o usuario estava vendo na outra.
function setStatusRelatorio(texto) {
  areaRelatorioInfo.textContent = texto;
}

function formatarContagem(valor) {
  return valor === null || valor === undefined ? "?" : String(valor);
}

const botoesValorRelatorio = [
  valorDespachoEl,
  valorSentencaEl,
  valorDespachoUrgentesEl,
  valorSentencaUrgentesEl,
  valorDespachoMais30DiasEl,
  valorSentencaMais30DiasEl,
  valorSemMov30El,
  valorSemMov90El,
  valorSemMov120El,
];

function definirBotoesValorHabilitados(habilitado) {
  for (const botao of botoesValorRelatorio) {
    botao.disabled = !habilitado || !botao.textContent || botao.textContent === "?";
  }
}

const modalEscolhaRelatorio = document.getElementById("modal-escolha-relatorio");
const modalBtnAbrir = document.getElementById("modal-btn-abrir");
const modalBtnExcel = document.getElementById("modal-btn-excel");
const modalBtnCancelar = document.getElementById("modal-btn-cancelar");

let pedidoRelatorioPendente = null;

function abrirModalEscolhaRelatorio(pedido) {
  pedidoRelatorioPendente = pedido;
  modalEscolhaRelatorio.hidden = false;
}

function fecharModalEscolhaRelatorio() {
  modalEscolhaRelatorio.hidden = true;
  pedidoRelatorioPendente = null;
}

// Clicar num numero do relatorio (ex.: "+30 dias" da Sentença, ou "90
// dias" do demonstrativo de processos sem movimentação) abre um modal
// perguntando se o usuario quer so' abrir o relatório já consultado ou
// tambem exportar a planilha Excel que o proprio eproc gera para aquele
// resultado. So' depois da escolha e' que a aba atual/visivel navega e
// consulta de fato.
for (const botao of botoesValorRelatorio) {
  botao.addEventListener("click", () => {
    abrirModalEscolhaRelatorio({
      categoria: botao.dataset.tipo || "situacao",
      situacao: botao.dataset.situacao,
      filtro: botao.dataset.filtro,
    });
  });
}

async function executarAberturaRelatorio(pedido, exportarExcel) {
  definirBotoesValorHabilitados(false);
  btnRelatorios.disabled = true;
  btnAbrirTelaRelatorio.disabled = true;
  areaErrosRelatorio.hidden = true;
  setStatusRelatorio(
    exportarExcel
      ? "Abrindo o relatório e exportando a planilha em uma nova aba (sua aba atual não é alterada)..."
      : "Abrindo o relatório detalhado em uma nova aba (sua aba atual não é alterada)..."
  );

  try {
    const resposta = await chrome.runtime.sendMessage({
      tipo: "ABRIR_RELATORIO_PREENCHIDO",
      categoria: pedido.categoria,
      situacao: pedido.situacao,
      filtro: pedido.filtro,
      exportarExcel,
    });
    if (!resposta || !resposta.ok) {
      throw new Error((resposta && resposta.erro) || "Falha ao abrir o relatório detalhado.");
    }
  } catch (e) {
    setStatusRelatorio("Erro ao abrir o relatório detalhado.");
    areaErrosRelatorio.hidden = false;
    areaErrosRelatorio.textContent = e && e.message ? e.message : String(e);
    definirBotoesValorHabilitados(true);
    btnRelatorios.disabled = false;
    btnAbrirTelaRelatorio.disabled = false;
  }
  // Em caso de sucesso, os botoes sao reabilitados quando chegar a
  // mensagem RELATORIO_PREENCHIDO_FINALIZADO (o fluxo demora alguns
  // segundos, envolvendo navegacao de pagina).
}

modalBtnAbrir.addEventListener("click", () => {
  const pedido = pedidoRelatorioPendente;
  fecharModalEscolhaRelatorio();
  if (pedido) executarAberturaRelatorio(pedido, false);
});

modalBtnExcel.addEventListener("click", () => {
  const pedido = pedidoRelatorioPendente;
  fecharModalEscolhaRelatorio();
  if (pedido) executarAberturaRelatorio(pedido, true);
});

modalBtnCancelar.addEventListener("click", () => {
  fecharModalEscolhaRelatorio();
});

btnRelatorios.addEventListener("click", async () => {
  btnRelatorios.disabled = true;
  btnAbrirTelaRelatorio.disabled = true;
  areaErrosRelatorio.hidden = true;
  areaRelatorio.hidden = true;
  areaProgressoRelatorio.hidden = false;
  textoProgressoRelatorio.textContent = "Iniciando...";
  setStatusRelatorio("Gerando relatório em segundo plano (sua aba atual não é alterada)...");

  // So' confirma que o processamento comecou (resposta imediata do
  // background); o resultado final chega depois via a mensagem
  // RELATORIO_FINALIZADO, tratada no listener mais abaixo. Nao dá para
  // esperar uma unica resposta pelo fim de um fluxo que demora varios
  // segundos e passa por navegacoes de pagina - isso e' o que deixava o
  // progresso pendurado em "Finalizando" para sempre.
  try {
    const resposta = await chrome.runtime.sendMessage({ tipo: "GERAR_RELATORIO" });
    if (!resposta || !resposta.ok) {
      throw new Error((resposta && resposta.erro) || "Falha desconhecida ao iniciar o relatório.");
    }
  } catch (e) {
    setStatusRelatorio("Erro ao iniciar o relatório.");
    areaErrosRelatorio.hidden = false;
    areaErrosRelatorio.textContent = e && e.message ? e.message : String(e);
    areaProgressoRelatorio.hidden = true;
    btnRelatorios.disabled = false;
    btnAbrirTelaRelatorio.disabled = false;
  }
});

btnAbrirTelaRelatorio.addEventListener("click", async () => {
  btnAbrirTelaRelatorio.disabled = true;
  areaErrosRelatorio.hidden = true;
  setStatusRelatorio("Abrindo a tela do Relatório Geral nesta aba...");

  try {
    const resposta = await chrome.runtime.sendMessage({ tipo: "ABRIR_TELA_RELATORIO" });
    if (!resposta || !resposta.ok) {
      throw new Error((resposta && resposta.erro) || "Falha ao abrir a tela do relatório.");
    }
    setStatusRelatorio("Tela do Relatório Geral aberta nesta aba.");
  } catch (e) {
    setStatusRelatorio("Erro ao abrir a tela do relatório.");
    areaErrosRelatorio.hidden = false;
    areaErrosRelatorio.textContent = e && e.message ? e.message : String(e);
  } finally {
    btnAbrirTelaRelatorio.disabled = false;
  }
});

const areaBtnRelatorioGerencial = document.getElementById("area-btn-relatorio-gerencial");
const btnRelatorioGerencialUnidade = document.getElementById("btn-relatorio-gerencial-unidade");
const areaProgressoUnidades = document.getElementById("area-progresso-unidades");
const textoProgressoUnidades = document.getElementById("texto-progresso-unidades");
const areaSelectUnidade = document.getElementById("area-select-unidade");
const selectUnidadeRelatorio = document.getElementById("select-unidade-relatorio");

// O botao "Relatório Gerencial da Unidade" so' aparece quando o perfil
// ativo da aba atual (select#selInfraUnidades no cabecalho do eproc) e'
// "CORREGEDORIA" - reavaliado sempre que o usuario troca de aba ou
// navega, ja' que o painel lateral permanece aberto durante isso.
async function atualizarBotaoRelatorioGerencial() {
  try {
    const aba = await getAbaAtiva();
    if (!aba || !aba.id) {
      areaBtnRelatorioGerencial.hidden = true;
      return;
    }
    const resposta = await chrome.tabs.sendMessage(aba.id, { tipo: "LER_PERFIL_ATUAL" }).catch(() => null);
    areaBtnRelatorioGerencial.hidden = !(resposta && resposta.perfil === "CORREGEDORIA");
  } catch (e) {
    areaBtnRelatorioGerencial.hidden = true;
  }
}

btnRelatorioGerencialUnidade.addEventListener("click", async () => {
  btnRelatorioGerencialUnidade.disabled = true;
  areaErrosRelatorio.hidden = true;
  areaSelectUnidade.hidden = true;
  areaProgressoUnidades.hidden = false;
  textoProgressoUnidades.textContent = "Iniciando...";
  setStatusRelatorio("Abrindo o Relatório Geral e lendo as unidades disponíveis (sua aba atual será navegada)...");

  // Mesmo padrao das demais operacoes em segundo plano: so' confirma que
  // comecou; o resultado final chega pela mensagem
  // UNIDADES_RELATORIO_FINALIZADO.
  try {
    const resposta = await chrome.runtime.sendMessage({ tipo: "LISTAR_UNIDADES_RELATORIO_GERAL" });
    if (!resposta || !resposta.ok) {
      throw new Error((resposta && resposta.erro) || "Falha desconhecida ao iniciar o carregamento.");
    }
  } catch (e) {
    setStatusRelatorio("Erro ao carregar as unidades.");
    areaErrosRelatorio.hidden = false;
    areaErrosRelatorio.textContent = e && e.message ? e.message : String(e);
    areaProgressoUnidades.hidden = true;
    btnRelatorioGerencialUnidade.disabled = false;
  }
});

chrome.tabs.onActivated.addListener(atualizarBotaoRelatorioGerencial);
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") atualizarBotaoRelatorioGerencial();
});
atualizarBotaoRelatorioGerencial();

chrome.runtime.onMessage.addListener((mensagem) => {
  if (!mensagem) return;

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
    setStatus(`Concluido! Arquivos salvos em Downloads/${mensagem.pasta}`);
    if (mensagem.erros && mensagem.erros.length > 0) {
      areaErros.hidden = false;
      areaErros.textContent =
        `${mensagem.erros.length} erro(s): ` +
        mensagem.erros.map((e) => `${e.nome} (${e.mensagem})`).join("; ");
    }
  }

  if (mensagem.tipo === "PROGRESSO_RELATORIO") {
    textoProgressoRelatorio.textContent = mensagem.texto || "Processando...";
    setStatusRelatorio(mensagem.texto || "Processando...");
  }

  if (mensagem.tipo === "RELATORIO_FINALIZADO") {
    areaProgressoRelatorio.hidden = true;
    btnRelatorios.disabled = false;
    btnAbrirTelaRelatorio.disabled = false;

    if (mensagem.ok) {
      const resultado = mensagem.resultado || {};
      const despacho = resultado.despacho || {};
      const sentenca = resultado.sentenca || {};

      valorDespachoEl.textContent = formatarContagem(despacho.total);
      valorDespachoUrgentesEl.textContent = formatarContagem(despacho.urgentes);
      valorDespachoMais30DiasEl.textContent = formatarContagem(despacho.mais30Dias);

      valorSentencaEl.textContent = formatarContagem(sentenca.total);
      valorSentencaUrgentesEl.textContent = formatarContagem(sentenca.urgentes);
      valorSentencaMais30DiasEl.textContent = formatarContagem(sentenca.mais30Dias);

      const semMovimentacao = resultado.semMovimentacao || {};
      valorSemMov30El.textContent = formatarContagem(semMovimentacao.dias30);
      valorSemMov90El.textContent = formatarContagem(semMovimentacao.dias90);
      valorSemMov120El.textContent = formatarContagem(semMovimentacao.dias120);

      areaRelatorio.hidden = false;
      definirBotoesValorHabilitados(true);

      const avisos = [
        ...(despacho.erros || []),
        ...(sentenca.erros || []),
        ...(semMovimentacao.erros || []),
      ];
      if (avisos.length > 0) {
        avisoUrgenciaEl.hidden = false;
        avisoUrgenciaEl.textContent = `Alguns valores não puderam ser determinados: ${avisos.join(" | ")}`;
      } else {
        avisoUrgenciaEl.hidden = true;
      }

      setStatusRelatorio("Relatório gerado com sucesso.");
    } else {
      setStatusRelatorio("Erro ao gerar o relatório.");
      areaErrosRelatorio.hidden = false;
      areaErrosRelatorio.textContent = mensagem.erro || "Falha desconhecida ao gerar o relatório.";
    }
  }

  if (mensagem.tipo === "RELATORIO_PREENCHIDO_FINALIZADO") {
    definirBotoesValorHabilitados(true);
    btnRelatorios.disabled = false;
    btnAbrirTelaRelatorio.disabled = false;

    if (mensagem.ok) {
      setStatusRelatorio("Relatório detalhado aberto em uma nova aba.");
    } else {
      setStatusRelatorio("Erro ao abrir o relatório detalhado.");
      areaErrosRelatorio.hidden = false;
      areaErrosRelatorio.textContent =
        mensagem.erro || "Falha desconhecida ao abrir o relatório detalhado.";
    }
  }

  if (mensagem.tipo === "PROGRESSO_UNIDADES_RELATORIO") {
    textoProgressoUnidades.textContent = mensagem.texto || "Processando...";
    setStatusRelatorio(mensagem.texto || "Processando...");
  }

  if (mensagem.tipo === "UNIDADES_RELATORIO_FINALIZADO") {
    areaProgressoUnidades.hidden = true;
    btnRelatorioGerencialUnidade.disabled = false;

    if (mensagem.ok) {
      const unidades = (mensagem.resultado && mensagem.resultado.unidades) || [];
      selectUnidadeRelatorio.innerHTML = '<option value="" selected disabled>Selecione uma unidade...</option>';
      for (const unidade of unidades) {
        const opcao = document.createElement("option");
        opcao.value = unidade.valor;
        opcao.textContent = unidade.texto;
        selectUnidadeRelatorio.appendChild(opcao);
      }
      areaSelectUnidade.hidden = unidades.length === 0;
      setStatusRelatorio(
        unidades.length > 0
          ? `${unidades.length} unidade(s) encontrada(s) no Relatório Geral.`
          : "Nenhuma unidade encontrada no filtro Órgão/Juízo."
      );
    } else {
      setStatusRelatorio("Erro ao carregar as unidades.");
      areaErrosRelatorio.hidden = false;
      areaErrosRelatorio.textContent =
        mensagem.erro || "Falha desconhecida ao carregar as unidades.";
    }
  }
});

const areaRegrasInfo = document.getElementById("area-regras-info");
const btnExportarRegras = document.getElementById("btn-exportar-regras");
const areaErrosRegras = document.getElementById("area-erros-regras");

function setStatusRegras(texto) {
  areaRegrasInfo.textContent = texto;
}

// Igual ao padrao ja' usado em "Localizadores do Órgão"/"Relatório
// Geral": roda tudo em segundo plano numa aba oculta que a propria
// extensao abre e navega, sem exigir que o usuario esteja (ou navegue
// manualmente) na tela "Automatizar Tramitação Processual". So' confirma
// que comecou; o resultado final chega pela mensagem REGRAS_FINALIZADO.
btnExportarRegras.addEventListener("click", async () => {
  btnExportarRegras.disabled = true;
  areaErrosRegras.hidden = true;
  setStatusRegras("Exportando regras em segundo plano (sua aba atual não é alterada)...");

  try {
    const resposta = await chrome.runtime.sendMessage({ tipo: "EXPORTAR_REGRAS_AUTOMACAO" });
    if (!resposta || !resposta.ok) {
      throw new Error((resposta && resposta.erro) || "Falha desconhecida ao iniciar a exportação.");
    }
  } catch (e) {
    setStatusRegras("Erro ao iniciar a exportação.");
    areaErrosRegras.hidden = false;
    areaErrosRegras.textContent = e && e.message ? e.message : String(e);
    btnExportarRegras.disabled = false;
  }
});

const areaLocalizadoresInfo = document.getElementById("area-localizadores-info");
const chkLocalizadoresPdf = document.getElementById("chk-localizadores-pdf");
const chkLocalizadoresExcel = document.getElementById("chk-localizadores-excel");
const btnExportarLocalizadores = document.getElementById("btn-exportar-localizadores");
const areaProgressoLocalizadores = document.getElementById("area-progresso-localizadores");
const textoProgressoLocalizadores = document.getElementById("texto-progresso-localizadores");
const areaErrosLocalizadores = document.getElementById("area-erros-localizadores");

function setStatusLocalizadores(texto) {
  areaLocalizadoresInfo.textContent = texto;
}

btnExportarLocalizadores.addEventListener("click", async () => {
  const formatos = { pdf: chkLocalizadoresPdf.checked, excel: chkLocalizadoresExcel.checked };
  if (!formatos.pdf && !formatos.excel) {
    areaErrosLocalizadores.hidden = false;
    areaErrosLocalizadores.textContent = "Marque ao menos um formato (PDF ou Excel).";
    return;
  }

  btnExportarLocalizadores.disabled = true;
  areaErrosLocalizadores.hidden = true;
  areaProgressoLocalizadores.hidden = false;
  textoProgressoLocalizadores.textContent = "Iniciando...";
  setStatusLocalizadores(
    "Exportando localizadores em segundo plano (percorrendo todas as páginas da listagem)..."
  );

  // Mesmo padrao de GERAR_RELATORIO: so' confirma que comecou; o
  // resultado final chega pela mensagem LOCALIZADORES_FINALIZADO.
  try {
    const resposta = await chrome.runtime.sendMessage({ tipo: "EXPORTAR_LOCALIZADORES", formatos });
    if (!resposta || !resposta.ok) {
      throw new Error((resposta && resposta.erro) || "Falha desconhecida ao iniciar a exportação.");
    }
  } catch (e) {
    setStatusLocalizadores("Erro ao iniciar a exportação.");
    areaErrosLocalizadores.hidden = false;
    areaErrosLocalizadores.textContent = e && e.message ? e.message : String(e);
    areaProgressoLocalizadores.hidden = true;
    btnExportarLocalizadores.disabled = false;
  }
});

chrome.runtime.onMessage.addListener((mensagem) => {
  if (!mensagem) return;

  if (mensagem.tipo === "PROGRESSO_LOCALIZADORES") {
    textoProgressoLocalizadores.textContent = mensagem.texto || "Processando...";
    setStatusLocalizadores(mensagem.texto || "Processando...");
  }

  if (mensagem.tipo === "LOCALIZADORES_FINALIZADO") {
    areaProgressoLocalizadores.hidden = true;
    btnExportarLocalizadores.disabled = false;

    if (mensagem.ok) {
      const resultado = mensagem.resultado || {};
      setStatusLocalizadores(
        `Concluído! ${resultado.total || 0} localizador(es) exportado(s) para Downloads/eproc/.` +
          (resultado.erroColeta ? ` Aviso: ${resultado.erroColeta}` : "")
      );
    } else {
      setStatusLocalizadores("Erro ao exportar os localizadores.");
      areaErrosLocalizadores.hidden = false;
      areaErrosLocalizadores.textContent =
        mensagem.erro || "Falha desconhecida ao exportar os localizadores.";
    }
  }

  if (mensagem.tipo === "PROGRESSO_REGRAS") {
    setStatusRegras(mensagem.texto || "Processando...");
  }

  if (mensagem.tipo === "REGRAS_FINALIZADO") {
    btnExportarRegras.disabled = false;

    if (mensagem.ok) {
      const resultado = mensagem.resultado || {};
      setStatusRegras(`${resultado.total || 0} regra(s) ativa(s) exportada(s) em uma nova aba.`);
    } else {
      setStatusRegras("Erro ao exportar as regras.");
      areaErrosRegras.hidden = false;
      areaErrosRegras.textContent = mensagem.erro || "Falha desconhecida ao exportar as regras.";
    }
  }

  if (mensagem.tipo === "PROGRESSO_LISTAR_LOCALIZADORES") {
    textoProgressoNavLocalizadores.textContent = mensagem.texto || "Processando...";
    setStatusNavLocalizadores(mensagem.texto || "Processando...");
  }

  if (mensagem.tipo === "LISTAR_LOCALIZADORES_FINALIZADO") {
    areaProgressoNavLocalizadores.hidden = true;
    btnCarregarLocalizadores.disabled = false;

    if (mensagem.ok) {
      const resultado = mensagem.resultado || {};
      const localizadores = resultado.localizadores || [];
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
      setStatusNavLocalizadores("Erro ao carregar os localizadores.");
      areaErrosNavLocalizadores.hidden = false;
      areaErrosNavLocalizadores.textContent =
        mensagem.erro || "Falha desconhecida ao carregar os localizadores.";
    }
  }

  if (mensagem.tipo === "PROGRESSO_PROCESSOS_LOCALIZADOR") {
    textoProgressoProcessosLocalizador.textContent = mensagem.texto || "Processando...";
    setStatusNavLocalizadores(mensagem.texto || "Processando...");
  }

  if (mensagem.tipo === "PROCESSOS_LOCALIZADOR_FINALIZADO") {
    areaProgressoProcessosLocalizador.hidden = true;
    btnExportarProcessosLocalizador.disabled = false;

    if (mensagem.ok) {
      const resultado = mensagem.resultado || {};
      setStatusNavLocalizadores(
        `Concluído! ${resultado.total || 0} processo(s) exportado(s) para Downloads/eproc/.` +
          (resultado.erroColeta ? ` Aviso: ${resultado.erroColeta}` : "")
      );
    } else {
      setStatusNavLocalizadores("Erro ao exportar os processos do localizador.");
      areaErrosNavLocalizadores.hidden = false;
      areaErrosNavLocalizadores.textContent =
        mensagem.erro || "Falha desconhecida ao exportar os processos do localizador.";
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

// Guarda a ultima lista carregada (nome + urlProcessos de cada
// localizador) para poder identificar qual localizador esta' selecionado
// no dropdown na hora de exportar o relatorio de processos dele.
let localizadoresCarregados = [];

function setStatusNavLocalizadores(texto) {
  areaNavLocalizadoresInfo.textContent = texto;
}

btnCarregarLocalizadores.addEventListener("click", async () => {
  btnCarregarLocalizadores.disabled = true;
  areaErrosNavLocalizadores.hidden = true;
  areaSelectLocalizador.hidden = true;
  areaAcoesLocalizador.hidden = true;
  areaProgressoNavLocalizadores.hidden = false;
  textoProgressoNavLocalizadores.textContent = "Iniciando...";
  setStatusNavLocalizadores(
    "Carregando localizadores em segundo plano (percorrendo todas as páginas da listagem)..."
  );

  // Mesmo padrao de EXPORTAR_LOCALIZADORES: so' confirma que comecou; o
  // resultado final chega pela mensagem LISTAR_LOCALIZADORES_FINALIZADO.
  try {
    const resposta = await chrome.runtime.sendMessage({ tipo: "LISTAR_LOCALIZADORES_COM_PROCESSOS" });
    if (!resposta || !resposta.ok) {
      throw new Error((resposta && resposta.erro) || "Falha desconhecida ao iniciar o carregamento.");
    }
  } catch (e) {
    setStatusNavLocalizadores("Erro ao iniciar o carregamento.");
    areaErrosNavLocalizadores.hidden = false;
    areaErrosNavLocalizadores.textContent = e && e.message ? e.message : String(e);
    areaProgressoNavLocalizadores.hidden = true;
    btnCarregarLocalizadores.disabled = false;
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
    setStatusNavLocalizadores("Erro ao iniciar a exportação.");
    areaErrosNavLocalizadores.hidden = false;
    areaErrosNavLocalizadores.textContent = e && e.message ? e.message : String(e);
    areaProgressoProcessosLocalizador.hidden = true;
    btnExportarProcessosLocalizador.disabled = false;
  }
});
