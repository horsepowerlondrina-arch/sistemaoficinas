# OPS-004 — Usuários, funcionários e permissões

Esta tarefa amplia as contas globais, memberships, profissionais e autorização existentes. A auditoria inicial está em `OPS-004-usuarios-permissoes-auditoria.md`. O registro histórico OPS-004 de Conta/Plano/Senha permanece independente deste documento.

## Uso

O Master administra usuários e funcionários em **Configurações → Usuários e funcionários**. A tela reúne vagas, acessos ativos/inativos, convites, personalizações, funcionários e histórico administrativo. Funcionários operacionais reutilizam os IDs de `professionals`; só contas ativas e convites válidos reservam vagas.

Os perfis são modelos individuais. Trocar o perfil substitui as personalizações após confirmação; restaurar o padrão remove os overrides do usuário editado. Masters mantêm o mesmo nível administrativo. Alterações envolvendo Masters exigem confirmação explícita e autenticação recente também no servidor. Os módulos contratados continuam sendo o teto das permissões efetivas. Responsabilidade contratual e administração central não são transferidas por mudanças de perfil.

A conta com vários vínculos ativos escolhe a oficina ao iniciar a sessão e pode trocar pela seleção **Oficina ativa**. Formulários com alterações pendentes exigem confirmação antes da troca. O servidor revalida o vínculo e o estado ativo em cada requisição.

Os convites de colaboradores usam `/aceitar-convite`, com token aleatório no fragmento da URL, hash no banco, validade de 48 horas, cancelamento e reenvio que invalida o link anterior. Novas contas definem sua própria senha. Contas existentes confirmam a senha atual, sem duplicação de conta global. O envio usa a configuração Resend existente; nenhuma senha vai por e-mail. Falha de entrega mantém o convite pendente e permite reenvio, sem devolver o token pela API.

A equipe é atribuída à OS em **Equipe e autorizações**, com múltiplos profissionais ativos e produtivos, inclusive sem login. A alteração do vínculo de usuário ou da atribuição afeta a visibilidade imediatamente no servidor. Eventos administrativos preservam o histórico; profissionais e itens históricos não são recriados.

O mesmo painel permite pedir aprovação do desconto total, com justificativa. A **Central de aprovações** permite aprovar ou recusar conforme permissão e limite do aprovador. Não há autoaprovação. O pedido mantém subtotal, desconto total e digest do estado da OS; mudanças incompatíveis invalidam o pedido. O desconto nunca é aplicado automaticamente pela solicitação nem acumulado por diferenças sucessivas.

## Segurança e armazenamento

- `shared/userPermissions.ts`: modelos, dependências, interseção com plano e cálculo exato dos limites.
- `server/auth/session.ts`: vínculo ativo e permissões atuais a cada requisição.
- `server/auth/userAuthorization.ts`: matriz de rotas, escopo de OS e projeção das respostas.
- `server/services/workshopUsers.ts`: usuários, convites, autenticação recente e vagas.
- `server/services/workshopOperationsAccess.ts`: funcionários, atribuições e aprovações.
- `server/services/workspaceAccess.ts`: dados operacionais conforme permissões e atribuições.

Tabelas aditivas: `workshop_user_access`, `staff_accounts`, `workshop_user_invites`, `session_reauthentication`, `session_office_choices`, `order_assignments` e `discount_requests`. O PostgreSQL mantém também tentativas de autenticação limitadas em tabela privada.

As funções privilegiadas ficam no schema privado `horse_power`, com `search_path` fixo, execução revogada de PUBLIC e grants apenas aos papéis restritos da aplicação. Diretório e capacidade exigem Master da oficina autenticada. Aceitação de convite exige token válido e autenticação da conta existente, quando houver. Nenhuma tabela nova é exposta via Data API. Políticas restritivas adicionais limitam as leituras SQL de OS, itens, recebimentos, checklists, evidências, documentos e solicitações às atribuições permitidas. O diretório de permissões é visível apenas ao próprio usuário ou ao Master; convites exigem Master.

Disputas por vagas, aceitação, reativação e alterações de Masters usam a trava transacional da oficina. Triggers protegem o último Master e a contagem de vagas também em operações administrativas centrais. Desativação remove as sessões daquela oficina, preservando os vínculos e sessões das demais. Alterações de permissões são reavaliadas sem novo login; a interface atualiza o contexto periodicamente.

Os descontos de recebimentos mantêm os cálculos monetários existentes e passam pelo mesmo teto individual. Solicitações também podem ser feitas para OS finalizadas com recebimento ainda não confirmado, respeitando as permissões financeiras e a validação do recebimento existente. Registros históricos de recebimentos, preços, funcionários e documentos são preservados.

## Migração e liberação

`local-postgres/038-workshop-users.sql` e seu espelho em `supabase/migrations/20261113000100_workshop_users.sql` são aditivos. A migração SQLite `033-workshop-users.sql` mantém a infraestrutura de testes legada. Vínculos existentes são mapeados para Master/Mecânico sem mudar IDs; novas memberships legadas continuam com fallback compatível.

Aplicar a migração remota somente após revisão dos testes e autorização específica. Aplicar o SQL aditivo antes de publicar o código dependente; a versão anterior não precisa consultar as novas tabelas. A reversão deve preservar as tabelas e históricos novos; não apagar usuários, memberships ou profissionais para fazer rollback. Depois de utilizar desativações ou permissões novas, não retornar a uma versão que ignore esses controles: uma correção de reversão precisa manter a autorização e a revogação dos acessos. Restaurar somente a interface antiga não pode reabilitar contas desativadas.

A integração do PR e a migração persistente não estão autorizadas nesta tarefa. Não utilizar produção, credenciais reais ou sessões reais na validação. O PR deverá permanecer sem merge até autorização do responsável.

## Verificações

- `npm run build`, `npm test`, `npm run test:postgres`.
- `tests/workshopUsers.test.ts`: APIs, convites, contas existentes, expiração, revogação, seleção de oficina, privacidade, atribuições e descontos.
- `tests/workshopUsers.postgres.integration.ts`: disputas de vagas/reativação/Masters e RLS com papel restrito no PostgreSQL 17 temporário.
- `scripts/test-workshop-users-ui.mjs`: API real local e PostgreSQL fictício, navegação, convites, funcionários, pedidos, troca de oficina com perfis independentes, privacidade e layouts desktop/tablet/mobile. Evidências em artefato do CI.
- Biblioteca visual privada em `docs/mapeamento-visual/`; nunca publicar imagens administrativas com a aplicação.
