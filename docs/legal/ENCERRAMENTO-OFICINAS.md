# Desenho de encerramento de oficinas — aguardando implementação

Referência: 15/11/2026, `main` `ff8f1af1`. Este documento **não ativa exclusão**.

## Regra aprovada

- A cobertura paga vale até o fim de `paid_until`; sem assinatura, o teste vale até `trial_ends_at`. A partir do dia seguinte, o acesso é somente leitura.
- Avisos no 30º, 60º e 89º dias corridos de atraso, segundo o calendário de São Paulo. Cada aviso informa a data prevista da exclusão e como exportar ou renovar.
- No 90º dia, revalidar pagamento confirmado, vigência, condição de teste, identidade da oficina, entrega do aviso final e eventuais bloqueios legais/administrativos. Uma renovação válida cancela o encerramento.
- Para uma oficina real, gerar pacote `.hptx` criptografado com fotos portáteis, armazená-lo no bucket privado `workshop-recovery-backups` do Supabase Storage e verificar hash, tamanho, inventário e recuperação antes da exclusão. Reter a cópia por 15 dias após a exclusão e removê-la automaticamente. Os bytes ficam no Storage, mas os metadados dos objetos continuam no schema `storage` do PostgreSQL.
- A oficina de teste só dispensa backup se possuir marcação interna explícita e auditada; nome, domínio do e-mail e plano não bastam para classificá-la.
- Falha de envio do último aviso, exportação, armazenamento, conferência ou exclusão bloqueia o processo. O acesso permanece somente leitura e o erro é comunicado ao painel.

## Operação segura

O job deve ser idempotente e operar em lotes pequenos. Registrar uma única tentativa por oficina, etapa e data, com estado persistente e retomada após falha. Antes da remoção, obter bloqueio transacional por oficina e repetir a consulta da cobertura de pagamento. Revogar sessões e links públicos no mesmo processo. Remover os objetos privados da oficina somente depois de garantir que o pacote restaurável contém suas fotos. Não registrar conteúdo do pacote, frase secreta nem chaves em logs.

A exclusão antecipada no painel deverá usar o mesmo mecanismo, com prévia de contagens, justificativa, reautenticação/MFA quando aplicável e confirmação digitando o nome exato da oficina. A ação e seu resultado ficam no histórico central, fora das tabelas excluídas. Não usar a ação de mudar o plano como atalho para excluir.

O usuário escolheu Supabase Storage porque não conseguiu habilitar R2. O bucket privado foi criado em 15/11/2026, sem políticas públicas. O plano gratuito do Supabase limita cada arquivo a 50 MB e inclui 1 GB de Storage; a implementação deve dividir pacotes grandes, verificar capacidade e falhar de forma segura. Não executar a etapa destrutiva até que o acesso do servidor seja configurado, a migração seja aprovada e os testes de backup/restauração com dados fictícios passem.

O backup de substituição existente em `horse_power.data_transfer_backups` fica no próprio PostgreSQL e expira em 30 dias. Ele não é o armazenamento final deste fluxo. A exportação `.hptx` converte referências das fotos privadas em conteúdo portátil; esta propriedade precisa de teste de restauração antes da exclusão.
