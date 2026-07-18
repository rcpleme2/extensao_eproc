// Janela dedicada (aberta via chrome.windows.create pelo painel lateral,
// bem maior que a área útil do side panel) para revisar/editar com mais
// espaço o texto que será enviado à IA. Não fala com nenhuma API - só lê
// o texto de chrome.storage.local (gravado pelo painel antes de abrir
// esta janela) e devolve o texto final pelo mesmo mecanismo, já que
// janelas separadas não compartilham variáveis JS entre si.

const textoPreviewJanela = document.getElementById("texto-preview-janela");
const contadorPreviewJanela = document.getElementById("contador-preview-janela");
const btnUsarPreviewJanela = document.getElementById("btn-usar-preview-janela");
const btnCancelarPreviewJanela = document.getElementById("btn-cancelar-preview-janela");

const params = new URLSearchParams(window.location.search);
const chave = params.get("chave");

function atualizarContador() {
  contadorPreviewJanela.textContent = `${textoPreviewJanela.value.length.toLocaleString("pt-BR")} caractere(s)`;
}

if (chave) {
  chrome.storage.local.get([chave], (itens) => {
    const dados = itens[chave];
    textoPreviewJanela.value = (dados && dados.texto) || "";
    atualizarContador();
    textoPreviewJanela.focus();
  });
} else {
  contadorPreviewJanela.textContent = "Não foi possível carregar o texto (janela aberta sem contexto válido).";
}

textoPreviewJanela.addEventListener("input", atualizarContador);

btnUsarPreviewJanela.addEventListener("click", () => {
  if (!chave) {
    window.close();
    return;
  }
  // Grava o texto final na MESMA chave - o painel que abriu esta janela
  // está escutando chrome.storage.onChanged para essa chave e recolhe o
  // resultado assim que ele muda (ver "aoMudarStorage" em popup.js).
  chrome.storage.local.set({ [chave]: { textoFinal: textoPreviewJanela.value } }, () => {
    window.close();
  });
});

btnCancelarPreviewJanela.addEventListener("click", () => {
  window.close();
});
