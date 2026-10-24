# Estado atual do Sistema Oficinas

**Auditoria atualizada:** 24/10/2026 (UTC)  
**Repositório:** `horsepowerlondrina-arch/sistemaoficinas`  
**Branch de referência:** `main`  
**Commit de referência:** `ed48c7d05d2c3a5aec8256265e615e24e5fef43c`

Este inventário registra evidências observadas nessa referência e não se atualiza automaticamente quando `main` avança.

## Confirmado no código

- Aplicação React/TypeScript com backend Express e PostgreSQL na configuração de nuvem.
- Administração central com autenticação e sessão separadas, permissões, auditoria e gestão de oficinas.
- Fluxos operacionais para clientes/veículos, ordens/orçamentos, checklists, cadastros, estoque, financeiro, documentos e transferência de dados.
- Migrações Supabase e PostgreSQL local versionadas; CI utiliza PostgreSQL 17 efêmero.
- O fluxo administrativo usa conexão e schema próprios, separados do acesso operacional às oficinas.

A presença de código não comprova validação manual recente de todos os fluxos.

## Testado

- PR #9 integrado em `ed48c7d05d2c3a5aec8256265e615e24e5fef43c).
- GitHub Actions run #30 (`40140433341`) aprovou build, testes gerais e integração PostgreSQL no head do PR. Não foi localizado run separado no SHA de integração.
- **Login administrativo online:** o responsável do projeto informou que realizou os testes e confirmou sucesso. Essa é uma confirmação do responsável, não uma execução de login pelo Codex.
- A correlação operacional confirmou, sem revelar URLs ou credenciais, que `DATABASE_URL` e `PLATFORM_ADMIN_DATABASE_URL` atendem o Supabase de homologação `vnclahdnirqlcbamodqy), e não o banco histórico Horse Power.

Build/CI e login não substituem revisão visual de todos os módulos ou auditoria integral de segurança.

## Disponível em homologação

- Projeto Vercel: `sistema-oficinas-homologacao`.
- Domínio: [sistema-oficinas-homologacao.vercel.app](https://sistema-oficinas-homologacao.vercel.app).
- Deployment observado READY, originado da `main` no commit `ed48c7d`, no target Production interno do projeto de homologação.
- O target interno “Production” da Vercel descreve o target do projeto; não comprova uma operação comercial separada de produção.
- O responsável confirmou testes de login bem-sucedidos.

## Publicado em produção

**Não verificado para o produto Sistema Oficinas.** Não há evidência suficiente de um deployment comercial separado da homologação.

O projeto Vercel `horse-power` permanece como instalação separada ligada ao repositório histórico e à sua própria `main`; não foi alterado.

## Planejado

- Planejamento e priorização permanecem nas conversas funcionais específicas do ChatGPT.
- INF-004 está **validada para encerramento administrativo**, conforme [relatório de auditoria](INF-004-AUDITORIA-AMBIENTES.md).
- A correção da lacuna RLS do banco histórico deve ser planejada separadamente na frente de segurança; não foi autorizada nem executada aqui.

## Não verificado / riscos pendentes

- Auditoria de segurança completa, carga, monitoramento e recuperação de desastre.
- Validação manual de todos os módulos e de todos os caminhos do importador/exportador `.hptx`.
- Funcionamento integral das rotas de servidor em Previews Vercel.
- Isolamento RLS no banco histórico Horse Power: a auditoria anterior encontrou ausência de RLS em `checklists` e `checklist_photos`; esse risco está fora do novo sistema e permanece para análise na frente de segurança.
- Produção comercial separada do Sistema Oficinas, domínio, tráfego e operação de backups.

## Documentação histórica a revisar

`README.md`, `docs/02-arquitetura.md`, `docs/03-validacao.md` e `docs/07-supabase-vercel.md` contêm material histórico que pode divergir da arquitetura atual. Revisar em tarefa própria, preservando o histórico e sem tratar configurações antigas como atuais.
