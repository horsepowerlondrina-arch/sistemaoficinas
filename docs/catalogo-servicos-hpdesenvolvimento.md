> Registro histórico do HPDesenvolvimento. Os 14 portes e o hash abaixo descrevem aquela versão; o contrato atual de quatro portes está em [CAT-009](CAT-009-quatro-portes.md).

# Catálogo operacional de serviços — HPDesenvolvimento

Publicado exclusivamente no Supabase `rapvlvstqcqordttqrru`, no schema privado `service_catalog`. Nenhuma migração ou importação foi executada no banco da oficina em produção.

## Conteúdo publicado

Versão `1.2-operacional`: 102 marcas, 14 portes, 7.534 modelos, 928 famílias, 928 bases compartilhadas, 6.491 identificadores de serviços e 836.093 registros de tempos. São 7.292.579 aplicações lógicas entre modelos e serviços, consultadas pelos vínculos de bases e possíveis diferenças por modelo, sem materializar milhões de linhas repetidas.

Não contém peças, quantidades ou histórico técnico de coleta. O catálogo original completo permanece como referência externa. Modelos, portes, códigos FIPE, identificadores, exclusões, serviços, nomes específicos de aplicação e tempos foram preservados. FIPE não é chave única; correspondências ambíguas exigirão confirmação na integração do veículo.

Arquivo operacional validado por SHA-256: `5557e09a16362452e1a5716164e9cc0e13d48a26140c1682ffdc5ae48b0eefaa`.

## Acesso

- As tabelas pertencem ao administrador do banco. O backend `horse_power_app` recebe somente SELECT, sem CREATE, INSERT, UPDATE, DELETE ou gestão de planos nessa área.
- Todas as tabelas possuem RLS habilitada e forçada. O schema não recebe permissões para `PUBLIC`, `anon`, `authenticated` ou `service_role`.
- A consulta exige versão ativa e liberação válida para a oficina atual em `service_catalog.tenant_access`. A condição identifica explicitamente `app.tenant_id`, além da RLS da própria tabela de liberações.
- A integração futura deverá iniciar uma transação e definir `set_config('app.tenant_id', tenantIdDaSessaoAutenticada, true)` nessa mesma transação. Nunca aceitar a oficina do corpo da requisição nem usar um SET persistente em uma conexão compartilhada.
- Sem contexto de oficina, sem liberação, com liberação desabilitada ou vencida, a política não permite consultar o catálogo. O contexto do tenant é definido somente pelo servidor; não há credencial SQL no navegador.
- A oficina `hp-centro` foi liberada apenas para testes de desenvolvimento. Não foi contratada assinatura nem habilitado faturamento. Novas oficinas não recebem liberação automática. Somente a administração da plataforma pode gerenciar liberações, por procedimento administrativo, nunca pelo CRUD do proprietário da oficina.
- Serviços particulares continuam no cadastro existente, separado do catálogo central e vinculado à oficina. Esta importação não copiou serviços particulares para a base compartilhada.

## Publicação e validação

As migrações `20261019215935_service_catalog_operational_structure.sql` e `20261019220654_activate_readonly_service_catalog.sql` registram a estrutura e a ativação. Entre ambas é necessária a importação administrativa do pacote validado: a ativação recusa um catálogo incompleto. A migração `20261019220939_optimize_catalog_tenant_policy.sql` faz a identificação da oficina ser calculada uma vez por consulta, preservando a autorização explícita por tenant. Não executar essas migrações isoladamente em produção como parte de um deploy rotineiro.

A carga utilizou uma credencial específica de importação, sem acesso aos dados de atendimento. Após a validação, suas permissões foram revogadas, o login foi desabilitado, a senha removida e a cópia local da credencial excluída.

Todos os campos operacionais foram comparados entre SQLite e PostgreSQL usando SHA-256 por registro e por grupo ordenado, sem depender apenas de contagens. A primeira tentativa de conferência por transferência integral sofreu timeout; a conferência por hashes calculados no banco foi concluída com sucesso.

Resultados da publicação:

