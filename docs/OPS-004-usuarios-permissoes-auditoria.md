# OPS-004 — auditoria de usuários, funcionários e permissões

Auditoria estática de 13/11/2026. Base: `408f3891c154227ecc5ee25b104a03e5427c0a92`, repositório `horsepowerlondrina-arch/sistemaoficinas`. Branch: `feat/ops-004-usuarios-permissoes`.

Este documento registra a auditoria anterior à implementação. Não comprova execução de testes, aplicação de migração ou disponibilidade funcional. OPS-004 também aparece historicamente como Conta/Plano/Senha; o nome deste documento distingue a nova tarefa sem reescrever seu histórico.

## Inventário técnico e reaproveitamento

| Área | Evidência atual | Alteração necessária |
| --- | --- | --- |
| Contas globais | `server/db/schema.sql`: `users` com e-mail único; `memberships` com chave composta usuário/oficina | Preservar IDs e contas; adicionar estado, perfil, permissões e limites ao vínculo |
| Autenticação | `server/auth/session.ts`: scrypt com salt, cookie HTTP-only, token armazenado por hash, sessão de 24 horas | Preservar mecanismos; incluir autenticação recente e validar estado/permissões atuais em toda requisição |
| Login e seleção | `server/app.ts`: login escolhe primeiro vínculo, `/api/session` lista oficinas, `/api/tenant` valida vínculo | Filtrar vínculos ativos; seleção explícita quando houver múltiplos vínculos; proteger rascunhos na troca |
| Autorização | `server/app.ts` e `server/services/payments.ts`: proprietário/operador; `requireAdmin`; `shared/workshopModules.ts`: disponibilidade por plano/módulo | Matriz por ação com negação por padrão; auditar chamadas de serviços e respostas, sem promover perfis a owner artificialmente |
| Planos | `local-postgres/030-adm003-plan-entitlements.sql`: limites básicos 2, profissional 5, premium 10, overrides e trial; `022-admin-workshop-entitlements.sql`: trigger serializa INSERT em memberships | Contar somente vínculos ativos e convites pendentes não expirados; mesma trava em convite, aceitação e reativação |
| Profissionais | `professionals` preserva nome, função, contatos e situação; `order_items.professional_id` referencia histórico | Ampliar o cadastro existente para funcionário com habilitação produtiva e vínculo opcional de usuário; não recriar profissionais |
| Vínculo por OS | `order_items.professional_id` é por item; não há atribuição múltipla por OS | Adicionar relação própria OS/funcionário com histórico; manter vínculo histórico por item sem exigir novas atribuições por serviço |
| Convite administrativo | `server/services/workshopActivation.ts`, `server/platformAdminApp.ts`, `local-postgres/010-workshop-activation.sql`: token seguro, 48h, envio Resend e ativação de oficina | Reaproveitar primitivas de token, hash, URL e entrega; criar finalidade e armazenamento próprios para convite de colaborador |
| Administração central | `src/components/PlatformWorkshopUsers.tsx` e `local-postgres/027-admin-workshop-management.sql`: troca owner/operator e remoção, com proteção do último proprietário | Compatibilizar as funções centrais com novos estados e proteção concorrente do último Master, sem conceder administração central ao Master |
| RLS | `server/db/postgres.ts`: contexto transacional `app.tenant_id`/`app.user_id`; `local-postgres/016-platform-admin-transfer-context.sql`: membership_self lê os próprios vínculos | Novas tabelas com políticas explícitas; diretório gerencial por funções restritas para não abrir leitura global de contas; testar com papel sem BYPASSRLS |
| Financeiro | `server/services/payments.ts`, `server/services/workshop.ts`, `server/services/cardMachines.ts`, `shared/customerPayments.ts`: precisão monetária e histórico existentes | Autorizações por operação e projeções de dados; preservar cálculos, máquinas, snapshots, descontos e estornos |
| Descontos | `server/services/workshop.ts` chama `totalOf` em saveOrder; `server/domain/orders.ts` valida teto do subtotal | Limite individual sobre desconto total acumulado, comparado com subtotal de referência; aprovação vinculada à revisão e digest dos valores |
| Documentos | `server/services/documents.ts`: revisões/snapshots, documentos e histórico; `server/services/sharing.ts`: compartilhamento | Revalidar escopo da OS e permissões pessoais/comerciais em leitura, emissão, pesquisa e exportação; não alterar snapshots históricos para ocultação |
| Interface | `src/App.tsx`, `src/pages/Management.tsx`, `src/pages/Registers.tsx`, `src/components/ui.tsx`: shell, configurações, profissionais, modais e formulários | Reutilizar padrões; nova aba de usuários e central interna de aprovações; condicionar navegação e ações às permissões efetivas |
| Testes | `.github/workflows/ci-postgres.yml`, `tests/platformWorkshopManagement.integration.ts`, `tests/platformEntitlements.integration.ts`, `tests/workshopActivation.integration.ts`, regressões financeiras existentes | Acrescentar integração concorrente de vagas/Masters/convites/descontos e testes negativos por API/documentos; capturas desktop/mobile do módulo afetado |

