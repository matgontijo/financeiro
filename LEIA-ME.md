> Guia da versão anterior: as referências a SQLite/financeiro.db e backup via OneDrive não descrevem o servidor atual. Consulte o [README atual](README.md), que documenta Supabase/PostgreSQL.

# 💰 Financeiro Pessoal

Aplicativo local de controle de finanças pessoais. Roda no seu próprio computador,
com servidor e banco de dados — seus dados nunca saem daqui.

## Como usar

1. Dê **dois cliques** no arquivo **`Iniciar Financeiro.bat`**.
2. O navegador abre automaticamente em `http://localhost:3345`.
3. Para encerrar, feche a janela preta (terminal) que ficou aberta.

> Requisito: Node.js instalado (já está neste computador).

## O que o app faz

| Aba | Função |
|---|---|
| **Dashboard** | Saldo, resultado do mês, ✨ Radar financeiro com análises automáticas, projeção de fim de mês, gráficos, contas a pagar |
| **Lançamentos** | Receitas, despesas e transferências, com filtros, busca, 💳 parcelamento e 📥 importação de extrato |
| **Conciliação** | Rotina diária: confira o app contra o extrato do banco e mantenha os saldos batendo |
| **Calendário** | O mês dia a dia — clique num dia para ver ou adicionar lançamentos |
| **Contas** | Conta corrente, poupança, carteira, cartão de crédito, investimentos |
| **Categorias** | Categorias personalizáveis com cores e ícones |
| **Orçamento** | Limite mensal de gasto por categoria, com barra de progresso e alertas |
| **Recorrências** | Contas fixas (aluguel, assinaturas, salário) geradas todo mês automaticamente |
| **Metas** | Objetivos de economia com progresso — e 🎉 confete quando você conclui! |
| **Relatórios** | Análise por período, evolução do patrimônio, 🔮 fluxo de caixa projetado, 📅 visão anual (categoria × mês), comparativo mês a mês, exportação CSV, backup e ♻️ restauração |

## Recursos espertos

- **⌨️ Ctrl+K** abre a paleta de comandos: busque qualquer lançamento ou execute
  qualquer ação de qualquer tela. A tecla **N** abre um novo lançamento.
- **🧠 Autocompletar**: ao digitar uma descrição que você já usou, o app preenche
  categoria, conta e valor sozinho, com base no seu histórico.
- **💳 Parcelamento**: numa despesa nova, escolha "6x" e informe o valor **total** —
  o app cria as 6 parcelas nos meses seguintes, certinhas ao centavo.
- **📥 Importar extrato**: baixe o extrato do seu banco em CSV ou OFX e importe na
  aba Lançamentos. O app descobre as colunas sozinho e ignora duplicados.
- **✨ Radar financeiro**: no Dashboard, o app cruza seus dados e avisa sobre
  orçamentos estourando, categorias que cresceram, contas atrasadas e mais.
- **🎨 Personalização**: escolha a cor do aplicativo e o tema claro/escuro no
  canto inferior esquerdo.
- **🔮 Fluxo de caixa projetado**: no Dashboard e nos Relatórios, o app projeta o
  saldo dia a dia (30/60/90 dias) usando pendências, parcelas e contas fixas — e
  avisa em que dia o saldo ficaria negativo.
- **💳 Fatura de cartão**: informe dia de fechamento/vencimento na conta do cartão
  e o app calcula a fatura, avisa do vencimento e prepara o pagamento.
- **📎 Comprovantes**: anexe foto ou PDF a qualquer lançamento (no celular, tire a
  foto na hora — o app comprime sozinho).
- **↩️ Desfazer**: excluiu sem querer? O aviso traz um botão "Desfazer".
- **⧉ Duplicar**: repita um lançamento com um clique.
- **♻️ Restaurar backup**: o backup baixado nos Relatórios pode ser restaurado por
  completo — troca de computador sem perder nada.
- **🔐 Sessão de 30 dias**: com PIN ativo, cada aparelho digita o PIN uma vez e
  fica conectado por 30 dias, mesmo reiniciando o app.

## 📱 Acessar pelo celular (rede de casa)

1. Execute **uma única vez** o arquivo **`Permitir celular (executar 1 vez).bat`**
   e aceite a permissão de administrador (libera a porta só na rede privada).
2. Deixe o app aberto no computador (`Iniciar Financeiro.bat`).
3. No celular, conectado no **mesmo Wi-Fi**, abra o endereço que aparece na
   janela do app (ex.: `http://192.168.0.10:3345`). No app, o botão **📱 Celular**
   (canto inferior esquerdo) mostra o endereço certinho.
4. No navegador do celular, use "Adicionar à tela inicial" para virar um ícone de app.

> **🔒 Importante:** ao liberar o acesso pela rede, ative o **PIN** (botão 🔒 no canto
> inferior esquerdo). Assim ninguém na sua casa vê seus dados sem a senha.

## ✅ Conciliação diária (rotina recomendada)

1. Abra a aba **Conciliação** e escolha a conta.
2. Abra o app do banco no celular e compare os lançamentos.
3. Marque aqui os que conferem e clique em **✓ Conferir selecionados**.
4. Digite o **saldo real do banco** — se a diferença for zero, está tudo certo. 🎯
5. Se sobrar diferença, falta lançar algo — ou use o botão de **ajuste automático**.

Lançamentos conferidos ganham um ✅ na lista. Se você editar um lançamento
conferido, ele volta para a fila de conferência (de propósito, por segurança).

## Dicas de uso

- **Valores**: digite no formato brasileiro, ex.: `1.234,56` ou `1234,56`.
- **Cartão de crédito**: lance as compras como despesas na conta do cartão
  (use o parcelamento para compras em N×); o pagamento da fatura é uma
  **transferência** da conta corrente para o cartão.
- **Pendente vs. pago**: só os lançamentos **pagos** afetam o saldo das contas.
  Os pendentes aparecem em "contas a pagar" no Dashboard.
- **Recorrências** entram automaticamente todo mês como pendentes — é só marcar
  como pago quando efetivar.

## Backup

- Os dados ficam no arquivo **`financeiro.db`** (nesta pasta, que já é sincronizada
  pelo OneDrive — backup automático na nuvem).
- Na aba **Relatórios** você também pode baixar um backup completo em JSON
  e exportar os lançamentos em CSV (abre direto no Excel).

## Estrutura técnica

- `server.js` — servidor HTTP + API REST (Node.js puro, sem dependências)
- `financeiro.db` — banco de dados SQLite (criado automaticamente)
- `public/` — interface web (HTML, CSS e JavaScript puros)
- Valores armazenados em centavos (inteiros) para evitar erros de arredondamento
