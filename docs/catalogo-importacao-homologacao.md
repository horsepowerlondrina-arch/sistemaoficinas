# Catálogo de quatro portes — preparação de uma carga futura

Contrato atual: 102 marcas, 928 famílias, 928 bases, 7.534 modelos, 6.491 serviços, 836.093 tempos e exatamente quatro classificações. Compacto: 2.161; Médio: 2.794; Premium: 2.579; Pesado: zero. A classificação já deve estar incorporada em models.classification_id na origem. Não aplicar novamente CAT-007.

O workflow manual existente usa as variáveis do Environment CATALOG_SOURCE_SHA256 e CATALOG_SOURCE_BYTES aprovadas para o SQLite convertido. A URL privada, os hosts autorizados e a conexão restrita continuam nos secrets existentes. Valores ausentes ou divergentes abortam o processo. Nenhum arquivo restrito é incluído em Git ou artefatos públicos.

O importador mantém destino fixo na homologação, TLS com CA verificada, confirmação de direitos e operação, role sem BYPASSRLS, transação, limites de tamanho e validação integral antes de ativar a release 2.0-quatro-portes. Um destino ocupado é recusado; o procedimento não apaga catálogo, fixtures, oficinas ou histórico para abrir espaço.

As migrações históricas continuam no repositório. A migração CAT-009 deve ser revisada e autorizada antes de qualquer carga futura. Os ensaios normais do CI usam apenas dados sintéticos; não baixam nem carregam o catálogo real. Executar o workflow de carga exige autorização específica separada.

Consulte [CAT-009](CAT-009-quatro-portes.md) para aliases de API, snapshots e compatibilidade. Nesta tarefa não houve operação no Supabase nem execução de carga.
