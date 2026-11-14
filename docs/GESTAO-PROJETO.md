# Gestão do projeto Sistema Oficinas

## Governança

- O repositório oficial de código é `horsepowerlondrina-arch/sistemaoficinas`; `main` é a referência de integração.
- O repositório histórico `horse-power` não é fonte de alterações novas. Esta decisão não autoriza operações nele.
- O planejamento funcional e a priorização ficam nas conversas específicas do ChatGPT. O Codex executa tarefas já definidas, registra evidências e não cria escopo adicional.
- **GOV-003 — Execução paralela controlada:** até dois Codex podem implementar tarefas independentes ao mesmo tempo, em branches e ambientes de trabalho isolados (worktrees próprios ou execuções remotas independentes). Nunca compartilham o mesmo diretório ou branch de trabalho. Tarefas que toquem os mesmos componentes, arquivos, configurações, estruturas de banco ou fluxos compartilhados são sequenciais.
- Todo trabalho começa conferindo `main`, branches, estado do checkout e documentação atual. Cada tarefa usa branch própria derivada da versão atual de `main`; não se reutiliza uma branch antiga sem conferir sua base.
- Cada solicitação de implementação do responsável autoriza o fluxo completo no escopo solicitado: branch, implementação, testes, PR e integração após CI aprovado e proteções satisfeitas. Não se pede aprovação rotineira adicional para merge nem para a publicação automática na homologação.
- Migrações remotas, alterações persistentes/destrutivas de dados, mudanças sensíveis de credenciais, segredos, autenticação ou permissões e publicação em produção continuam exigindo autorização específica.
- **GOV-002 — Padronização de autorizações e publicação:** registrar como política de governança a execução ponta a ponta por tarefa, mantendo as exceções de segurança e os controles obrigatórios da plataforma.
- **GOV-003 — Desenvolvimento paralelo:** conservar integralmente a autorização padrão da GOV-002 e suas exceções. Coordenar merges e publicações para que cada PR seja validado sobre uma `main` compatível. Nunca executar alterações simultâneas em bancos remotos persistentes.

## Coordenação de até dois Codex

- Antes de iniciar, cada execução consulta a `main` e os PRs/branches existentes; usa sua própria branch, ambiente isolado, CI PostgreSQL 17 temporário e dados fictícios. Não há dependência obrigatória do computador do responsável.
- Cada tarefa tem implementação, correções, testes e PR próprios. Se outro PR entrar primeiro, a tarefa remanescente verifica conflitos, atualiza sua branch de forma segura e repete testes cujo resultado foi invalidado pela atualização.
- A integração é serializada: confirme a base e as verificações obrigatórias imediatamente antes do merge. Após o deployment automático da sua integração, confira o commit na homologação e valide o fluxo que o acesso permitir.
- Capturas e índices em `docs/mapeamento-visual/` exigem coordenação quando duas tarefas atingem as mesmas telas; preserve a versão mais recente e refaça a verificação visual aplicável.
- Podem ocorrer em paralelo, por exemplo, documentação de um módulo e correção isolada de outro. Exigem sequência duas alterações de migração no mesmo schema, duas edições do mesmo formulário ou dos mesmos índices/capturas, e mudanças concorrentes em autenticação/permissões. Bancos remotos persistentes nunca recebem alterações simultâneas.

## Frentes e módulos

### Plataforma central

Administração de contas e permissões da plataforma, cadastro/gestão/ativação de oficinas, auditoria e operação comercial. A administração central possui autenticação e sessão separadas das contas operacionais. O painel não recebe acesso irrestrito aos registros operacionais das oficinas.

### Sistema operacional da oficina

Cada oficina autenticada opera seus próprios clientes e veículos, ordens/orçamentos, checklists, cadastros, serviços/produtos, estoque, financeiro, configurações e documentos. A transferência completa .hptx é exclusiva do Painel de Administração Central. Exportações individuais por módulo (PDF, Excel ou CSV), sujeitas a filtros e permissões, são futuras e não estão implementadas nesta decisão. A disponibilidade concreta de cada módulo deve ser confirmada no código e nos testes da revisão, não inferida por este catálogo.

## Identificadores e prioridade

- IDs de tarefa seguem `<ÁREA>-<número>[.<subtarefa>]`, por exemplo `GOV-001`, `ADM-002.1`, `MIG-004`. IDs já usados permanecem históricos; não são renumerados nem reutilizados.
- Prefixos existentes incluem `GOV` (governança), `INF` (infraestrutura), `SEC` (segurança), `ADM` (administração da plataforma), `PROD` e `OFI` (produto/oficina), `FIN` (financeiro), `CAT` (catálogo), `DOC` (documentos), `EXP`, `IMP` e `MIG` (transferência/migração). Prefixos são convenções, não prova de que uma tarefa está aprovada ou concluída.
- Prioridade: `P0` risco imediato a segurança/dados ou indisponibilidade; `P1` bloqueio de operação ou requisito próximo; `P2` evolução importante; `P3` melhoria desejável. Quem planeja atribui prioridade e dependências; não inferir prioridade pelo número da tarefa.

## Estados de tarefa

Use um estado por vez: **Proposta**, **Planejada**, **Pronta**, **Em andamento**, **Em revisão**, **Bloqueada**, **Integrada**, **Disponível em homologação**, **Aceita**, **Publicada em produção** ou **Cancelada**.

