# Assinaturas Stripe — PR de teste

Branch: `feat/admin-billing-stripe`. Mercado Pago: PR #121 preservado, sem merge.
Este recurso aceita exclusivamente chaves `sk_test_` ou `rk_test_`. Chaves live e eventos live são rejeitados.
Nenhuma migração, preço ou cobrança real foi executada por esta implementação.

## Funcionamento

- Administração → Assinaturas e cobranças: preços mensais de Básico, Profissional e Premium, em centavos, com justificativa/auditoria. Exige `platform:settings`.
- Configurações → Conta: proprietário contrata, acompanha pagamentos e cancela renovação. A oficina vem da sessão, nunca do corpo da requisição.
- Cartão: Checkout de assinatura mensal. Fatura pendente pode ser regularizada no link hospedado do Stripe exibido na conta. Pix: Checkout de pagamento único; renovação mensal preparada pelo job, paga pelo cliente todo mês.
- Para empresas brasileiras, a documentação Stripe informa que Pix Automático não está disponível: https://docs.stripe.com/payments/pix .
- Contratação após o teste gratuito existente. Nenhum segundo período grátis é concedido.
- Vencimento usa America/Sao_Paulo. No dia seguinte sem pagamento, somente leitura. Suspensões manuais permanecem prioritárias, inclusive após pagamento.
- Troca de plano: cancelar renovação atual, manter o período pago e contratar novo plano quando ele terminar. Não há prorrata ou débito inesperado.
- Novos preços não alteram contratos existentes; Pix automático conserva a versão contratada. Alterar a oferta não cobra nada.
- Registros operacionais, usuários e catálogo não são removidos por cancelamento, downgrade ou atraso.
- Reembolsos/disputas retiram a cobertura daquele pagamento. Nenhuma rotina executa reembolsos automaticamente.
- Uma reserva durável precede cada chamada de criação de checkout. Repetições usam os mesmos parâmetros e chave. Falhas ambíguas com mais de 23 horas bloqueiam nova criação para conciliação, evitando reutilizar uma chave Stripe expirada.

## Configuração de Preview (somente após autorização)

Não copiar chaves no GitHub, logs ou chat.
- `STRIPE_BILLING_ENABLED=true`
- `STRIPE_TEST_TENANT_IDS`: somente identificadores das oficinas fictícias autorizadas. Lista vazia bloqueia testes de cobrança.
- `STRIPE_SECRET_KEY`: chave secreta **de teste**.
- `STRIPE_WEBHOOK_SECRET`: segredo do endpoint de teste.
- `STRIPE_CRON_SECRET`: valor aleatório de pelo menos 32 caracteres.
- `APP_ORIGIN`: origem autorizada do Preview.
- Conexões operacionais/administrativas já existentes, com privilégios restritos.

Webhook: `POST /api/billing/stripe/webhook`, versão `2025-06-30.basil`.
Eventos: checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.expired,
invoice.paid, invoice.payment_failed, customer.subscription.updated, customer.subscription.deleted,
charge.refunded, charge.dispute.created e charge.dispute.closed.
A assinatura é conferida no corpo original, antes do parser JSON. Eventos nunca concedem acesso diretamente:
os recursos atuais são consultados na Stripe, verificando cliente, moeda, valor e pagamento liquidado.

Job autenticado: `GET /api/billing/stripe/renew`, Authorization Bearer com o segredo do job.
Executar a cada cinco minutos no ambiente de testes autorizado. Cada lote processa até dez contas,
com retomada e exclusão mútua no PostgreSQL. A cobrança vencida é bloqueada na leitura do acesso,
independentemente da execução do job. O Pix pendente aparece na conta da oficina.
Não há envio automático de email de cobrança nesta versão.

A proteção da Vercel precisa permitir o webhook autenticado pela assinatura Stripe sem disponibilizar segredos
de bypass publicamente. Não desativar proteção de outros deployments incidentalmente.

## Migração proposta, NÃO aplicada remotamente

SQL completo: [036-stripe-billing.sql](../local-postgres/036-stripe-billing.sql).
Cria cinco tabelas privadas com RLS para o papel restrito administrativo.
Não altera oficinas nem migra registros do Mercado Pago. Substitui três funções de cálculo de acesso
para considerar somente contas com pagamento reconciliado, mantendo legado e suspensões.
Os preços históricos só permitem UPDATE na coluna active.
O usuário operacional não acessa as tabelas financeiras da plataforma.

Antes de aplicar no Supabase: confirmar projeto `vnclahdnirqlcbamodqy`, funções e papéis atuais,
comparar SQL, obter autorização específica e backup das definições anteriores.
Recuperação: desabilitar novas contratações e restaurar as funções anteriores em migração revisada;
preservar tabelas e auditoria. Não apagar contratos ou pagamentos para reverter.
A migração não autoriza configurar credenciais nem criar registros persistentes de teste.

## Validação exigida

CI: build, testes gerais, PostgreSQL 17 temporário, dados fictícios; nenhum acesso Stripe real no CI.
Teste do provedor real em modo teste continua necessário antes de merge:
checkout cartão, confirmação assinada, Pix elegível, repetição do webhook, falha/atraso, cancelamento.
Confirmar o domínio exato e a oficina fictícia, preservando Horse Power.
A conexão do plugin Stripe não substitui as variáveis do backend Vercel.

## Limitações deliberadas

- Sem cobranças reais; ativar live exige tarefa e autorização separadas.
- Apenas BRL/mensal; sem descontos, impostos automáticos, prorrata, créditos, parcelamento ou múltiplos itens.
  Faturas divergentes são bloqueadas para revisão, nunca ignoradas.
- Cancelamento mantém o período pago. Trocas imediatas não são suportadas.
- Lista administrativa mostra as cem contas mais recentes.
- O teste gratuito atual deve terminar antes da contratação.
