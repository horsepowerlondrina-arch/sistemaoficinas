# Transferência de dados da oficina

Em Configurações → Transferência de dados, o proprietário pode exportar um pacote `.hptx` ou selecionar um pacote e validar sua prévia antes de importar. A prévia não grava dados. A confirmação mostra origem, destino autenticado, contagens e impedimentos.

O formato `sistema-oficinas-workshop-transfer` versão 1 usa gzip, AES-256-GCM e chave derivada por scrypt. Use a mesma frase secreta, com ao menos 12 caracteres, na origem e no destino; mantenha-a separada do arquivo.

A importação só é aceita em uma oficina sem registros operacionais. Ela remapeia `tenant_id` à oficina da sessão, mantém IDs operacionais e relacionamentos, valida colunas e conflitos, reconta cada entidade dentro de uma transação e faz rollback integral em qualquer erro. Não use `tenant_id` enviado pelo navegador. Credenciais, hashes, MFA, sessões, tokens, links públicos ativos e dados de plano/cobrança não são importados. Revisões imutáveis de documentos disponíveis no pacote são preservadas.

Faça a primeira importação em oficina fictícia vazia e confira os totais antes de uma migração real. Uma segunda importação no mesmo destino é bloqueada; transfira atualizações para outro destino vazio. Links públicos devem ser emitidos novamente. O importador não cria migrações nem altera tabelas.

Para exportar, abra Configurações → Transferência de dados, informe a frase secreta e escolha **Exportar pacote protegido**. Para importar, escolha o `.hptx`, informe a mesma frase, gere a prévia e digite o identificador integral exibido antes da confirmação.
