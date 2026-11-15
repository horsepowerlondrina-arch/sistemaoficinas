# Encerramento de oficinas — implementação em validação

Referência: 15/11/2026, PR #203. A rotina permanece desativada até migração, configuração e validação específicas na homologação. Este documento **não ativa exclusão**.

## Regra aprovada

- A cobertura paga vale até o fim de `paid_until`; sem assinatura, o teste vale até `trial_ends_at`. A partir do dia seguinte, o acesso é somente leitura.
- Avisos no 30º, 60º e 89º dias corridos de atraso, segundo o calendário de São Paulo. Cada aviso informa a data prevista da exclusão e como exportar ou renovar.
- No 90º dia, revalidar pagamento confirmado, vigência, condição de teste, identidade da oficina, entrega do aviso final e eventuais bloqueios legais/administrativos. Uma renovação válida cancela o encerramento.
- Para uma oficina real, gerar pacote `.hptx` criptografado com fotos portáteis, armazená-lo no bucket privado `workshop-recovery-backups` do Supabase Storage e verificar hash, tamanho, inventário e recuperação antes da exclusão. Reter a cópia por 15 dias após a exclusão e removê-la automaticamente. Os bytes ficam no Storage, mas os metadados dos objetos continuam no schema `storage` do PostgreSQL.
- A rotina implementada também gera backup das oficinas de teste; não infere dispensa de backup por nome, domínio do e-mail ou plano.
- Falha de envio do último aviso, exportação, armazenamento, conferência ou exclusão bloqueia o processo. O acesso permanece somente leitura e o erro é comunicado ao painel.

## Operação segura

O job opera em lotes pequenos e usa registros únicos para os avisos, reserva temporária e retomada após falha. Antes da remoção, obtém bloqueio transacional por oficina e repete a consulta da cobertura de pagamento. Revoga sessões e links públicos na mesma transação. Remove as fotos privadas da oficina somente depois de verificar que o pacote restaurável contém seus bytes. Não registra conteúdo do pacote, frase secreta nem chaves em logs.

A exclusão antecipada no painel deverá usar o mesmo mecanismo, com prévia de contagens, justificativa, reautenticação/MFA quando aplicável e confirmação digitando o nome exato da oficina. A ação e seu resultado ficam no histórico central, fora das tabelas excluídas. Não usar a ação de mudar o plano como atalho para excluir.

O usuário escolheu Supabase Storage porque não conseguiu habilitar R2. O bucket privado foi criado em 15/11/2026, sem políticas públicas. O pacote é dividido em partes de até 4 MB, conferidas após o upload; pacote acima do limite configurado ou falha de armazenamento bloqueia a exclusão. Não executar a etapa destrutiva até que a segunda migração seja autorizada e aplicada, a frase secreta do servidor esteja configurada e os testes com dados fictícios passem.

O adaptador de backup reutiliza a credencial de servidor já configurada para fotos privadas na homologação e exige que a URL corresponda ao projeto `vnclahdnirqlcbamodqy`. Ele recusa o ambiente definitivo da Horse Power. Essa credencial nunca deve chegar ao navegador ou ao manifesto da cópia.

O backup de substituição existente em `horse_power.data_transfer_backups` fica no próprio PostgreSQL e expira em 30 dias. Ele não é o armazenamento final deste fluxo. A exportação `.hptx` converte referências das fotos privadas em conteúdo portátil; o teste confere a leitura, integridade e abertura da cópia, mas uma restauração operacional completa ainda exige um procedimento administrativo controlado. Os rascunhos legais não devem ser publicados como Termos ou Política definitiva antes de identificar a pessoa jurídica e realizar revisão jurídica.
