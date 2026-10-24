# INF-004 — Auditoria de branches e ambientes

**Data:** 24/10/2026 (UTC)  
**Repositório:** `horsepowerlondrina-arch/sistemaoficinas`  
**Branch da auditoria:** `infra/inf-004-auditoria-ambientes`  
**Commit base de `main`:** `939afd173f0362d5694d8d6c192e283588c778e6`  
**Escopo:** consultas somente leitura ao GitHub, Vercel e Supabase. Nenhum banco, variável, projeto ou deployment foi alterado.

## 1. Branches e Pull Requests

Branches remotas listadas antes da criação desta branch de auditoria:

| Branch | Base original do PR | Head consultado | PR | Comparação GitHub com `main` | Situação |
|---|---|---|---:|---|---|
| `main` | — | `939afd173f0362d5694d8d6c192e283588c778e6` | — | referência | Ativa |
| `adm-002-ativacao-oficinas` | `438371c11eca3f3567d772c08b0977ccbc4aa007` | `e8e44bfe150fae105f9db751f00b41a9de297f9d` | #2 merged | 0 commits exclusivos por ancestry; 7 atrás | Integrada; candidata à limpeza |
| `mig-002-transfer` | `5905a25bc8cb2269e3350e0acef108934a1cc822` | `e7f2f09ca6e121294e97e0a29ca1516e63872d3d` | #1 merged | 0 exclusivos; 9 atrás | Integrada; candidata à limpeza |
| `mig-004-merge-replace` | `04e5bf7071dded4ef4b4139df7c4a1e3048095fe` | `94dc8138907a2a45dfc11b972383e304525adce8` | #3 merged | 10 commits não ancestrais; 6 atrás | Integrada pelo PR; comparação ancestry não indica código pendente |
| `mig-004-fix-replace-permissions` | `16fddb35c381d4cc6a54eaa4aeff89a8e1d329c7` | `b18f0f79f77726d1d5261e6a0490b28c1fd525a7` | #4 merged | 1 não ancestral; 5 atrás | Integrada pelo PR; candidata à limpeza |
| `fix/transfer-external-catalog-identity` | `b14aeace5695360610194602dc6265abf1c0a124` | `b9a824eecce972e4cb506622a20fddc944a5600f` | #5 merged | 3 não ancestrais; 4 atrás | Integrada pelo PR; candidata à limpeza |
| `fix/mig-005-transfer-schema` | `dd7de824f110c0dbc62fb20b1a689ffb477cb962` | `2c2e6a8ef32e1723867e86048fa9f3706c2980f8` | #6 merged | 7 não ancestrais; 3 atrás | Integrada pelo PR; candidata à limpeza |
| `fix/transfer-preserve-destination-user` | `0855a3eae639890a116b22f86bacddfee74416c6` | `325e0e991b714b4bf28c781b8278033b2a50b3ea` | #7 merged | 1 não ancestral; 2 atrás | Integrada pelo PR; candidata à limpeza |
| `docs/gov-001-gestao-projeto` | `6496c8a8795178babcaba525cb707f7fd88b823a` | `d0b6025bb709b8206994b54bdb81d0ecf4b218b5` | #8 merged | 1 não ancestral; 1 atrás | Integrada; conteúdo de governança está em `main` |

Todos os PRs #1–#8 foram encontrados como integrados à `main`. Nas branches cujo PR foi squash/merge sem preservar a identidade de cada commit ancestral, a comparação GitHub reporta commits “ahead” pela topologia do grafo, embora o PR esteja fechado como merged. Não foram identificados commits adicionados às branches depois do head do PR correspondente. O conteúdo dos PRs está incorporado na linha principal; as diferenças atuais das branches são versões antigas e/ou topologia, não motivo para reabrir o trabalho.

**Candidatas a exclusão futura:** as oito branches de tarefa listadas acima. A exclusão não foi executada; requer a aprovação prevista.  
**Alterações pendentes:** nenhuma entre as branches remotas existentes e seus PRs #1–#8. A branch INF-004 desta auditoria é nova e permanece em revisão.  
**Branches locais:** não consultadas. O fluxo desta tarefa foi executado diretamente no GitHub, conforme a decisão de não manter trabalho no computador. GitHub não expõe branches locais que nunca foram enviadas.

## 2. Vercel

### Homologação — `sistema-oficinas-homologacao`

