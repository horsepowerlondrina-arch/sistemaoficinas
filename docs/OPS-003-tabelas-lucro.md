# OPS-003 — Tabelas de lucro por oficina

Configurações → Lucro peças/terceiros mantém o padrão visual existente e permite adicionar, editar e excluir até 20 faixas em duas tabelas independentes.

- Custos inicial/final são inclusivos em centavos. A primeira faixa começa em zero; a seguinte começa um centavo depois do limite anterior. Lacunas, sobreposições e valores inválidos impedem salvar.
- Somente a última faixa pode ser ilimitada. Se houver limite final, custos acima dele são rejeitados pelo cálculo.
- Peças preservam acréscimo por faixa e ganho mínimo. Os modos globais de acréscimo e margem continuam disponíveis e preservam a tabela quando selecionados.
- Terceiros usam exclusivamente o acréscimo percentual da faixa correspondente, independentemente do modo das peças.
- Os dois simuladores usam as mesmas funções monetárias das integrações. Alterações locais têm proteção de navegação e descarte.

## Persistência e compatibilidade

Não há migração nem nova tabela: `tenants.parts_pricing_rules` continua armazenando JSON, agora com `service_rules` opcional e `from` opcional por faixa. Arrays legados continuam legíveis; o início é inferido do limite anterior. Sem `service_rules`, utiliza-se o percentual legado de terceiros (30% quando ausente) em uma faixa ilimitada. A leitura não grava nem substitui configurações. Salvamentos parciais preservam campos omitidos.

A API mantém a exigência de administração e acesso ao módulo de configurações; o tenant vem da sessão. Nenhum salvamento percorre ou recalcula orçamentos, OS, catálogo ou recebimentos. Serviços próprios preservam preço manual; mão de obra técnica mantém tempo e valor/hora. Novos serviços terceirizados usam a faixa vigente; snapshots existentes mantêm o percentual registrado.

## Validação

- `tests/profitTables.test.ts`: limites, arredondamento, modos, tabelas independentes, compatibilidade, persistência, permissões, tenant da sessão, simuladores e preservação histórica.
- `tests/profitTables.postgres.integration.ts`: PostgreSQL 17 temporário, persistência, RLS entre oficinas, permissões e rollback.
- `scripts/capture-settings.mjs`: navegador isolado, inclusão/edição/exclusão, lacunas/sobreposições, proteção de rascunho, salvamento real e recarga. Integra o workflow visual existente.
- Capturas afetadas: `config-lucro-pecas` e `config-lucro-pecas-desktop`, módulo 14. A biblioteca permanece exclusivamente em `docs/mapeamento-visual/` no GitHub.

A validação de gravação utiliza somente dados fictícios em bancos temporários. Integração na main depende da aprovação solicitada na OPS-003; publicação e validação online ocorrem depois dela.
