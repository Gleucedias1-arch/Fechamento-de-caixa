# PRD — Fechamento de Caixa House 190

## Problema original (usuário)
"Verifique meu projeto do github fechamento de caixa. Na parte da auditoria de motoboy quero somente o valor de motoboy que está no sistema e o valor realmente pago... coloca o ícone de uma moto e na parte de auditoria de lançamentos de nota, quero uma parte para valor vendido no iFood, outra com valor passado nas máquinas fiscais, X Valor de nota fiscal emitida, coloca um ícone de iFood ou de nota fiscal."

Definições complementares confirmadas pelo usuário:
- Motoboy: manter apenas `Valor no sistema` + `Valor realmente pago`, ícone 🏍️, diferença = Pago − Sistema.
- Notas: substituir os campos existentes por três valores monetários (iFood, Máquinas fiscais, NF emitida), ícone 🧾, mostrar quanto foi emitido a mais ou a menos.
- Regra de divergência de notas: `Diferença = (iFood + Máquinas) − NF emitida`.
- Registros antigos exibem "—" nos campos ausentes (sem migração).
- Operador deve poder lançar as duas auditorias diariamente junto com o fechamento — regras do Firebase atualizadas.

## Arquitetura
- Frontend estático (HTML/CSS/JS ES Modules) + Firebase Hosting.
- Firebase Web SDK 10.12.5 (Auth, Realtime Database, Storage).
- Testes Node nativos (`node --test`).

## O que foi implementado neste ciclo (Jan 2026)
- Auditoria de motoboys simplificada: 2 valores + ícone 🏍️, diferença Pago − Sistema; campo `driver` removido.
- Auditoria de notas reestruturada: `ifoodAmount`, `machinesAmount`, `invoiceAmount`, `expectedAmount = iFood + Máquinas`, `difference = expectedAmount − invoiceAmount`, ícone 🧾, mensagem "Nota emitida a mais/a menos/confere".
- Regras Firebase (`motoboyAudits`, `invoiceAudits`) endurecidas com validação por campo (tipos, ranges, chaves permitidas), leitura/escrita liberada para qualquer usuário ativo (operador incluso) para permitir lançamento diário.
- `canAudit()` amplia acesso a `admin`, `finance`, `operator`, `manager`.
- Menu lateral agora usa 🏍️/🧾 nos itens; `operator-audit-nav` substitui o gate `finance-only` das auditorias.
- Renderização da lista de auditorias tem fallback para registros legados (exibe "Registro anterior" com os campos antigos, "—" quando ausentes).
- Testes: `tests/project.test.mjs` cobre labels, ícones, fórmula da diferença, ausência dos campos antigos, presença das novas validações nas regras. `65/65` OK.

## Backlog / próximas
- P1: adicionar botão de download em CSV/planilha para as duas auditorias (facilita conciliação semanal).
- P1: exibir mini-resumo das auditorias do dia dentro da tela de fechamento (deep link entre módulos).
- P2: gráfico simples de divergência por loja/dia (linha ou barras) nas telas de auditoria.
- P2: bloquear envio de fechamento se as auditorias do dia não estiverem lançadas (regra de operação diária).
