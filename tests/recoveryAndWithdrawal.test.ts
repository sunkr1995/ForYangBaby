import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import {
  calculateAllSolutions,
  calculateWithdrawalRepayment,
  formatWanAmount,
  formatRequiredWanAmount,
  getRecoveryTarget,
  parseAmount,
  simulateOperations,
  validateAccount,
  type Account,
  type Operations,
} from "../src/utils/marginCalculator";

// 全部为虚构样例，覆盖参考表的代数关系。
const account: Account = {
  assets: "1200000",
  debt: "1000000",
  target: "1.3",
  warning: "1.4",
};
const operations = (patch: Partial<Operations> = {}): Operations => ({
  addCash: "0",
  externalRepayment: "0",
  internalCashRepayment: "0",
  saleAmount: "0",
  transactionFees: "0",
  stockRepayment: "0",
  ...patch,
});

describe("恢复目标和万元操作精度", () => {
  it.each([
    ["1.3", ["100400.00", "77207.02", "334221.04"]],
    ["1.4", ["200400.00", "143101.98", "500499.51"]],
  ])("参考表两档恢复公式 %s", (recoveryTarget, expected) => {
    const a = { ...account, recoveryTarget, recoveryBuffer: "0.0004" };
    const results = calculateAllSolutions(a);
    expect(results.map((result) => result.amount!.toFixed(2))).toEqual(
      expected,
    );
    for (const [index, result] of results.entries()) {
      const shown = formatRequiredWanAmount(result.amount!).replaceAll(",", "");
      const actualAmount = parseAmount(shown, "10000");
      expect(actualAmount.gte(result.amount!)).toBe(true);
      const patch: Partial<Operations> =
        index === 0
          ? { addCash: actualAmount }
          : index === 1
            ? { externalRepayment: actualAmount }
            : { internalCashRepayment: actualAmount };
      expect(simulateOperations(a, operations(patch)).reachedTarget).toBe(true);
      const insufficient = result.amount!.sub("0.01");
      const less: Partial<Operations> =
        index === 0
          ? { addCash: insufficient }
          : index === 1
            ? { externalRepayment: insufficient }
            : { internalCashRepayment: insufficient };
      expect(simulateOperations(a, operations(less)).reachedTarget).toBe(false);
    }
  });
  it.each([
    ["0.01", "0.00"],
    ["9608.51", "0.96"],
    ["1000000.01", "100.00"],
    ["12345678.90", "1,234.57"],
    ["-100.01", "-0.01"],
  ])("万元展示保留两位小数 %s", (yuan, expected) => {
    expect(formatWanAmount(new Decimal(yuan))).toBe(expected);
  });
  it("恢复目标可超过警戒线，风险阈值保持独立", () => {
    const a = { ...account, recoveryTarget: "1.6", recoveryBuffer: "0.0004" };
    expect(validateAccount(a)).toEqual([]);
    expect(getRecoveryTarget(a).toString()).toBe("1.6004");
    const result = simulateOperations(a, operations({ addCash: "100000" }));
    expect(result.reachedTarget).toBe(false);
    expect(result.riskStatus).toBe("BELOW_WARNING");
  });
  it("达到平仓线恢复目标后仍返回警戒状态", () => {
    const result = simulateOperations(
      account,
      operations({ addCash: "100000" }),
    );
    expect(result.reachedTarget).toBe(true);
    expect(result.riskStatus).toBe("BELOW_WARNING");
  });
  it("操作后资产组成变化不影响风险分类", () => {
    const result = simulateOperations(
      { ...account, stocks: "1200000" },
      operations({ saleAmount: "200000", stockRepayment: "200000" }),
    );
    expect(result.assets.toString()).toBe("1000000");
    expect(result.riskStatus).toBe("BELOW_TARGET");
  });
  it("附加比例可设为零，旧调用兼容", () => {
    expect(
      calculateAllSolutions(account).map((s) => s.amount!.toString()),
    ).toEqual(
      calculateAllSolutions({ ...account, recoveryBuffer: "0" }).map((s) =>
        s.amount!.toString(),
      ),
    );
  });
  it.each<Partial<Account>>([
    { recoveryTarget: "1" },
    { recoveryTarget: "NaN" },
    { recoveryBuffer: "-0.0004" },
    { recoveryBuffer: "" },
    { withdrawalRatio: "1" },
    { withdrawalRatio: "Infinity" },
  ])("非法比例设置 %j", (patch) => {
    expect(validateAccount({ ...account, ...patch }).length).toBeGreaterThan(0);
  });
});

