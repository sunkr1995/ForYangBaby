<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import Decimal from "decimal.js";
import {
  ElButton,
  ElInput,
  ElForm,
  ElFormItem,
  ElTabs,
  ElTabPane,
  ElTag,
  ElAlert,
} from "element-plus";
import "element-plus/es/components/button/style/css";
import "element-plus/es/components/input/style/css";
import "element-plus/es/components/form/style/css";
import "element-plus/es/components/form-item/style/css";
import "element-plus/es/components/tabs/style/css";
import "element-plus/es/components/tag/style/css";
import "element-plus/es/components/alert/style/css";
import {
  calculateAllSolutions,
  calculateMarginRatio,
  calculateNetAssets,
  calculateRiskStatus,
  formatWanAmount,
  formatRequiredWanAmount,
  formatAmount,
  getRecoveryTarget,
  calculateWithdrawalRepayment,
  formatRatio,
  operationLabels,
  parseAmount,
  parseDecimal,
  simulateOperations,
  validateAccount,
  type Account,
  type Operations,
  type Snapshot,
  type RiskStatus,
} from "./utils/marginCalculator";
const fields = [
  { key: "assets", label: "总资产", suffix: "万元", required: true },
  { key: "debt", label: "总负债", suffix: "万元", required: true },
  { key: "warning", label: "警戒线", suffix: "%", required: true },
  { key: "target", label: "平仓线", suffix: "%", required: true },
  { key: "broker", label: "券商显示的当前比例", suffix: "%", required: false },
] as const;
const advancedFields = [
  { key: "cash", label: "账户内可用现金" },
  { key: "stocks", label: "可卖股票市值" },
  { key: "external", label: "本次可用外部资金" },
] as const;
const form = reactive({
  assets: "",
  debt: "",
  warning: "140",
  target: "130",
  broker: "",
  cash: "",
  stocks: "",
  external: "",
});
const ops = reactive<Record<keyof Operations, string>>({
  addCash: "0",
  externalRepayment: "0",
  internalCashRepayment: "0",
  saleAmount: "0",
  transactionFees: "0",
  stockRepayment: "0",
  withdrawal: "0",
});
const recoveryMode = ref("warning");
const recoveryForm = reactive({ custom: "150", buffer: "0.03" });
const withdrawalRatio = ref("300");
const tab = ref("solutions");
const copyMessage = ref("");
const disclaimer =
  "本工具仅根据用户输入的资产、负债及设定比例进行数学测算，结果仅供参考。实际维持担保比例、担保品认定、融资负债、还款顺序及追保要求以证券公司规定和账户实际数据为准。本工具不提供投资建议。";
