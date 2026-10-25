# ADM-003 — Transferências completas centralizadas

## Decisão
O pacote completo versionado .hptx pertence exclusivamente à Administração Central. O sistema operacional das oficinas não exibe a opção em Configurações e não registra as rotas operacionais antigas. Usuários da oficina não têm acesso ao fluxo por interface nem API.

No Painel ADM, Gestão de Oficinas oferece exportação, prévia, importação nos modos Oficina vazia/Mesclar/Substituir, conferência MIG-006, backups e histórico para uma oficina selecionada. A tela mostra nome, identificador e ambiente. O servidor confere a oficina pelo acesso pontual à função segura platform_admin.workshop_directory; não confia em IDs recebidos como autorização.

## Isolamento e autorização
- Sessão administrativa separada e permissão explícita data-transfer:manage.
- Operações operacionais são chamadas pelo serviço de transferência existente sob contexto tenant/usuário proprietário já existente, preservando RLS e as restrições dos serviços MIG.
- A conta administrativa não recebe acesso genérico ao schema operacional, membership artificial, nem acesso ao catálogo global.
- Uma substituição exige prévia, nome exato, ID de confirmação, pedido e aprovação por outro administrador. A aprovação fica vinculada ao tenant e ao SHA-256 do pacote e é consumida na mesma transação operacional para impedir repetição.
- A auditoria central identifica o administrador, oficina, ação, horário, resultado e hash do pacote; não registra frase secreta, arquivo nem dados pessoais.
- Usuários, credenciais, vínculos e sessões da oficina são preservados. A política existente remapeia autoria operacional ao proprietário da oficina de destino; eventos históricos de auditoria da origem não são importados.

## Migração e disponibilização
A migração aditiva 20261025000500_platform_admin_data_transfer.sql acrescenta somente data-transfer:manage ao allowlist de permissões. Ela não concede essa permissão automaticamente a contas existentes. O código não deve ser integrado/publicado na homologação enquanto essa migração não for aprovada e aplicada no banco de homologação.

A Function Vercel aceita pacotes centrais de até 4 MiB para evitar o limite de request/response. Pacotes maiores precisam de decisão separada sobre envio segmentado/armazenamento temporário protegido. Esta implementação não acrescenta storage externo.

## Exportações futuras por oficina
A oficina poderá futuramente exportar dados específicos no módulo correspondente, em PDF, Excel ou CSV, respeitando filtros, autorização e isolamento. Exemplos: clientes/veículos, produtos/estoque, fornecedores, OS, financeiro e checklists. Esta decisão não implementa essas exportações.

## Evidências
Preencher o estado desta tarefa após a validação:
- Branch/commit/PR:
- Build e testes gerais:
- Testes PostgreSQL 17:
- Migração remota autorizada/aplicada:
- Integração e deployment de homologação:
- Validação online fictícia:
- Riscos/pendências:
