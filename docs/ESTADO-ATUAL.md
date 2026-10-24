# Estado atual do Sistema Oficinas

**Auditoria atualizada:** 24/10/2026 (UTC)  
**Repositório:** `horsepowerlondrina-arch/sistemaoficinas`  
**Branch de referência:** `main`  
**Commit de referência:** `ed48c7d05d2c3a5aec8256265e615e24e5fef43c`

Este inventário descreve evidências consultadas nessa referência e não se atualiza automaticamente quando `main` avança.

## Confirmado no código

- Aplicação React/TypeScript com backend Express, API própria e persistência PostgreSQL na configuração de nuvem.
- A administração central tem rotas, autenticação e sessão próprias, permissões, auditoria e gestão/ativação de oficinas. A identidade de sessão administrativa usa cookie separado do cookie operacional.
- Há fluxos operacionais para clientes/veículos, ordens/orçamentos, checklists, cadastros, estoque, financeiro, documentos e transferência de dados. A presença de código não comprova validação manual recente de cada fluxo.
- O repositório contém migrações Supabase, migrações PostgreSQL locais e CI com PostgreSQL 17 temporário.
- O importador/exportador `.hptx` contém prévia, mesclagem, substituição, arquivos de backup criptografados e trilhas históricas; o uso completo autenticado online ainda não foi validado nesta auditoria.

## Testado

- O responsável confirmou que os testes de login e logout online foram executados e passaram. Essa confirmação não é apresentada como execução de credenciais pelo Codex.

- GitHub Actions run #26 (`40138356222`) passou build, testes gerais e integração PostgreSQL no head `d0b6025bb709b8206994b54bdb81d0ecf4b218b5`, PR #8 (GOV-001).
- Esse head foi integrado à `main`, que agora aponta para `939afd173f0362d5694d8d6c192e283588c778e6`. O resultado é evidência para o head testado; não foi localizado um run no próprio SHA de integração.
- O CI do PR #9 passou no run #28 (Actions run `40140238929`), no head `ef52e84b8b48c103de06746b5fdbac3683ec5ded`. Posteriormente, o PR foi integrado em `ed48c7d`; o run #30 (`40140433341`) também aprovou build, testes gerais e integração PostgreSQL no head do PR.
- Isso não equivale a uma revisão visual de todos os módulos ou a uma auditoria completa de segurança.

- Evidência de execução correlacionou `DATABASE_URL` e `PLATFORM_ADMIN_DATABASE_URL` ao Supabase de homologação `vnclahdnirqlcbamodqy`, sem revelar valores. As roles operacionais e administrativas têm privilégios separados; detalhes e limites estão no [relatório INF-004](INF-004-AUDITORIA-AMBIENTES.md).

## Disponível em homologação

- Vercel `sistema-oficinas-homologacao`: deployment mais recente consultado estava READY, com target Production do projeto, vindo de `main` no commit `ed48c7d05d2c3a5aec8256265e615e24e5fef43c`.
- Alias: [sistema-oficinas-homologacao.vercel.app](https://sistema-oficinas-homologacao.vercel.app).
- O projeto é identificado como homologação pelo nome, domínio, vínculo do repositório e Supabase associado no registro de ambiente. O target interno “Production” da Vercel é uma configuração daquele projeto e não prova publicação comercial em produção.
- O status READY confirma deployment, não teste funcional autenticado.

## Publicado em produção

**Não verificado para o produto Sistema Oficinas.** A auditoria não encontrou evidência suficiente de uma implantação comercial de produção separada da homologação. Não inferir isso pelo target da Vercel.

O projeto Vercel independente `horse-power` continua com deployment Production de `horsepowerlondrina-arch/horse-power` na branch `main` e domínios Horse Power verificados. Trata-se da instalação Horse Power separada, não do projeto `sistema-oficinas-homologacao`; não foi modificada.

## Planejado

- O planejamento e a priorização continuam nas conversas funcionais específicas do ChatGPT. Não foi consultado backlog canônico completo; nenhuma tarefa futura é declarada aprovada por este inventário.
- INF-004 está **validada para encerramento administrativo**. A atualização documental final está nesta PR #10; veja [relatório da auditoria](INF-004-AUDITORIA-AMBIENTES.md).

## Não verificado / riscos pendentes

- A correlação dos destinos foi feita por evidências indiretas de execução e privilégios, não pela leitura de valores das variáveis. Ver relatório INF-004 para os limites dessa evidência.
- Funcionamento de API/database em deployments Preview: foram listadas variáveis de banco e admin apenas no target Production da Vercel; Preview e Development não têm configuração de banco visível. Um Preview automático pode não executar rotas de servidor. Não foi realizado teste online desse caminho.
- Sessão completa de importação `.hptx` em navegador após as correções recentes, inclusive substituição e reimpressão de documentos históricos.
- Produção comercial separada do Sistema Oficinas, domínios, tráfego e plano operacional de backup/recuperação.
- Cobertura manual, carga, monitoramento, recuperação de desastre e auditoria de segurança completa.

## Documentação histórica a revisar

`README.md`, `docs/02-arquitetura.md`, `docs/03-validacao.md` e `docs/07-supabase-vercel.md` contêm material histórico que pode divergir da arquitetura atual (incluindo descrições SQLite e o repositório anterior). Foram preservados nesta tarefa; revisar em tarefa própria, sem apagar evidência histórica nem tratar configurações antigas como atuais.
