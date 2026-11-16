import Decimal from "decimal.js";

Decimal.set({ precision: 80, rounding: Decimal.ROUND_HALF_UP });
export type Money = string | Decimal;
export type Feasibility =
  "FEASIBLE" | "INFEASIBLE" | "UNKNOWN" | "NOT_REQUIRED";
export type RiskStatus =
  "NO_DEBT" | "BELOW_WARNING" | "BELOW_TARGET" | "AT_OR_ABOVE_TARGET";
export interface Account {
  assets: Money;
  debt: Money;
  /** 平仓线，小数形式。保留 target 字段以兼容已有调用。 */
  target: Money;
  warning: Money;
  recoveryTarget?: Money;
  recoveryBuffer?: Money;
  withdrawalRatio?: Money;
  cash?: Money;
  stocks?: Money;
  external?: Money;
}
export interface Operations {
  addCash: Money;
  externalRepayment: Money;
  internalCashRepayment: Money;
  saleAmount: Money;
  transactionFees: Money;
  stockRepayment: Money;
  withdrawal?: Money;
}
export interface Snapshot {
  assets: Decimal;
  debt: Decimal;
  netAssets: Decimal;
  ratio: Decimal | null;
}
export interface Solution extends Snapshot {
  name: string;
  amount: Decimal | null;
  feasibility: Feasibility;
  reason: string;
}
export const operationLabels: Record<keyof Operations, string> = {
  addCash: "追加现金",
  externalRepayment: "外部资金直接还债",
  internalCashRepayment: "账户内已有现金还债",
  saleAmount: "卖股票成交金额",
  transactionFees: "股票交易费用",
  stockRepayment: "卖股所得实际还债",
  withdrawal: "提取现金",
};
export function parseDecimal(value: Money): Decimal {
  if (!(value instanceof Decimal) && !/^\d+(?:\.\d+)?$/.test(value))
    throw new Error("请输入有效的非负十进制数");
  const result = new Decimal(value);
  if (!result.isFinite() || result.isNegative())
    throw new Error("请输入有效的非负数");
  if (result.gt("1000000000000000000000000")) throw new Error("输入数值过大");
  return result;
}
export function parseAmount(value: Money, unit: Money = "1"): Decimal {
  const amount = parseDecimal(value).mul(parseDecimal(unit));
  if (amount.decimalPlaces() > 2) throw new Error("金额最小单位为0.01元");
  return amount;
}
export const ceilToCent = (value: Decimal): Decimal =>
  value.toDecimalPlaces(2, Decimal.ROUND_CEIL);
export const formatAmount = (value: Decimal): string =>
  value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
