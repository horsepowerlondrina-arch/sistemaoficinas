# Análise de importação do catálogo técnico

Inspeção realizada abrindo os arquivos com `DatabaseSync({readOnly:true})`,
sem modificar SQLite ou acessar Supabase. Nenhum dado operacional foi importado.

## Arquivos encontrados

| Arquivo | Conteúdo |
|---|---|
| `C:\Users\horse\Documents\catalogo.sqlite` | Pacote operacional de 294.141.952 bytes; 7 tabelas |
| `C:\Users\horse\Documents\Horse Power Local\dados\catalogo.sqlite` | Fonte completa de 804.425.728 bytes; 10 tabelas |

Pacote operacional SHA-256:
`5557e09a16362452e1a5716164e9cc0e13d48a26140c1682ffdc5ae48b0eefaa`.
Fonte completa SHA-256:
`bddd58e4548fd2cf58fba8aa7fa3268ca00e07998a6e5b6928c92da8236fa71f`.

Ambos têm 102 marcas, 928 famílias, 928 bases, 7.534 modelos, 6.491 serviços
e 836.093 tempos. O operacional tem 14 classificações; a fonte completa tem 15,
além de 3.354 peças, 1.002.330 observações e 3 registros de metadados.
Não tratar os dois arquivos como cópias equivalentes nem usar o número de
classificações como constante universal.

A fonte não possui esquema de clientes, OS, usuários ou sessões da aplicação.
`models` contém `collection_method`, `reference_model_id` e
`checked_service_ids` adicionais; `bases` contém `reference_model_id`;
`repair_times` contém `parts_json` e metadados de captura adicionais.
Somente a projeção operacional corresponde a `service_catalog`.
Não copiar todas as colunas nem executar o DDL SQLite em PostgreSQL.

## Mapeamento proposto

- brands → id, name; classifications → id, name.
- families → id, brand_id; bases → id, family_id, service_count.
- services → id, name.
- models → id, brand_id, family_id, classification_id, name, fipe_code,
  complete, service_count, base_id, excluded_service_ids.
- repair_times → id, base_id, model_id, service_id, service_name, minutes,
  time_identifier.

Preservar UUIDs, códigos FIPE como texto, exclusões JSON e nomes específicos.
Tempo já está em minutos: não converter para horas durante a carga.
Uma base compartilhada pode atender vários modelos; diferenças explícitas por
modelo prevalecem sobre a base. A view existente implementa isso sem expandir
milhões de aplicações. Não inferir que códigos FIPE são únicos.
Peças, observações e histórico de coleta não entram no catálogo operacional.
Classificações adicionais sem uso devem ser analisadas, nunca descartadas por
posição ou por uma contagem esperada.

## Etapas para um futuro importador

1. Escolher explicitamente a fonte e conferir SHA-256; inspeção independente:
   `npm.cmd run catalog:inspect -- "C:\Users\horse\Documents\catalogo.sqlite"`.
   O comando mostra esquema/contagens/hash, não linhas de clientes nem senhas.
2. Validar tabelas/colunas e dependências antes de gravar. Rejeitar origem
   desconhecida. Abrir SQLite somente em leitura e não mexer no seu WAL.
3. Usar administrador exclusivamente local e staging privado separado.
   Transferir por lotes parametrizados/COPY, com lista explícita de colunas.
   Não conceder escrita a hp_local_app e não importar dados de oficina.
4. Validar UUIDs, JSON de exclusões, FKs, tempo não negativo, exatamente um
   destino base/modelo por tempo e unicidade por base-serviço/modelo-serviço.
   Verificar equivalência ordenada por hashes dos campos operacionais entre
   SQLite e staging; contagens sozinhas não bastam.
5. Conferir aplicações resolvidas, exclusões, sobreposições e tempos zero.
   Preservar os 14 portes de mão de obra e conferir compatibilidade por UUID.
6. Ativar a nova release somente após validação, em transação administrativa.
   Não sobrepor o catálogo fictício enquanto houver snapshots que dependam dele.
   Na primeira implementação, preferir um novo banco local vazio de homologação
   da importação e revisão explícita, sem TRUNCATE automático.
7. Revalidar RLS: sem tenant, sem liberação, expirada, desabilitada e concorrente;
   INSERT/UPDATE/DELETE e autoliberação devem falhar para o runtime.

A importação integral não foi executada: esta entrega prepara a estrutura,
o catálogo fictício e o diagnóstico seguro da fonte. Não há pressuposto de
licença/distribuição do conteúdo externo nem envio do arquivo ao Git.