const riskLabels = {
  NO_DEBT: "无负债",
  BELOW_WARNING: "低于警戒线，请及时关注",
  BELOW_TARGET: "低于平仓线",
  AT_OR_ABOVE_TARGET: "达到警戒线",
};
const feasibilityLabels = {
  FEASIBLE: "可执行",
  INFEASIBLE: "不可执行",
  UNKNOWN: "条件待确认",
  NOT_REQUIRED: "不需要补仓",
};
function fieldError(key: keyof typeof form): string {
  const value = form[key];
  if (!value)
    return ["assets", "debt", "warning", "target"].includes(key)
      ? "请填写此项"
      : "";
  try {
    if (["warning", "target", "broker"].includes(key)) {
      const ratio = parseDecimal(value);
      if (ratio.lte(0)) return "比例必须大于0";
      if (key === "target" && ratio.lte(100)) return "平仓线必须大于100%";
    } else parseAmount(value, "10000");
  } catch (error) {
    return (error as Error).message;
  }
  return "";
}
const accountResult = computed(() => {
  const errors = [...fields, ...advancedFields]
    .map((f) => fieldError(f.key))
    .filter(Boolean);
  if (errors.length) return { account: null, errors };
  const a: Account = {
    assets: parseAmount(form.assets, "10000"),
    debt: parseAmount(form.debt, "10000"),
    warning: parseDecimal(form.warning).div(100),
    target: parseDecimal(form.target).div(100),
  };
  for (const key of ["cash", "stocks", "external"] as const)
    if (form[key]) a[key] = parseAmount(form[key], "10000");
  const validation = validateAccount(a);
  return { account: validation.length ? null : a, errors: validation };
});
const account = computed(() => accountResult.value.account);
const ratio = computed(() =>
  account.value
    ? calculateMarginRatio(account.value.assets, account.value.debt)
    : null,
);
const risk = computed(() =>
  account.value ? calculateRiskStatus(account.value) : null,
);
const recoverySettings = computed(() => {
  try {
    const selected =
      recoveryMode.value === "liquidation"
        ? form.target
        : recoveryMode.value === "warning"
          ? form.warning
          : recoveryForm.custom;
    const target = parseDecimal(selected).div(100);
    if (target.lte(1)) throw new Error("恢复目标比例必须大于100%");
    const buffer = parseDecimal(recoveryForm.buffer).div(100);
    return { target, buffer, error: "" };
  } catch (error) {
    return { target: null, buffer: null, error: (error as Error).message };
  }
});
const calculationAccount = computed(() => {
  const settings = recoverySettings.value;
  return account.value && settings.target && settings.buffer
    ? {
        ...account.value,
        recoveryTarget: settings.target,
        recoveryBuffer: settings.buffer,
      }
    : null;
});
const effectiveTarget = computed(() =>
  calculationAccount.value ? getRecoveryTarget(calculationAccount.value) : null,
);
const recoveryScenarios = computed(() => {
  if (!account.value || !recoverySettings.value.buffer) return [];
  return [
    { name: "恢复至平仓线", target: account.value.target },
    { name: "恢复至警戒线", target: account.value.warning },
  ].map((scenario) => {
    const a = {
      ...account.value!,
      recoveryTarget: scenario.target,
      recoveryBuffer: recoverySettings.value.buffer!,
    };
    return {
      name: scenario.name,
      target: getRecoveryTarget(a),
      solutions: calculateAllSolutions(a),
    };
  });
});
function snapshotRisk(value: Snapshot): RiskStatus {
  return calculateRiskStatus({
    assets: value.assets,
    debt: value.debt,
    target: account.value!.target,
    warning: account.value!.warning,
  });
}
function riskTagType(status: RiskStatus) {
  if (status === "BELOW_TARGET") return "danger";
  return status === "BELOW_WARNING" ? "warning" : "success";
}
const withdrawalPlan = computed(() => {
  if (!account.value) return { result: null, error: "" };
  try {
    return {
      result: calculateWithdrawalRepayment(
        {
          ...account.value,
          withdrawalRatio: parseDecimal(withdrawalRatio.value).div(100),
        },
        parseAmount(ops.withdrawal, "10000"),
      ),
      error: "",
    };
  } catch (error) {
    return { result: null, error: (error as Error).message };
  }
});
const solutions = computed(() =>
  calculationAccount.value
    ? calculateAllSolutions(calculationAccount.value)
    : [],
);
const simulation = computed(() => {
  if (!calculationAccount.value)
    return {
      result: null,
      errors: account.value ? [recoverySettings.value.error] : ([] as string[]),
    };
  try {
    const operations = {} as Operations;
    for (const key of Object.keys(ops) as (keyof Operations)[]) {
      try {
        operations[key] = parseAmount(ops[key], "10000");
      } catch (e) {
        throw new Error(`${operationLabels[key]} ${(e as Error).message}`);
      }
    }
    return {
      result: simulateOperations(
        {
          ...calculationAccount.value,
          withdrawalRatio: parseDecimal(withdrawalRatio.value).div(100),
        },
        operations,
      ),
      errors: [],
    };
  } catch (e) {
    return { result: null, errors: [(e as Error).message] };
  }
});
const difference = computed(() =>
  form.broker && ratio.value
    ? parseDecimal(form.broker).sub(ratio.value.mul(100)).toFixed(2)
    : null,
);
const change = computed(() =>
  simulation.value.result?.ratio && ratio.value
    ? `${simulation.value.result.ratio.sub(ratio.value).mul(100).toFixed(2)} 个百分点`
    : "无负债时不计算比例变化",
);
function resetCalculationSettings() {
  recoveryMode.value = "warning";
  recoveryForm.custom = "150";
  recoveryForm.buffer = "0.03";
  withdrawalRatio.value = "300";
  for (const key of Object.keys(ops) as (keyof Operations)[]) ops[key] = "0";
  copyMessage.value = "";
}
function demo() {
  resetCalculationSettings();
  Object.assign(form, {
    assets: "120",
    debt: "100",
    warning: "140",
    target: "130",
    broker: "",
    cash: "",
    stocks: "",
    external: "",
  });
}
function reset() {
  resetCalculationSettings();
  Object.assign(form, {
    assets: "",
    debt: "",
    warning: "140",
    target: "130",
    broker: "",
    cash: "",
    stocks: "",
    external: "",
  });
}

