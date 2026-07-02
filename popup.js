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
});

const areaRegrasInfo = document.getElementById("area-regras-info");
const btnExportarRegras = document.getElementById("btn-exportar-regras");
const areaErrosRegras = document.getElementById("area-erros-regras");

const PADRAO_URL_AUTOMATIZAR_LOCALIZADORES = "acao=automatizar_localizadores";

function setStatusRegras(texto) {
  areaRegrasInfo.textContent = texto;
}

// O botao so' fica habilitado quando a aba ativa esta' na tela
// "Automatizar Tramitação Processual" do eproc - reavaliado sempre que o
// usuario troca de aba ou navega, ja' que o painel lateral permanece
// aberto durante isso.
async function atualizarEstadoBotaoRegras() {
  try {
    const aba = await getAbaAtiva();
    const naPaginaCerta = !!(
      aba &&
      aba.url &&
      aba.url.includes(PADRAO_URL_AUTOMATIZAR_LOCALIZADORES)
    );
    btnExportarRegras.disabled = !naPaginaCerta;
    setStatusRegras(
      naPaginaCerta
        ? 'Pronto para exportar as regras ativas desta página.'
        : 'Abra a tela "Automatizar Tramitação Processual" do eproc para habilitar a exportação.'
    );
  } catch (e) {
    btnExportarRegras.disabled = true;
  }
}

function escaparHtml(texto) {
  return String(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

      const fluxo = `
    <div class="fluxo">
      <div class="fluxo-caixa fluxo-origem">
        <div class="fluxo-caixa-titulo">Origem</div>
        <div>${escaparHtml(r.localizadorOrigem)}</div>
      </div>
      <div class="fluxo-seta" aria-hidden="true">&rarr;</div>
      <div class="fluxo-coluna">
        <div class="fluxo-caixa fluxo-criterio">
          <div class="fluxo-caixa-titulo">Critério</div>
          <div>${escaparHtml(r.criterioResumo)}</div>
          ${r.criterioAlternativas > 0 ? `<div class="fluxo-badge">+${r.criterioAlternativas} alternativa(s)</div>` : ""}
        </div>
        ${fluxoExtra}
      </div>
      <div class="fluxo-seta" aria-hidden="true">&rarr;</div>
      <div class="fluxo-caixa fluxo-destino">
        <div class="fluxo-caixa-titulo">Destino</div>
        <div>${escaparHtml(r.destinoResumo)}</div>
      </div>
      ${
        r.acaoResumo
          ? `<div class="fluxo-seta" aria-hidden="true">&rarr;</div>
      <div class="fluxo-caixa fluxo-acao">
        <div class="fluxo-caixa-titulo">Ação automatizada</div>
        <div>${escaparHtml(r.acaoResumo)}</div>
      </div>`
          : ""
      }
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
  .fluxo { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:14px; }
  .fluxo-caixa { background:#f4f7fa; border:1px solid #c8d6e0; border-radius:6px; padding:7px 10px; font-size:12px; line-height:1.4; max-width:220px; }
  .fluxo-caixa-titulo { font-size:9.5px; text-transform:uppercase; letter-spacing:0.03em; font-weight:700; color:#2c6ea6; margin-bottom:2px; }
  .fluxo-origem { background:#eef1f5; border-color:#c3cdd6; }
  .fluxo-criterio { background:#fff6e0; border-color:#f0d68a; }
  .fluxo-criterio .fluxo-caixa-titulo { color:#8a6d00; }
  .fluxo-destino { background:#e9f7ee; border-color:#a9dcb9; }
  .fluxo-destino .fluxo-caixa-titulo { color:#1a7f37; }
  .fluxo-acao { background:#eef1fd; border-color:#c2caf5; }
  .fluxo-acao .fluxo-caixa-titulo { color:#3d4fc4; }
  .fluxo-seta { font-size:16px; color:#9aa7b0; }
  .fluxo-coluna { display:flex; flex-direction:column; gap:4px; }
  .fluxo-extra { font-size:11px; color:#666; max-width:220px; }
  .fluxo-badge { font-size:10px; color:#888; margin-top:2px; }
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

btnExportarRegras.addEventListener("click", async () => {
  btnExportarRegras.disabled = true;
  areaErrosRegras.hidden = true;
  setStatusRegras("Lendo as regras ativas da página...");

  try {
    const aba = await getAbaAtiva();
    const resposta = await chrome.tabs.sendMessage(aba.id, { tipo: "LISTAR_REGRAS_AUTOMACAO" });

    if (!resposta || !resposta.regras || resposta.regras.length === 0) {
      setStatusRegras("Nenhuma regra ativa encontrada nesta página.");
      return;
    }

    const html = construirDocumentoRegras(resposta.regras, resposta.tituloPagina);
    await chrome.tabs.create({ url: "data:text/html;charset=utf-8," + encodeURIComponent(html) });
    setStatusRegras(`${resposta.regras.length} regra(s) ativa(s) exportada(s) em uma nova aba.`);
  } catch (e) {
    setStatusRegras("Erro ao exportar as regras.");
    areaErrosRegras.hidden = false;
    areaErrosRegras.textContent = e && e.message ? e.message : String(e);
  } finally {
    atualizarEstadoBotaoRegras();
  }
});

chrome.tabs.onActivated.addListener(atualizarEstadoBotaoRegras);
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") atualizarEstadoBotaoRegras();
});
atualizarEstadoBotaoRegras();

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
});
