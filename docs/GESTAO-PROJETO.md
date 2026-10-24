# Gestão do projeto Sistema Oficinas

## Governança

- O repositório oficial de código é `horsepowerlondrina-arch/sistemaoficinas`; `main` é a referência de integração.
- O repositório histórico `horse-power` não é fonte de alterações novas. Esta decisão não autoriza operações nele.
- O planejamento funcional e a priorização ficam nas conversas específicas do ChatGPT. O Codex executa tarefas já definidas, registra evidências e não cria escopo adicional.
- Apenas um Codex deve implementar mudanças no repositório por vez. Revisões independentes podem ocorrer sem alterar arquivos.
- Todo trabalho começa conferindo `main`, branches, estado do checkout e documentação atual. Cada tarefa usa branch própria derivada da versão atual de `main`; não se reutiliza uma branch antiga sem conferir sua base.
- Alterações integram por Pull Request após as verificações exigidas. Merge, migração remota e publicação requerem autorização conforme o impacto e as decisões de arquitetura.

## Frentes e módulos

### Plataforma central

Administração de contas e permissões da plataforma, cadastro/gestão/ativação de oficinas, auditoria e operação comercial. A administração central possui autenticação e sessão separadas das contas operacionais. O painel não recebe acesso irrestrito aos registros operacionais das oficinas.

### Sistema operacional da oficina

Cada oficina autenticada opera seus próprios clientes e veículos, ordens/orçamentos, checklists, cadastros, serviços/produtos, estoque, financeiro, configurações, documentos e transferência de dados. A disponibilidade concreta de cada módulo deve ser confirmada no código e nos testes da revisão, não inferida por este catálogo.

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
6. Criar commit e PR; corrigir falhas na mesma branch.
7. Integrar somente após verificações e aprovação. Migrações remotas e publicações têm autorização própria quando exigida.
8. Validar o destino com dados fictícios e atualizar `docs/ESTADO-ATUAL.md` ou o registro específico sem alegar verificações não feitas.

## Responsáveis funcionais

- **Planejamento e decisões de produto:** responsável do projeto nas conversas de planejamento do ChatGPT.
- **Implementação e evidências técnicas:** Codex na conversa de execução.
- **Revisão, aprovação de integração e autorização de mudanças remotas:** responsável autorizado do projeto.
- **GitHub Actions:** verificações automatizadas configuradas no repositório; não substituem aprovação funcional.
- **Vercel/Supabase:** serviços de hospedagem e banco nos ambientes identificados; a configuração ativa deve ser verificada antes de qualquer operação.

Esses papéis descrevem o processo acordado; não afirmam identidades ou permissões específicas além das disponíveis na plataforma.


## Registro de auditoria

- **INF-004 — Auditoria de branches e ambientes:** Em revisão na branch `infra/inf-004-auditoria-ambientes`, baseada na `main` `939afd173f0362d5694d8d6c192e283588c778e6`.
- Resultado provisório, evidências e bloqueios: [docs/INF-004-AUDITORIA-AMBIENTES.md](INF-004-AUDITORIA-AMBIENTES.md).
- Não declarar a auditoria concluída nem remover branches até resolver os itens bloqueantes e obter aprovação para a limpeza.
