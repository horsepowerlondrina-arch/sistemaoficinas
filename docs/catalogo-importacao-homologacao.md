# CAT-008 — carga privada em homologação

## Segurança e escopo

O fluxo `.github/workflows/catalog-homologation-import.yml` só pode ser iniciado manualmente. A opção padrão executa a validação integral numa instância descartável PostgreSQL 17. A carga persistente exige selecionar `load-homologation`, declarar os direitos de processamento do catálogo e possuir os segredos do ambiente `catalog-homologation` configurados.

O banco temporário e o Supabase de homologação são destinos separados. O workflow não aplica migrações remotas, não habilita oficinas, não publica código e não acessa produção. O arquivo SQLite é baixado para `$RUNNER_TEMP`, validado por tamanho e SHA-256, não é enviado a artifacts e é removido ao final do job.

O pacote atualmente reconhecido é `C:\Users\horse\Documents\catalogo.sqlite`, 294.141.952 bytes, SHA-256 `5557e09a16362452e1a5716164e9cc0e13d48a26140c1682ffdc5ae48b0eefaa`. Os documentos do pacote não contêm licença ou autorização de redistribuição; uma pessoa responsável deve confirmar que o processamento privado no runner e a utilização no Sistema Oficinas estão autorizados antes de iniciar o workflow.

## Preparação única do ambiente GitHub

No GitHub, crie o environment `catalog-homologation` e configure revisão obrigatória para o deployment desse environment. Cadastre como secrets:

- `CATALOG_SOURCE_URL`: URL HTTPS assinada, privada e com validade suficiente para a execução.
- `CATALOG_SOURCE_ALLOWED_HOSTS`: nomes dos hosts permitidos na URL e nos redirecionamentos, separados por vírgula.
- `CATALOG_IMPORT_DATABASE_URL`: conexão PostgreSQL de sessão do projeto `vnclahdnirqlcbamodqy`, com usuário restrito `hp_catalog_import_login` e TLS obrigatório.

O processo de download aceita somente os hosts informados no segundo secret. Ele não imprime a URL nem os dados do catálogo. Não armazene o arquivo em Git, releases ou artifacts.

## Preparação do usuário PostgreSQL restrito

Depois de aprovar e aplicar as migrações Supabase `20261025000700_catalog_module_access.sql` e `20261025000800_catalog_import_pipeline.sql`, crie no painel Supabase uma role de login chamada `hp_catalog_import_login`, sem superuser, criação de roles/bancos ou bypass de RLS. Conceda a associação ao grupo sem login `hp_catalog_importer`:

```sql
GRANT hp_catalog_importer TO hp_catalog_import_login;
```

Guarde a senha somente no secret `CATALOG_IMPORT_DATABASE_URL`. O script confirma host/ref do projeto, banco `postgres`, associação à role restrita e ausência de superuser/BYPASSRLS. A role de carga recebe acesso somente às tabelas técnicas e temporárias; não recebe privilégios em `horse_power`, dados de oficina, permissões administrativas ou `tenant_access`.

## Carga e retomada

Antes de gravar, o importador valida o hash, as sete tabelas, UUIDs, relacionamentos, JSON de exclusões, tempos, aplicações lógicas e as 51 exceções CAT-007. A carga é feita em lotes parametrizados e numa única transação. Se ocorrer erro ou cancelamento antes do commit, a transação reverte e a mesma execução pode ser repetida. Após um commit com resposta perdida, uma repetição valida a release e os hashes e encerra sem duplicar dados.

Na homologação, uma função restrita só remove o fixture sintético conhecido se todos os IDs, nomes, contagens, vínculos, release e ausência de snapshots históricos coincidirem exatamente. Qualquer divergência aborta sem gravar. A função aposenta o release `homologacao-sintetica`, preserva as 51 exceções e os registros de autorização das oficinas.

Durante o preflight, o importador estima o pico conservador como tamanho atual do banco mais duas vezes o estágio. Se exceder 450 MiB, ele reverte antes da gravação final, mantendo margem abaixo do limite de 500 MB do plano Free. O tamanho final efetivo do banco temporário e de homologação fica registrado no log do job, sem credenciais.

## Execução direta autorizada em homologação

O importador também aceita execução direta, sem GitHub Actions e sem banco PostgreSQL local. Essa modalidade exige `CATALOG_IMPORT_TARGET=homologation-direct`, `CATALOG_HOMOLOGATION_DIRECT_AUTHORIZED=true`, `CATALOG_IMPORT_CONFIRM=CAT-008-HOMOLOGATION-DIRECT-IMPORT` e `CATALOG_RIGHTS_CONFIRMED=true`. A conexão deve usar exclusivamente `hp_catalog_import_login`, na porta TLS 5432, pelo host direto do projeto `vnclahdnirqlcbamodqy` ou pelo pooler `ca-central-1` com usuário de sessão vinculado a esse mesmo projeto; não aceita usuário administrativo nem outro destino. O importador ainda verifica a associação somente à role `hp_catalog_importer`, o destino `postgres`, a release, o hash, as contagens e o estado do fixture em uma transação com rollback.

Informe a URL somente por variável de ambiente temporária ou gerenciador de segredos; não a coloque em argumentos de linha de comando, arquivos versionados, logs ou mensagens. Remova a role de login temporária após a execução, mantendo intacta a role sem login `hp_catalog_importer`.

## Operação

1. Aplicar separadamente as migrações aprovadas no Supabase de homologação e preparar a role de login restrita.
2. Configurar a fonte privada e os secrets do environment.
3. Executar manualmente o workflow com direitos confirmados e `preflight-only`.
4. Revisar hash, contagens e tamanho medido no PostgreSQL 17.
5. Só depois de autorização específica para gravar em homologação, executar novamente com `load-homologation`.
6. Verificar a release ativa, 7.534 modelos, 6.491 serviços, 836.093 tempos, 7.292.579 aplicações lógicas e distribuição comercial 2.161/2.794/2.579/0. A liberação de oficinas é uma operação separada e não é feita pelo importador.

