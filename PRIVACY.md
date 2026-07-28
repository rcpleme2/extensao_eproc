# Política de Privacidade — Extensão Auxiliar eProc

**Extensão:** Extensão Auxiliar eProc (versão 6.4.0)
**Última atualização:** 22 de julho de 2026
**Contato do desenvolvedor:** rcpl@tjpr.jus.br

> Versão web (para colar no Chrome Web Store):
> https://rcpleme2.github.io/extensao_eproc/privacy.html

## 1. Resumo

A **Extensão Auxiliar eProc** funciona **inteiramente no seu navegador**. O
desenvolvedor **não opera nenhum servidor** e **não recebe, coleta, armazena ou
tem acesso a qualquer dado seu**. A extensão não usa analytics, telemetria,
cookies de rastreamento nem publicidade.

Dados só saem do seu navegador **quando você aciona uma funcionalidade de
Inteligência Artificial**. Nesse caso, o conteúdo é enviado **diretamente do seu
navegador para o provedor de IA que você escolher** (Anthropic ou Google), usando
**as chaves de API que você mesmo cadastrou**. O desenvolvedor não intermedeia
nem tem visibilidade sobre esse tráfego.

## 2. Quais dados a extensão trata

A extensão pode ler e processar, **localmente**, dentro da sua sessão autenticada
do eProc:

- **Conteúdo de processos e documentos** exibidos na aba ativa do eProc (texto,
  metadados de documentos, movimentações) — apenas quando você usa uma função da
  extensão.
- **Chaves de API** que você cadastra (Anthropic/Claude e Google Gemini).
- **Prompts, filas de processamento em lote e preferências** de configuração
  criados por você.

A extensão **não** acessa seu histórico de navegação, senhas, e-mails ou qualquer
site fora dos domínios do eProc e das APIs de IA declaradas.

## 3. Onde os dados ficam armazenados

Todas as informações (chaves de API, prompts, filas, preferências) são gravadas
**exclusivamente** no armazenamento local do seu navegador
(`chrome.storage.local`), no seu próprio dispositivo. **Nada é enviado ao
desenvolvedor.**

Você pode apagar esses dados a qualquer momento removendo a extensão ou limpando
os dados de navegação do Chrome/Edge.

## 4. Compartilhamento com terceiros

A extensão **não vende, aluga ou compartilha** seus dados para fins comerciais.

O único envio a terceiros ocorre **por sua ação explícita**, ao usar as funções
de IA, e vai diretamente ao provedor que você escolher:

- **Anthropic (Claude)** — `api.anthropic.com` — para análise de texto de
  documentos. Política de privacidade: https://www.anthropic.com/legal/privacy
- **Google (Gemini)** — `generativelanguage.googleapis.com` — para análise de
  texto e **transcrição de áudio/vídeo** de audiências. Política de privacidade:
  https://policies.google.com/privacy

Esses envios usam **as suas próprias chaves de API** e ficam sujeitos aos termos
e políticas de cada provedor. O desenvolvedor não tem acesso a esse conteúdo nem
às respostas.

## 5. Anonimização e seus limites

Antes de enviar **texto** para a IA, a extensão aplica uma anonimização
automática de melhor esforço (CPF, CNPJ, telefones, e-mails e endereços). **Essa
anonimização não é garantida como completa** e pode não remover todos os dados
sensíveis.

**Importante:** a transcrição de **áudio e vídeo** de audiências é enviada ao
Google Gemini **sem qualquer anonimização**. Avalie com cautela antes de enviar
conteúdo sigiloso ou sob segredo de justiça. O uso da extensão é de
responsabilidade do usuário quanto ao dever de sigilo processual.

## 6. O que a extensão NÃO faz

- Não envia dados ao desenvolvedor.
- Não possui servidores próprios.
- Não coleta analytics, telemetria ou estatísticas de uso.
- Não usa dados para publicidade ou para treinamento de modelos por parte do
  desenvolvedor.
- Não rastreia sua navegação.

## 7. Permissões e suas finalidades

| Permissão | Finalidade |
|---|---|
| `activeTab` / `scripting` | Ler os documentos do processo aberto na aba ativa do eProc quando você aciona a extensão. |
| `tabs` | Identificar se a aba atual é uma página do eProc. |
| `storage` | Salvar localmente chaves, prompts e preferências. |
| `downloads` | Exportar relatórios e documentos para o seu computador. |
| `sidePanel` | Exibir a interface da extensão no painel lateral. |
| `alarms` | Verificar periodicamente o resultado de análises enviadas em lote à Anthropic. |
| Acesso a `eproc1g.tjpr.jus.br` e `eproc1g.tre.tjpr.jus.br` | Ler as páginas do eProc na sua sessão autenticada. |
| Acesso a `api.anthropic.com` e `generativelanguage.googleapis.com` | Enviar conteúdo às APIs de IA que você escolher, com as suas chaves. |

## 8. Segurança

As chaves de API e demais dados permanecem no seu dispositivo. Toda comunicação
com o eProc e com as APIs de IA ocorre por HTTPS. Mantenha suas chaves em sigilo;
quem tiver acesso a elas poderá usar as respectivas contas de API.

## 9. Público

Trata-se de uma ferramenta profissional destinada ao uso funcional no âmbito
judiciário. Não se destina a menores de idade nem coleta dados de crianças.

## 10. Alterações desta política

Alterações serão publicadas nesta mesma URL, com atualização da data acima. O uso
continuado após mudanças implica concordância.

## 11. Contato

Dúvidas sobre esta política: rcpl@tjpr.jus.br
