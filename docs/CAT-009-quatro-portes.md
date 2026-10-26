# CAT-009 — porte único do catálogo

O porte do veículo é exclusivamente service_catalog.models.classification_id, associado ao UUID de service_catalog.classifications. Os quatro nomes aceitos são Compacto, Médio, Premium e Pesado. A distribuição do catálogo convertido é 2.161, 2.794, 2.579 e zero modelos, respectivamente.

## Tarifas e contratos

O nome do porte seleciona apenas a chave de tarifa compacto/medio/premium/pesado em horse_power.labor_commercial_rates. As quatro tarifas pertencem à oficina. A hora permanece em centavos e o preço interno é minutos × tarifa / 60, com o arredondamento já existente. Terceirização, desconto e preço ajustado na OS continuam com suas regras próprias.

Os campos de API commercial_category_id/name são aliases de compatibilidade do porte único; não consultam uma classificação paralela. O ajuste de cobrança por item na OS não altera o porte central do veículo. Novos snapshots gravam o UUID e o nome da classificação. Snapshots anteriores são usados como foram emitidos; uma edição sem reprecificação não relê porte, tempo ou tarifa do catálogo.

Serviços particulares usam sua chave de tarifa já cadastrada, inclusive sem assinatura do catálogo. O campo legado workshop_services.porte_id não é mais preenchido por cadastros novos nem usado para converter portes. Seus valores antigos são preservados ao editar um serviço.

## Migração proposta, ainda sem aplicação remota

local-postgres/020-single-catalog-porte.sql e supabase/migrations/20261025001000_single_catalog_porte.sql desativam o gatilho que preenchia a classificação auxiliar. As tabelas de mapeamento, exceções e históricos CAT-007 permanecem preservadas e sem uso operacional. Nenhum tempo, modelo, tarifa, orçamento ou snapshot é reescrito.

As constraints NOT VALID preservam registros legados existentes e impedem novas classificações fora dos quatro nomes ou modelos sem porte. Isso não converte um catálogo antigo: a instalação dos dados convertidos exige outra operação autorizada. O backend recusa um modelo legado não convertido em novas consultas de preço, em vez de inferir sua classificação. A view model_services e suas bases compartilhadas não mudam.

O importador futuro exige SHA-256 explícito do arquivo convertido, quatro nomes únicos, vínculos de todos os modelos, contagens e distribuição exatas. Não lê as exceções CAT-007 nem preenche tabelas auxiliares. Usa uma nova release 2.0-quatro-portes, verifica hashes de todos os registros e recusa destino ocupado, sem limpar fixtures ou substituir releases anteriores. O antigo hash do catálogo de 14 portes não é mais uma configuração padrão.

## Validação e publicação

O CI usa somente PostgreSQL 17 descartável e dados fictícios para testar porte direto, ausência de reclassificação por UUID histórico, quatro tarifas, RLS, serviços particulares, terceiros e preservação de snapshots. A CAT-009 não executa importação, migração persistente, integração do PR ou publicação. A aprovação do PR e a autorização de cada operação remota continuam necessárias.

Uma publicação futura deve coordenar a migração com a disponibilidade do catálogo convertido. A reversão de código não deve reativar o gatilho antigo sobre dados já convertidos; qualquer reversão de schema ou dados exige revisão e autorização próprias.
