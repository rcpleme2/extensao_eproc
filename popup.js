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
const areaProgresso = document.getElementById("area-progresso");
const barraProgresso = document.getElementById("barra-progresso");
const textoProgresso = document.getElementById("texto-progresso");
const areaErros = document.getElementById("area-erros");

const ROTULO_FASE = {
  individuais: "Arquivos individuais",
  "pdf-unico": "PDF único",
};

let estadoAtual = { numeroProcesso: null, documentos: [] };

// Os dois modos sao mutuamente exclusivos (radio buttons), entao sempre
// ha' exatamente um marcado; so' falta ter documentos detectados.
function atualizarEstadoBotaoBaixar() {
  btnBaixar.disabled = estadoAtual.documentos.length === 0;
}

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

    if (!resposta || !resposta.documentos || resposta.documentos.length === 0) {
      setStatus(
        "Nenhum documento encontrado. Confirme que voce esta na pagina de detalhes do processo no eproc."
      );
      estadoAtual = { numeroProcesso: null, documentos: [] };
      atualizarEstadoBotaoBaixar();
      areaProcesso.hidden = true;
      areaOpcoes.hidden = true;
      listaDocumentosEl.hidden = true;
      listaDocumentosEl.innerHTML = "";
      return;
    }

    estadoAtual = resposta;
    numeroProcessoEl.textContent = resposta.numeroProcesso;
    totalDocumentosEl.textContent = String(resposta.documentos.length);
    areaProcesso.hidden = false;
    areaOpcoes.hidden = false;
    listaDocumentosEl.hidden = false;
    renderizarLista(resposta.documentos);
    atualizarEstadoBotaoBaixar();
    setStatus("Documentos detectados. Escolha o que baixar e clique em \"Baixar\".");
  } catch (e) {
    setStatus(
      "Nao foi possivel ler a pagina. Verifique se voce esta em uma pagina de processo do eproc e tente novamente."
    );
  }
});

btnBaixar.addEventListener("click", async () => {
  if (!estadoAtual.documentos.length) return;
  const opcoes = {
    individuais: radioIndividuais.checked,
    pdfUnico: radioPdfUnico.checked,
  };

  btnBaixar.disabled = true;
  btnDetectar.disabled = true;
  radioIndividuais.disabled = true;
  radioPdfUnico.disabled = true;
  areaProgresso.hidden = false;
  barraProgresso.value = 0;
  barraProgresso.max = estadoAtual.documentos.length;
  textoProgresso.textContent = `0 / ${estadoAtual.documentos.length}`;
  areaErros.hidden = true;
  setStatus("Baixando...");

  chrome.runtime.sendMessage({
    tipo: "BAIXAR_DOCUMENTOS",
    numeroProcesso: estadoAtual.numeroProcesso,
    documentos: estadoAtual.documentos,
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
      ? "Abrindo o relatório e exportando a planilha nesta aba..."
      : "Abrindo o relatório detalhado nesta aba..."
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

chrome.runtime.onMessage.addListener((mensagem) => {
  if (!mensagem) return;

  if (mensagem.tipo === "PROGRESSO_DOWNLOAD") {
    barraProgresso.value = mensagem.concluidos;
    barraProgresso.max = mensagem.total;
    const rotulo = ROTULO_FASE[mensagem.fase] || "";
    textoProgresso.textContent = `${rotulo ? rotulo + ": " : ""}${mensagem.concluidos} / ${mensagem.total}`;
    if (rotulo) setStatus(`Gerando ${rotulo.toLowerCase()}...`);
  }

  if (mensagem.tipo === "DOWNLOAD_FINALIZADO") {
    btnBaixar.disabled = false;
    btnDetectar.disabled = false;
    radioIndividuais.disabled = false;
    radioPdfUnico.disabled = false;
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
      setStatusRelatorio("Relatório detalhado aberto nesta aba.");
    } else {
      setStatusRelatorio("Erro ao abrir o relatório detalhado.");
      areaErrosRelatorio.hidden = false;
      areaErrosRelatorio.textContent =
        mensagem.erro || "Falha desconhecida ao abrir o relatório detalhado.";
    }
  }
});
