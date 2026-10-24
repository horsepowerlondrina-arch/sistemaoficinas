# Gestão do projeto Sistema Oficinas

## Governança

- O repositório oficial de código é `horsepowerlondrina-arch/sistemaoficinas`; `main` é a referência de integração.
- O repositório histórico `horse-power` não é fonte para alterações novas.
- Planejamento funcional e priorização ficam nas conversas específicas do ChatGPT. O Codex executa tarefas definidas, registra evidências e não amplia o escopo.
- Apenas um Codex deve implementar mudanças no repositório por vez. Revisões independentes podem ocorrer sem alterar arquivos.
- Todo trabalho começa conferindo `main`, branches, estado do checkout e documentação. Cada tarefa usa branch própria derivada da versão atual de `main`.
- Alterações integram por Pull Request após as verificações exigidas. Merge, migração remota e publicação requerem autorização apropriada.

## Frentes e módulos

### Plataforma central

Administração de contas e permissões da plataforma, cadastro/gestão/ativação de oficinas, auditoria e operação comercial. A sessão administrativa é separada das contas operacionais. O painel central não deve receber acesso irrestrito aos dados operacionais das oficinas.

### Sistema operacional da oficina

Cada oficina autenticada opera seus próprios clientes e veículos, ordens/orçamentos, checklists, cadastros, serviços/produtos, estoque, financeiro, configurações, documentos e transferência de dados. A disponibilidade de cada módulo deve ser confirmada no código e nos testes da revisão.

## Identificadores e prioridades

- IDs seguem `<ÁREA>-<número>[.<subtarefa>]`, por exemplo `GOV-001`, `ADM-002.1`, `MIG-004`. IDs usados permanecem históricos e não são reutilizados.
- Prefixos existentes incluem `GOV`, `INF`, `SEC`, `ADM`, `PROD`, `OFI`, `FIN`, `CAT`, `DOC`, `EXP`, `IMP` e `MIG`. Prefixos não provam aprovação ou conclusão.
- Prioridades: `P0` risco imediato a segurança/dados ou indisponibilidade; `P1` bloqueio operacional ou requisito próximo; `P2` evolução importante; `P3` melhoria desejável. Quem planeja define prioridade e dependências.

## Estados de tarefa

Use um estado por vez: **Proposta**, **Planejada**, **Pronta**, **Em andamento**, **Em revisão**, **Bloqueada**, **Integrada**, **Disponível em homologação**, **Aceita**, **Publicada em produção** ou **Cancelada**.

Declare um estado somente com evidência apropriada. Código existente não significa teste aprovado; CI não significa publicação; deployment não significa validação funcional; homologação não significa produção. Registre data e referência. Bloqueios devem indicar a próxima ação.

## Registro obrigatório por tarefa

Registrar identificador, objetivo, critérios de aceitação, prioridade, estado, branch de origem/destino, dependências e autorizações, arquivos alterados, comportamento, testes e resultados, impactos de banco e segurança, isolamento entre oficinas, dados utilizados, riscos, problemas conhecidos, commits, PR, destino de integração, deployment, validação online, pendências e próxima ação.

## Fluxo de execução

1. Planejar na conversa funcional apropriada; especificar destino e limites.
2. Conferir repositório oficial, `main`, estado e instruções; criar branch específica.
3. Implementar o menor conjunto coerente, preservando alterações existentes.
4. Executar build, testes gerais e PostgreSQL exigidos. Usar dados fictícios.
5. Revisar diff, segredos, arquivos e efeitos das migrações.
6. Criar commit e PR; corrigir falhas na mesma branch.
7. Integrar após verificações e aprovação. Migrações remotas e publicações exigem autorização própria quando aplicável.
8. Validar o destino com dados fictícios e atualizar o estado documental sem alegar verificações não feitas.

## Responsáveis funcionais

- Planejamento e decisões de produto: responsável do projeto nas conversas de planejamento do ChatGPT.
- Implementação e evidências técnicas: Codex na conversa de execução.
- Revisão, aprovação de integração e autorização de mudanças remotas: responsável autorizado do projeto.
- GitHub Actions: verificações automatizadas do repositório; não substituem aprovação funcional.
- Vercel/Supabase: serviços de hospedagem e banco; confirmar configuração ativa antes de operações.

## Registro de auditoria

- **INF-004 — Auditoria de branches e ambientes:** validada para encerramento administrativo na referência `main` `ed48c7d05d2c3a5aec8256265e615e24e5fef43c`; os documentos deste PR atualizam o inventário após integração do PR #9.
- O responsável confirmou que os testes de login online passaram.
- Destinos das duas conexões confirmados por correlação de execução, sem revelar credenciais: ambas atendem `vnclahdnirqlcbamodqy`; a conexão administrativa usa papel/schema segregado.
- A lacuna de RLS identificada no banco histórico Horse Power permanece separada e pendente na frente de segurança. INF-004 não a corrige nem a classifica como resolvida.
- Consulte [relatório de auditoria INF-004](INF-004-AUDITORIA-AMBIENTES.md) e [estado atual](ESTADO-ATUAL.md).