- Banco completo: aproximadamente 240 MB; catálogo com índices: aproximadamente 224 MB. Limite gratuito considerado: 500 MB, deixando cerca de 260 MB para crescimento. O consumo real deve ser acompanhado ao adicionar dados e índices.
- Testes com o backend normal: sem oficina e sem liberação não há leitura; oficina de testes liberada consulta modelos e serviços; INSERT, UPDATE, DELETE e tentativa de autoliberação retornam `42501`.
- Login, leitura do workspace e criação/remoção de um cadastro temporário passaram após a importação. Permanecem 277 OS, 164 veículos e 1.008 itens no cadastro existente.
- Auditoria de segurança do Supabase sem alertas após a ativação.

## Integração à OS

A integração disponibiliza o módulo Serviços, a seleção explícita de modelo na OS e a busca paginada no servidor. Candidatos podem ser filtrados pelo código FIPE disponível; FIPE compartilhado não é tratado como identificação única. O modelo e o porte confirmados são gravados no veículo ao salvar o atendimento. Modelos sem correspondência ou sem aplicações podem utilizar serviços particulares com porte informado, sem inferência silenciosa de tempos.

Configurações → Mão de obra por porte permite definir a tarifa de cada um dos 14 portes. Não foram inventadas tarifas: os valores precisam ser informados pela oficina. Serviços internos calculam minutos/60 × tarifa; serviços terceirizados usam custo e acréscimo configurado, originalmente 30%. O cadastro particular permite informar tempo ou preço e calcula o outro valor; exige porte para novos serviços e não possui categoria nem campo de origem. Há cadastro rápido dentro da OS e edição/remoção no módulo Serviços.

O registro privado usa `horse_power.workshop_services`, separado dos produtos e do catálogo compartilhado, com todas as consultas e alterações limitadas ao tenant autenticado. A migração `20261019222329_integrate_repair_services_orders.sql` levou os quatro serviços antigos disponíveis com custo de terceiros para esse cadastro, inicialmente para todos os portes, e arquivou os serviços legados sem apagar suas referências históricas. Produtos, custos, preços, estoque, OS e itens históricos foram conferidos antes/depois e permaneceram iguais.

Itens novos de serviços usam `order_items.catalog_id=NULL` e `service_snapshot` com identidade, nome, aplicação/modelo, porte, minutos, tarifa, custo, acréscimo, preço calculado, preço cobrado e versão. Referências e valores enviados pelo navegador não substituem a resolução e validação no servidor. Ao editar um item existente, o servidor reutiliza o snapshot daquele item e daquela OS, inclusive após alterações do catálogo, tarifa ou assinatura. O valor cobrado, execução interna/terceirizada e custo podem mudar somente naquela OS. Tempo zero exige informação complementar e tarifa válida antes da inclusão como interno, sem assumir serviço gratuito.

As consultas ao catálogo usam uma transação de leitura dedicada com contexto local da oficina, sem usar o bloqueio global de alterações de atendimentos. O contexto é descartado ao terminar a transação. Criação/alteração de serviços particulares, tarifas e remoções são registradas na auditoria. O navegador recebe apenas páginas de 30 modelos ou 50 serviços, não o banco completo.

Peças permanecem fora deste catálogo operacional e não geram produtos ou movimentos de estoque. A interface de captura de serviços do Tempario foi retirada e novas capturas dessa origem são recusadas no HPDesenvolvimento; os registros anteriores permanecem para o histórico. A captura de produtos do Sky Peças continua funcionando. Esta etapa não publica uma nova extensão na Chrome Web Store nem modifica a oficina em produção.

Validação da integração: suíte local completa com 146 testes; testes adicionais de migração, vínculo por família e diferença por modelo, ambiguidade FIPE, isolamento entre oficinas, tempos zero, preço e snapshots; teste HTTP com catálogo real, OS/veículo/cliente/serviço temporários removidos ao final; TypeScript e build Vite. A navegação visual local não pôde ser conferida pelo navegador integrado, que não alcançou o servidor local; não foi criado acesso público ou bypass da proteção do ambiente.

