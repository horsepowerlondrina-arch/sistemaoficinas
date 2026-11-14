# Fotos privadas dos checklists

Branch: feat/checklist-private-storage. Alvo inicial: somente homologação `vnclahdnirqlcbamodqy`.

## Compatibilidade

`checklist_photos.image_data` aceita o Base64 legado ou uma referência interna versionada `private-checklist:v1:` com caminho, tamanho e SHA-256. Não se muda o schema nem a política RLS da tabela. Fotos antigas continuam disponíveis sem migração automática. A API autenticada mantém seu endereço e valida oficina/escopo antes de buscar o arquivo. Não se entregam URLs assinadas ou públicas.

Novos uploads usam objetos imutáveis com chave `<tenant>/<uuid>` em bucket privado `checklist-photos`. Upload não sobrescreve; o servidor baixa novamente e verifica hash antes de registrar a referência. Falha na gravação SQL deixa no máximo um objeto órfão, nunca uma referência para conteúdo não verificado. Exclusão de foto remove o registro; o objeto é conservado até limpeza controlada, para não apagar dados durante rollback.

Documentos emitidos preservam os snapshots existentes. Novas emissões ainda incorporam cópia das imagens no snapshot imutável: mover essas cópias também exigiria uma tarefa específica de documentos históricos. A economia inicial é nas fotos operacionais, não em todos os snapshots.

Exportação e backup `.hptx` materializam bytes, sem caminhos do bucket. Mesclagem e conferência usam essa representação portátil, preservando hashes/idempotência. Importações legadas continuam aceitas; fotos importadas podem ser movidas pelo mesmo lote de migração. Referências externas no pacote são rejeitadas na importação.

## Ativação após aprovação específica

1. Criar no Supabase de homologação o bucket `checklist-photos` com `public=false`, `file_size_limit=1600000`, MIME `image/jpeg,image/png`. Não criar políticas anon/authenticated. O sistema usa sessões próprias, não JWT Supabase Auth; nenhuma leitura direta do navegador é autorizada.
2. Configurar somente no servidor Vercel de homologação `CHECKLIST_STORAGE_URL=https://vnclahdnirqlcbamodqy.supabase.co`, `CHECKLIST_STORAGE_SECRET` (segredo servidor Supabase), `CHECKLIST_STORAGE_ENABLED=true`. Nunca prefixar segredo com VITE ou registrar seu valor. A chave não vai ao frontend. A chave de servidor exige aprovação específica e deve ser mantida exclusivamente no ambiente autorizado.
3. Publicar e testar upload/leitura/remoção em oficina fictícia, tentativa de outra oficina e PDF. Confirmar que a URL pública de Storage não retorna bytes.
4. Para fotos existentes: executar `migrateChecklistPhotos(db,tenantId,limit,apply)` com contexto autenticado de proprietário e oficina explícita. Limite máximo 20, padrão 10. Primeiro `apply=false`; após aprovação, `apply=true`. Cada foto é copiada, baixada e conferida antes de trocar o valor por comparação condicional (tenant, id e conteúdo original). Repetição não copia registros já movidos. Não imprime bytes nem caminhos. Falha preserva o Base64 da foto afetada. Uma transação externa permite rollback do lote SQL; os objetos já enviados permanecem recuperáveis.
5. `cleanupChecklistPhotoOrphans(db,tenantId,offset,apply)` faz prévia por padrão e limpa somente objetos sem referência SQL e com mais de 30 dias, em páginas de 100. A execução com `apply=true` exige autorização. Usar `nextOffset` para continuar; uma nova execução pode começar em 0. Objetos referenciados não expiram. Não configurar lifecycle cego. A rotina não modifica tabelas de documentos ou dados operacionais.

Desabilitar novos uploads privados não reverte dados já movidos: manter URL e segredo para leitura. Para rollback completo, materializar os bytes verificados de volta em Base64 antes de remover configuração/objetos. Nunca apagar bucket ou segredo enquanto houver referências.

## Validação

Testes de serviço cobrem legado e privado, isolamento, hash, falhas de download, migração sem escrita, migração repetida e snapshots. PostgreSQL 17 temporário valida gravação/RLS e migração com adaptador de arquivos fictício; isso não substitui o teste real da API Storage após configuração autorizada. Nenhuma interface foi alterada.

## Execução remota controlada

O workflow manual `Checklist private storage controlled batch` usa o ambiente GitHub `checklist-storage-homologacao`. Configurar proteção por aprovação e, somente após autorização, dois segredos: `PHOTO_DATABASE_URL` (login restrito da aplicação com RLS, exclusivamente no projeto de homologação) e `CHECKLIST_STORAGE_SECRET`. Entradas: oficina UUID, migrate/cleanup, apply=false por padrão e offset. Não executa automaticamente nem em PR. Confere projeto, evento e branch; lote de migração até 10 fotos. Registra evento de auditoria ao aplicar. Não contém segredos no YAML ou logs. Falhas de banco revertem o lote SQL, mantendo origem; objetos órfãos são elegíveis após 30 dias. Nunca apontar para o banco definitivo.
