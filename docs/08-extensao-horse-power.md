# Extensão Chrome — integração Sky Peças

A captura ativa neste repositório é a de peças do Sky Peças. O conector fica em
`extension/horse-power`; a integração do Tempario foi removida da extensão,
do painel e das rotas ativas do Sistema Oficinas. Não há scripts de captura,
permissões, botões ou APIs de Tempario ativos.

## Captura Sky Peças

O painel cria uma sessão curta vinculada à oficina, ao administrador, à
sessão autenticada e ao orçamento ou catálogo selecionado. A extensão guarda o
token em `chrome.storage.session`, acessível apenas a contextos confiáveis. A
fila de pendências guarda o destino original e os itens, sem token. Reenvios
mantêm o identificador de captura e não podem ser redirecionados a outro
orçamento ou oficina.

O worker aceita mensagens do frame principal do Sky Peças e da aplicação de
destino autorizada. O servidor valida sessão, permissão, status do atendimento,
placa quando disponível e duplicidade antes de registrar a captura. O popup
permite revisar envios pendentes, tentar novamente ou descartar os pendentes e
revogar a conexão.

Cada captura Sky corresponde a uma compra. O frete total, inicialmente R$ 17,50,
é rateado proporcionalmente ao custo total das peças (custo unitário ×
quantidade). Alterar o frete ou incluir outra peça recalcula os custos das
peças da mesma captura. A disponibilidade exibida pelo fornecedor não altera o
estoque da oficina.

Itens destinados a orçamento/OS ficam pendentes em `external_captures` até
**Concluir captura**. Antes da conclusão, o usuário pode editar a quantidade,
remover uma peça e revisar frete, custo e preço sugerido. Fechar no X descarta
os itens ainda pendentes. A confirmação materializa os itens no atendimento,
recalcula o total e revoga a sessão. Capturas diretas ao catálogo continuam
com o fluxo próprio de cadastro. Não há alteração de clientes ou veículos.

A placa normalizada do veículo cadastrado, ou a placa avulsa do orçamento, é
mantida apenas na sessão da extensão e pode preencher um campo de placa visível
e identificado no Sky Peças. O adaptador não aciona buscas nem consulta APIs
de placas. Campos ambíguos, ocultos, desabilitados e telas de login não são
preenchidos. Edições manuais são respeitadas.

## Extensão de teste INT-015

O pacote manual é gerado por `scripts/package-test-extension.mjs` durante o
build em `public/downloads/sistema-oficinas-test-extension.zip`. No GitHub
Actions, o mesmo pacote é publicado como artefato da execução do CI. A
instalação no Chrome é manual pelo modo desenvolvedor.

O pacote tem nome próprio, versão 0.1.0, armazenamento independente por
identificador de extensão e seletores próprios no Sky Peças. Suas permissões de
aplicação e o worker aceitam somente
`https://sistema-oficinas-homologacao.vercel.app`; ele não pode conectar à
produção nem aos domínios Horse Power. A permissão do fornecedor limita-se ao
Sky Peças. No Sky, o botão de teste é identificado como **S.O. Teste • Enviar**.
Pode ficar instalado junto com a extensão Horse Power da Chrome Web Store; não
altera os dados, as configurações ou as conexões da versão comercial.

Para instalar, baixe e extraia o ZIP em uma pasta permanente, abra
`chrome://extensions`, habilite o modo desenvolvedor e use **Carregar sem
compactação** para selecionar a pasta extraída. No Sky Peças, use apenas o
botão **S.O. Teste • Enviar** ao validar o Sistema Oficinas. A instalação
visual no Chrome e a captura com sessão autenticada ainda requerem validação
manual no navegador do usuário.

O cartão e o link de download da versão de teste só são exibidos na aplicação
de homologação. O workflow da Chrome Web Store deixou de publicar em pushes;
a publicação da versão comercial continua fora do fluxo INT-015 e exige ação
manual separada.

## Dados históricos e compatibilidade

A tarefa não remove tabelas nem registros persistentes. `service_times`,
`external_catalog_links` e os campos de origem/duração em recibos antigos
permanecem no banco e nos mecanismos de exportação e transferência para
preservar histórico. A API operacional de tempos e a página antiga foram
retiradas; novas capturas da extensão aceitam apenas Sky Peças. O catálogo
técnico próprio, serviços cadastrados e snapshots existentes em orçamentos e
OS não são migrados nem apagados.

O modo `tenants.catalog_mode='extension'` mantém o fluxo de importação do Sky
Peças sem alterar o catálogo técnico próprio. Cadastros manuais e serviços
continuam sob seus módulos próprios. Itens arquivados mantêm os snapshots
históricos nos documentos existentes.

## Verificação

Os testes cobrem mensagens e origens autorizadas do worker, contexto de placa,
frete proporcional, captura Sky, edição, duplicidade, descarte e conclusão.
Testes de regressão verificam a rejeição da origem removida, a ausência da API
operacional de tempos, a preservação de referências históricas e a estrutura
do ZIP de teste. A CI usa PostgreSQL 17 temporário com dados fictícios. Não
execute a verificação de origem publicada contra banco persistente sem
autorização específica.
