# E-mail transacional das oficinas

Convites de ativação e recuperação de senha das contas operacionais usam Resend. O painel administrativo central mantém autenticação separada e não usa a recuperação de senha desta página.

## Domínio e remetente

1. Em Resend → Domains, adicionar `osdrive.com.br`.
2. Criar no DNS do Registro.br **exatamente** os registros SPF/DKIM e demais registros mostrados pelo Resend. Não substituir registros de e-mail existentes sem revisar seu impacto.
3. Aguardar o status **Verified** no Resend antes de enviar mensagens reais.
4. Criar uma API key Resend com permissão de envio e colocá-la diretamente no ambiente **Production** do projeto Vercel de homologação `sistema-oficinas-homologacao`, em `RESEND_API_KEY`. Não colocar a chave no GitHub, chat ou arquivo versionado.
5. Definir `WORKSHOP_ACTIVATION_FROM` como o endereço de remetente autorizado do domínio verificado, por exemplo `OSDrive <convites@osdrive.com.br>`. Confirmar o endereço escolhido com o responsável antes de configurá-lo.
6. Definir `APP_ORIGIN=https://sistema-oficinas-homologacao.vercel.app` no mesmo ambiente. O serviço exige origem HTTPS e gera links somente nesse domínio.
7. Após salvar as variáveis, criar um novo deployment da homologação para que as funções leiam os valores atualizados. Não aplicar essas variáveis ao projeto histórico Horse Power.

Não exibir valores das variáveis ou credenciais em logs. A opção de link manual de ativação continua disponível caso o envio esteja indisponível.

## Convites de ativação

O fluxo administrativo existente gera um convite com token de uso único, expiração de 48 horas e registro de status. O envio real ocorre somente após o domínio estar verificado e as três variáveis acima configuradas. A tela administrativa informa falhas de entrega; o link manual usa o mesmo procedimento de ativação.

## Recuperação de senha da oficina

Na tela de login, **Esqueci minha senha** abre `/recuperar-senha`. A pessoa informa seu e-mail e recebe um link de uso único por 30 minutos. A resposta não revela se o e-mail existe. A nova senha deve ter 12 a 200 caracteres. Após a troca, todas as sessões operacionais dessa conta são encerradas e o usuário entra novamente. A recuperação não altera o login do painel central.

O token fica apenas no fragmento da URL e o banco armazena seu hash. Pedidos são limitados por endereço de rede e e-mail. Erros do provedor não registram conteúdo da mensagem nem o token. Caso o envio não esteja configurado, a API responde indisponibilidade em vez de prometer um e-mail.

## Validação em homologação

Após verificar o domínio, configurar as variáveis e aplicar a migração autorizada, testar com **uma conta de oficina fictícia** cujo destinatário seja autorizado:

1. Solicitar a recuperação na tela de login e conferir a chegada da mensagem.
2. Abrir o link, cadastrar senha fictícia nova e entrar.
3. Confirmar que o link não funciona novamente e que a sessão antiga foi encerrada.
4. No painel ADM, enviar convite para uma oficina fictícia e conferir status e ativação.

Nunca usar contas reais da Horse Power para testes. Não colar chaves ou links de recuperação em tickets, prints ou conversas.
