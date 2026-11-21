# Liberação do cadastro e da cobrança do OSDrive

O projeto comercial mantém o piloto quando as opções de lançamento estão desligadas. O ambiente de testes mantém a lista existente de destinatários autorizados e a Stripe em modo de teste.

1. Aplicar a migração de cadastro comercial após aprovação do destino. Ela registra novas oficinas comerciais em uma tabela privada. As oficinas do piloto continuam fora da cobrança real.
2. Conferir remetente, identidade OSDrive, recebimento de ativação e convite e política de privacidade. O cadastro usa `OSDRIVE_PUBLIC_SIGNUP_ENABLED` e `OSDRIVE_COMMERCIAL_RESEND_KEY`. Habilitar apenas após aprovação explícita.
3. Conferir preços ativos dos três planos no projeto comercial. Configurar a chave e o segredo do webhook próprios em `OSDRIVE_STRIPE_LIVE_KEY` e `OSDRIVE_STRIPE_LIVE_WEBHOOK_SECRET`. A cobrança comercial também exige `STRIPE_BILLING_ENABLED` e `OSDRIVE_LIVE_BILLING_ENABLED`. Habilitar apenas após aprovação explícita.
4. Conferir que a versão publicada corresponde ao candidato validado. Verificar o callback, o webhook, a proteção de credenciais financeiras e o estado final da assinatura. Confirmar os meios que a conta Stripe comercial pode oferecer antes de anunciá-los.
5. Em caso de incidente, interromper novas contratações e preservar a reconciliação de pagamentos já iniciados. Os registros do provedor e o histórico local devem ser preservados para conferência.
