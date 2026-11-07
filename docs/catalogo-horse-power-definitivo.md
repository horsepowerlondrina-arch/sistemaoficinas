# Cópia do Catálogo Técnico para a Horse Power definitiva

A origem é exclusivamente o catálogo técnico do Supabase de homologação `vnclahdnirqlcbamodqy`. O destino é exclusivamente o novo Supabase `rvlovjpquozbrsszsxwe`. Nenhuma tabela operacional de oficina é copiada por este procedimento.

O workflow manual `Horse Power definitive catalog copy` lê sete tabelas com `hp_catalog_export_login`, em transação somente leitura. Ele cria um SQLite temporário no runner do GitHub, confere contagens e chaves, e ensaia a importação integral em PostgreSQL 17 descartável. A opção `preflight-only` termina aí. A opção `load-definitive` só prossegue se o ensaio passar, usando `hp_catalog_import_login` no destino e o importador transacional existente. Erros causam rollback; a origem temporária é excluída ao final. O workflow não publica esse arquivo como artifact.

O ambiente de GitHub Actions `horse-power-catalog-copy` guarda `HP_CATALOG_SOURCE_PASSWORD` e `HP_CATALOG_TARGET_PASSWORD`, com acesso limitado à branch autorizada. As senhas devem ser inseridas diretamente na interface do GitHub. Não as inclua em commits, logs ou mensagens. O workflow constrói as URLs de conexão sem imprimi-las. Depois da carga e conferência final, remova os segredos e desabilite os dois logins temporários.

Contagens aprovadas: 102 marcas, 4 portes, 928 famílias, 928 bases, 6.491 serviços, 7.534 modelos e 836.093 tempos. O hash SHA-256 do SQLite reconstruído é calculado no runner e identifica **esta cópia temporária**. Ele não será igual ao hash histórico do arquivo convertido originalmente, pois a estrutura física do SQLite reconstruído difere. A integridade de conteúdo é conferida por contagens, chaves, distribuição dos portes e hashes canônicos de cada tabela entre SQLite e destino.

A carga do catálogo não inclui os dados operacionais da Horse Power nem habilita o domínio definitivo. A migração desses dados e a publicação exigem suas próprias validações e autorizações.
