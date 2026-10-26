# Validação do catálogo convertido

O desenvolvimento e a validação obrigatória usam GitHub Actions com PostgreSQL 17 temporário. PostgreSQL no computador e arquivos .env locais não são pré-requisitos.

O SQLite convertido é somente leitura para o validador. São exigidos quatro portes, 102 marcas, 928 famílias, 928 bases, 7.534 modelos, 6.491 serviços e 836.093 tempos. O SHA-256 deve ser fornecido explicitamente em CATALOG_SOURCE_SHA256; o hash anterior de 14 classificações foi descontinuado. As 51 exceções já pertencem ao classification_id de cada modelo.

O ensaio sintético cria quatro classificações e prova que um UUID presente nas aprovações antigas mantém o porte atribuído diretamente no modelo. A classificação auxiliar não é preenchida e não participa do cálculo. A importação futura preserva UUIDs, tempos, exclusões, substituições individuais e bases compartilhadas, validando hashes e relacionamentos sem materializar as aplicações lógicas.

[CAT-009](CAT-009-quatro-portes.md) registra a migração e as autorizações necessárias. Não executar a carga antiga CAT-008 como etapa da simplificação.
