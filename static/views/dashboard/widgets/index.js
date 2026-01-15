import { upcoming } from './upcoming.js';
import { snapshot } from './snapshot.js';
import { recentExpenses } from './recent_expenses.js';
import { balanceCard } from './balance_card.js';
import { recentEntries } from './recent_entries.js';
import { projectionTxns } from './projection_txns.js';
import { expensesChart } from './expenses_chart.js';
import { projection } from './projection.js';

export function createWidgetDefinitions() {
  const defs = [upcoming, recentExpenses, snapshot, balanceCard, recentEntries, projectionTxns, expensesChart, projection];
  return Object.fromEntries(defs.map((def) => [def.type, def]));
}