/** 万元展示保留两位小数，实际计算仍精确到分。 */
export function formatWanAmount(value: Decimal): string {
  return formatAmount(value.div(10000));
}
/** 最低操作金额向上显示，避免按万元展示值操作时不足额。 */
export function formatRequiredWanAmount(value: Decimal): string {
  return value
    .div(10000)
    .toFixed(2, Decimal.ROUND_CEIL)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
export function getRecoveryTarget(account: Account): Decimal {
  return parseDecimal(account.recoveryTarget ?? account.target).add(
    parseDecimal(account.recoveryBuffer ?? "0"),
  );
}
export const formatRatio = (value: Decimal | null): string =>
  value === null ? "无负债" : `${value.mul(100).toFixed(2)}%`;
export function validateAccount(account: Account): string[] {
  const errors: string[] = [];
  try {
    const assets = parseAmount(account.assets);
    parseAmount(account.debt);
    const target = parseDecimal(account.target);
    const warning = parseDecimal(account.warning);
    if (target.lte(1)) errors.push("平仓线必须大于100%");
    if (warning.lte(0)) errors.push("警戒线必须大于0");
    if (warning.lte(target)) errors.push("警戒线必须高于平仓线");
    if (parseDecimal(account.recoveryTarget ?? account.target).lte(1))
      errors.push("恢复目标比例必须大于100%");
    getRecoveryTarget(account);
    if (parseDecimal(account.withdrawalRatio ?? "3").lte(1))
      errors.push("取现后最低比例必须大于100%");
    const cash =
      account.cash === undefined ? undefined : parseAmount(account.cash);
    const stocks =
      account.stocks === undefined ? undefined : parseAmount(account.stocks);
    if (account.external !== undefined) parseAmount(account.external);
    if (
      cash?.gt(assets) ||
      stocks?.gt(assets) ||
      (cash && stocks && cash.add(stocks).gt(assets))
    )
      errors.push("可用现金与可卖股票合计不能超过总资产");
  } catch (error) {
    errors.push((error as Error).message);
  }
  return errors;
}
function assertAccount(account: Account): void {
  const errors = validateAccount(account);
  if (errors.length) throw new Error(errors.join("；"));
}
export function calculateMarginRatio(
  assets: Money,
  debt: Money,
): Decimal | null {
  const b = parseAmount(debt);
  return b.isZero() ? null : parseAmount(assets).div(b);
}
export const calculateNetAssets = (assets: Money, debt: Money): Decimal =>
  parseAmount(assets).sub(parseAmount(debt));
function snapshot(assets: Decimal, debt: Decimal): Snapshot {
  return {
    assets,
    debt,
    netAssets: assets.sub(debt),
    ratio: debt.isZero() ? null : assets.div(debt),
  };
}
export function calculateRiskStatus(account: Account): RiskStatus {
  assertAccount(account);
  const ratio = calculateMarginRatio(account.assets, account.debt);
  if (ratio === null) return "NO_DEBT";
  if (ratio.lt(account.target)) return "BELOW_TARGET";
  return ratio.lt(account.warning) ? "BELOW_WARNING" : "AT_OR_ABOVE_TARGET";
}
function solution(
  account: Account,
  kind: "cash" | "external" | "internal",
): Solution {
  assertAccount(account);
  const a = parseAmount(account.assets),
    b = parseAmount(account.debt),
    r = getRecoveryTarget(account);
  const name = {
    cash: "追加现金",
    external: "外部资金直接还债",
    internal: "账户内资产还债",
  }[kind];
  const before = snapshot(a, b);
  if (b.isZero() || a.gte(b.mul(r)))
    return {
      ...before,
      name,
      amount: new Decimal(0),
      feasibility: "NOT_REQUIRED",
      reason: "已达到恢复目标，不需要补仓",
    };
  if (kind === "internal" && a.lte(b))
    return {
      ...before,
      name,
      amount: null,
      feasibility: "INFEASIBLE",
      reason: "净资产小于或等于零，账户内还债无法达到恢复目标",
    };
  const raw =
    kind === "cash"
      ? b.mul(r).sub(a)
      : kind === "external"
        ? b.sub(a.div(r))
        : b.mul(r).sub(a).div(r.sub(1));
  const amount = ceilToCent(raw);
  const after = snapshot(
    kind === "cash" ? a.add(amount) : kind === "internal" ? a.sub(amount) : a,
    kind === "cash" ? b : b.sub(amount),
  );
  if (
    after.assets.isNegative() ||
    after.debt.isNegative() ||
    (after.ratio !== null && after.assets.lt(after.debt.mul(r)))
  )
    throw new Error("取整后的方案未达到恢复目标或超出允许范围");
  let available: Decimal | undefined;
  if (kind === "internal") {
    const known = new Decimal(account.cash ?? "0").add(account.stocks ?? "0");
    if (
      known.gte(amount) ||
      (account.cash !== undefined && account.stocks !== undefined)
    )
      available = known;
  } else if (account.external !== undefined)
    available = new Decimal(account.external);
  const feasibility =
    available === undefined
      ? "UNKNOWN"
      : available.gte(amount)
        ? "FEASIBLE"
        : "INFEASIBLE";
  const reason =
    feasibility === "UNKNOWN"
      ? "理论金额，资金来源信息不足"
      : feasibility === "FEASIBLE"
        ? "已知资金充足，可执行"
        : "已知可用资金不足";
  return { ...after, name, amount, feasibility, reason };
}
export const calculateCashAddition = (a: Account): Solution =>
  solution(a, "cash");
export const calculateExternalRepayment = (a: Account): Solution =>
  solution(a, "external");
export const calculateInternalRepayment = (a: Account): Solution =>
  solution(a, "internal");
export const calculateAllSolutions = (a: Account): Solution[] => [
  calculateCashAddition(a),
  calculateExternalRepayment(a),
  calculateInternalRepayment(a),
];
export function validateOperations(
  account: Account,
  operations: Operations,
): string[] {
  const errors = validateAccount(account);
  try {
    const op = Object.fromEntries(
      Object.entries(operations).map(([key, value]) => [
        key,
        parseAmount(value),
      ]),
    ) as Record<keyof Operations, Decimal>;
    const withdrawal = parseAmount(operations.withdrawal ?? "0");
    const repayments = op.externalRepayment
      .add(op.internalCashRepayment)
      .add(op.stockRepayment);
    if (repayments.gt(account.debt)) errors.push("合计还款不能超过当前负债");
    if (op.transactionFees.gt(op.saleAmount))
      errors.push("交易费用不能超过卖股成交金额");
    if (op.stockRepayment.gt(op.saleAmount.sub(op.transactionFees)))
      errors.push("卖股实际还债不能超过卖股净所得");
    if (op.saleAmount.add(op.internalCashRepayment).gt(account.assets))
      errors.push("卖股与使用已有现金合计不能超过当前总资产");
    if (account.cash !== undefined && op.internalCashRepayment.gt(account.cash))
      errors.push("账户内已有现金不足");
    if (account.stocks !== undefined && op.saleAmount.gt(account.stocks))
      errors.push("卖出金额超过可卖股票市值");
    if (
      account.cash !== undefined &&
      op.saleAmount.gt(new Decimal(account.assets).sub(account.cash))
    )
      errors.push("卖股金额超过扣除已知现金后的资产");
    if (
      account.stocks !== undefined &&
      op.internalCashRepayment.gt(
        new Decimal(account.assets).sub(account.stocks),
      )
    )
      errors.push("现金还债超过扣除已知股票后的资产");
    if (
      account.external !== undefined &&
      op.addCash.add(op.externalRepayment).gt(account.external)
    )
      errors.push("追加现金与外部还债合计超过外部可用资金");
    const newAssets = new Decimal(account.assets)
      .add(op.addCash)
      .sub(op.internalCashRepayment)
      .sub(op.stockRepayment)
      .sub(op.transactionFees)
      .sub(withdrawal);
    const newDebt = new Decimal(account.debt).sub(repayments);
    if (newAssets.isNegative()) errors.push("操作后总资产不能为负");
    if (withdrawal.gt(0)) {
      // 已有现金与卖出股票互不重叠，未知现金仅用于判断理论上限。
      const cashBefore =
        account.cash === undefined
          ? new Decimal(account.assets).sub(
              Decimal.max(account.stocks ?? "0", op.saleAmount),
            )
          : parseAmount(account.cash);
      const cashAfter = cashBefore
        .add(op.addCash)
        .add(op.saleAmount)
        .sub(op.transactionFees)
        .sub(op.internalCashRepayment)
        .sub(op.stockRepayment);
      if (withdrawal.gt(cashAfter)) errors.push("可用于取现的现金不足");
      const minimum = parseDecimal(account.withdrawalRatio ?? "3");
      if (newDebt.gt(0) && newAssets.lt(newDebt.mul(minimum)))
        errors.push(`取现后维持担保比例必须达到${formatRatio(minimum)}`);
    }
  } catch (error) {
    errors.push((error as Error).message);
  }
  return errors;
}
export function simulateOperations(
  account: Account,
  operations: Operations,
): Snapshot & {
  reachedTarget: boolean;
  feasibility: Feasibility;
  riskStatus: RiskStatus;
} {
  const errors = validateOperations(account, operations);
  if (errors.length) throw new Error(errors.join("；"));
  const op = Object.fromEntries(
    Object.entries(operations).map(([key, value]) => [key, parseAmount(value)]),
  ) as Record<keyof Operations, Decimal>;
  const assets = new Decimal(account.assets)
    .add(op.addCash)
    .sub(op.internalCashRepayment)
    .sub(op.stockRepayment)
    .sub(op.transactionFees)
    .sub(operations.withdrawal ?? "0");
  const debt = new Decimal(account.debt)
    .sub(op.externalRepayment)
    .sub(op.internalCashRepayment)
    .sub(op.stockRepayment);
  const unknown =
    (op.addCash.add(op.externalRepayment).gt(0) &&
      account.external === undefined) ||
    (op.internalCashRepayment.gt(0) && account.cash === undefined) ||
    (op.saleAmount.gt(0) && account.stocks === undefined) ||
    (new Decimal(operations.withdrawal ?? "0").gt(
      op.addCash
        .add(op.saleAmount)
        .sub(op.transactionFees)
        .sub(op.internalCashRepayment)
        .sub(op.stockRepayment),
    ) &&
      account.cash === undefined);
  return {
    ...snapshot(assets, debt),
    reachedTarget:
      debt.isZero() || assets.gte(debt.mul(getRecoveryTarget(account))),
    riskStatus: calculateRiskStatus({
      assets,
      debt,
      target: account.target,
      warning: account.warning,
    }),
    feasibility: unknown ? "UNKNOWN" : "FEASIBLE",
  };
}

export interface WithdrawalPlan extends Solution {
  withdrawal: Decimal;
  requiredRatio: Decimal;
}

/** 使用账户内资产还债，再提取现金。未计变现费用及结算时间。 */
export function calculateWithdrawalRepayment(
  account: Account,
  requestedWithdrawal: Money,
): WithdrawalPlan {
  assertAccount(account);
  const withdrawal = parseAmount(requestedWithdrawal);
  const requiredRatio = parseDecimal(account.withdrawalRatio ?? "3");
  const assets = parseAmount(account.assets);
  const debt = parseAmount(account.debt);
  const raw = Decimal.max(
    0,
    debt
      .mul(requiredRatio)
      .sub(assets)
      .add(withdrawal)
      .div(requiredRatio.sub(1)),
  );
  const amount = ceilToCent(raw);
  const before = snapshot(assets, debt);
  const base = { name: "还债后提取现金", withdrawal, requiredRatio };
  if (amount.gt(debt) || amount.add(withdrawal).gt(assets)) {
    return {
      ...base,
      ...before,
      amount: null,
      feasibility: "INFEASIBLE",
      reason: "账户内资产不足以完成还债与取现，无法满足取现后最低比例",
    };
  }
  const after = snapshot(assets.sub(amount).sub(withdrawal), debt.sub(amount));
  if (after.debt.gt(0) && after.assets.lt(after.debt.mul(requiredRatio)))
    throw new Error("取整后的还债金额未满足取现后最低比例");
  const needed = amount.add(withdrawal);
  const known = new Decimal(account.cash ?? "0").add(account.stocks ?? "0");
  let feasibility: Feasibility = "UNKNOWN";
  if (known.gte(needed)) feasibility = "FEASIBLE";
  else if (account.cash !== undefined && account.stocks !== undefined)
    feasibility = "INFEASIBLE";
  if (needed.isZero()) feasibility = "NOT_REQUIRED";
  const reason =
    feasibility === "UNKNOWN"
      ? "理论金额，可用于还债与取现的资金信息不足"
      : feasibility === "INFEASIBLE"
        ? "已知可变现资金不足以覆盖还债与取现"
        : feasibility === "NOT_REQUIRED"
          ? "无需还债或取现"
          : "已知可变现资金充足，需先变现为现金并满足实际取现条件";
  return { ...base, ...after, amount, feasibility, reason };
}