function operationError(key: keyof Operations): string {
  try {
    parseAmount(ops[key], "10000");
    return "";
  } catch (e) {
    return (e as Error).message;
  }
}
async function copy() {
  if (!account.value || !calculationAccount.value) return;
  const lines = [
    "融资融券维持担保比例测算",
    `总资产 ${formatWanAmount(new Decimal(account.value.assets))} 万元`,
    `总负债 ${formatWanAmount(new Decimal(account.value.debt))} 万元`,
    `当前比例 ${formatRatio(ratio.value)}`,
    `平仓线 ${form.target}%，警戒线 ${form.warning}%`,
    `恢复目标 ${formatRatio(recoverySettings.value.target)}，附加比例 ${recoveryForm.buffer} 个百分点，实际测算目标 ${formatRatio(effectiveTarget.value)}`,
    ...solutions.value.map(
      (s) =>
        `${s.name} ${s.amount === null ? "无可行金额" : formatRequiredWanAmount(s.amount) + " 万元（精确最低金额 " + formatAmount(s.amount) + " 元）"}（${feasibilityLabels[s.feasibility]}，${s.reason}）`,
    ),
  ];
  for (const scenario of recoveryScenarios.value) {
    lines.push(
      `${scenario.name}（含附加比例 ${formatRatio(scenario.target)}）`,
    );
    lines.push(
      ...scenario.solutions.map(
        (s) =>
          `${s.name} ${s.amount === null ? "无可行金额" : formatRequiredWanAmount(s.amount) + " 万元（精确最低金额 " + formatAmount(s.amount) + " 元）"}（${feasibilityLabels[s.feasibility]}）`,
      ),
    );
  }
  const plan = withdrawalPlan.value.result;
  if (plan && plan.withdrawal.gt(0)) {
    lines.push(
      `独立取现方案：拟取现 ${formatWanAmount(plan.withdrawal)} 万元，取现后最低比例 ${formatRatio(plan.requiredRatio)}，需内部还债 ${plan.amount === null ? "无可行金额" : formatRequiredWanAmount(plan.amount) + " 万元（精确最低金额 " + formatAmount(plan.amount) + " 元）"}，${feasibilityLabels[plan.feasibility]}，${plan.reason}`,
    );
    if (plan.amount !== null)
      lines.push(
        `取现后资产 ${formatWanAmount(plan.assets)} 万元，负债 ${formatWanAmount(plan.debt)} 万元，比例 ${formatRatio(plan.ratio)}`,
      );
  } else if (withdrawalPlan.value.error)
    lines.push(`取现测算输入无效 ${withdrawalPlan.value.error}`);
  if (Object.values(ops).some((v) => v !== "0")) {
    const s = simulation.value.result;
    if (s)
      lines.push(
        `模拟后资产 ${formatWanAmount(s.assets)} 万元，负债 ${formatWanAmount(s.debt)} 万元，净资产 ${formatWanAmount(s.netAssets)} 万元，比例 ${formatRatio(s.ratio)}，${s.reachedTarget ? "达到恢复目标" : "未达到恢复目标"}，${riskLabels[s.riskStatus]}，${feasibilityLabels[s.feasibility]}`,
      );
    else lines.push(`操作模拟输入无效 ${simulation.value.errors.join("；")}`);
  }
  lines.push(
    "假设卖出价格等于当前资产估值，交易费用扣除一次，未还债卖股所得留在账户内。反向方案未计交易费用，卖股票不等于偿还负债。",
    disclaimer,
  );
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    copyMessage.value = "计算结果已复制";
  } catch {
    copyMessage.value = "复制失败，请检查浏览器剪贴板权限";
  }
}
</script>