## Constatações e riscos

1. A conta já é global e o vínculo já é por oficina. Criar outra tabela de contas ou clonar usuários por oficina produziria duplicidade e risco para recuperação de senha.
2. `memberships.role` admite somente `owner` e `operator`. O papel legado precisa ser preservado durante migração e transição dos consumidores; não basta acrescentar cinco nomes no frontend.
3. A autorização aparece no middleware e dentro dos serviços. Liberar apenas o middleware produziria bloqueios internos; transformar papéis operacionais em owner ampliaria privilégios. A migração deve abranger ambos os níveis.
4. O limite atual conta todos os vínculos. O trigger existente precisa ser adaptado junto com o estado dos vínculos e as reservas de convites. Uma checagem isolada no servidor não evita concorrência.
5. A proteção atual do último proprietário existe na administração central, mas não contempla todos os novos caminhos de desativação, perfil e estado. Todos devem adquirir a mesma trava por oficina.
6. O operador recebe uma projeção operacional por `mechanicWorkspace`, mas ela não implementa atribuição por OS nem permissões pessoais configuráveis. Não reutilizar a resposta completa do owner para perfis novos.
7. `professionals` já possui referências históricas por item. A migração deve ser aditiva, sem gerar IDs novos para os profissionais existentes.
8. As políticas de memberships atuais permitem ao usuário consultar seus próprios vínculos. O Master não poderá listar usuários alheios com consultas comuns sem um mecanismo restrito de diretório; evitar grants amplos sobre contas globais.
9. Compartilhamento público e snapshots exigem decisão por emissão e por acesso. Revogar atribuição precisa afetar documentos privados e links diretos imediatamente; links públicos existentes não podem ser usados como atalho pelo usuário restrito.
10. Solicitações de desconto devem ser transacionais, impedir autoaprovação, aplicar o desconto total aprovado e invalidar por mudança de revisão. Aprovar somente a diferença permitiria contorno por pedidos sucessivos.

## Sequência de implementação

1. Migrações aditivas PostgreSQL/SQLite compatíveis com usuários atuais; vínculos ativos, perfil, permissões, limites, convites próprios, atribuições e solicitações de desconto. Espelhar o PostgreSQL local e o SQL remoto revisável, sem aplicar remotamente.
2. Modelo compartilhado de perfis, permissões, dependências e interseção com módulos contratados; validação estrita no servidor.
3. Serviços transacionais de usuários, vagas, funcionários, convites, autenticação recente, Masters e auditoria. Manter o responsável contratual independente.
4. Autorização de todas as rotas e serviços, projeção de workspace e dados pessoais/comerciais, escopo de OS, documentos e exportações.
5. Aprovações de descontos com revisão, trava e auditoria; atribuições múltiplas por OS e histórico.
6. Interfaces existentes adaptadas e proteção de rascunhos; atualizar catálogo visual e capturas reais no mesmo PR.
7. CI PostgreSQL 17 com dados fictícios, build, testes gerais, regressões, testes negativos e concorrentes. Revisar diff antes de abrir o PR completo.

## Coordenação e estado da tarefa

O PR #121 (`feat/admin-billing-mercadopago`) permanece aberto como draft e altera `server/auth/session.ts`, `server/app.ts`, `server/db/database.ts` e `server/db/postgres.ts`. A main atual já possui integração Stripe. É necessário esclarecer se o trabalho Mercado Pago continua ativo ou foi substituído antes de alterar os mesmos componentes de autenticação. A regra de coordenação do AGENTS.md exige sequência para autenticação e permissões compartilhadas.

Branch exclusiva criada na main auditada. Até este registro, somente a auditoria foi adicionada; nenhuma funcionalidade foi implementada, nenhum banco remoto foi consultado ou modificado e nenhum deployment foi solicitado. A autorização desta tarefa termina no PR: integração e migrações remotas aguardam autorização específica do responsável.
