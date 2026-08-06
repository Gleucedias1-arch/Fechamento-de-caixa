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

## Redesign 3.0 — Junho/2026
- Novo tema visual premium: sidebar escura em gradiente navy, paleta refinada (ouro + azul), fontes Sora (display) + Inter (corpo), fundo texturizado.
- Nova logo "House 190" (squircle dourado, casa branca com porta vazada em degradê + selo "190").
- Ícones SVG na sidebar/topbar (Dashboard, Fechamento, Conferência, Histórico, Usuários, Sair, Backups) e substituição dos emojis de Motoboy (🏍️) e Nota (🧾) por ícones SVG.
- KPI cards com linha de destaque, números tabulares e hover; botões com gradiente; microinterações (entrada de views/cards, hover, scrollbar, seleção, estados vazios).
- Menu mobile com drawer + backdrop (body.nav-open) fechando ao tocar fora.
- Arquivos: styles.css (tokens :root + bloco "REDESIGN 3.0"), index.html (fontes v3.0.0 + ícones), app.js (menu mobile), management-audits.js (logo + ícones).
- Deploy: publicar via "Save to GitHub" (GitHub Pages/Action).

## Regras publicadas + Troca de máquina (financeiro) — Junho/2026
- Regras do Realtime Database publicadas no Firebase (via chave de serviço fornecida pelo usuário e já removida do ambiente). Corrigiu "Permission denied" global. Verificado lendo as regras ao vivo.
- Nova feature: financeiro pode TROCAR a máquina usada após o envio do caixa (quando o operador seleciona a errada).
  - UI: aba "Cartão e Pix" da conferência → botão "Trocar máquina" abre painel com dropdown por máquina + motivo obrigatório.
  - Lógica (app.js): renderMachineSwap + handlers saveMachineSwap; transfere valores Cré/Déb/Pix da máquina antiga para a nova, atualiza selectedMachines/machineDefinitions, recalcula totais, grava lastMachineSwap + auditLog.
  - Regras (database.rules.json): finance pode gravar selectedMachines, machineDefinitions e lastMachineSwap quando status != approved.
  - Bloqueado quando o caixa está aprovado (precisa reabrir).
- Pendente de teste e2e real: requer login de financeiro + caixa enviado (não testável pelas ferramentas por exigir Firebase Auth do cliente).

## Correção ABSOLUTA do Permission Denied (auditorias) — Junho/2026
- Causa raiz real: regra de `motoboyAudits` e `invoiceAudits` exigia `createdAt` no `.validate` do pai, mas NÃO havia regra filha para `createdAt` → caía no `"$other": {".validate": false}` → toda gravação rejeitada (regra autocontraditória). Também faltava `.indexOn` para a query `orderByChild('createdAt')`.
- Correção: adicionada regra filha `createdAt` (isNumber, <= now+60000) e `.indexOn: ["createdAt","date"]` em ambas as seções. Deploy publicado.
- Verificado com requisições REST autenticadas como operador e financeiro reais (custom token -> idToken): READ (com query), WRITE motoboy e WRITE nota = 200. Registros de teste removidos.
- Dados dos usuários conferidos: 5 usuários, todos com chave = UID de auth e active=true booleano (não havia problema de dado).

## Correção permissões de Backup + tela Usuários — Junho/2026
- Bug: nó `users` só tinha `.read` por `$uid`, sem `.read` de coleção. collectBackup() lê `/users` inteiro -> falhava (401) mesmo p/ admin, quebrando o backup e a tela Usuários do admin.
- Correção: adicionado `.read` de coleção em `users` para admin (email admin OU role admin). Deploy publicado.
- Verificado autenticado: admin lê /users, settings, closings, motoboy, notas (200) e grava /backups (200); operador e financeiro seguem bloqueados em /users e /backups (401). Backup completo OK.

## Histórico de auditorias compacto — Junho/2026
- Problema: "Últimas auditorias" mostrava até 40 registros -> rolagem enorme com muitos dias.
- Solução (management-audits.js + injectStyles): mostra as 4 mais recentes e botão "Ver mais N auditoria(s)"/"Ver menos" (colapso via classe .collapsed + nth-child). Card compactado no mobile (2 colunas). Aplica-se a motoboy e notas. Sem mudança nas regras/dados.

## Link público do Gestor (dashboard sem login) — Junho/2026
- Página gestor.html + gestor.js: acesso somente leitura, sem login (Firebase Anonymous Auth), abas por loja (Todas + 3 lojas), tempo real via onValue.
- Abordagem espelho: app.js (admin/financeiro) publica snapshot display-ready em /publicDashboard/{token} (KPIs, situação por loja, canais, visão financeira, divergências). Listener onValue em closings de hoje republica em tempo real.
- Token secreto gerado e salvo em settings/publicShare.token. Link: /gestor.html?t=g_VwQ_ToyWf1q63VFq1pXMIihG514
- Anonymous Auth habilitado no projeto. Regras: /publicDashboard/$token .read=auth!=null (anônimo ok), .write=admin/finance. Dados brutos (closings/users) seguem bloqueados para anônimo.
- Verificado: anônimo lê só o painel (closings/users=401), financeiro escreve (200), operador bloqueado (401), token errado=vazio. Página renderiza e troca abas OK.
- Limitação: espelho atualiza enquanto um admin/financeiro tem o app aberto (sem backend/Cloud Function). Para 24/7 sem ninguém logado, precisaria de Cloud Function (pago).