describe("还债后取现", () => {
  it("参考表300%公式及完整组合操作", () => {
    const a = { ...account, cash: "975000", stocks: "0" };
    const plan = calculateWithdrawalRepayment(a, "50000");
    expect(plan.amount!.toFixed(2)).toBe("925000.00");
    expect(plan.feasibility).toBe("FEASIBLE");
    expect([
      plan.assets.toString(),
      plan.debt.toString(),
      plan.netAssets.toString(),
      plan.ratio!.toString(),
    ]).toEqual(["225000", "75000", "150000", "3"]);
    const result = simulateOperations(
      a,
      operations({ internalCashRepayment: plan.amount!, withdrawal: "50000" }),
    );
    expect(result.assets.eq(plan.assets)).toBe(true);
    expect(result.debt.eq(plan.debt)).toBe(true);
    expect(result.riskStatus).toBe("AT_OR_ABOVE_TARGET");
  });
  it("自定义取现比例及循环小数向上取分", () => {
    const a = { ...account, withdrawalRatio: "2.7" };
    const plan = calculateWithdrawalRepayment(a, "50000.01");
    expect(plan.amount!.toFixed(2)).toBe("911764.72");
    expect(plan.assets.gte(plan.debt.mul("2.7"))).toBe(true);
    const less = plan.amount!.sub("0.01");
    expect(
      new Decimal(a.assets)
        .sub(less)
        .sub("50000.01")
        .lt(new Decimal(a.debt).sub(less).mul("2.7")),
    ).toBe(true);
  });
  it("缺少变现资金信息时保留未知状态", () => {
    expect(calculateWithdrawalRepayment(account, "50000").feasibility).toBe(
      "UNKNOWN",
    );
    expect(
      calculateWithdrawalRepayment({ ...account, cash: "1" }, "50000")
        .feasibility,
    ).toBe("UNKNOWN");
  });
  it("已知资金必须同时覆盖还债与取现", () => {
    expect(
      calculateWithdrawalRepayment(
        { ...account, cash: "974999.99", stocks: "0" },
        "50000",
      ).feasibility,
    ).toBe("INFEASIBLE");
    expect(
      calculateWithdrawalRepayment(
        { ...account, cash: "0", stocks: "975000" },
        "50000",
      ).feasibility,
    ).toBe("FEASIBLE");
  });
  it.each(["200000.01", "1200000.01"])("超出可提取净资产 %s", (withdrawal) => {
    const plan = calculateWithdrawalRepayment(account, withdrawal);
    expect(plan.feasibility).toBe("INFEASIBLE");
    expect(plan.amount).toBeNull();
  });
  it("提取全部净资产时需要全部清偿", () => {
    const plan = calculateWithdrawalRepayment(account, "200000");
    expect(plan.amount!.toString()).toBe("1000000");
    expect(plan.assets.isZero()).toBe(true);
    expect(plan.ratio).toBeNull();
  });
  it("已有足够比例时无需还款", () => {
    const plan = calculateWithdrawalRepayment(
      { ...account, assets: "4000000" },
      "50000",
    );
    expect(plan.amount!.isZero()).toBe(true);
    expect(plan.ratio!.toString()).toBe("3.95");
  });
  it("无负债时仅扣除取现", () => {
    const a = { ...account, debt: "0", cash: "50000" };
    const plan = calculateWithdrawalRepayment(a, "50000");
    expect(plan.amount!.isZero()).toBe(true);
    expect(plan.ratio).toBeNull();
    const result = simulateOperations(a, operations({ withdrawal: "50000" }));
    expect(result.assets.toString()).toBe("1150000");
    expect(result.riskStatus).toBe("NO_DEBT");
  });
  it("未取现旧调用保持原结果", () => {
    const result = simulateOperations(account, operations());
    expect(result.assets.toString()).toBe("1200000");
  });
  it.each<Partial<Operations>>([
    { withdrawal: "-1" },
    { withdrawal: "NaN" },
    { withdrawal: "0.001" },
    { withdrawal: "50000" },
    { internalCashRepayment: "924999.99", withdrawal: "50000" },
  ])("拒绝不满足取现条件的操作 %j", (patch) => {
    expect(() => simulateOperations(account, operations(patch))).toThrow();
  });
  it("拒绝把未变现股票当作可取现金", () => {
    const a = { ...account, assets: "4000000", cash: "0", stocks: "4000000" };
    expect(() =>
      simulateOperations(a, operations({ withdrawal: "50000" })),
    ).toThrow("可用于取现的现金不足");
  });
  it("未知现金也不能与卖股重复计入取现上限", () => {
    const a = { ...account, debt: "0" };
    expect(() =>
      simulateOperations(
        a,
        operations({ saleAmount: "1000000", withdrawal: "1200000.01" }),
      ),
    ).toThrow();
  });
  it("卖股净所得可用于取现且费用只扣一次", () => {
    const a = { ...account, assets: "4000000", cash: "0", stocks: "4000000" };
    const result = simulateOperations(
      a,
      operations({
        saleAmount: "100000",
        transactionFees: "100",
        withdrawal: "99900",
      }),
    );
    expect(result.assets.toString()).toBe("3900000");
    expect(result.netAssets.toString()).toBe("2900000");
    expect(result.feasibility).toBe("FEASIBLE");
  });
  it("资金来源未知时取现模拟保持待确认", () => {
    const a = { ...account, assets: "4000000" };
    expect(
      simulateOperations(a, operations({ withdrawal: "50000" })).feasibility,
    ).toBe("UNKNOWN");
  });
});

it.each([
  ["0.01", "0.01"],
  ["9608.51", "0.97"],
  ["1000000.01", "100.01"],
  ["1000000", "100.00"],
])("最低操作金额向上显示 %s", (yuan, expected) => {
  expect(formatRequiredWanAmount(new Decimal(yuan))).toBe(expected);
});
it("支持0.03个百分点附加比例", () => {
  expect(
    getRecoveryTarget({
      ...account,
      recoveryTarget: "1.4",
      recoveryBuffer: "0.0003",
    }).toString(),
  ).toBe("1.4003");
});
