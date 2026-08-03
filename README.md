# Fechamento de Caixa House 190

Sistema web responsivo para fechamento diário, conciliação e acompanhamento de divergências das lojas House 190.

Versão 2.3.0 com correção auditável dos valores do operador pelo financeiro e comprovantes armazenados no Google Drive. O Firebase continua responsável por autenticação e dados; fotos e PDFs novos não são enviados ao Firebase Storage.

## Recursos

- Login por e-mail e senha com Firebase Authentication
- Perfis de administrador, financeiro, gerente e operador
- Fechamento por loja, data e turno
- Conferência restrita a Dinheiro, Cartão e Pix
- Seleção das máquinas utilizadas, com Crédito, Débito, Pix e subtotal
- Saídas detalhadas, sangrias, suprimentos e troco
- Solicitação de pagamento Pix para motoboy ou freelancer
- Cálculo automático de falta ou sobra
- Dashboard diário, histórico e fila financeira
- Correção auditável dos valores do operador pelo financeiro, preservando o lançamento original
- Dashboard baseado nos valores corrigidos e aprovados pelo financeiro
- Confirmação ou recusa dos pagamentos Pix solicitados pela loja
- Recuperação de rascunhos e correção de fechamentos devolvidos
- Bloqueio de fechamento duplicado por loja, data e turno
- Fotos e PDFs no Google Drive, organizados por ano, mês e loja
- Banco Firebase Realtime Database

## Google Drive e Apps Script

O arquivo `google-apps-script/Code.gs` amplia o serviço já usado pelas selfies. Ele mantém a ação `uploadClockSelfie` e acrescenta `uploadClosingAttachment` e `deleteClosingAttachment`.

Para ativar a versão nova no endpoint configurado:

1. Abra o projeto existente no Google Apps Script.
2. Substitua o conteúdo de `Code.gs` pelo arquivo deste repositório.
3. Em **Implantar > Gerenciar implantações**, edite a implantação atual.
4. Selecione **Nova versão**, mantenha **Executar como: eu** e permita acesso a **Qualquer pessoa**.
5. Clique em **Implantar**. O aplicativo valida o token do Firebase antes de aceitar qualquer arquivo.

Endpoint configurado no aplicativo:

`https://script.google.com/macros/s/AKfycbzNlFEnYAGp3GOS0jD6f2rQ-qklOe4fO8hDUDbYD_ANi_aJcPxpJKReDsQJP2rkTwd0/exec`

Os comprovantes são gravados em:

`pasta raiz / Fechamento de Caixa / AAAA / AAAA-MM / Loja`

O limite é de 5 comprovantes por fechamento e 2 MB por arquivo. São aceitos JPEG, PNG, WebP, HEIC, HEIF e PDF.

## Configuração do Firebase

1. Ative Authentication por e-mail/senha.
2. Publique `database.rules.json` no Realtime Database.
3. O primeiro acesso de `glleucedias1@gmail.com` cria o perfil administrador.
4. Publique o site pelo GitHub Pages ou Firebase Hosting.

Para publicar somente as regras do banco:

```bash
firebase deploy --only database
```

## Segurança

A configuração web do Firebase é pública por definição. O acesso aos dados é protegido por autenticação e pelas regras do Realtime Database. O Apps Script confirma o token e o perfil no Firebase, limita a loja do usuário, valida o tipo e o tamanho do arquivo e registra metadados de auditoria no Google Drive.
