# Migração autorizada das 24 fotos existentes

Destino exclusivo: Horse Power definitiva, Supabase `rvlovjpquozbrsszsxwe`.
Autorização: migrar as 24 fotos existentes, conferindo integridade e preservando documentos e revisões.

Prévia: 24 fotos legadas, 2.673.034 bytes, uma oficina; 30 revisões históricas. Nenhum byte de imagem, credencial, identificador de cliente ou documento real integra este PR.

O executor anterior é limitado à homologação e não foi reutilizado apontando para produção. A manutenção usa as conexões e Storage já configurados no servidor definitivo, sem copiar segredos para GitHub ou computador. A página `/api/photo-migration` está sob a autenticação operacional existente, exige proprietário, origem canônica nos POSTs, projeto definitivo, prazo máximo e assinatura exata do conjunto autorizado. Não há rota anônima nem nova permissão. O conjunto aprovado é identificado por assinatura de conteúdo; novas fotos ou mudanças bloqueiam o lote.

O GET mostra prévia sem escrita. Cada POST explicitamente confirmado migra até três fotos, dentro da transação e trava de mutações da oficina. O objeto imutável é enviado, baixado e conferido por tamanho e SHA-256 antes do UPDATE condicional. Manifesto e assinatura das revisões são conferidos antes/depois. A auditoria deve ser gravada ou o lote é revertido. Falhas preservam os dados SQL de origem; objetos enviados nunca são apagados. A execução é idempotente e não duplica fotos já migradas.

Após os oito lotes, a verificação lê todos os objetos em grupos limitados, conferindo bytes e hash contra o manifesto aprovado. As 30 revisões não são atualizadas nem reemitidas. O objeto privado contém os mesmos bytes originais; recuperação posterior pode materializá-los de volta em Base64 de forma verificada e condicional, sem excluir objetos, mediante autorização da recuperação. Não desligar/remover a chave ou o bucket.

Remover a entrada HTTP e o módulo de manutenção após terminar e conferir, mantendo os testes gerais do adaptador e os registros de auditoria. Além dessa remoção, o executor expira em 15/11/2026 06:00 UTC (03:00 de Brasília). Nenhuma migração de schema ou credencial nova é necessária.

CI obrigatório antes da publicação: build, testes gerais, PostgreSQL 17 temporário e testes negativos de autorização/origem/escopo/expiração, rollback, idempotência e integridade. Produção é utilizada somente para a migração real autorizada, nunca como base de testes fictícios.
