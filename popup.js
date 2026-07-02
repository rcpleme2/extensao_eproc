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
      listaDocumentosEl.innerHTML = "";
      return;
    }

    estadoAtual = resposta;
    numeroProcessoEl.textContent = resposta.numeroProcesso;
    totalDocumentosEl.textContent = String(resposta.documentos.length);
    areaProcesso.hidden = false;
    areaOpcoes.hidden = false;
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

const btnRelatorios = document.getElementById("btn-relatorios");
const btnAbrirTelaRelatorio = document.getElementById("btn-abrir-tela-relatorio");
const areaRelatorio = document.getElementById("area-relatorio");
const valorDespachoEl = document.getElementById("valor-despacho");
const valorSentencaEl = document.getElementById("valor-sentenca");
const valorDespachoUrgentesEl = document.getElementById("valor-despacho-urgentes");
const valorSentencaUrgentesEl = document.getElementById("valor-sentenca-urgentes");
const avisoUrgenciaEl = document.getElementById("aviso-urgencia");
const areaProgressoRelatorio = document.getElementById("area-progresso-relatorio");
const textoProgressoRelatorio = document.getElementById("texto-progresso-relatorio");

function formatarContagem(valor) {
  return valor === null || valor === undefined ? "?" : String(valor);
}

btnRelatorios.addEventListener("click", async () => {
  btnRelatorios.disabled = true;
  btnAbrirTelaRelatorio.disabled = true;
  areaErros.hidden = true;
  areaRelatorio.hidden = true;
  areaProgressoRelatorio.hidden = false;
  textoProgressoRelatorio.textContent = "Iniciando...";
  setStatus("Gerando relatório em segundo plano (sua aba atual não é alterada)...");

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
    setStatus("Erro ao iniciar o relatório.");
    areaErros.hidden = false;
    areaErros.textContent = e && e.message ? e.message : String(e);
    areaProgressoRelatorio.hidden = true;
    btnRelatorios.disabled = false;
    btnAbrirTelaRelatorio.disabled = false;
  }
});

btnAbrirTelaRelatorio.addEventListener("click", async () => {
  btnAbrirTelaRelatorio.disabled = true;
  areaErros.hidden = true;
  setStatus("Abrindo a tela do Relatório Geral nesta aba...");

  try {
    const resposta = await chrome.runtime.sendMessage({ tipo: "ABRIR_TELA_RELATORIO" });
    if (!resposta || !resposta.ok) {
      throw new Error((resposta && resposta.erro) || "Falha ao abrir a tela do relatório.");
    }
    setStatus("Tela do Relatório Geral aberta nesta aba.");
  } catch (e) {
    setStatus("Erro ao abrir a tela do relatório.");
    areaErros.hidden = false;
    areaErros.textContent = e && e.message ? e.message : String(e);
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
    setStatus(mensagem.texto || "Processando...");
  }

  if (mensagem.tipo === "RELATORIO_FINALIZADO") {
    areaProgressoRelatorio.hidden = true;
    btnRelatorios.disabled = false;
    btnAbrirTelaRelatorio.disabled = false;

    if (mensagem.ok) {
      const resultado = mensagem.resultado || {};
      valorDespachoEl.textContent = formatarContagem(resultado.conclusosDespacho);
      valorSentencaEl.textContent = formatarContagem(resultado.conclusosSentenca);
      valorDespachoUrgentesEl.textContent = formatarContagem(resultado.conclusosDespachoUrgentes);
      valorSentencaUrgentesEl.textContent = formatarContagem(resultado.conclusosSentencaUrgentes);
      areaRelatorio.hidden = false;

      const avisos = [resultado.avisoUrgenciaDespacho, resultado.avisoUrgenciaSentenca].filter(Boolean);
      if (avisos.length > 0) {
        avisoUrgenciaEl.hidden = false;
        avisoUrgenciaEl.textContent = `Não foi possível determinar a urgência em algum caso: ${avisos.join(
          " | "
        )}`;
      } else {
        avisoUrgenciaEl.hidden = true;
      }

      setStatus("Relatório gerado com sucesso.");
    } else {
      setStatus("Erro ao gerar o relatório.");
      areaErros.hidden = false;
      areaErros.textContent = mensagem.erro || "Falha desconhecida ao gerar o relatório.";
    }
  }
});
