# INF-004 — Auditoria de branches e ambientes: encerramento

**Atualizado:** 24/10/2026 (UTC)  
**Repositório:** `horsepowerlondrina-arch/sistemaoficinas`  
**Referência integrada:** `main` em `ed48c7d05d2c3a5aec8256265e615e24e5fef43c`  
**Branch deste registro:** `docs/inf-004-encerramento`  
**Escopo:** fechar a auditoria de branches e ambientes com evidências remotas somente leitura e os testes de login confirmados pelo responsável do projeto.

## Resultado do encerramento

**INF-004: validada para encerramento administrativo.** O PR #9 foi integrado à `main` em `ed48c7d`; o CI do PR aprovou build, testes gerais e PostgreSQL; o responsável confirmou que os testes de login online foram executados e passaram. Este documento atualiza o estado depois da integração. O histórico das verificações anteriores permanece abaixo e deve ser lido junto deste adendo final.

## Conexões da aplicação e isolamento de papéis

O diagnóstico foi feito por correlação de execução, sem revelar valores de variáveis:

| Conexão | Resultado | Evidência não sensível |
|---|---|---|
| `DATABASE_URL` | **CORRESPONDE** ao Supabase de homologação `vnclahdnirqlcbamodqy`; não aponta para o banco histórico Horse Power | Uma chamada à rota operacional existente originou atividade recente de `horse_power_app` no Supabase de homologação; não foi observada atividade correspondente no banco histórico durante a janela da verificação. |
| `PLATFORM_ADMIN_DATABASE_URL` | **CORRESPONDE** ao mesmo Supabase de homologação; não aponta para o banco histórico Horse Power | A inicialização administrativa passou pela asserção de conexão que exige `hp_platform_admin_app` e o schema administrativo. O catálogo do banco histórico não contém esse schema nem esse papel; foi observada sessão do papel esperado no destino de homologação. |

No Supabase de homologação, os papéis de aplicação e administração são não-superusuários e não têm `BYPASSRLS`. O papel operacional tem acesso ao schema operacional, onde as 48 tabelas verificadas têm RLS habilitado. O papel administrativo tem acesso ao schema administrativo e não ao schema operacional. As sessões administrativa e operacional também usam cookies distintos.

Esses resultados confirmam os destinos e a separação de privilégios na configuração verificada; não representam auditoria completa de segurança nem prova sobre todo acesso futuro.

## Login administrativo

O responsável do projeto confirmou que os testes de login online foram executados e passaram. O CI do PR #9 também passou build, testes gerais e testes PostgreSQL, incluindo os casos de autenticação/MFA simulados. A correção integrada vincula a exceção de MFA exclusiva da conta fictícia ao identificador do projeto Vercel de homologação; não remove MFA do fluxo normal.

O teste online é registrado como confirmação do responsável, não como credenciais ou login executados pelo Codex.

## CI e publicação observada

- PR #9 foi integrado à `main` como `ed48c7d05d2c3a5aec8256265e615e24e5fef43c`.
- O GitHub Actions run #30 (`40140433341`), no head do PR, aprovou build, testes gerais e integração PostgreSQL. O resultado é evidência para o head testado; não foi localizado um run separado no SHA de integração.
- A Vercel do projeto `sistema-oficinas-homologacao` tinha deployment READY da `main` em `ed48c7d`, target Production interno desse projeto de homologação.
- O alvo/domínio de homologação continua separado do projeto Vercel `horse-power`. A produção Horse Power não foi alterada.
- Esta atualização documental não integra código, não altera configurações ou bancos e não solicita deployment manual. O Preview automático da branch documental foi autorizado pelo responsável; ele não deve ser confundido com atualização do alias de homologação.

## Branches

A verificação anterior encontrou os PRs #1–#9 integrados à `main`. As branches de tarefa antigas listadas no relatório anterior foram mantidas; a INF-004 não incluiu sua exclusão. Branches locais nunca enviadas não são visíveis ao GitHub e não foram inventariadas. A branch documental atual é separada e permanece para revisão até a integração do seu PR.

## Limites e riscos que permanecem

1. **Banco histórico Horse Power:** a auditoria anterior identificou que `checklists` e `checklist_photos` não tinham RLS no banco histórico, e o papel de backend podia lê-las. Isso permanece uma lacuna de defesa em profundidade independente do novo Sistema Oficinas. Não foi alterado nesta tarefa e deve ser tratado na frente de segurança, conforme decisão do responsável.
2. **Cobertura:** a confirmação de login não equivale à validação manual de todos os módulos, importação `.hptx`, recuperação de desastre, carga ou auditoria completa.
3. **Previews:** a existência de previews automáticos foi confirmada. A execução completa de APIs com banco em um Preview não foi objeto do encerramento.

## Nota de privacidade da verificação

Durante a correlação operacional, uma chamada somente leitura à rota de sessão existente reutilizou uma sessão de oficina já aberta no navegador e retornou conteúdo operacional na própria resposta. Nenhum dado foi copiado para este relatório ou usado em alteração; a chamada não efetuou escrita. Para proteger a oficina, detalhes e valores não são registrados aqui. Nas validações futuras, não reutilizar rotas autenticadas do navegador para diagnosticar conexão sem primeiro garantir uma sessão sem dados operacionais.

## Histórico da auditoria

O relatório inicial, antes da integração do PR #9 e da correlação de destinos, está preservado no histórico Git. Esta versão substitui seu estado provisório: os destinos das duas conexões foram confirmados por evidência de execução, o PR #9 foi integrado e os testes de login foram confirmados pelo responsável. A lacuna de RLS no banco histórico permanece explicitamente separada.