- Projeto Vercel identificado separadamente, framework Vite, Node.js `24.x`.
- A deployment READY mais recente consultada aponta para repositório `horsepowerlondrina-arch/sistemaoficinas`, branch `main`, commit `939afd173f0362d5694d8d6c192e283588c778e6`, target Production do próprio projeto.
- Domínio verificado: `sistema-oficinas-homologacao.vercel.app`. Não há domínio próprio conectado ao projeto no inventário consultado.
- SSO/deployment protection está habilitado para deployments exceto domínios personalizados; proteção por senha está desabilitada. O alias `.vercel.app` é o domínio de homologação consultado.
- Foram encontrados deployments Preview automáticos para branches (incluindo o head da GOV-001); isso demonstra que branches/PRs podem gerar Preview no projeto de homologação. O Preview observado não substituiu o alias de homologação nem atualizou o deployment Production.
- O target Production da Vercel neste projeto é o ambiente de homologação. O deployment de `main` para esse projeto pode atualizar a homologação automaticamente após integração; não foi disparado deployment manual nesta tarefa.

### Infraestrutura Horse Power — `horse-power`

- Deployment READY identificado em `horsepowerlondrina-arch/horse-power`, branch `main`, commit `55629c1028d0a7bd666a433511e67bd2bbc2fe0f`, target Production do projeto.
- Domínios Horse Power verificados incluem `horse-power.vercel.app`, `oficinahorsepower.com.br` e `sistema.oficinahorsepower.com.br`. Domínios próprios estão fora da exceção de SSO descrita na configuração.
- Este projeto segue conectado ao repositório Horse Power e permanece separado do projeto `sistema-oficinas-homologacao`. Não foi alterado e seu código não foi usado como fonte de desenvolvimento.
- A configuração explícita de “production branch” e o comando de build salvo no painel não foram retornados pela leitura de projeto disponível; o branch e build de deployment efetivamente observado são os acima. O projeto informa framework Vite/Node 24.x.

### Variáveis Vercel

