# PRD — Fechamento de Caixa House 190

## Problema original (usuário)
Verificar o projeto de "Fechamento de Caixa" e adaptar as auditorias:
- Motoboy: apenas Valor no sistema × Valor pago, com ícone de moto.
- Notas: valor do iFood, valor das máquinas fiscais e valor da NF emitida, com ícone de nota.
- Regras do Firebase precisam permitir o operador lançar isso diariamente junto com o fechamento.

Depois foram pedidas melhorias adicionais:
- Trava diária: bloquear envio do fechamento se as duas auditorias do dia não foram lançadas.
- Resumo no fechamento: card compacto no topo da tela do fechamento com as diferenças do dia.
- Gráfico de divergência: mini gráfico por loja e dia nas telas de auditoria.

## Arquitetura
- Frontend estático (HTML/CSS/JS ES Modules) + Firebase Hosting.
- Firebase Web SDK 10.12.5 (Auth, Realtime Database, Storage).
- Testes Node nativos (`node --test`).

## O que foi implementado

### Ciclo 1 (Jan 2026)
- Auditoria de motoboys simplificada: 2 valores + ícone 🏍️, diferença Pago − Sistema, campo `driver` removido.
- Auditoria de notas reestruturada: `ifoodAmount`, `machinesAmount`, `invoiceAmount`, `expectedAmount = iFood + Máquinas`, `difference = expectedAmount − invoiceAmount`, ícone 🧾.
- Regras Firebase endurecidas por campo e liberadas para qualquer usuário ativo (operador incluso).
- `canAudit()` inclui `operator` e `manager`; menu passa a usar ícones 🏍️/🧾.
- Fallback para registros legados (exibe "—" e a marcação "Registro anterior").

### Ciclo 2 (Jan 2026)
- **Trava diária**: `window.HouseAudits.checkDailyAudits(store, date)` chamada no submit do `#closingForm` bloqueia o envio se qualquer uma das auditorias do dia estiver ausente, com mensagem específica e rolagem até o card de resumo.
- **Resumo no fechamento** (`#dailyAuditSummary`): card injetado logo após o cabeçalho do formulário, atualizado ao mudar data/loja e após cada lançamento de auditoria; mostra a diferença de cada auditoria, botão "Abrir auditoria" e badge de "Auditorias OK" / "Faltam auditorias" / "Aguardando".
- **Gráfico de divergência**: SVG inline dentro de cada tela de auditoria mostrando os últimos 14 dias de diferença acumulada; filtro de loja (Todas / cada loja) por gráfico.
- Testes cobrindo trava diária, resumo e gráfico. Suíte: **67/67 OK**.

## Backlog / próximas
- P1: exportar auditorias filtradas em CSV para conciliação semanal com o contador.
- P2: histórico consolidado das auditorias por operador (quem lançou, quando).
- P2: notificação/webhook para o financeiro quando uma auditoria fica pendente após o fim do turno.
