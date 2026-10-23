# PostgreSQL local no Windows

## Estado e escopo

Branch de trabalho: `postgres-local`, criada de `desenvolvimento-local`.
Na inspeção, ambas as bases locais e `origin/HPDesenvolvimento` apontavam para
`fa3795cfeca954ed6bdcd6a2bb4be73eccf3ce18`; `main` e `origin/main` para
`1628c0ea12de50b8e7c1b824aa4400653983de32`. A branch inicialmente aberta,
`sec-003-2-links-publicos`, estava limpa e no mesmo commit. Foram usadas as
referências já disponíveis localmente, sem fetch/push ou consulta a bancos online.
Entre main e a base local há 42 arquivos diferentes, incluindo o catálogo técnico,
serviços particulares, FIPE e as proteções específicas da homologação.

Antes: `server/index.ts` abria SQLite e executava o seed automaticamente.
Agora: esse ponto de entrada exige PostgreSQL local, verifica o usuário runtime
e a migração, não executa seed e não recua para SQLite em caso de erro.
`api/index.ts → server/cloud.ts` permanece inalterado, assim como `vercel.json`
e as migrações Supabase. Os testes legados continuam usando SQLite em memória.
Essa compatibilidade permite preservar as funcionalidades e a suíte existente.

## 1. Instalar e criar um banco vazio

Instale PostgreSQL **17 x64** pelo instalador indicado em
https://www.postgresql.org/download/windows/ (a aplicação usa views
`security_invoker`, disponíveis a partir do PostgreSQL 15).
Selecione servidor e ferramentas de linha de comando. pgAdmin é opcional.
Defina sua própria senha de administrador; use a porta 5432.
Não abra a porta no firewall. Mantenha `listen_addresses='localhost'` em
`postgresql.conf` e autenticação `scram-sha-256` em `pg_hba.conf`, limitada
a `127.0.0.1/32` e `::1/128`. Reinicie o serviço após ajustar a configuração.

No PowerShell, na raiz do repositório:

```powershell
$env:Path = "C:\Program Files\PostgreSQL\17\bin;" + $env:Path
psql -h 127.0.0.1 -U postgres -d postgres -f local-postgres/bootstrap.psql
Copy-Item local-postgres/env.example .env.local
notepad .env.local
```

O bootstrap pede uma senha própria para `hp_local_app`, cria
`horse_power_local` e não apaga bancos existentes. Execute uma vez.
Use senhas distintas para administrador e aplicação; codifique caracteres
especiais nas URLs com percent-encoding. O arquivo `.env.local` é ignorado.
Não use URLs do Supabase. O servidor recusa banco diferente, host remoto,
opções na URL, execução Vercel/production e overrides de conexão libpq.
O banco deve ser exclusivo deste projeto: o bootstrap restringe CONNECT e a
migração restringe também o schema public.

## 2. Migrar e criar dados fictícios

```powershell
npm.cmd run db:local:migrate
npm.cmd run db:local:seed
```

As migrações exigem `LOCAL_ADMIN_DATABASE_URL`, sempre loopback e banco
`horse_power_local`. O servidor usa apenas `LOCAL_DATABASE_URL`, com
`hp_local_app` sem superusuário, criação de bancos/roles ou bypass de RLS.
A baseline local congela a estrutura PostgreSQL já versionada, adapta somente
roles/permissões locais e separa a estrutura da carga real do catálogo.
Cada aplicação ocorre em transação, com bloqueio e checksum; uma nova execução
confere o checksum. Não cria tabelas da aplicação sobre schemas preexistentes
sem histórico local. Alterações futuras devem ser novas migrações, acompanhadas
da evolução do executor; nunca editar uma migração já aplicada.

O seed só aceita banco sem usuários. Cria duas oficinas fictícias, dois
administradores sem vínculo entre oficinas, clientes e veículos fictícios,
tarifa ilustrativa e catálogo sintético com um modelo e um serviço.
Senhas aleatórias ficam somente em `data/local-credentials.json`, ignorado
pelo Git. Nenhuma senha padrão é usada. Não execute o importador de dados reais
nem o antigo seed SQLite neste banco.
Se COMMIT falhar depois de gravar credenciais, preserve o arquivo e confira o
banco antes de repetir; não há reset automático.

## 3. Executar e validar

```powershell
npm.cmd run dev
# Em outro terminal:
npm.cmd run build
npm.cmd test
npm.cmd run test:postgres
```

Abra http://127.0.0.1:5173 e use as credenciais locais geradas.
A API escuta somente em 127.0.0.1:3001. Não é necessário iniciar Supabase.
Tokens de consultas pagas são removidos do ambiente do processo local.
As variáveis de origem são locais. Não há sincronização automática com bancos
online. Encerre com Ctrl+C.

`npm test` mantém a suíte existente e adiciona validações de configuração.
`test:postgres` exige o banco local migrado e o seed fictício; cobre login,
sessão, logout, isolamento HTTP, rollback, concorrência/contexto da oficina,
leitura autorizada e proibição de escrita/autoliberação no catálogo.
Executá-lo não substitui testes manuais da interface.

## Permissões e limites

`service_catalog` pertence ao administrador. Runtime tem USAGE/SELECT,
sem CREATE ou escrita. RLS é habilitada e forçada nas tabelas; a view
`model_services` usa `security_invoker=true`. Sem versão ativa, contexto,
liberação válida ou com liberação vencida, o catálogo não é acessível.
O contexto usa `set_config(...,true)` dentro da transação e não persiste no pool.
Somente a oficina fictícia A recebe acesso inicial; B serve como controle negativo.
Acesso administrativo não é exposto na interface.

