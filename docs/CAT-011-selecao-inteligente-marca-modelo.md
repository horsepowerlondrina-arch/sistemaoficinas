# CAT-011 — Seleção inteligente de marca e modelo

## Escopo

A seleção de veículo no orçamento e na ordem de serviço utiliza dois campos: marca e modelo. As opções vêm do catálogo central, respeitando a autorização do módulo da oficina. A busca de modelos exige a marca e retorna páginas limitadas, com nome completo, porte, código FIPE e quantidade de serviços.

## Comportamento

- As buscas aceitam texto sem acentos e são limitadas no backend (20 marcas e 30 modelos por página).
- O vínculo exato `vehicles.service_model_id` é carregado ao abrir ou localizar veículo por placa. A consulta de serviços fica disponível em seguida.
- Marca, modelo e FIPE do veículo são usados como sugestões quando não há vínculo exato; versões ambíguas exigem escolha manual.
- Confirmar um modelo persiste o vínculo no veículo autenticado. Enviar `service_model_id: null` limpa explicitamente o vínculo; clientes que omitem o campo preservam o valor.
- Alterar o veículo não reescreve snapshots nem preços de serviços existentes. Novos serviços permanecem vinculados ao modelo confirmado.
- Serviços particulares continuam disponíveis mesmo quando o módulo do catálogo central não está habilitado.

## Rotas

- `GET /api/repair-services/brands?q=&offset=`
- `GET /api/repair-services/models?brand_id=&q=&fipe=&offset=`

Ambas as rotas verificam o acesso ao catálogo e respeitam a oficina autenticada. A busca de modelos é sempre limitada à marca selecionada.

## Banco e validação

Não há migração nem alteração de modelos, tempos ou classificações. Os testes do PR exercitam pesquisa sem acentos, filtro por marca, paginação, isolamento de acesso, vínculo de modelo por placa e preservação de snapshots; o CI do projeto executa PostgreSQL 17.