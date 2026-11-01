# OPS-001 — Correções das configurações da oficina

## Escopo e decisões

- Taxas continuam exigindo o módulo Financeiro. A tela informa o bloqueio e não oferece gravação quando esse módulo está desabilitado; nenhuma autorização foi ampliada.
- Precificação exibe e preserva os modos por faixas, acréscimo sobre custo e margem sobre venda. O simulador usa a função compartilhada de cálculo. A margem é limitada a menos de 100%.
- O perfil mostra o endereço efetivo dos novos documentos e permite substituir explicitamente o endereço completo legado pelos campos estruturados. Documentos já emitidos não são reescritos.
- Formulários mostram alterações pendentes e pedem confirmação ao navegar com rascunhos. Há proteção de fechamento da página; os rascunhos não são armazenados em storage do navegador.
- A tabela de taxas por parcela permanece consultiva e sob manutenção administrativa. A interface informa que origem contratual e vigência não estão registradas e explica a precedência sobre as taxas padrão.
- Taxas padrão passam a registrar payment_settings.updated na mesma transação da gravação, sem registrar valores de credenciais.
- Conta e integrações têm aba própria; textos de planejamento foram retirados da área operacional. As extensões históricas permanecem apenas referenciadas, sem alteração.
- Abas inválidas e o caminho legado de transferência retornam a Dados da oficina.
- A tarifa zero explica que remove o valor configurado do porte.
- A identidade OSDrive e o ajuste da faixa de homologação da main foram preservados.

## Validação

A suíte HTTP OPS-001 verifica permissão de operador, bloqueio de Financeiro, isolamento por oficina, auditoria e persistência dos modos de preço. O driver Playwright verifica rascunho ao trocar de aba, normalização de URL, bloqueio visual do Financeiro, manutenção do modo de margem ao salvar e ausência de overflow horizontal. O workflow existente executa build, testes gerais, PostgreSQL 17 descartável e capturas reais com dados fictícios.

As capturas ficam exclusivamente em docs/mapeamento-visual/. Os resultados finais e os commits correspondentes são registrados no PR da tarefa.

## Operações remotas

Não há migração de schema, alteração de credenciais, permissões de infraestrutura ou dados persistentes. A homologação usa o deployment automático do projeto já conectado.

## Regressão identificada no CI

O teste PostgreSQL detectou uma corrida preexistente: a resposta HTTP de sucesso era enviada antes do COMMIT da requisição. A consulta de sessão imediatamente após o login podia não encontrar a gravação. A resposta agora aguarda o encerramento da transação; falhas de commit não enviam o corpo de sucesso nem um novo cookie. Testes determinísticos cobrem atraso, falha e rollback, além da suíte PostgreSQL real. As políticas RLS e as permissões permanecem inalteradas.