Um estado só pode ser declarado mediante evidência apropriada. Código existente não significa teste aprovado; build/teste aprovado não significa publicação; deployment não significa validação funcional; homologação não significa produção. Registrar a data e a referência usada. Uma tarefa bloqueada deve indicar o bloqueio e a próxima ação.

## Registro obrigatório por tarefa

Toda tarefa técnica deve registrar:

- identificador, objetivo, critérios de aceitação, prioridade e estado;
- branch de origem, branch de destino e dependências/autorizações;
- arquivos alterados e resumo do comportamento;
- testes executados, comandos, resultados e evidências; testes não executados devem ser declarados;
- impacto de banco/migrações, segurança, isolamento entre oficinas e dados usados;
- riscos, problemas conhecidos e limitações;
- commit(s), PR, destino pretendido de integração, deployment e validação online quando aplicável;
- pendências e próxima ação recomendada.

## Fluxo de execução

1. Planejar a tarefa na conversa funcional apropriada; especificar o destino e os limites.
2. Conferir repositório oficial, `main`, status e instruções; criar branch específica.
3. Implementar o menor conjunto coerente, preservando alterações existentes.
4. Executar build, testes gerais e PostgreSQL exigidos pela tarefa. Dados de teste são fictícios.
5. Revisar diff, segredos, arquivos incluídos e efeitos de migrações.
6. Criar commit e PR para `main`; corrigir falhas na mesma branch.
7. A solicitação da tarefa já autoriza o merge após CI obrigatório aprovado e proteções/revisões da branch satisfeitas, sem nova aprovação rotineira. O deployment automático na homologação também está coberto no escopo.
8. Migrações remotas, alterações persistentes ou destrutivas de dados, mudanças sensíveis de credenciais/autenticação/permissões e produção exigem autorização específica. Validar a homologação com dados fictícios e registrar evidências sem alegar verificações não feitas.

## Responsáveis funcionais

- **Planejamento e decisões de produto:** responsável do projeto nas conversas de planejamento do ChatGPT.
- **Implementação e evidências técnicas:** Codex na conversa de execução.
- **Revisão e autorização específica:** responsável autorizado do projeto para mudanças remotas, ações fora do escopo ou quando a proteção da plataforma exigir uma revisão humana. As integrações rotineiras autorizadas por esta política não exigem nova aprovação do responsável.
- **GitHub Actions:** verificações automatizadas configuradas no repositório; não substituem aprovação funcional.
- **Vercel/Supabase:** serviços de hospedagem e banco nos ambientes identificados; a configuração ativa deve ser verificada antes de qualquer operação.

Esses papéis descrevem o processo acordado; não afirmam identidades ou permissões específicas além das disponíveis na plataforma.


## Registro de auditoria

- **INF-004 — Auditoria de branches e ambientes:** **Aceita**, com a atualização documental final no PR #10, após integração do PR #9 na `main` em `ed48c7d05d2c3a5aec8256265e615e24e5fef43c`.
- O responsável confirmou que os testes de login e logout online passaram.
- Destinos das conexões confirmados por evidências indiretas, sem revelar credenciais; a role administrativa está segregada da operacional.
- A lacuna de RLS identificada no banco histórico Horse Power permanece pendente e separada na frente de segurança.
- Consulte [relatório de auditoria INF-004](INF-004-AUDITORIA-AMBIENTES.md) e [estado atual](ESTADO-ATUAL.md).


## OPS-002 — Máquinas de cartão e taxas (01/11/2026)

Implementação em revisão no PR #82, branch `feat/ops-002-maquinas-cartao`. Cadastro por oficina, tabelas independentes, padrão único, snapshots de recebimentos e migração aditiva. Testes usam somente dados fictícios e PostgreSQL 17 temporário. Integração/publicação aguardam aprovação pedida especificamente nesta tarefa; a migração remota exige autorização própria. Detalhes e procedimento: [OPS-002](OPS-002-maquinas-cartao.md).

## OPS-003 — Tabelas de lucro (01/11/2026)

Edição independente de faixas para peças/produtos e terceiros, preservando modos de cálculo, permissões e preços históricos. Sem migração de banco. Implementação na branch `feat/ops-003-tabelas-lucro`; integração depende da aprovação específica solicitada nesta tarefa. Regras e testes: [OPS-003](OPS-003-tabelas-lucro.md).

## OPS-004 — Usuários, funcionários e permissões (13/11/2026)

Estado: **Em revisão** no [PR #168](https://github.com/horsepowerlondrina-arch/sistemaoficinas/pull/168), branch `feat/ops-004-usuarios-permissoes`. Implementação sobre a main `408f3891c154227ecc5ee25b104a03e5427c0a92`, com auditoria prévia, perfis individuais, convites de colaboradores, vagas, funcionários independentes, múltiplas oficinas, atribuição de OS e aprovações de descontos. O identificador foi solicitado pelo responsável; o registro histórico de Conta/Plano/Senha não é renomeado nem substituído.

[Auditoria](OPS-004-usuarios-permissoes-auditoria.md) e [implementação, segurança e liberação](OPS-004-usuarios-permissoes.md). Testes e capturas usam somente PostgreSQL 17 temporário e dados fictícios. Por autorização específica desta tarefa, integração, migração remota e publicação na homologação aguardam nova autorização do responsável. Produção permanece fora do escopo.
