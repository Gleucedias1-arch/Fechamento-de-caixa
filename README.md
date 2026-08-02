# Fechamento de Caixa House 190

Sistema web responsivo para fechamento diário, conciliação e acompanhamento de divergências das lojas House 190.

## Recursos

- Login por e-mail e senha com Firebase Authentication
- Perfis de administrador, gerente e operador
- Fechamento por loja, data e turno
- Conferência de dinheiro, Pix, iFood, Sipag, Cappta e Stone
- Sangrias, despesas, suprimentos, troco e ajustes
- Cálculo automático de falta ou sobra
- Dashboard diário e histórico
- Dashboard consolidado com entradas, saídas, disponível, pendências e divergências por forma de pagamento
- Área exclusiva do financeiro com fila de conferência, aprovação e devolução
- Conciliação líquida de Stone, Sipag, Cielo, Cappta, Laranjinha e Wise
- Auditoria de cupom fiscal, iFood, motoboy, entrega grátis e sangria
- Resultado financeiro registrado com responsável, parecer e data da conferência
- Banco Firebase Realtime Database

## Configuração

1. Ative Authentication por e-mail/senha no Firebase.
2. Publique `database.rules.json` no Realtime Database para habilitar os perfis e a conferência financeira.
3. O primeiro acesso de `glleucedias1@gmail.com` cria o perfil administrador.
4. Publique os arquivos pelo GitHub Pages ou Firebase Hosting.

## Segurança

A configuração web do Firebase é pública por definição. O acesso aos dados é protegido por autenticação e pelas regras do Realtime Database.
