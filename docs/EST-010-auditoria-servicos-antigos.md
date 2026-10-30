# EST-010 — Auditoria de serviços antigos da Horse Power

Data da verificação: 2026-10-30. Consultas exclusivamente de leitura. Nenhum dado remoto foi alterado.

## Fontes e identificação da oficina

- Sistema antigo: Supabase `cbdwgocofigrdigfgwkp`, esquema `horse_power`, oficina `hp-centro`. A estrutura antiga armazena serviços próprios em `catalog` (`kind='service'`), com referência em `sku`, categoria textual, preço e custo em centavos. Não há tabela `workshop_services` nessa fonte.
- Homologação: Supabase `vnclahdnirqlcbamodqy`, esquema `horse_power`. Há **duas** oficinas com nome `Horse Power Car Service`: `59c85eea-7112-40de-b77f-c5627c541b48` e `ec8552cd-35c3-4e16-8371-d97aee0f6b43`. Ambas têm vínculo de usuário e histórico de OS. A primeira contém 294 OS, 142 clientes, 172 veículos e uma sessão recente; a segunda contém 290 OS, 140 clientes, 168 veículos. A primeira é a cópia atualmente mais completa, mas a identidade da sessão do usuário afetado precisa ser confirmada antes de qualquer correção de dados.

## Contagens verificadas

| Origem / oficina | `catalog` serviços ativos | `catalog` inativos/arquivados | `workshop_services` privados ativos | `workshop_services` legados ativos/inativos |
| --- | ---: | ---: | ---: | ---: |
| Sistema antigo, `hp-centro` | 69 | 237 (7 mesclados) | tabela inexistente | tabela inexistente |
| Homologação, `59c85eea-…` | 69 | 237 | 2 | 1 / 1 |
| Homologação, `ec8552cd-…` | 61 | 237 | 0 | 0 / 0 |

Os 69 serviços ativos da origem e os 69 do `catalog` da primeira oficina na homologação têm a mesma assinatura MD5 calculada sobre a lista ordenada de **nome, referência (`sku`), categoria, preço e custo**: `5c85be7d990b5f31a1af98b84769720b`. Os IDs não foram incluídos na assinatura porque a transferência os remapeou. Na origem e nessa cópia, 7 têm custo positivo, 62 têm custo zero e todos os 69 têm `sku`. Não há nomes duplicados entre os 69 ativos dessa cópia.

Dois nomes ativos (`Alinhamento` e `Balanceamento`) também existem em `workshop_services` como serviços privados, com preço e custo iguais aos respectivos registros de `catalog`, mas **referências diferentes**. Assim, 67 dos 69 serviços antigos ativos não têm sequer correspondência nominal em `workshop_services` dessa oficina; a identidade dos outros dois deve ser confirmada antes de qualquer migração. Não foi comprovado que as 61 cópias ativas na segunda oficina sejam vínculos incorretos; a duplicidade de oficinas requer investigação separada antes de mover ou excluir dados.

## Causa da ausência na interface

`Cadastros → Serviços Próprios` chama `GET /api/workshop-services?service_type=private` e a OS usa o mesmo endpoint com `status=active`. O endpoint, em `server/app.ts`, chama `listWorkshopServices` em `server/services/repairCatalog.ts`, que lê exclusivamente `workshop_services`, exige o `tenant_id` da sessão e aplica `service_type='private'` e o estado ativo. `catalog` não participa dessa consulta. Logo, os 69 registros antigos transferidos para `catalog` não aparecem em nenhuma das duas interfaces, mesmo estando na homologação. Os dois serviços privados atuais aparecem somente para o tenant `59c85eea-…`; o tenant duplicado não possui nenhum serviço privado.

A migração antiga `20261019222329_integrate_repair_services_orders.sql` copiava de `catalog` para `workshop_services` apenas serviços ativos com `cost>0` no momento de sua execução, depois arquivava serviços em `catalog`. A transferência posterior da Horse Power trouxe os 69 serviços antigos para `catalog` sem executar novamente essa conversão. As migrações EST-004/005 adicionaram `service_type`, descrição, referência e categoria a `workshop_services`; não transferiram os registros posteriores de `catalog`. A EST-009 manteve o filtro `service_type=private` na pesquisa da OS. A estrutura da homologação possui as colunas esperadas; não foi observada falha de rota ou incompatibilidade de esquema.

## Segurança e recuperação proposta

Não alterar o filtro do endpoint para incluir todo `catalog`: isso confundiria serviços antigos com o cadastro próprio editável, permitiria duplicidades e não atenderia aos controles de referência e categoria da EST-005. A recuperação requer **importação controlada** dos 69 serviços ativos do `catalog` para `workshop_services` na oficina correta, com reconciliação prévia dos dois nomes já presentes, referências únicas, categorias e preservação dos valores. Também exige decidir se os 237 arquivados devem continuar somente como histórico. Uma importação direta ou atualização de `tenant_id` é operação persistente remota e precisa de autorização específica depois de apresentar a prévia exata das linhas e um plano de reversão.

Nenhuma alteração de código é necessária para explicar a ausência: o endpoint opera conforme o modelo de dados atual e mantém o isolamento por oficina. Esta auditoria não modifica API, interface, permissões, catálogo técnico ou dados.

## Consultas de verificação reproduzíveis

Executar somente em projetos identificados e em modo de leitura. Não usar as consultas como script de migração.

```sql
SELECT id, name FROM horse_power.tenants WHERE name = 'Horse Power Car Service';
SELECT tenant_id, service_type, active, count(*)
FROM horse_power.workshop_services GROUP BY 1,2,3 ORDER BY 1,2,3;
SELECT tenant_id, active, count(*)
FROM horse_power.catalog WHERE kind='service' GROUP BY 1,2 ORDER BY 1,2;
SELECT count(*) n,
  md5(string_agg(name||'|'||coalesce(sku,'')||'|'||coalesce(category,'')||'|'||price||'|'||cost,
                 '~' ORDER BY name,sku)) fingerprint
FROM horse_power.catalog
WHERE tenant_id = '<tenant_id da oficina verificada>'
  AND kind='service' AND active=1 AND archived_at IS NULL AND merged_into IS NULL;
```

Para comparar com a origem, substituir o último `tenant_id` por `hp-centro` e executar **somente leitura** no projeto antigo. O inventário desta auditoria é um retrato de 2026-10-30 e pode mudar com novos cadastros.