Dados operacionais mantêm o modelo do backend online: filtros pelo tenant da
sessão, vínculos compostos e transações. O papel SQL runtime é compartilhado
entre oficinas e não representa por si só uma fronteira de autorização
operacional; não distribua sua credencial. RLS específica de tenant é aplicada
ao catálogo, não adicionada silenciosamente a todas as tabelas operacionais.
O adaptador cloud continua exigindo TLS/certificado; só a conexão local usa
TLS desativado, em loopback. Nenhum arquivo SQLite atual é aberto na inicialização.

## Publicar somente após revisão

Não envie esta branch nem mescle suas configurações locais diretamente em main
ou HPDesenvolvimento. Após aprovação, selecione os commits funcionais e revise
migrações/configurações para o destino. Não publique banco, .env, credenciais,
arquivos catalogo.sqlite ou dados locais. Este trabalho não cria deployments.

## Verificação desta entrega

- Build final: aprovado (TypeScript, Vite e preparação do site). Aviso de
  bundle JavaScript acima de 500 kB permanece; não bloqueou o build.
- Suíte principal: 149 testes aprovados, zero falhas ou testes ignorados
  (146 existentes + 3 novos de configuração local).
- Integração PostgreSQL: 7 testes/subtestes aprovados, zero falhas ou ignorados,
  em PostgreSQL 17.10 real, portátil, no Windows, porta temporária 55439.
- Migração aplicada e repetida com checksum confirmado.
- Servidor real iniciado com PostgreSQL; sessão sem autenticação retornou 401.
- Banco temporário encerrado. Credenciais fictícias de validação foram retiradas
  de data/ para não interferir no seed da instalação permanente.
- Arquivos online e migrações Supabase conferidos sem alterações.
  Nenhum push, deployment ou acesso aos bancos online foi realizado.
- A instalação permanente do PostgreSQL e o preenchimento de .env.local ainda
  precisam seguir as etapas acima. Não foi instalado serviço no Windows.
- A importação do catálogo completo e a navegação visual da interface continuam
  pendentes; somente o catálogo sintético foi usado nos testes.

## Arquivos desta implementação

Modificados: README.md, package.json, server/index.ts, server/db/postgres.ts.

Adicionados:
- server/localConfig.ts e server/db/local.ts: configuração restrita e conexão.
- local-postgres/bootstrap.psql, env.example e 001-local.sql: criação,
  configuração e baseline independente.
- scripts/local-admin.ts, local-migrate.ts e local-seed.ts: administração local.
- scripts/catalog-inspect.ts: diagnóstico somente leitura do catálogo externo.
- tests/localConfig.test.ts e localPostgres.integration.ts: verificações.
- docs/postgresql-local.md e docs/catalogo-importacao-local.md: operação e análise.

As alterações permanecem no diretório de trabalho da branch postgres-local,
sem commit ou envio remoto.

## Configuração permanente concluída — 21/10/2026

O computador possui PostgreSQL **18.6**, usado com aprovação explícita do usuário
em substituição à versão 17 inicialmente solicitada. Serviço:
`postgresql-x64-18`, ativo em `localhost:5432`, autenticação SCRAM-SHA-256.
A restrição de escuta foi aplicada e o serviço reiniciado com confirmação
administrativa do Windows; `pending_restart=false`.

A inspeção anterior à criação encontrou somente postgres/template0/template1
e nenhum papel hp_local_app. Não foram apagados bancos nem substituídos dados.
O bootstrap existente foi usado para criar horse_power_local e o papel restrito.
A senha administrativa foi digitada diretamente em terminal com entrada oculta;
a senha runtime foi gerada aleatoriamente. Nenhuma senha foi registrada aqui,
no código ou nos resultados dos comandos.

.env.local está configurado e ignorado pelo Git, com acesso Windows restrito ao
usuário proprietário. Os dados fictícios foram gerados pelo script local de seed:
duas oficinas, dois administradores, dois clientes/veículos fictícios, um modelo
e um serviço sintético. Nenhuma OS persistiu após os testes.
As credenciais de login fictícias estão em data/local-credentials.json, ignorado
pelo Git; consulte esse arquivo localmente, sem copiar seu conteúdo para commits.

Resultados nesta instalação:
- npm.cmd run db:local:migrate: aprovado.
- npm.cmd run db:local:seed: aprovado.
- npm.cmd run build: aprovado, com aviso não bloqueante de bundle acima de 500 kB.
- npm.cmd test: 149 aprovados, zero falhas.
- npm.cmd run test:postgres: 7 aprovados, zero falhas, inclusive após o reinício.
- Entrada real da API: iniciou com .env.local e retornou HTTP 401 sem login.
  O processo de verificação foi encerrado; o serviço PostgreSQL permanece ativo.

Houve bloqueios na inspeção Windows do serviço e na leitura do arquivo protegido
pelo ambiente restrito. A configuração foi concluída pelas execuções autorizadas
e pelo terminal administrativo; não há bloqueio pendente.
Nenhum acesso Supabase, modificação Vercel ou publicação foi realizado.

Para iniciar normalmente na raiz deste repositório: `npm.cmd run dev`.
Não execute novamente o bootstrap ou o seed em uma instalação já preenchida.
