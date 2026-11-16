# 融资融券维持担保比例计算器

纯前端、本地实时计算的融资融券账户测算工具。账户金额不会上传、写入 URL 或持久化，刷新即清空。

## 功能

- 总资产、总负债、警戒线、平仓线及券商比例差异。
- 追加现金、外部直接还债、账户内资产还债三种最低理论金额及操作后快照。
- 根据可用现金、股票市值和外部资金区分可执行、不可执行、条件待确认和不需要补仓。
- 六项组合操作模拟，包含卖股净所得及交易费用，展示前后资产、负债、净资产、比例与达标状态。
- 中文校验、演示数据、重置、结果复制和桌面/移动响应式布局。

## 技术栈

Vue 3 Composition API、TypeScript strict、Vite、按组件引入的 Element Plus、decimal.js、Vitest。无后端、路由、CDN、外部字体、远程 API 或统计脚本。

## 本地开发

推荐 Node.js 22。安装后运行以下命令。

```sh
npm ci
npm run dev
```

打开终端显示的本地地址。Windows PowerShell 如果禁止执行 npm.ps1，可使用 npm.cmd 替代 npm。

## 验证与构建

```sh
npm run typecheck
npm run test
npm run build
npm run preview
```

构建产物位于 dist。默认 base 为相对路径 `./`，支持项目子路径。也可使用环境变量 VITE_BASE_PATH 显式指定，例如 `/ForYangBaby/` 或自定义域名的 `/`。

## GitHub Pages 部署

1. 将项目提交并推送到 GitHub 仓库 main 分支。
2. 在仓库 Settings → Pages → Build and deployment 中，将 Source 设置为 GitHub Actions。
3. 在 Settings → Actions → General 中允许本仓库工作流运行，确保 Pages 部署权限可用。
4. main 分支 push 自动触发测试和部署，也可以在 Actions 中手动运行“测试与部署 GitHub Pages”。
5. 工作流使用 Node.js 22、npm ci、类型检查、Vitest、Vite 构建和官方 Pages Actions。所有检查通过后才部署。
6. 部署路径从 configure-pages 的 base_path 自动读取。当前仓库默认网址为 https://sunkr1995.github.io/ForYangBaby/ ，实际以 Actions 部署输出为准。
7. 自定义域名需先在 Pages 配置域名和 DNS。如需显式覆盖路径，在 Settings → Secrets and variables → Actions → Variables 中设置 VITE_BASE_PATH 为 `/`。

工作流已授予 contents read、pages write、id-token write。分支保护和环境保护若启用，需按仓库现有规则完成检查。项目没有 History 路由，刷新无需服务器回退。

## 计算公式

A 为总资产，B 为总负债，R 为平仓线小数比例，例如 150% 输入引擎为 1.5。

| 项目 | 公式 |
| --- | --- |
| 当前比例 | A / B，B 为零时显示无负债 |
| 净资产 | A − B |
| 最低追加现金 | max(0, B × R − A) |
| 最低外部还债 | max(0, B − A / R) |
| 最低内部还债 | max(0, (B × R − A) / (R − 1)) |

内部还债公式仅适用于 R > 1、净资产大于零且当前未达标。净资产非正时标记不可行。达到平仓线或无负债时三种金额均为零。当前比例低于平仓线时显示红色风险提示，介于平仓线（含）和警戒线之间时显示橙色提前预警，达到警戒线时显示绿色状态。补仓测算以平仓线为基准，达到平仓线后仍可能存在警戒线预警。

模拟操作后资产为 `A + addCash − internalCashRepayment − stockRepayment − transactionFees`。
模拟操作后负债为 `B − externalRepayment − internalCashRepayment − stockRepayment`。
卖股净所得为 `saleAmount − transactionFees`，实际卖股还债不得超过净所得。合计还款不得超过负债。

## 精度及业务假设

- 引擎金额单位为元，表单单位为万元。最多支持六位万元小数，对应 0.01 元。
- 金额、比例均使用 Decimal，精度为80位。所需金额向上取分，取整后再验证平仓线，显示保留两位。输入非负普通十进制字符串，单项引擎数值上限为 10²⁴。
- 平仓线必须大于100%，警戒线必须严格高于平仓线。默认平仓线130%、警戒线150%，均可按券商要求调整。
- 外部还债资金直接偿债，不加入当前账户资产快照。
- 已有现金还债使用原账户现金。新追加现金不用于同一次操作中的“已有现金还债”字段。
- 卖出价格等于当前资产估值，交易费用仅扣一次，未还债净所得仍留在账户内。仅卖股无费用时比例不变。
- 反向方案未计卖股费用。内部方案只评估已知可变现资产，不保证股票实际成交或净所得充足。
- 资金信息空缺时展示理论结果和条件待确认。已知资金足够覆盖理论金额时可判定可执行，已知完整资金不足时判定不可执行。
- 不模拟券商担保品折算、利息累积、税费明细、交易结算时间、停牌或流动性限制。
- 剪贴板功能需要安全上下文和浏览器权限，失败会显示中文提示。

## 文件结构

- `src/App.vue` 账户表单、风险状态、方案卡片、操作模拟、对比与复制。
- `src/style.css` 响应式视觉样式。
- `src/utils/marginCalculator.ts` 独立类型、解析、格式化、校验与纯计算函数。
- `tests/marginCalculator.test.ts` 公式及边界测试。
- `.github/workflows/deploy.yml` 自动验证与部署。
- `vite.config.ts`、`tsconfig.json`、`package.json`、`package-lock.json` 构建与依赖配置。

## 风险提示

本工具仅根据用户输入的资产、负债及平仓线进行数学测算，结果仅供参考。实际维持担保比例、担保品认定、融资负债、还款顺序及追保要求以证券公司规定和账户实际数据为准。本工具不提供投资建议。
