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

// Configurações do painel (engrenagem no cabeçalho) - guardadas em
// chrome.storage.local (não sync: é preferência local deste navegador,
// não precisa seguir o usuário entre máquinas). O valor padrão preserva
// o comportamento de antes dessa opção existir (substituir a sigla já
// era feito sempre). A ordenação alfabética das listas em dropdowns NÃO
// é configurável - é sempre aplicada, direto onde cada dropdown é
// preenchido (handlers de UNIDADES_RELATORIO_FINALIZADO e
// LISTAR_LOCALIZADORES_FINALIZADO mais abaixo).
const CONFIG_PADRAO = {
  substituirSigla: true,
  separarOrgaoJuizoPorComarca: false,
  anexarMagistradoConclusos: true,
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

btnAbrirConfiguracoes.addEventListener("click", async () => {
  const config = await obterConfiguracoes();
  chkConfigSubstituirSigla.checked = config.substituirSigla;
  chkConfigSepararOrgaoJuizo.checked = config.separarOrgaoJuizoPorComarca;
  chkConfigAnexarMagistradoConclusos.checked = config.anexarMagistradoConclusos;
  modalConfiguracoes.hidden = false;
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
function aplicarStatus(el, texto, tipo) {
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
  // para nada acontecer escondido atras de um cartao colapsado.
  abrirCartaoDe(el);
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

function setStatus(texto, tipo) {
  aplicarStatus(areaStatus, texto, tipo);
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
  iniciarCronometroStatus(areaStatus);
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
const valorAtivosEl = document.getElementById("valor-ativos");
const valorSuspensosGeralEl = document.getElementById("valor-suspensos-geral");
const avisoUrgenciaEl = document.getElementById("aviso-urgencia");
const areaProgressoRelatorio = document.getElementById("area-progresso-relatorio");
const textoProgressoRelatorio = document.getElementById("texto-progresso-relatorio");
const areaErrosRelatorio = document.getElementById("area-erros-relatorio");

// Cada cartao (Exportar Documentos / Relatórios) tem sua propria area de
// status e de erros - mante-los separados evita que uma acao numa secao
// sobrescreva a mensagem que o usuario estava vendo na outra.
function setStatusRelatorio(texto, tipo) {
  aplicarStatus(areaRelatorioInfo, texto, tipo);
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
    setStatusRelatorio("Erro ao abrir o relatório detalhado.", "erro");
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
    setStatusRelatorio("Erro ao iniciar o relatório.", "erro");
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
    setStatusRelatorio("Tela do Relatório Geral aberta nesta aba.", "ok");
  } catch (e) {
    setStatusRelatorio("Erro ao abrir a tela do relatório.", "erro");
    areaErrosRelatorio.hidden = false;
    areaErrosRelatorio.textContent = e && e.message ? e.message : String(e);
  } finally {
    btnAbrirTelaRelatorio.disabled = false;
  }
});

const cardCorregedoria = document.getElementById("card-corregedoria");
const cardGestaoUnidade = document.getElementById("card-gestao-unidade");

// Perfil CORREGEDORIA não usa "Gestão da Unidade" (ela é do perfil de
// gestão da própria vara/juízo) - mas em vez de esconder o cartão como o
// de Corregedoria (que só existe para quem tem esse perfil), ele
// continua visível e desabilitado: sinaliza que a funcionalidade existe,
// só não se aplica ao perfil atual.
function definirGestaoUnidadeDesabilitada(desabilitada) {
  cardGestaoUnidade.classList.toggle("card--desabilitado", desabilitada);
  if (desabilitada) cardGestaoUnidade.open = false;
}

cardGestaoUnidade.querySelector(".card-titulo").addEventListener("click", (evento) => {
  if (cardGestaoUnidade.classList.contains("card--desabilitado")) {
    evento.preventDefault();
  }
});
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
const areaBtnExportarGerencial = document.getElementById("area-btn-exportar-gerencial");
const btnExportarRelatorioGerencial = document.getElementById("btn-exportar-relatorio-gerencial");
const areaProgressoRelatorioGerencial = document.getElementById("area-progresso-relatorio-gerencial");
const textoProgressoRelatorioGerencial = document.getElementById("texto-progresso-relatorio-gerencial");
// Relatório Geral (panorama) desativado por enquanto - ver comentário em
// popup.html no lugar do botão. Refs comentadas junto para não quebrar
// (document.getElementById de um id que não existe mais no DOM).
// const btnRelatorioPanoramico = document.getElementById("btn-relatorio-panoramico");
// const areaProgressoPanoramico = document.getElementById("area-progresso-panoramico");
// const textoProgressoPanoramico = document.getElementById("texto-progresso-panoramico");
const areaErrosCorregedoria = document.getElementById("area-erros-corregedoria");

// A unidade escolhida no dropdown (nome + valor do filtro Órgão/Juízo) -
// e' o "campo com a escolha da unidade" que todo relatório deste painel
// da Corregedoria precisa conferir antes de rodar (ver
// "exigirUnidadeSelecionada" abaixo).
let unidadeSelecionadaCorregedoria = null;

// Algumas comarcas do Paraná tem "de" no PRÓPRIO nome (ex.: "Cândido de
// Abreu") - separar pelo ÚLTIMO " de " cortaria errado nesses casos (ex.:
// "... do Juízo Único de Cândido de Abreu" viraria comarca "Abreu" em vez
// de "Cândido de Abreu", já que o último " de " fica DENTRO do próprio
// nome da comarca). Lista de exceções conhecidas: quando o nome termina
// com uma delas, a comarca é a exceção inteira, sem tentar nenhum split.
const COMARCAS_COM_DE_NO_NOME = ["Cândido de Abreu"];

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
// uma unidade foi escolhida antes de rodar - lanca erro com uma mensagem
// clara em vez de deixar a operacao seguir sem saber de qual unidade
// extrair os dados.
function exigirUnidadeSelecionada() {
  if (!unidadeSelecionadaCorregedoria || !unidadeSelecionadaCorregedoria.valor) {
    throw new Error('Selecione uma unidade na lista antes de gerar este relatório.');
  }
  return unidadeSelecionadaCorregedoria;
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
      definirGestaoUnidadeDesabilitada(false);
      return;
    }
    const resposta = await chrome.tabs.sendMessage(aba.id, { tipo: "LER_PERFIL_ATUAL" }).catch(() => null);
    const ehCorregedoria = Boolean(resposta && resposta.perfil === "CORREGEDORIA");
    cardCorregedoria.hidden = !ehCorregedoria;
    definirGestaoUnidadeDesabilitada(ehCorregedoria);
  } catch (e) {
    cardCorregedoria.hidden = true;
    definirGestaoUnidadeDesabilitada(false);
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
  unidadeSelecionadaCorregedoria = null;
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
  unidadeSelecionadaCorregedoria = null;
  areaUnidadeSelecionada.hidden = true;
  areaPersonalizarRelatorio.hidden = true;
  areaBtnExportarGerencial.hidden = true;

  selectUnidadeRelatorio.innerHTML = '<option value="" selected disabled>Selecione um juízo/vara...</option>';
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

// Ao escolher uma unidade no dropdown, preenche o campo indicando de
// onde a informação será extraída (e' esse campo que
// "exigirUnidadeSelecionada" confere antes de qualquer relatório deste
// painel) e libera o botao de exportar o relatorio consolidado.
selectUnidadeRelatorio.addEventListener("change", () => {
  const valor = selectUnidadeRelatorio.value;
  const opcaoSelecionada = selectUnidadeRelatorio.selectedOptions[0];
  if (!valor || !opcaoSelecionada) {
    unidadeSelecionadaCorregedoria = null;
    areaUnidadeSelecionada.hidden = true;
    areaPersonalizarRelatorio.hidden = true;
    areaBtnExportarGerencial.hidden = true;
    return;
  }
  unidadeSelecionadaCorregedoria = {
    valor,
    // O nome completo original (com "de <Comarca>") e' o que identifica a
    // unidade sem ambiguidade nos relatórios/PDFs - o texto exibido no
    // dropdown, so' o Juízo/Vara, e' so' pra' facilitar a escolha visual.
    nome: opcaoSelecionada.dataset.nomeCompleto || opcaoSelecionada.textContent,
  };
  areaUnidadeSelecionada.hidden = false;
  areaUnidadeSelecionada.textContent = `Informações serão extraídas de: ${unidadeSelecionadaCorregedoria.nome}`;
  areaPersonalizarRelatorio.hidden = false;
  areaBtnExportarGerencial.hidden = false;
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

btnExportarRelatorioGerencial.addEventListener("click", async () => {
  areaErrosCorregedoria.hidden = true;

  let unidade;
  try {
    unidade = exigirUnidadeSelecionada();
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
    `Gerando o Relatório para Correição de "${unidade.nome}" em segundo plano (sua aba atual será navegada)...`
  );

  // Mesmo padrao das demais operacoes em segundo plano: so' confirma que
  // comecou; o resultado final chega pela mensagem
  // RELATORIO_GERENCIAL_FINALIZADO.
  try {
    const resposta = await chrome.runtime.sendMessage({
      tipo: "EXPORTAR_RELATORIO_GERENCIAL_UNIDADE",
      valorUnidade: unidade.valor,
      nomeUnidade: unidade.nome,
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

// ---- Gestão da Unidade (alternativo) - experimental ----
// Mesmo Relatório para Correição do cartão Corregedoria, mas sem
// dropdown de unidade nenhum: reaproveita o filtro que a própria tela do
// eproc já aplica sozinha para o perfil logado (MAGISTRADO/GESTÃO DA
// UNIDADE), ja' restrito a' unidade habilitada na sessão - ver
// "exportarRelatorioUnidadeAtual" em background.js.
const areaRelatorioUnidadeAltInfo = document.getElementById("area-relatorio-unidade-alt-info");
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

  btnExportarRelatorioUnidadeAlt.disabled = true;
  areaProgressoRelatorioUnidadeAlt.hidden = false;
  textoProgressoRelatorioUnidadeAlt.textContent = "Iniciando...";
  iniciarCronometroStatus(areaRelatorioUnidadeAltInfo);
  setStatusUnidadeAlt("Gerando o Relatório da Unidade em segundo plano (sua aba atual será navegada)...");

  // Mesmo padrao das demais operacoes em segundo plano: so' confirma que
  // comecou; o resultado final chega pela mensagem
  // RELATORIO_UNIDADE_ATUAL_FINALIZADO.
  try {
    const resposta = await chrome.runtime.sendMessage({ tipo: "EXPORTAR_RELATORIO_UNIDADE_ATUAL", opcoes });
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

      const processosAtivos = resultado.processosAtivos || {};
      const suspensos = resultado.suspensos || {};
      valorAtivosEl.textContent = formatarContagem(processosAtivos.total);
      valorSuspensosGeralEl.textContent = formatarContagem(suspensos.total);

      areaRelatorio.hidden = false;
      definirBotoesValorHabilitados(true);

      const avisos = [
        ...(despacho.erros || []),
        ...(sentenca.erros || []),
        ...(semMovimentacao.erros || []),
        ...(processosAtivos.erros || []),
        ...(suspensos.erros || []),
      ];
      if (avisos.length > 0) {
        avisoUrgenciaEl.hidden = false;
        avisoUrgenciaEl.textContent = `Alguns valores não puderam ser determinados: ${avisos.join(" | ")}`;
      } else {
        avisoUrgenciaEl.hidden = true;
      }

      setStatusRelatorio("Relatório gerado com sucesso.", "ok");
    } else {
      setStatusRelatorio("Erro ao gerar o relatório.", "erro");
      areaErrosRelatorio.hidden = false;
      areaErrosRelatorio.textContent = mensagem.erro || "Falha desconhecida ao gerar o relatório.";
    }
  }

  if (mensagem.tipo === "RELATORIO_PREENCHIDO_FINALIZADO") {
    definirBotoesValorHabilitados(true);
    btnRelatorios.disabled = false;
    btnAbrirTelaRelatorio.disabled = false;

    if (mensagem.ok) {
      setStatusRelatorio("Relatório detalhado aberto em uma nova aba.", "ok");
    } else {
      setStatusRelatorio("Erro ao abrir o relatório detalhado.", "erro");
      areaErrosRelatorio.hidden = false;
      areaErrosRelatorio.textContent =
        mensagem.erro || "Falha desconhecida ao abrir o relatório detalhado.";
    }
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
      selectUnidadeRelatorio.innerHTML = '<option value="" selected disabled>Selecione um juízo/vara...</option>';
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
    textoProgressoRelatorioGerencial.textContent = mensagem.texto || "Processando...";
    setStatusCorregedoria(mensagem.texto || "Processando...");
  }

  if (mensagem.tipo === "RELATORIO_GERENCIAL_FINALIZADO") {
    areaProgressoRelatorioGerencial.hidden = true;
    btnExportarRelatorioGerencial.disabled = false;

    if (mensagem.ok) {
      const resultado = mensagem.resultado || {};
      setStatusCorregedoria(
        `Concluído! Relatório para Correição de "${resultado.unidade || ""}" salvo em Downloads/eproc/ (${
          resultado.totalLocalizadores || 0
        } localizador(es)).`,
        "ok"
      );
    } else {
      setStatusCorregedoria("Erro ao gerar o relatório gerencial.", "erro");
      areaErrosCorregedoria.hidden = false;
      areaErrosCorregedoria.textContent =
        mensagem.erro || "Falha desconhecida ao gerar o relatório gerencial.";
    }
  }

  if (mensagem.tipo === "PROGRESSO_RELATORIO_UNIDADE_ATUAL") {
    textoProgressoRelatorioUnidadeAlt.textContent = mensagem.texto || "Processando...";
    setStatusUnidadeAlt(mensagem.texto || "Processando...");
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

const areaRegrasInfo = document.getElementById("area-regras-info");
const btnExportarRegras = document.getElementById("btn-exportar-regras");
const areaErrosRegras = document.getElementById("area-erros-regras");
// const chkRegrasHtml = document.getElementById("chk-regras-html");
// const chkRegrasPdf = document.getElementById("chk-regras-pdf");

function setStatusRegras(texto, tipo) {
  aplicarStatus(areaRegrasInfo, texto, tipo);
}

// Igual ao padrao ja' usado em "Localizadores do Órgão"/"Relatório
// Geral": roda tudo em segundo plano numa aba oculta que a propria
// extensao abre e navega, sem exigir que o usuario esteja (ou navegue
// manualmente) na tela "Automatizar Tramitação Processual". So' confirma
// que comecou; o resultado final chega pela mensagem REGRAS_FINALIZADO.
// Escolha de formato (HTML/PDF) desativada por enquanto - o PDF passou a
// ser o único formato oferecido no painel (ver comentário equivalente em
// popup.html/background.js).
btnExportarRegras.addEventListener("click", async () => {
  btnExportarRegras.disabled = true;
  areaErrosRegras.hidden = true;
  iniciarCronometroStatus(areaRegrasInfo);
  setStatusRegras("Exportando regras em segundo plano (sua aba atual não é alterada)...");

  try {
    const resposta = await chrome.runtime.sendMessage({ tipo: "EXPORTAR_REGRAS_AUTOMACAO" });
    if (!resposta || !resposta.ok) {
      throw new Error((resposta && resposta.erro) || "Falha desconhecida ao iniciar a exportação.");
    }
  } catch (e) {
    setStatusRegras("Erro ao iniciar a exportação.", "erro");
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

function setStatusLocalizadores(texto, tipo) {
  aplicarStatus(areaLocalizadoresInfo, texto, tipo);
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
  iniciarCronometroStatus(areaLocalizadoresInfo);
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
    setStatusLocalizadores("Erro ao iniciar a exportação.", "erro");
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
          (resultado.erroColeta ? ` Aviso: ${resultado.erroColeta}` : ""),
        "ok"
      );
    } else {
      setStatusLocalizadores("Erro ao exportar os localizadores.", "erro");
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
      setStatusRegras(`${resultado.total || 0} regra(s) ativa(s) exportada(s) em um arquivo PDF baixado.`, "ok");
    } else {
      setStatusRegras("Erro ao exportar as regras.", "erro");
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
    textoProgressoDocumentosLocalizador.textContent = mensagem.texto || "Processando...";
    setStatusNavLocalizadores(mensagem.texto || "Processando...");
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

  // Mesmo padrao de EXPORTAR_LOCALIZADORES: so' confirma que comecou; o
  // resultado final chega pela mensagem LISTAR_LOCALIZADORES_FINALIZADO.
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
