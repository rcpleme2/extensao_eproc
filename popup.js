const areaStatus = document.getElementById("area-status");
const btnDetectar = document.getElementById("btn-detectar");
const btnBaixar = document.getElementById("btn-baixar");
const areaProcesso = document.getElementById("area-processo");
const numeroProcessoEl = document.getElementById("numero-processo");
const totalDocumentosEl = document.getElementById("total-documentos");
const listaDocumentosEl = document.getElementById("lista-documentos");
const areaProgresso = document.getElementById("area-progresso");
const barraProgresso = document.getElementById("barra-progresso");
const textoProgresso = document.getElementById("texto-progresso");
const areaErros = document.getElementById("area-erros");

let estadoAtual = { numeroProcesso: null, documentos: [] };

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
      btnBaixar.disabled = true;
      areaProcesso.hidden = true;
      listaDocumentosEl.innerHTML = "";
      return;
    }

    estadoAtual = resposta;
    numeroProcessoEl.textContent = resposta.numeroProcesso;
    totalDocumentosEl.textContent = String(resposta.documentos.length);
    areaProcesso.hidden = false;
    renderizarLista(resposta.documentos);
    btnBaixar.disabled = false;
    setStatus("Documentos detectados. Clique em \"Baixar todos\" para exportar.");
  } catch (e) {
    setStatus(
      "Nao foi possivel ler a pagina. Verifique se voce esta em uma pagina de processo do eproc e tente novamente."
    );
  }
});

btnBaixar.addEventListener("click", async () => {
  if (!estadoAtual.documentos.length) return;
  btnBaixar.disabled = true;
  btnDetectar.disabled = true;
  areaProgresso.hidden = false;
  barraProgresso.value = 0;
  barraProgresso.max = estadoAtual.documentos.length;
  textoProgresso.textContent = `0 / ${estadoAtual.documentos.length}`;
  areaErros.hidden = true;
  setStatus("Baixando documentos...");

  chrome.runtime.sendMessage({
    tipo: "BAIXAR_DOCUMENTOS",
    numeroProcesso: estadoAtual.numeroProcesso,
    documentos: estadoAtual.documentos,
  });
});

chrome.runtime.onMessage.addListener((mensagem) => {
  if (!mensagem) return;

  if (mensagem.tipo === "PROGRESSO_DOWNLOAD") {
    barraProgresso.value = mensagem.concluidos;
    barraProgresso.max = mensagem.total;
    textoProgresso.textContent = `${mensagem.concluidos} / ${mensagem.total}`;
  }

  if (mensagem.tipo === "DOWNLOAD_FINALIZADO") {
    btnBaixar.disabled = false;
    btnDetectar.disabled = false;
    setStatus(`Concluido! Arquivos salvos em Downloads/${mensagem.pasta}`);
    if (mensagem.erros && mensagem.erros.length > 0) {
      areaErros.hidden = false;
      areaErros.textContent =
        `${mensagem.erros.length} erro(s): ` +
        mensagem.erros.map((e) => `${e.nome} (${e.mensagem})`).join("; ");
    }
  }
});
