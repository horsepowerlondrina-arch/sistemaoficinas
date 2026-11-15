# Migração autorizada das 24 fotos existentes

Destino exclusivo: Horse Power definitiva, Supabase `rvlovjpquozbrsszsxwe`.
Autorização: migrar as 24 fotos existentes, conferindo integridade e preservando documentos e revisões.

Prévia: 24 fotos legadas, 2.673.034 bytes, uma oficina; 30 revisões históricas. Nenhum byte de imagem, credencial, identificador de cliente ou documento real integra este PR.

O executor anterior é limitado à homologação e não foi reutilizado apontando para produção. A manutenção usa as conexões e Storage já configurados no servidor definitivo, sem copiar segredos para GitHub ou computador. A página `/api/photo-migration` está sob a autenticação operacional existente, exige proprietário, origem canônica nos POSTs, projeto definitivo, prazo máximo e assinatura exata do conjunto autorizado. Não há rota anônima nem nova permissão. O conjunto aprovado é identificado por assinatura de conteúdo; novas fotos ou mudanças bloqueiam o lote.

O GET mostra prévia sem escrita. Cada POST explicitamente confirmado migra até três fotos, dentro da transação e trava de mutações da oficina. O objeto imutável é enviado, baixado e conferido por tamanho e SHA-256 antes do UPDATE condicional. Manifesto e assinatura das revisões são conferidos antes/depois. A auditoria deve ser gravada ou o lote é revertido. Falhas preservam os dados SQL de origem; objetos enviados nunca são apagados. A execução é idempotente e não duplica fotos já migradas.

Após os oito lotes, a verificação lê todos os objetos em grupos limitados, conferindo bytes e hash contra o manifesto aprovado. As 30 revisões não são atualizadas nem reemitidas. O objeto privado contém os mesmos bytes originais; recuperação posterior pode materializá-los de volta em Base64 de forma verificada e condicional, sem excluir objetos, mediante autorização da recuperação. Não desligar/remover a chave ou o bucket.

Remover a entrada HTTP e o módulo de manutenção após terminar e conferir, mantendo os testes gerais do adaptador e os registros de auditoria. Além dessa remoção, o executor expira em 15/11/2026 06:00 UTC (03:00 de Brasília). Nenhuma migração de schema ou credencial nova é necessária.

CI obrigatório antes da publicação: build, testes gerais, PostgreSQL 17 temporário e testes negativos de autorização/origem/escopo/expiração, rollback, idempotência e integridade. Produção é utilizada somente para a migração real autorizada, nunca como base de testes fictícios.

## Resultado da operação — 15/11/2026 UTC

Migração concluída exclusivamente no banco definitivo `rvlovjpquozbrsszsxwe`, em oito lotes de três fotos. Auditoria: oito eventos `checklist.private_storage_migrated`, soma de 24 fotos e zero restante, uma oficina. As 24 referências apontam a 24 objetos privados com tamanho correspondente: 2.673.034 bytes. A verificação autenticada baixou todos os objetos e validou SHA-256 e tamanho. Manifesto antes/depois: `53abfc71ca9c62862aae294dadacdef1e3a9ae70b76095c6ccd83ee219a6e194`.

As 30 revisões foram preservadas sem reemissão: 30 hashes de payload válidos e assinatura agregada inalterada `57a19ae08137281ddb5959e3794fdfb7`. Quatro fotos de um checklist finalizado foram exibidas normalmente após a migração. Bucket continua privado. Nenhuma foto, documento ou objeto foi excluído; não houve limpeza de órfãos ou mudança de credenciais.

PR #193: executor temporário; CI [43668410708](https://github.com/horsepowerlondrina-arch/sistemaoficinas/actions/runs/43668410708) aprovado, 368 testes gerais e 43 PostgreSQL. A primeira submissão foi bloqueada por Origin null antes de gravações. PR #194: ajuste de Referrer-Policy exclusivamente nesta página, expressamente autorizado; CI [43669704895](https://github.com/horsepowerlondrina-arch/sistemaoficinas/actions/runs/43669704895) aprovado. Execução no commit `fe451a7f5d8d418be8f9742d862d1fc663e08786`, deployment `dpl_59gh9xkbCZAaAYxgDn5rTNNWh7r8`, READY no domínio definitivo.

A alteração de encerramento remove a rota HTTP, o módulo de manutenção e seus testes específicos, retornando os dois arquivos compartilhados ao conteúdo anterior à manutenção. Mantém os testes permanentes do armazenamento e o histórico do Git/auditoria. A publicação dessa remoção deve ocorrer após o respectivo CI; conferir que `/api/photo-migration` não está mais disponível e que as fotos continuam acessíveis pelo fluxo autenticado.

Snapshots históricos permanecem com os bytes originais, inclusive Base64 quando já presente; não foram reescritos para reduzir armazenamento. A liberação de espaço no banco refere-se aos registros operacionais das fotos, não aos documentos históricos preservados.
