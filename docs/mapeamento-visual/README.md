# Biblioteca visual — Sistema Oficinas

Referência compartilhada de telas reais do Sistema Oficinas. As capturas foram feitas em ambiente local com dados fictícios; cada registro mantém seu estado, data e commit de origem, quando conhecido. Funcionalidades sem imagem aparecem como pendentes ou bloqueadas.

- [Índice visual navegável](./INDEX.md)
- [Checklist completo](./CHECKLIST.md)
- [Catálogo de capturas](./catalog.json)

## Acesso

Consulte esta pasta no repositório privado do GitHub. O índice mostra as miniaturas e abre os PNGs completos. A biblioteca é exclusiva do desenvolvimento e não integra nem é publicada com a aplicação da oficina.

## Manutenção

- visual:capture — percorre as rotas catalogadas e atualiza as capturas, data e commit. Faça o commit do código da interface primeiro; a captura gravadora exige checkout limpo para registrar a revisão correta. Requer aplicação local de teste e o arquivo ignorado data/local-credentials.json, gerado pelo seed local.
- visual:capture -- --module 08-financeiro — limita a execução a um módulo.
- visual:capture -- --affected — seleciona módulos conforme os arquivos alterados em relação a origin/main.
- node scripts/test-admin-interface.mjs — valida as interações administrativas em loopback com API fictícia e gera capturas no diretório temporário do runner; artifacts do CI permitem revisão antes da inclusão no catálogo.
- visual:check — confere PNGs, metadados, caminhos, estados e índices.
- visual:index — regenera este índice e o checklist a partir do catálogo JSON.

Capturas que criem, editem ou finalizem registros só podem usar base PostgreSQL efêmera de CI ou outra base descartável configurada. Nunca rode capturas gravadoras na homologação compartilhada.

## Coleta atual

O acervo inclui 87 PNGs de telas reais. Consulte a data e o commit de cada entrada: as capturas originais de 22/10/2026 não registraram o commit e continuam sinalizadas. Capturas ADM-002.1 usam Chromium com respostas de API fictícias e não comprovam o backend; a integração PostgreSQL é testada separadamente no CI. Nenhuma credencial, token ou dado real deve aparecer nas imagens.