<template>
  <div class="page">
    <header class="topbar">
      <span class="brand">账户测算</span
      ><span class="privacy">本地计算 · 数据不保存</span>
    </header>
    <section class="intro">
      <div>
        <h1>信用账户维比担保比例测算器</h1>
        <p>快速测算补仓金额、还款方案与操作后风险比例。</p>
      </div>
      <ElButton @click="demo">加载演示数据</ElButton>
    </section>
    <main>
      <section class="panel account-panel">
        <div class="section-heading">
          <h2>账户信息</h2>
          <ElButton text @click="reset">重置</ElButton>
        </div>
        <p class="muted">
          金额单位为万元，支持输入至 0.01
          元。比例以百分数输入，警戒线必须高于平仓线。
        </p>
        <ElForm label-position="top" autocomplete="off" @submit.prevent>
          <div class="field-grid">
            <ElFormItem
              v-for="field in fields"
              :key="field.key"
              :label="field.label"
              :required="field.required"
              :error="form[field.key] ? fieldError(field.key) : ''"
              ><ElInput
                v-model="form[field.key]"
                inputmode="decimal"
                :aria-label="field.label"
                :placeholder="field.required ? '请输入' : '选填'"
                autocomplete="off"
                ><template #suffix>{{ field.suffix }}</template></ElInput
              ></ElFormItem
            >
          </div>
          <details>
            <summary>高级参数 <span>填写后判断资金可行性</span></summary>
            <div class="advanced-grid">
              <ElFormItem
                v-for="field in advancedFields"
                :key="field.key"
                :label="field.label"
                :error="fieldError(field.key)"
                ><ElInput
                  v-model="form[field.key]"
                  inputmode="decimal"
                  :aria-label="field.label"
                  placeholder="未知可留空"
                  ><template #suffix>万元</template></ElInput
                ></ElFormItem
              >
            </div>
          </details>
        </ElForm>
        <ElAlert
          v-if="accountResult.errors.length && form.assets && form.debt"
          :title="accountResult.errors.join('；')"
          type="error"
          :closable="false"
        />
      </section>
      <section class="risk-panel" :class="risk ?? ''" aria-live="polite">
        <div>
          <span class="eyebrow">当前维持担保比例</span>
          <div class="ratio">{{ account ? formatRatio(ratio) : "—" }}</div>
          <span class="risk-label">{{
            risk ? riskLabels[risk] : "填写账户信息后开始测算"
          }}</span>
        </div>
        <div class="risk-metrics">
          <div>
            <span>当前净资产</span
            ><strong>{{
              account
                ? formatWanAmount(
                    calculateNetAssets(account.assets, account.debt),
                  ) + " 万元"
                : "—"
            }}</strong>
          </div>
          <div>
            <span>警戒线</span><strong>{{ form.warning || "—" }}%</strong>
          </div>
          <div>
            <span>平仓线</span><strong>{{ form.target || "—" }}%</strong>
          </div>
        </div>
        <p v-if="difference !== null" class="broker-note">
          券商比例与计算值相差
          {{ difference }} 个百分点，可能存在资产负债统计口径差异。
        </p>
      </section>
      <section class="workspace panel">
        <div class="workspace-heading">
          <h2>方案测算</h2>
          <ElButton :disabled="!calculationAccount" @click="copy"
            >复制计算结果</ElButton
          >
        </div>
        <p v-if="copyMessage" role="status">{{ copyMessage }}</p>
        <ElForm label-position="top" @submit.prevent>
          <div class="simulation-grid">
            <ElFormItem label="恢复目标">
              <select
                v-model="recoveryMode"
                class="recovery-select"
                aria-label="恢复目标"
              >
                <option value="liquidation">平仓线</option>
                <option value="warning">警戒线</option>
                <option value="custom">自定义比例</option>
              </select>
            </ElFormItem>
            <ElFormItem v-if="recoveryMode === 'custom'" label="自定义恢复比例">
              <ElInput
                v-model="recoveryForm.custom"
                inputmode="decimal"
                aria-label="自定义恢复比例"
                ><template #suffix>%</template></ElInput
              >
            </ElFormItem>
            <ElFormItem label="附加比例（百分点）">
              <ElInput
                v-model="recoveryForm.buffer"
                inputmode="decimal"
                aria-label="附加比例"
                ><template #suffix>个百分点</template></ElInput
              >
            </ElFormItem>
          </div>
        </ElForm>
        <ElAlert
          v-if="recoverySettings.error"
          :title="recoverySettings.error"
          type="error"
          :closable="false"
        />
        <p class="muted">
          实际恢复目标
          {{
            effectiveTarget ? formatRatio(effectiveTarget) : "—"
          }}。附加比例默认 0.03 个百分点，可设为
          0。万元金额保留两位小数，所需操作金额向上显示。实际操作可按精确最低元金额，操作后数据及达标状态按精确值计算。
        </p>
        <ElTabs v-model="tab"
          ><ElTabPane label="反向补仓计算" name="solutions">
            <p class="muted">
              按选定的恢复目标及附加比例计算最低理论金额，向上取整到分。平仓线和警戒线独立用于风险提醒。
            </p>
            <div
              v-if="calculationAccount"
              class="solution-grid"
              aria-live="polite"
            >
              <article
                v-for="s in solutions"
                :key="s.name"
                class="solution-card"
              >
                <div class="card-heading">
                  <h3>{{ s.name }}</h3>
                  <ElTag
                    :type="
                      s.feasibility === 'INFEASIBLE'
                        ? 'danger'
                        : s.feasibility === 'UNKNOWN'
                          ? 'warning'
                          : 'success'
                    "
                    >{{ feasibilityLabels[s.feasibility] }}</ElTag
                  >
                </div>
                <span class="muted">理论所需金额</span>
                <div class="solution-amount">
                  {{
                    s.amount === null ? "—" : formatRequiredWanAmount(s.amount)
                  }}<small v-if="s.amount !== null">万元</small>
                </div>
                <p v-if="s.amount !== null" class="muted">
                  精确最低金额 {{ formatAmount(s.amount) }} 元
                </p>
                <p class="reason">{{ s.reason }}</p>
                <ElTag
                  v-if="s.amount !== null"
                  :type="riskTagType(snapshotRisk(s))"
                  >{{ riskLabels[snapshotRisk(s)] }}</ElTag
                >
                <dl>
                  <div>
                    <dt>操作后总资产</dt>
                    <dd>{{ formatWanAmount(s.assets) }} 万元</dd>
                  </div>
                  <div>
                    <dt>操作后总负债</dt>
                    <dd>{{ formatWanAmount(s.debt) }} 万元</dd>
                  </div>
                  <div>
                    <dt>操作后比例</dt>
                    <dd>
                      {{
                        s.debt.isZero() ? "负债已清偿" : formatRatio(s.ratio)
                      }}
                    </dd>
                  </div>
                </dl>
              </article>
            </div>
            <div v-else class="empty">
              输入总资产与总负债，即可查看三种补仓方案。
            </div>
            <div
              v-if="recoveryScenarios.length"
              class="table-wrap scenario-comparison"
            >
              <h3>两档恢复方案对照</h3>
              <table>
                <thead>
                  <tr>
                    <th>方案（万元）</th>
                    <th
                      v-for="scenario in recoveryScenarios"
                      :key="scenario.name"
                    >
                      {{ scenario.name }}<br />{{
                        formatRatio(scenario.target)
                      }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(name, index) in [
                      '追加现金',
                      '外部资金直接还债',
                      '账户内资产还债',
                    ]"
                    :key="name"
                  >
                    <th>{{ name }}</th>
                    <td
                      v-for="scenario in recoveryScenarios"
                      :key="scenario.name"
                    >
                      {{
                        scenario.solutions[index]!.amount === null
                          ? "不可行"
                          : formatRequiredWanAmount(
                              scenario.solutions[index]!.amount!,
                            )
                      }}<br /><span class="muted">{{
                        feasibilityLabels[
                          scenario.solutions[index]!.feasibility
                        ]
                      }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="explanation">
              <strong>卖股票不等于偿还负债。</strong>
              <p>
                仅卖股且现金留在账户内时，忽略费用与价差，总资产、总负债及比例均不变。账户内还债可使用已有现金或卖股净所得，反向理论方案未计交易费用。
              </p>
            </div> </ElTabPane
          ><ElTabPane label="正向操作模拟" name="simulation">
            <p class="muted">
              输入计划操作金额，实时查看组合结果。金额单位为万元，无操作请填 0。
            </p>
            <ElForm label-position="top" autocomplete="off" @submit.prevent
              ><div class="simulation-grid">
                <ElFormItem
                  v-for="(label, key) in operationLabels"
                  :key="key"
                  :label="label"
                  :error="operationError(key)"
                  ><ElInput
                    v-model="ops[key]"
                    :aria-label="label"
                    inputmode="decimal"
                    ><template #suffix>万元</template></ElInput
                  ></ElFormItem
                >
              </div></ElForm
            >
            <ElForm label-position="top" @submit.prevent
              ><ElFormItem label="取现后最低维持担保比例"
                ><ElInput
                  v-model="withdrawalRatio"
                  inputmode="decimal"
                  aria-label="模拟取现后最低比例"
                  ><template #suffix>%</template></ElInput
                ></ElFormItem
              ></ElForm
            >
            <ElAlert
              v-if="simulation.errors.length"
              :title="simulation.errors.join('；')"
              type="error"
              :closable="false"
            />
            <template v-if="account && simulation.result"
              ><div class="simulation-status" aria-live="polite">
                <ElTag
                  :type="
                    simulation.result.reachedTarget
                      ? riskTagType(simulation.result.riskStatus)
                      : 'warning'
                  "
                  >{{
                    simulation.result.reachedTarget
                      ? "达到恢复目标"
                      : "未达到恢复目标"
                  }}</ElTag><ElTag
                  :type="riskTagType(simulation.result.riskStatus)"
                  >{{ riskLabels[simulation.result.riskStatus] }}</ElTag
                ><span>比例变化 {{ change }}</span>
              </div>
              <p
                v-if="simulation.result.feasibility === 'UNKNOWN'"
                class="muted"
              >
                资金来源信息不足，当前展示理论模拟结果。
              </p>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>项目</th>
                      <th>操作前</th>
                      <th>操作后</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th>总资产（万元）</th>
                      <td>
                        {{ formatWanAmount(new Decimal(account.assets)) }}
                      </td>
                      <td>{{ formatWanAmount(simulation.result.assets) }}</td>
                    </tr>
                    <tr>
                      <th>总负债（万元）</th>
                      <td>{{ formatWanAmount(new Decimal(account.debt)) }}</td>
                      <td>{{ formatWanAmount(simulation.result.debt) }}</td>
                    </tr>
                    <tr>
                      <th>净资产（万元）</th>
                      <td>
                        {{
                          formatWanAmount(
                            calculateNetAssets(account.assets, account.debt),
                          )
                        }}
                      </td>
                      <td>
                        {{ formatWanAmount(simulation.result.netAssets) }}
                      </td>
                    </tr>
                    <tr>
                      <th>维持担保比例</th>
                      <td>{{ formatRatio(ratio) }}</td>
                      <td>{{ formatRatio(simulation.result.ratio) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div></template
            >
            <div v-if="!account" class="empty">请先填写有效的账户信息。</div>
            <p class="muted">
              假设卖出价格等于当前资产估值，交易费用仅扣除一次，未用于还债的卖股所得仍留在账户中。
            </p>
          </ElTabPane>
          <ElTabPane label="还债后取现" name="withdrawal">
            <p class="muted">
              按当前账户独立测算：先使用账户内资产还债，再提取现金。取现后最低比例默认采用参考表的
              300%，可按实际要求调整。未计变现费用及结算时间。
            </p>
            <ElForm label-position="top" @submit.prevent
              ><div class="simulation-grid">
                <ElFormItem label="拟提取现金"
                  ><ElInput
                    v-model="ops.withdrawal"
                    inputmode="decimal"
                    aria-label="拟提取现金"
                    ><template #suffix>万元</template></ElInput
                  ></ElFormItem
                >
                <ElFormItem label="取现后最低维持担保比例"
                  ><ElInput
                    v-model="withdrawalRatio"
                    inputmode="decimal"
                    aria-label="取现后最低比例"
                    ><template #suffix>%</template></ElInput
                  ></ElFormItem
                >
              </div></ElForm
            >
            <ElAlert
              v-if="withdrawalPlan.error"
              :title="withdrawalPlan.error"
              type="error"
              :closable="false"
            />
            <article
              v-if="withdrawalPlan.result"
              class="solution-card withdrawal-result"
              aria-live="polite"
            >
              <div class="card-heading">
                <h3>所需账户内还债金额</h3>
                <ElTag
                  :type="
                    withdrawalPlan.result.feasibility === 'INFEASIBLE'
                      ? 'danger'
                      : withdrawalPlan.result.feasibility === 'UNKNOWN'
                        ? 'warning'
                        : 'success'
                  "
                  >{{
                    feasibilityLabels[withdrawalPlan.result.feasibility]
                  }}</ElTag
                >
              </div>
              <div class="solution-amount">
                {{
                  withdrawalPlan.result.amount === null
                    ? "—"
                    : formatRequiredWanAmount(withdrawalPlan.result.amount)
                }}<small>万元</small>
              </div>
              <p v-if="withdrawalPlan.result.amount !== null" class="muted">
                精确最低金额 {{ formatAmount(withdrawalPlan.result.amount) }} 元
              </p>
              <p class="reason">{{ withdrawalPlan.result.reason }}</p>
              <dl v-if="withdrawalPlan.result.amount !== null">
                <div>
                  <dt>取现后总资产</dt>
                  <dd>
                    {{ formatWanAmount(withdrawalPlan.result.assets) }} 万元
                  </dd>
                </div>
                <div>
                  <dt>取现后总负债</dt>
                  <dd>
                    {{ formatWanAmount(withdrawalPlan.result.debt) }} 万元
                  </dd>
                </div>
                <div>
                  <dt>取现后净资产</dt>
                  <dd>
                    {{ formatWanAmount(withdrawalPlan.result.netAssets) }} 万元
                  </dd>
                </div>
                <div>
                  <dt>取现后比例</dt>
                  <dd>{{ formatRatio(withdrawalPlan.result.ratio) }}</dd>
                </div>
              </dl>
              <p class="muted">
                账户内可用现金与可卖股票用于判断资金条件，需覆盖还债金额和拟取现金额。组合操作可在“正向操作模拟”中验证。
              </p>
            </article>
            <div v-if="!account" class="empty">请先填写有效的账户信息。</div>
          </ElTabPane></ElTabs
        >
      </section>
    </main>
    <footer>
      <h2>计算假设与风险提示</h2>
      <p>{{ disclaimer }}</p>
      <p>
        所有计算均在浏览器本地完成。账户信息不上传、不保存，刷新页面后清空。
      </p>
    </footer>
  </div>
</template>
