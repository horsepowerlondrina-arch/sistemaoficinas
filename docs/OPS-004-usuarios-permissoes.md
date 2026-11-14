# OPS-004 — Usuários, funcionários e permissões

## Correções após a validação autenticada

O cartão do usuário usa o nome do perfil efetivo (Master, Gerente, Consultor de Serviços, Mecânico ou Financeiro), em vez da condição genérica de navegação administrativa. Sessões legadas sem perfil continuam com os rótulos anteriores.

A consulta de OS inclui somente dois campos técnicos adicionais: `vehicle_year` e `vehicle_model_year`, obtidos pelo vínculo do veículo na mesma oficina. A tela usa esses campos quando o cadastro completo não está disponível ao usuário; ano-modelo ausente mantém o fallback anterior para o ano de fabricação. Isso não concede consulta a clientes, veículos, contatos, preços ou dados de outra oficina, nem altera o histórico de documentos. Não exige migração ou mudança em dados persistentes.

As regressões HTTP e PostgreSQL verificam os anos no escopo atribuído; o teste Playwright confere os perfis Master/Financeiro/Mecânico, a separação entre fabricação/modelo e a OS do Mecânico em desktop e mobile, mantendo clientes/veículos completos e valores comerciais ocultos. A biblioteca visual acompanha as capturas reais do mesmo fluxo isolado. Nesta correção foram criadas duas capturas da OS restrita do Mecânico (desktop/mobile), substituídos nove PNGs afetados pelos perfis e revalidadas cinco imagens sem alteração de bytes. Metadados e índices usam a revisão `10ab46c5db3eca34b8947849ab96439d55f650b5`, validada pelo [CI 43553052711](https://github.com/horsepowerlondrina-arch/sistemaoficinas/actions/runs/43553052711). Não há captura pendente desta correção; a biblioteca conserva as pendências históricas catalogadas.

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

A autorização inicial limitava a tarefa ao PR. Em 13/11/2026, o responsável autorizou explicitamente a migração no Supabase de homologação `vnclahdnirqlcbamodqy`, a integração do PR #168 e a publicação automática com validação por contas fictícias. Produção continua fora do escopo.

## Verificações

- `npm run build`, `npm test`, `npm run test:postgres`.
- `tests/workshopUsers.test.ts`: APIs, convites, contas existentes, expiração, revogação, seleção de oficina, privacidade, atribuições e descontos.
- `tests/workshopUsers.postgres.integration.ts`: disputas de vagas/reativação/Masters e RLS com papel restrito no PostgreSQL 17 temporário.
- `scripts/test-workshop-users-ui.mjs`: API real local e PostgreSQL fictício, navegação, convites, funcionários, pedidos, troca de oficina com perfis independentes, privacidade e layouts desktop/tablet/mobile. Evidências em artefato do CI.
- Biblioteca visual privada em `docs/mapeamento-visual/`; nunca publicar imagens administrativas com a aplicação.

## Execução dos testes e limitações

O teste de interface cria oficinas exclusivas da OPS-004, sem modificar as oficinas-base dos demais testes. A limpeza dos testes de transferência preserva as identidades fictícias com seu último Master até o descarte do PostgreSQL do job; nenhuma proteção é desabilitada. Os cenários originais de importação, rollback, concorrência e isolamento continuam executados.

O envio de convite no CI usa uma entrega fictícia; não aciona e-mails reais, Stripe ou serviços pagos. A entrega real pelo Resend e os fluxos na homologação somente poderão ser validados após a liberação autorizada. As evidências de navegador verificam a aplicação verdadeira com API e PostgreSQL, incluindo ativação, seleção de oficina, rascunhos, atribuição por OS e consulta técnica sem tarifas.

As capturas da OPS-004 usam o driver `ops004-interface` e o mesmo catálogo JSON da biblioteca privada. O workflow executa `node scripts/test-workshop-users-ui.mjs`; o artefato `ops004-users-interface` contém PNGs desktop/mobile/tablet para revisão. Após revisar os PNGs, incluir os arquivos nas posições do catálogo, registrar a revisão de origem, executar `npm run visual:index` e `npm run visual:check`. Não publicar a biblioteca com a aplicação.

## Evidências de validação

A execução [CI PostgreSQL 43542134927](https://github.com/horsepowerlondrina-arch/sistemaoficinas/actions/runs/43542134927), revisão `2d98a2eed1091d17e6799ec83aca370d81b5005d`, aprovou build, 383 testes gerais, 44 testes PostgreSQL, reconstrução completa do esquema, regressões da extensão, navegador e integridade do índice. O teste concorrente específico passou tanto na etapa antecipada quanto na suíte completa. O commit final do PR repete o workflow após a inclusão das imagens.

Mapeamento visual atualizado: **SIM**. Foram criadas 14 imagens reais da OPS-004 e renovadas 34 capturas existentes (32 arquivos PNG com bytes diferentes e duas revalidações). Módulos: acesso, orçamentos, OS, cadastros/serviços e configurações. Todas as 14 entradas OPS-004 possuem PNG, data e revisão de origem; nenhuma captura obrigatória desta tarefa está pendente. A biblioteca histórica ainda mantém suas próprias pendências catalogadas. As imagens foram produzidas na revisão `3f53da28177e3d9d5cca9811e7a403e008863a9a` com dados fictícios e revisadas antes de serem versionadas.

## Liberação autorizada em homologação

- Migração aplicada somente em `vnclahdnirqlcbamodqy`: versão remota `20261114024707`, nome `ops_004_workshop_users_20261113`; SQL fonte `20261113000100_workshop_users.sql`, SHA-256 `d219fa9ed0218a7c3a1fd79a1fa325441f73d0dc9a556e3126c8722f6509cd28`.
- Verificação posterior: 5 usuários, 5 vínculos, 6 OS e 1 profissional preservados; IDs e perfis existentes inalterados. As oito tabelas novas têm RLS; funções sensíveis não concedem execução a PUBLIC.
- [PR #168](https://github.com/horsepowerlondrina-arch/sistemaoficinas/pull/168) integrado por squash no commit `5c772253bd37a4c8ff36f0f3e6edc955f6505a97`, após aprovação do [CI](https://github.com/horsepowerlondrina-arch/sistemaoficinas/actions/runs/43543335812).
- A primeira publicação automática ficou READY, mas a validação real de `/api/session` detectou `FUNCTION_INVOCATION_FAILED`: imports sem extensão não eram resolvidos no JavaScript emitido pelo Node da Vercel. READY não foi considerado evidência de funcionamento.
- [PR #169](https://github.com/horsepowerlondrina-arch/sistemaoficinas/pull/169) corrige as referências ESM com `.js`, sem alterar regras, dados, migrações ou configuração da Vercel. `tests/vercelServerRuntime.test.ts` transpila o servidor e os módulos compartilhados e carrega a aplicação em Node sem resolvedor TypeScript. O teste falhou antes e passou após o ajuste. A integração e nova publicação automática dependem do CI obrigatório aprovado e da validação online.

A validação autenticada em homologação depende de uma sessão fictícia disponível. Operações mutáveis, concorrência, convites e limites são exercitados em PostgreSQL 17 temporário no CI; não usar a homologação compartilhada para testes destrutivos nem registrar credenciais nos relatórios.
