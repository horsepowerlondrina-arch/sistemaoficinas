# Catálogo, estoque e lucro das peças

Atualização de 04/10/2026.

- Produtos e serviços podem ser cadastrados manualmente no catálogo e sem sair da edição de orçamento/OS. O catálogo antigo arquivado continua oculto; nenhum item histórico foi reativado.
- A extensão de teste INT-015 envia peças do Sky Peças ao catálogo ou a um orçamento/OS em andamento. OS finalizadas/canceladas recusam capturas. A placa continua sendo enviada quando há veículo no atendimento.
- Importar não cria saldo físico. Estoque permite novo produto, entrada com quantidade/custo/frete/venda e importação do Sky. Entradas usam identificador de requisição para evitar duplicação em reenvios.
- Clientes e veículos estão reunidos em Cadastros. A aba Tempos foi removida; referências de tempo continuam armazenadas junto às capturas.

## Política Horse Power

Base em centavos = custo unitário sem frete + frete unitário. Venda = maior entre base com acréscimo arredondado em centavos e base + ganho mínimo.

| Base até | Acréscimo | Ganho mínimo |
| --- | --- | --- |
| R$ 20 | 80% | R$ 8 |
| R$ 50 | 60% | R$ 10 |
| R$ 100 | 50% | R$ 20 |
| R$ 250 | 45% | — |
| R$ 500 | 40% | — |
| R$ 1.000 | 35% | — |
| Acima de R$ 1.000 | 30% | — |

Configurações > Lucro das peças permite editar as faixas e simular. Cada faixa inclui seu limite superior. Valores acima começam na próxima faixa, mesmo se houver redução de preço na transição, conforme política informada.

Na captura Sky, frete informado vale por unidade para todos os itens daquela conexão. Para frete diferente, concluir e abrir nova captura. Uma nova captura atualiza custo e venda atuais do catálogo. Os itens já presentes em atendimentos mantêm custo e preço históricos. Reenvio do mesmo comprovante não refaz operações.

`catalog.cost` e `order_items.cost` representam custo completo, incluindo frete; `catalog.freight_unit` permite mostrar separadamente o custo sem frete no formulário. Movimentações novas guardam valores da entrada.

Financeiro > Lucro das peças considera OS finalizadas no período, descontos proporcionais e custo histórico. É ganho bruto antes de taxas e despesas e pode incluir vendas ainda não recebidas. Valores históricos sem custo conhecido continuam sujeitos à qualidade da importação original.

## Validação

49 testes locais aprovados, incluindo limites das faixas, ganho mínimo, frete, isolamento de oficinas, reenvios, estoque e preservação dos custos históricos. Compilação aprovada. Conferência visual local do cadastro de peça e entrada de estoque; verificação PostgreSQL com oficina temporária. Segurança Supabase sem apontamentos.

Para testar a captura direta, instale a extensão de teste INT-015 pelo modo desenvolvedor do Chrome e recarregue o Sky Peças. 
