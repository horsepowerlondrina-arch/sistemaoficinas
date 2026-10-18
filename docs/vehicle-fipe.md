# Identificação FIPE por placa — HPDesenvolvimento

A consulta de novos veículos usa `GET /gateway/v1/placa/{placa}` e, após obter os dados, `GET /gateway/v1/placa/{placa}/fipe`. O fornecedor debita o saldo pré-pago associado à chave; os SKUs são `consulta-veiculo` e `consulta-fipe`. Em 18/10/2026, a documentação informa R$ 0,08 por resultado de cada rota (R$ 0,16 quando ambas entregam resultados). O sistema não lança essa cobrança no caixa da oficina.

Documentação: https://www.fipeplaca.com.br/api-docs

O veículo recebe `fipe_code`, `fipe_model` e `fipe_year_id`. Campos são opcionais e não exigem digitação. Uma única opção com confiança alta, ano compatível e sem conflito conhecido de combustível pode preencher automaticamente. Múltiplos candidatos permanecem disponíveis para confirmação explícita, incluindo a indicação dos que não possuem código. A falha da busca FIPE preserva os dados básicos do veículo e permite continuar sem código.

O componente compartilhado de placa atende cadastro direto, cadastro junto ao cliente, nova OS e checklist. A escolha FIPE não limpa os demais dados já digitados. Os campos acompanham a criação do veículo pela OS e a finalização do checklist. Veículos já cadastrados usam o cadastro local e não geram nova consulta paga; cadastros antigos não são enriquecidos em lote.

Resultados externos são guardados em cache privado por oficina e placa por 24 horas quando há candidatos, ou 10 minutos em resultados incompletos/ausentes. Requisições simultâneas na mesma instância são agrupadas. Isso reduz repetições, mas não garante deduplicação entre duas instâncias que consultem simultaneamente uma placa ainda sem cache. As chamadas não seguram o bloqueio global das transações comerciais. O cache não é uma associação definitiva ao veículo.

## Ativação exclusiva em desenvolvimento

Não copiar nem ler a chave de produção. No projeto Vercel `hpdesenvolvimento`, cadastrar uma chave própria de testes na variável sensível `FIPEPLACA_TOKENS_JSON`, no formato de objeto por oficina, e habilitar `ENABLE_PAID_VEHICLE_LOOKUP=true`. O identificador da oficina copiada é `hp-centro`. Fazer um novo deployment da branch `HPDesenvolvimento` para aplicar as variáveis. Nunca compartilhar a chave em commits ou mensagens.

Sem uma chave separada, o cadastro local funciona e a consulta externa informa indisponibilidade. Os testes automatizados usam respostas simuladas, sem gastar saldo. Não há migração nem configuração aplicada na Horse Power de produção.
