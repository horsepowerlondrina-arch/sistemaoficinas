# OPS-004 — Conta da oficina

A aba Configurações → Conta preserva os dados do administrador e oferece envio de link para alterar a senha. O fluxo existente de e-mail usa token de uso único por 30 minutos, mínimo de 12 caracteres e encerra as sessões após a troca. A mensagem de envio não confirma se um e-mail existe.

O plano exibe somente o código, situação e fim do teste da oficina autenticada. A leitura é feita por função com privilégio mínimo que confere o usuário proprietário e a oficina do contexto. Upgrade, downgrade e cancelamento aparecem desabilitados até a futura integração de pagamentos; não há cobrança ou alteração contratual.

Migrações locais e remotas adicionam apenas a função de leitura, sem alterar dados. A migração remota da homologação exige autorização específica antes da publicação do endpoint. A interface lida com ambientes ainda sem essa função exibindo plano não atribuído. O CI usa PostgreSQL 17 descartável e dados fictícios.
