# Estado atual do Sistema Oficinas

**Auditoria documental:** 24/10/2026 (UTC)  
**Repositório:** `horsepowerlondrina-arch/sistemaoficinas`  
**Branch de referência:** `main`  
**Commit de referência:** `6496c8a8795178babcaba525cb707f7fd88b823a`

Este é um inventário pontual do código e das evidências consultadas nessa referência. Não equivale a uma auditoria completa nem atualiza automaticamente quando `main` avança.

## Confirmado no código

- Aplicação web React/TypeScript com backend Express e API própria.
- Há interface e integração de administração central, incluindo gestão de oficinas e ativação; há documentação específica em `docs/ADM-001.1-painel-central.md`, `docs/ADM-001.2-gestao-oficinas.md` e `docs/ADM-002-ativacao-oficinas.md`.
- O repositório contém fluxos operacionais de ordens/orçamentos, cadastros, checklists, financeiro, estoque, documentos e transferência. A presença de código não assegura que todos os fluxos tenham sido validados recentemente.
- Existem migrações Supabase versionadas e um workflow `.github/workflows/ci-postgres.yml`; o fluxo documentado usa PostgreSQL 17 efêmero no CI.
- O fluxo de transferência documenta exportação/importação `.hptx`, prévia, mesclagem, substituição e backups; cada caminho ainda requer validação funcional específica antes de ser considerado aceito.

## Testado

- O workflow GitHub Actions #25 (run ID `40136445104`), associado ao PR #7 e ao head `325e0e991b714b4bf28c781b8278033b2a50b3ea`, aprovou build, testes gerais e integração PostgreSQL.
- O head testado foi então integrado por squash em `main` como `6496c8a8795178babcaba525cb707f7fd88b823a`. Não foi localizada evidência de execução daquele workflow diretamente sobre o SHA squash.
- Esta evidência não certifica visualmente todos os módulos nem substitui testes futuros para mudanças posteriores.

## Disponível em homologação

- Foi localizada uma deployment Vercel READY do projeto `sistema-oficinas-homologacao`, associada ao commit de referência, com alias `https://sistema-oficinas-homologacao.vercel.app`.
- “READY” confirma o estado do deployment na plataforma, não um teste completo autenticado. Esta auditoria não validou todos os fluxos no navegador.
- A palavra “production” que a Vercel usa como target interno de deployment do projeto não significa que o sistema esteja publicado como produto em produção.

## Publicado em produção

**Não verificado.** Não há nesta auditoria evidência suficiente para afirmar que exista deployment de produção separado do projeto de homologação, nem para declarar que o sistema esteja sendo usado em produção. Não inferir isso a partir de alias, domínio ou target da Vercel.

## Planejado

- A fonte de priorização é a conversa de planejamento funcional do ChatGPT. Não foi consultado um backlog canônico completo; por isso este documento não declara novas tarefas futuras como aprovadas.
- Melhorias comerciais, expansão de módulos e outras necessidades só devem ser tratadas como planejadas após decisão explícita do responsável funcional.

## Não verificado

- Fluxo completo de importação `.hptx` autenticado após as correções mais recentes, incluindo substituição, recuperação e revisão histórica em uma sessão de navegador.
- Produção separada, seu domínio, tráfego, política de backup e prontidão operacional.
- Auditoria completa de segurança, carga, recuperação de desastre, monitoramento e conformidade.
- Cobertura atual e recente de todos os módulos operacionais, contas e permissões.
- Se as descrições históricas de dados reais em documentos antigos ainda refletem o estado presente de qualquer ambiente.

## Documentação histórica a revisar

Os documentos `README.md`, `docs/02-arquitetura.md`, `docs/03-validacao.md` e `docs/07-supabase-vercel.md` incluem descrições históricas que podem divergir da arquitetura e dos ambientes atuais (por exemplo, SQLite como arquitetura principal ou o antigo repositório). Foram preservados sem alteração nesta tarefa; devem ser revisados em tarefa própria para manter a rastreabilidade histórica e atualizar instruções que ainda sejam utilizadas. Trate detalhes de ambiente neles como não verificados até nova conferência.