- No projeto de homologação aparecem `DATABASE_URL` e `PLATFORM_ADMIN_DATABASE_URL` como variáveis sensíveis, além da chave de criptografia TOTP e variáveis públicas de habilitação/hostname. As variáveis consultadas estavam no target Production.
- No projeto Horse Power aparece `DATABASE_URL`; `PLATFORM_ADMIN_DATABASE_URL` não foi listado. Os valores sensíveis foram mantidos ocultos, inclusive ao solicitar descriptografia. Não foi possível confirmar os destinos Supabase exatos.
- Não foram listadas variáveis de banco para Preview ou Development no projeto de homologação. O funcionamento das APIs em Preview não foi verificado e pode depender de configuração própria. Não copiar valores de produção/homologação para Preview sem decisão específica.
- A documentação da Vercel informa que valores de ambiente são criptografados em repouso e que `VERCEL_PROJECT_ID` é disponibilizado como variável de sistema em build/runtime quando o sistema expõe essas variáveis: [environment variables](https://vercel.com/docs/environment-variables), [system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables).

## 3. Supabase

### Homologação — `vnclahdnirqlcbamodqy`

- Projeto `sistema-oficinas-homologacao`, estado `ACTIVE_HEALTHY`, PostgreSQL 17.11.
- O histórico de migrações contém as migrações de administração, isolamento RLS, ativação, MIG-004 e compatibilidade `external_captures`, incluindo `transfer_merge_replace`, `transfer_archives_retention`, `transfer_replace_runtime_delete` e `transfer_external_capture_compatibility`.
- Consultas somente leitura ao catálogo: 48 tabelas no schema privado `horse_power`; RLS habilitado nas 48. Nas tabelas de amostra `checklists`, `checklist_photos`, `customers` e `orders`, existe política `tenant_scope` para `horse_power_app` e a expressão inclui tenant.
- Papel `horse_power_app`: não superuser e sem `BYPASSRLS`; possui acesso às tabelas operacionais. A API continua dependendo da validação de sessão/membership e do contexto de oficina do servidor.
- Não foram consultadas linhas de clientes, oficinas, ordens, pagamentos ou outros dados operacionais.

### Banco histórico Horse Power — `cbdwgocofigrdigfgwkp`

- Projeto `horsepowerlondrina-arch's Project`, estado `ACTIVE_HEALTHY`, PostgreSQL 17.11.
- Consultas somente leitura ao catálogo confirmaram 38 tabelas no schema `horse_power`; 36 têm RLS habilitado, mas `checklists` e `checklist_photos` não têm RLS nem políticas.
- O papel `horse_power_app` pode fazer SELECT nessas duas tabelas, embora não seja superuser nem tenha `BYPASSRLS`. Portanto o banco não fornece isolamento por oficina nessas tabelas; a proteção depende da aplicação. Isso é uma **lacuna de defesa em profundidade**, não evidência de que usuário final consiga explorar ou de que dados tenham sido expostos. Não se inspecionou o código antigo nem dados, e não se testaram requisições de exploração.
- Em amostra, políticas `backend_access` de `customers` e `orders` permitem o papel de backend sem predicado tenant; reforça a dependência de autorização na aplicação antiga.
- Não foram executadas migrações ou escritas no banco histórico. Corrigir esse risco exige análise própria da aplicação/migração histórica e autorização explícita; não misturar a correção no schema operacional do novo sistema.

## 4. Sessões, origens, administração e oficinas

- A API administrativa usa o cookie `hp_platform_session`, separado de `hp_session` operacional. Cookies são HttpOnly, SameSite=Strict, com Secure em produção; a sessão administrativa tem duração configurada de 8 horas e é persistida por hash.
- As rotas administrativas exigem sessão e permissões; eventos de login/logout e ações administrativas são auditados. MFA TOTP permanece verificado pelo servidor para contas normais.
- A API valida origens contra `APP_ORIGIN`/`APP_ORIGINS` mais loopback local. A origem recusada recebe 403. A permissão localhost é regra do código e merece revisão separada se o modelo de origens mudar.
- A sessão operacional associa usuário a tenant no banco, confirma membership, define identidade de requisição e verifica estado de acesso antes de prosseguir. CI documenta testes PostgreSQL entre oficinas.
- O workflow CI usa serviço PostgreSQL 17 efêmero, cria roles/banco fictícios e executa migrações/testes; não usa credenciais Supabase. A senha configurada no serviço é de teste temporária, não uma credencial operacional.

## 5. Exceção de MFA de homologação

Na configuração Vercel de homologação foram vistas as variáveis de teste para o e-mail fictício e o hostname exato `sistema-oficinas-homologacao.vercel.app`, no target Production. O código em `main` exige `VERCEL=1`, `VERCEL_ENV=production`, e-mail e hostname configurados e correspondência exata. Outros e-mails, hostnames e deployments Preview recusam o bypass; a autenticação normal valida TOTP e o bypass gera evento de auditoria.

**Risco comprovado:** o código anterior não vinculava a exceção ao identificador imutável do projeto Vercel. Se as mesmas variáveis fossem copiadas para outro projeto com o mesmo hostname, a exceção poderia ser reativada fora do projeto pretendido.

**Correção nesta branch:** adicionar a exigência de `VERCEL_PROJECT_ID` igual ao ID do projeto Vercel `sistema-oficinas-homologacao`, com testes para ID divergente e ausente. O ID esperado veio da consulta do projeto Vercel. A correção está somente na branch/PR, ainda não integrada nem implantada. O deployment online atual mantém o código anterior até eventual integração/publicação autorizada.

## 6. Testes, correções e conclusão

- CI existente: run #26, head GOV-001, build + testes gerais + PostgreSQL aprovados.
- O primeiro CI do PR (run #27) aprovou build e testes gerais, mas falhou na integração PostgreSQL porque o fixture de login admin não definia o novo `VERCEL_PROJECT_ID`. O fixture agora simula o ID do projeto de homologação e o executa novamente. Nenhum teste foi removido ou relaxado.
- Mudanças planejadas nesta branch: código de guarda MFA, testes unitários e PostgreSQL (incluindo o ambiente Vercel simulado), este relatório e atualização do estado/registro de gestão. Nenhuma migração, variável, banco ou deployment será alterado.
- Branches antigas candidatas à exclusão não foram removidas.
- Vercel e Supabase não foram modificados; nenhum deployment manual foi criado.

### Bloqueios e riscos restantes

1. Não foi possível confirmar os destinos exatos de `DATABASE_URL` e `PLATFORM_ADMIN_DATABASE_URL`, pois a Vercel não retornou seus valores. Requer inspeção autorizada no painel ou procedimento de diagnóstico sem revelar credenciais.
2. Duas tabelas do banco histórico não têm RLS, com SELECT para o papel do backend. Exige revisão específica; não alterar esse Supabase nesta tarefa.
3. Branches locais que nunca foram enviadas não podem ser inventariadas via GitHub; nenhum computador/checkout local foi consultado.
4. Preview Vercel não tem variáveis de banco visíveis; sua funcionalidade server-side precisa ser validada separadamente. Não adicionar segredos de banco aos ambientes Preview como parte desta auditoria.
5. É necessário CI verde no PR. O PR pode acionar Preview automático protegido na Vercel de homologação; isso não é deployment manual nem altera o alias Production.
6. Limpeza das oito branches candidatas depende de aprovação posterior.

**Conclusão:** **INF-004 parcialmente concluída.** A auditoria remota de branches e metadados das plataformas foi feita e a guarda adicional do MFA foi preparada. O destino dos segredos de conexão e o risco de RLS no banco histórico permanecem sem resolução; nenhuma alteração remota foi aplicada.
