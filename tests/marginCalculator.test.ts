import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import {
  calculateAllSolutions,
  calculateMarginRatio,
  calculateRiskStatus,
  parseAmount,
  simulateOperations,
  validateAccount,
  validateOperations,
  type Account,
  type Operations,
} from "../src/utils/marginCalculator";
const account: Account = {
  assets: "1200000",
  debt: "1000000",
  target: "1.5",
  warning: "1.8",
};
const operation = (patch: Partial<Operations> = {}): Operations => ({
  addCash: "0",
  externalRepayment: "0",
  internalCashRepayment: "0",
  saleAmount: "0",
  transactionFees: "0",
  stockRepayment: "0",
  ...patch,
});
describe("维持担保比例计算", () => {
  it("标准补仓与未知资金状态", () => {
    expect(calculateMarginRatio(account.assets, account.debt)?.toString()).toBe(
      "1.2",
    );
    const results = calculateAllSolutions(account);
    expect(results.map((s) => s.amount?.toString())).toEqual([
      "300000",
      "200000",
      "600000",
    ]);
    expect(results.every((s) => s.feasibility === "UNKNOWN")).toBe(true);
  });
  it.each(["1600000", "1500000"])("已达平仓线 %s", (assets) => {
    expect(
      calculateAllSolutions({ ...account, assets }).every(
        (s) => s.amount?.isZero() && s.feasibility === "NOT_REQUIRED",
      ),
    ).toBe(true);
  });
  it("无负债", () => {
    expect(calculateMarginRatio("500000", "0")).toBeNull();
    expect(
      calculateAllSolutions({ ...account, debt: "0" }).every(
        (s) => s.feasibility === "NOT_REQUIRED",
      ),
    ).toBe(true);
  });
  it("账户内还债", () => {
    const r = simulateOperations(
      account,
      operation({ internalCashRepayment: "200000" }),
    );
    expect([
      r.assets.toString(),
      r.debt.toString(),
      r.ratio?.toString(),
    ]).toEqual(["1000000", "800000", "1.25"]);
  });
  it("组合操作", () => {
    const r = simulateOperations(
      account,
      operation({
        addCash: "100000",
        externalRepayment: "100000",
        internalCashRepayment: "100000",
      }),
    );
    expect([
      r.assets.toString(),
      r.debt.toString(),
      r.ratio?.toString(),
    ]).toEqual(["1200000", "800000", "1.5"]);
  });
  it("仅卖股", () => {
    const r = simulateOperations(account, operation({ saleAmount: "100000" }));
    expect([
      r.assets.toString(),
      r.debt.toString(),
      r.ratio?.toString(),
    ]).toEqual(["1200000", "1000000", "1.2"]);
  });
  it("费用只扣一次", () => {
    const r = simulateOperations(
      account,
      operation({
        saleAmount: "100000",
        transactionFees: "100",
        stockRepayment: "99900",
      }),
    );
    expect([
      r.assets.toString(),
      r.debt.toString(),
      r.netAssets.toString(),
    ]).toEqual(["1100000", "900100", "199900"]);
  });
  it.each<Partial<Operations>>([
    { externalRepayment: "1000000.01" },
    { internalCashRepayment: "100001" },
    { saleAmount: "200001" },
    { stockRepayment: "1" },
    { transactionFees: "1" },
    { addCash: "-1" },
    { addCash: "NaN" },
    { addCash: "" },
    { addCash: "0.001" },
    { addCash: "50000", externalRepayment: "50001" },
    { saleAmount: "1100000", internalCashRepayment: "200000" },
  ])("拒绝不合法操作 %j", (patch) => {
    const a = {
      ...account,
      cash: "100000",
      stocks: "200000",
      external: "100000",
    };
    expect(validateOperations(a, operation(patch)).length).toBeGreaterThan(0);
    expect(() => simulateOperations(a, operation(patch))).toThrow();
  });
  it.each(["-1", "", "NaN", "Infinity", "abc", "1e3", "0.001"])(
    "拒绝非法金额 %s",
    (value) => expect(() => parseAmount(value)).toThrow(),
  );
  it.each(["1", "0", "-1", "NaN"])("拒绝非法平仓线 %s", (target) =>
    expect(validateAccount({ ...account, target }).length).toBeGreaterThan(0),
  );
  it("警戒线和资产组成校验", () => {
    expect(
      validateAccount({ ...account, warning: "1.4" }).length,
    ).toBeGreaterThan(0);
    expect(
      validateAccount({ ...account, warning: "0" }).length,
    ).toBeGreaterThan(0);
    expect(
      validateAccount({ ...account, cash: "1000000", stocks: "300000" }).length,
    ).toBeGreaterThan(0);
  });
  it.each(["900000", "1000000"])("净资产非正时内部方案不可行 %s", (assets) => {
    expect(calculateAllSolutions({ ...account, assets })[2]?.feasibility).toBe(
      "INFEASIBLE",
    );
  });
  it("零资产全部外部清偿", () => {
    const r = calculateAllSolutions({
      ...account,
      assets: "0",
      external: "1000000",
    })[1]!;
    expect(r.amount?.toString()).toBe("1000000");
    expect(r.ratio).toBeNull();
  });
  it("已知资金判断", () => {
    expect(
      calculateAllSolutions({
        ...account,
        external: "300000",
        cash: "600000",
      }).map((s) => s.feasibility),
    ).toEqual(["FEASIBLE", "FEASIBLE", "FEASIBLE"]);
    expect(
      calculateAllSolutions({
        ...account,
        external: "1",
        cash: "0",
        stocks: "0",
      }).every((s) => s.feasibility === "INFEASIBLE"),
    ).toBe(true);
    expect(
      calculateAllSolutions({ ...account, cash: "1" })[2]?.feasibility,
    ).toBe("UNKNOWN");
  });
  it("循环小数向上取分并验证达标与最低金额", () => {
    const a = { ...account, assets: "1.21", debt: "1", target: "1.7" };
    for (const [index, r] of calculateAllSolutions(a).entries()) {
      expect(r.assets.gte(r.debt.mul(a.target))).toBe(true);
      expect(r.amount!.decimalPlaces()).toBeLessThanOrEqual(2);
      const less = r.amount!.sub("0.01");
      const assets =
        index === 0
          ? new Decimal(a.assets).add(less)
          : index === 2
            ? new Decimal(a.assets).sub(less)
            : new Decimal(a.assets);
      const debt =
        index === 0 ? new Decimal(a.debt) : new Decimal(a.debt).sub(less);
      expect(assets.lt(debt.mul(a.target))).toBe(true);
    }
  });
  it("万元精度", () => {
    expect(parseAmount("0.000001", "10000").toString()).toBe("0.01");
    expect(() => parseAmount("0.0000001", "10000")).toThrow();
  });
  it.each([
    ["0", "NO_DEBT"],
    ["1000000", "BELOW_TARGET"],
    ["700000", "BELOW_WARNING"],
    ["600000", "AT_OR_ABOVE_TARGET"],
  ])("风险状态 %s", (debt, status) => {
    expect(calculateRiskStatus({ ...account, debt })).toBe(status);
  });
  it.each(["1.4", "1.5"])("警戒线必须严格高于平仓线 %s", (warning) => {
    expect(validateAccount({ ...account, warning })).toContain("警戒线必须高于平仓线");
  });
  it.each([
    ["129.99", "BELOW_TARGET"],
    ["130", "BELOW_WARNING"],
    ["149.99", "BELOW_WARNING"],
    ["150", "AT_OR_ABOVE_TARGET"],
  ])("平仓线130%%、警戒线150%%的临界提醒 %s", (assets, status) => {
    const a = { ...account, assets, debt: "100", target: "1.3", warning: "1.5" };
    expect(calculateRiskStatus(a)).toBe(status);
    expect(calculateAllSolutions(a).every(s => s.feasibility === "NOT_REQUIRED")).toBe(new Decimal(assets).gte("130"));
  });
  it("全部清偿与缺少来源说明", () => {
    const r = simulateOperations(
      account,
      operation({ externalRepayment: "1000000" }),
    );
    expect(r.ratio).toBeNull();
    expect(r.reachedTarget).toBe(true);
    expect(r.feasibility).toBe("UNKNOWN");
  });
});
