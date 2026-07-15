import { buildCpaZip, convertInputToCpa, convertInputToSub, extractAdminAccountIds, inspectInputFormat, repairSecondVerifyJson, sliceSubPayload } from './converter.js'

const CODEX_AUTH_ENDPOINT = 'https://auth.openai.com/oauth/authorize'
const CODEX_TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token'
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CODEX_REDIRECT_URI = 'http://localhost:1455/auth/callback'
const CODEX_SCOPE = 'openid profile email offline_access'
const CODEX_AUDIENCE = 'https://api.openai.com/v1'
const CODEX_PKCE_STORAGE_PREFIX = 'sub-cpa-converter:codex-pkce:'
const OPENAI_ME_ENDPOINT = 'https://api.openai.com/v1/me'
const OPENAI_RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses'
const OPENAI_CHAT_COMPLETIONS_ENDPOINT = 'https://api.openai.com/v1/chat/completions'
const ADMIN_API_BASE = 'https://aasfa.xgrok.xdo.icu/api/v1'
const HEALTH_REPLY_MODEL = 'gpt-5.5'
const HEALTH_REPLY_MODEL_ALIASES = [HEALTH_REPLY_MODEL, 'gpt5.5']
const HEALTH_REPLY_PROMPT = '请只回复两个字：可用'
const HEALTH_REQUEST_TIMEOUT_MS = 45_000
const HEALTH_ME_REQUEST_TIMEOUT_MS = 12_000
const HEALTH_REFRESH_REQUEST_TIMEOUT_MS = 15_000
const HEALTH_TEST_CONCURRENCY = 10
const HEALTH_BROWSER_TEST_CONCURRENCY = 8
const HEALTH_BROWSER_MIN_CONCURRENCY = 4
const HEALTH_BROWSER_MAX_CONCURRENCY = 10
const HEALTH_FAILED_RECHECK_CONCURRENCY = 4
const HEALTH_ME_PROBE_ATTEMPTS = 3
const HEALTH_REFRESH_ATTEMPTS = 2
const HEALTH_RETRY_BASE_DELAY_MS = 350
const HEALTH_TOKEN_EXPIRY_SKEW_MS = 60_000
const LDXP_ORDER_NO_PATTERN = /\bLD\d{6}[A-Z0-9]{4,}\b/gi

const state = {
  target: 'sub',
  latestOutput: '',
  downloadCursor: 0,
  outputSignature: '',
  latestHealthReport: null,
  latestHealthFilter: null,
  repairDocuments: [],
  codexAuth: {
    url: '',
    codeVerifier: '',
    oauthState: ''
  },
  lastCodexCodeExchange: {
    key: '',
    input: ''
  }
}

const elements = {
  targetCpa: document.querySelector('#targetCpa'),
  targetSub: document.querySelector('#targetSub'),
  targetRepair: document.querySelector('#targetRepair'),
  targetHealth: document.querySelector('#targetHealth'),
  codexLogin: document.querySelector('#codexLogin'),
  sourceText: document.querySelector('#sourceText'),
  outputText: document.querySelector('#outputText'),
  healthResult: document.querySelector('#healthResult'),
  fileInput: document.querySelector('#fileInput'),
  repairUpload: document.querySelector('#repairUpload'),
  repairFileInput: document.querySelector('#repairFileInput'),
  clearRepairFiles: document.querySelector('#clearRepairFiles'),
  repairStatus: document.querySelector('#repairStatus'),
  dropZone: document.querySelector('#dropZone'),
  convertNow: document.querySelector('#convertNow'),
  checkFormat: document.querySelector('#checkFormat'),
  swapDirection: document.querySelector('#swapDirection'),
  clearAll: document.querySelector('#clearAll'),
  downloadOutput: document.querySelector('#downloadOutput'),
  pasteDemo: document.querySelector('#pasteDemo'),
  inputTitle: document.querySelector('#inputTitle'),
  outputTitle: document.querySelector('#outputTitle'),
  statCount: document.querySelector('#statCount'),
  statMissingRefresh: document.querySelector('#statMissingRefresh'),
  statFormat: document.querySelector('#statFormat'),
  statStatus: document.querySelector('#statStatus'),
  dropOverlay: document.querySelector('#dropOverlay'),
  downloadDialog: document.querySelector('#downloadDialog'),
  downloadForm: document.querySelector('#downloadForm'),
  downloadLimit: document.querySelector('#downloadLimit'),
  downloadHint: document.querySelector('#downloadHint'),
  cancelDownload: document.querySelector('#cancelDownload'),
  codexLoginDialog: document.querySelector('#codexLoginDialog'),
  codexAuthUrl: document.querySelector('#codexAuthUrl'),
  codexCodeVerifier: document.querySelector('#codexCodeVerifier'),
  closeCodexLogin: document.querySelector('#closeCodexLogin'),
  copyCodexAuthUrl: document.querySelector('#copyCodexAuthUrl'),
  openCodexAuthUrl: document.querySelector('#openCodexAuthUrl'),
  toast: document.querySelector('#toast')
}

let inputTimer = 0
let dragDepth = 0

elements.targetCpa.addEventListener('click', () => {
  setTarget('cpa')
  convertIfInput({ allowHealthFilterPrompt: true })
})
elements.targetSub.addEventListener('click', () => {
  setTarget('sub')
  convertIfInput({ allowHealthFilterPrompt: true })
})
elements.targetRepair.addEventListener('click', () => {
  setTarget('repair')
  convertIfInput()
})
elements.targetHealth.addEventListener('click', () => {
  setTarget('health')
  convertIfInput()
})
elements.convertNow.addEventListener('click', () => {
  void convertCurrent({ allowHealthFilterPrompt: true })
})
elements.checkFormat.addEventListener('click', checkCurrentFormat)
elements.swapDirection.addEventListener('click', () => {
  const target = nextTarget()
  setTarget(target)
  convertIfInput({ allowHealthFilterPrompt: target === 'sub' || target === 'cpa' })
})
elements.clearAll.addEventListener('click', () => {
  elements.sourceText.value = ''
  elements.outputText.value = ''
  state.latestOutput = ''
  state.latestHealthReport = null
  state.latestHealthFilter = null
  state.repairDocuments = []
  updateRepairStatus()
  resetDownloadCursor()
  refreshOutputPreview()
  updateStats({ count: 0, missingRefreshToken: 0, format: currentOutputLabel(), warnings: [] }, '待转换')
})
elements.downloadOutput.addEventListener('click', downloadOutput)
elements.pasteDemo.addEventListener('click', pasteDemo)
elements.codexLogin.addEventListener('click', startCodexLogin)
elements.fileInput.addEventListener('change', readSelectedFile)
elements.repairFileInput.addEventListener('change', readRepairFiles)
elements.clearRepairFiles.addEventListener('click', clearRepairFiles)
elements.sourceText.addEventListener('input', scheduleAutoConvert)
elements.downloadForm.addEventListener('submit', confirmDownload)
elements.cancelDownload.addEventListener('click', closeDownloadDialog)
elements.closeCodexLogin.addEventListener('click', closeCodexLoginDialog)
elements.copyCodexAuthUrl.addEventListener('click', copyCodexAuthUrl)
elements.openCodexAuthUrl.addEventListener('click', openCodexAuthUrl)
elements.downloadDialog.addEventListener('click', (event) => {
  if (event.target === elements.downloadDialog) closeDownloadDialog()
})
elements.codexLoginDialog.addEventListener('click', (event) => {
  if (event.target === elements.codexLoginDialog) closeCodexLoginDialog()
})
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeDownloadDialog()
    closeCodexLoginDialog()
  }
})
elements.dropZone.addEventListener('click', () => elements.fileInput.click())
elements.dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    elements.fileInput.click()
  }
})
window.addEventListener('dragenter', handleDragEnter)
window.addEventListener('dragover', handleDragOver)
window.addEventListener('dragleave', handleDragLeave)
window.addEventListener('drop', handleDrop)

setTarget('sub')

function setTarget(target) {
  state.target = target
  resetDownloadCursor()
  const isCpa = target === 'cpa'
  const isRepair = target === 'repair'
  const isHealth = target === 'health'
  elements.targetCpa.classList.toggle('is-active', isCpa)
  elements.targetSub.classList.toggle('is-active', target === 'sub')
  elements.targetRepair.classList.toggle('is-active', isRepair)
  elements.targetHealth.classList.toggle('is-active', isHealth)
  elements.repairUpload.hidden = !isRepair
  elements.repairUpload.closest('.panel')?.classList.toggle('is-repair-mode', isRepair)
  elements.inputTitle.textContent = isRepair ? 'Session / AT 输入' : isHealth ? '本地测活输入' : '输入 JSON'
  elements.outputTitle.textContent = isRepair ? '二验修正输出' : isHealth ? '本地测活结果' : isCpa ? 'CPA 输出' : 'SUB 输出'
  elements.sourceText.placeholder = isRepair
    ? '先粘贴 GPT Session / AT JSON，下面再上传带 refresh_token 和旧 access_token 的二验 JSON...'
    : isHealth
      ? '粘贴账号 JSON，或输入订单号 LD260605E0DVIX；订单号查询请先安装 LDXP 自动抓取，或附加 Merchant-Token: xxx...'
      : isCpa
        ? '粘贴 GPT AT、RT 授权链接、SUB、CPA JSON，点击 CPA 后输出 CPA...'
        : '粘贴 GPT AT、RT 授权链接、CPA、SUB JSON，点击 SUB 后输出 Sub2API...'
  refreshOutputPreview()
  updateStats({ count: 0, missingRefreshToken: 0, format: currentOutputLabel(), warnings: [] }, '待转换')
}

function nextTarget() {
  const targets = ['sub', 'cpa', 'repair', 'health']
  const index = targets.indexOf(state.target)
  return targets[(index + 1) % targets.length]
}

function convertIfInput(options = {}) {
  if (elements.sourceText.value.trim()) {
    void convertCurrent({ silent: true, ...options })
  }
}

async function convertCurrent(options = {}) {
  window.clearTimeout(inputTimer)
  const input = elements.sourceText.value.trim()
  if (!input) {
    showToast('请先粘贴或上传内容')
    return
  }

  const isHealthRun = state.target === 'health'

  try {
    const conversionInput = state.target === 'health' ? input : await resolveCodexCodeCallbackInput(input)
    if (isHealthRun) state.latestHealthFilter = null
    const preparedInput = isHealthRun ? conversionInput : await resolvePostHealthConversionInput(conversionInput, options)
    syncDownloadScope(`${preparedInput}\n${getRepairSignature()}`)
    if (isHealthRun) {
      updateStats({ count: 0, missingRefreshToken: 0, format: currentOutputLabel(), warnings: [] }, '正在测活 GPT5.5...')
    }
    const result = await buildCurrentResult(preparedInput)
    state.latestHealthReport = isHealthRun ? result.report : null
    if (isHealthRun) {
      rememberLatestHealthFilter(input, result, conversionInput)
    }
    setLatestOutput(getResultOutput(result))
    refreshOutputPreview()
    updateStats(result.meta, getResultStatus(result))
    if (!options.silent) {
      showToast(options.successMessage || '转换完成')
    }
  } catch (error) {
    setLatestOutput('')
    state.latestHealthReport = null
    if (isHealthRun) state.latestHealthFilter = null
    elements.outputText.value = ''
    renderHealthReport(null)
    elements.statStatus.textContent = error.message || '转换失败'
    elements.statStatus.title = elements.statStatus.textContent
    if (!options.silent) {
      showToast(error.message || '转换失败')
    }
  }
}

async function buildCurrentResult(input) {
  if (state.target === 'repair') {
    return repairSecondVerifyJson(input, state.repairDocuments)
  }
  if (state.target === 'health') {
    return runLocalHealthCheck(input)
  }
  return state.target === 'sub'
    ? convertInputToSub(input)
    : convertInputToCpa(input)
}

async function resolvePostHealthConversionInput(input, options = {}) {
  if (state.target !== 'sub' && state.target !== 'cpa') return input

  const healthFilter = getCurrentHealthFilter()
  const sourceInput = healthFilter
    ? firstString(healthFilter.conversionInput, input)
    : await resolveOrderNumberConversionInput(input)
  if (!healthFilter) return sourceInput

  const decision = buildHealthFilterDecision(sourceInput, healthFilter.report)
  if (!decision.canFilter) return sourceInput

  if (!options.allowHealthFilterPrompt) return sourceInput

  const shouldFilter = window.confirm([
    `刚刚测活发现 ${decision.removeCount} 个失败/不可用账号，是否在转换为 ${currentOutputLabel()} 前去除？`,
    '',
    `确定：只保留可用账号和额度用尽账号（${decision.keepCount} 个）。`,
    `取消：保留全部 ${decision.totalCount} 个账号。`
  ].join('\n'))

  if (!shouldFilter) return sourceInput

  showToast(`已去除 ${decision.removeCount} 个失败/不可用账号，保留 ${decision.keepCount} 个`)
  return decision.filteredInput
}

async function resolveOrderNumberConversionInput(input) {
  const orderNos = extractLdxpOrderNos(input)
  if (!orderNos.length) return input

  updateStats({
    count: orderNos.length,
    missingRefreshToken: 0,
    format: currentOutputLabel(),
    warnings: []
  }, `正在查询订单卡密：0/${orderNos.length}（仅自营订单可读取）`)

  const payload = await fetchOrderCardsPayload(input)
  const cardText = firstString(payload?.card_text, payload?.cardText)
  if (!cardText) {
    throw new Error('订单接口没有返回可转换卡密')
  }
  return cardText
}

function rememberLatestHealthFilter(sourceInput, result, fallbackInput) {
  const report = result?.report
  if (!isCompletedHealthReport(report)) {
    state.latestHealthFilter = null
    return
  }

  state.latestHealthFilter = {
    sourceSignature: buildHealthSourceSignature(sourceInput),
    conversionInput: firstString(result?.healthSourceInput, fallbackInput, sourceInput),
    report,
    createdAt: Date.now()
  }
}

function getCurrentHealthFilter() {
  const healthFilter = state.latestHealthFilter
  if (!healthFilter) return null
  if (healthFilter.sourceSignature !== buildHealthSourceSignature(elements.sourceText.value)) return null
  if (!isCompletedHealthReport(healthFilter.report)) return null
  return healthFilter
}

function buildHealthFilterDecision(input, report) {
  let subResult
  try {
    subResult = convertInputToSub(input)
  } catch {
    return { canFilter: false }
  }

  const accounts = Array.isArray(subResult?.payload?.accounts) ? subResult.payload.accounts : []
  if (!accounts.length) return { canFilter: false }

  const removeIndexes = collectHealthRemovalIndexes(report, accounts.length)
  if (!removeIndexes.size) return { canFilter: false }

  const keptAccounts = accounts.filter((_, index) => !removeIndexes.has(index))
  const filteredPayload = {
    ...subResult.payload,
    accounts: keptAccounts
  }

  return {
    canFilter: true,
    totalCount: accounts.length,
    removeCount: accounts.length - keptAccounts.length,
    keepCount: keptAccounts.length,
    filteredInput: JSON.stringify(filteredPayload, null, 2)
  }
}

function collectHealthRemovalIndexes(report, accountCount) {
  const indexes = new Set()
  const results = Array.isArray(report?.results) ? report.results : []
  results.forEach((item, position) => {
    if (!shouldRemoveHealthAccount(item)) return
    const itemIndex = Number(item?.index)
    const accountIndex = Number.isInteger(itemIndex) && itemIndex >= 1 && itemIndex <= accountCount
      ? itemIndex - 1
      : position
    if (accountIndex >= 0 && accountIndex < accountCount) {
      indexes.add(accountIndex)
    }
  })
  return indexes
}

function shouldRemoveHealthAccount(item) {
  if (!item || isHealthPending(item) || isHealthUsageLimited(item)) return false
  return item.usable !== true
}

function isCompletedHealthReport(report) {
  const results = Array.isArray(report?.results) ? report.results : []
  if (!results.length) return false
  if (report?.progress && report.progress.done !== true) return false
  return !results.some(isHealthPending)
}

function buildHealthSourceSignature(input) {
  return String(input ?? '').trim()
}

function getResultOutput(result) {
  if (state.target === 'sub') {
    return JSON.stringify(result.payload, null, 2)
  }
  return result.output
}

function getResultStatus(result) {
  if (state.target === 'repair' && result.meta.count === 0) {
    return '没有可修正的 AT'
  }
  if (state.target === 'health') {
    const failed = result.meta.failed ?? 0
    const usageLimited = result.meta.usageLimited ?? 0
    const parts = [
      `可用 ${result.meta.usable ?? 0} 个`,
      `不可用 ${result.meta.unusable ?? 0} 个`
    ]
    if (usageLimited) parts.push(`额度用尽 ${usageLimited} 个`)
    if (result.meta.refreshed) parts.push(`自动刷新 ${result.meta.refreshed} 个`)
    if (failed) parts.push(`测试失败 ${failed} 个`)
    return `测活完成：${parts.join('，')}`
  }
  return result.meta.warnings.length ? '已转换，有提示' : '转换成功'
}

async function runLocalHealthCheck(input) {
  try {
    return await runBrowserHealthCheck(input)
  } catch (error) {
    if (!canUseLocalHealthFallback() || containsSensitiveCredentialInput(input)) {
      throw error
    }
    return runServerHealthCheck(input)
  }
}

function containsSensitiveCredentialInput(input) {
  return /(?:access_token|refresh_token|id_token|credentials|rt\.1\.|eyJ[A-Za-z0-9_-]+\.)/i.test(firstString(input))
}

async function runBrowserHealthCheck(input) {
  if (typeof fetch !== 'function') {
    throw new Error('当前浏览器不支持直接测活')
  }

  const orderNos = extractLdxpOrderNos(input)
  if (orderNos.length) {
    return runOrderHealthCheck(input)
  }

  const directIds = extractAdminAccountIds(input)
  if (directIds.length) {
    const accounts = directIds.map((id, index) => ({
      id,
      index: index + 1,
      name: id,
      email: ''
    }))
    const proxyReport = await runProxyHealthTestsWithProgress(accounts)
    if (proxyReport) return formatHealthReport(proxyReport)
    return formatHealthReport(await runAdminAccountTests(accounts))
  }

  const accounts = convertInputToSub(input).payload.accounts || []
  return formatHealthReport(await runBrowserCredentialTests(accounts))
}

async function runOrderHealthCheck(input) {
  const orderNos = extractLdxpOrderNos(input)
  publishOrderLookupProgress(orderNos)

  const payload = await fetchOrderCardsPayload(input)
  const cardText = firstString(payload?.card_text, payload?.cardText)
  if (!cardText) {
    throw new Error('订单接口没有返回可测活卡密')
  }

  const accounts = convertInputToSub(cardText).payload.accounts || []
  if (!accounts.length) {
    throw new Error('订单卡密里没有解析到可测活账号')
  }

  const orderOptions = {
    directCredentials: true,
    orderQuery: true,
    sourceOrders: Array.isArray(payload?.source_orders) && payload.source_orders.length ? payload.source_orders : orderNos,
    orderLookup: Array.isArray(payload?.order_lookup) ? payload.order_lookup : []
  }
  publishHealthProgress(accounts, [], 0, orderOptions)

  const report = attachOrderHealthMeta(await runBrowserCredentialTests(accounts, orderOptions), orderOptions)
  const formatted = formatHealthReport(report)
  formatted.healthSourceInput = cardText
  return formatted
}

async function fetchOrderCardsPayload(input) {
  const response = await fetch('/api/order-cards', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ input })
  })

  const text = await response.text()
  let payload = null
  if (text.trim()) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = { message: text.slice(0, 300) }
    }
  }

  if (!response.ok || payload?.ok === false) {
    const message = firstString(payload?.message, `订单号查询请求失败：HTTP ${response.status}`)
    const hint = firstString(payload?.hint)
    throw new Error(hint && !message.includes(hint) ? `${message}\n${hint}` : message)
  }

  return payload
}

function publishOrderLookupProgress(orderNos) {
  if (state.target !== 'health' || !orderNos.length) return
  const total = orderNos.length
  const report = {
    type: 'ldxp-order-lookup-progress',
    generated_at: new Date().toISOString(),
    method: 'ldxp-order-query-progress',
    target_model: HEALTH_REPLY_MODEL,
    total,
    usable: 0,
    unusable: 0,
    usage_limited: 0,
    refreshed: 0,
    failed: 0,
    source_orders: orderNos,
    order_lookup: [],
    progress: {
      current: 0,
      completed: 0,
      total,
      percent: 0,
      done: false
    },
    results: orderNos.map((orderNo, index) => ({
      source: 'ldxp-order-query',
      index: index + 1,
      id: orderNo,
      name: orderNo,
      email: '-',
      usable: false,
      status: 'testing',
      model: HEALTH_REPLY_MODEL,
      reply: '',
      message: '正在查询订单卡密（仅自营订单可读取）...',
      has_access_token: true,
      has_refresh_token: true,
      checked_at: ''
    }))
  }
  state.latestHealthReport = report
  setLatestOutput(JSON.stringify(report, null, 2))
  renderHealthReport(report)
  updateStats(formatHealthReport(report).meta, `正在查询订单卡密：0/${total}（仅自营订单可读取）`)
}

function attachOrderHealthMeta(report, options = {}) {
  const method = firstString(report?.method, 'local-node-gpt5.5-reply-probe')
  return {
    ...report,
    method: method.includes('ldxp-order-query') ? method : `${method}+ldxp-order-query`,
    source_orders: Array.isArray(options.sourceOrders) ? options.sourceOrders : [],
    order_lookup: Array.isArray(options.orderLookup) ? options.orderLookup : []
  }
}

async function tryAdminAccountHealthCheck(convertedAccounts) {
  let adminAccounts
  try {
    adminAccounts = await loadAdminAccounts()
  } catch {
    return null
  }

  const wantedKeys = buildWantedAdminAccountKeys(convertedAccounts)
  const matched = adminAccounts
    .filter((account) => {
      const keys = buildAdminAccountKeys(account)
      return keys.some((key) => wantedKeys.has(key))
    })
    .map((account, index) => ({
      id: getAdminAccountId(account),
      index: index + 1,
      name: getAdminAccountName(account),
      email: getAdminAccountEmail(account),
      raw: account
    }))
    .filter((account) => account.id)

  if (!matched.length) return null
  return runAdminAccountTests(matched)
}

async function runAdminAccountTests(accounts) {
  const proxyReport = await tryAdminAccountProxyTests(accounts)
  if (proxyReport) return proxyReport

  const results = []
  for (let start = 0; start < accounts.length; start += HEALTH_TEST_CONCURRENCY) {
    const batch = accounts.slice(start, start + HEALTH_TEST_CONCURRENCY)
    const batchResults = await Promise.all(batch.map((account, offset) => testAdminAccount(account, start + offset)))
    results.push(...batchResults)
  }

  return buildAdminHealthReport(results)
}

async function testAdminAccount(account, index) {
  try {
    const payload = await adminApiFetch(`/admin/accounts/${encodeURIComponent(account.id)}/test`, {
      method: 'POST',
      body: JSON.stringify({
        model_id: HEALTH_REPLY_MODEL,
        prompt: HEALTH_REPLY_PROMPT
      })
    })
    const test = normalizeAdminTestResult(payload)
    const message = firstString(test.message, test.success ? '后台接口测试可用' : '后台接口测试不可用')
    return {
      source: 'sub2api-admin-api',
      index: account.index || index + 1,
      id: account.id,
      name: firstString(account.name, account.email, account.id),
      email: firstString(account.email),
      usable: test.success,
      status: test.success ? 'usable' : normalizeHealthFailureStatus(message, 'unusable'),
      model: firstString(test.model, HEALTH_REPLY_MODEL),
      reply: firstString(test.reply),
      message,
      checked_at: new Date().toISOString(),
      response: test.data
    }
  } catch (error) {
    const message = normalizeAdminApiErrorMessage(error.message || '后台测试接口不可用')
    return {
      source: 'sub2api-admin-api',
      index: account.index || index + 1,
      id: account.id,
      name: firstString(account.name, account.email, account.id),
      email: firstString(account.email),
      usable: false,
      status: normalizeHealthFailureStatus(message, 'admin_test_failed'),
      model: HEALTH_REPLY_MODEL,
      reply: '',
      message,
      checked_at: new Date().toISOString()
    }
  }
}

async function runBrowserCredentialTests(accounts, options = {}) {
  const results = []
  const batchHistory = []
  const progressOptions = { ...options, directCredentials: true, browserFallback: true }
  let currentIndex = 0
  let currentConcurrency = HEALTH_BROWSER_TEST_CONCURRENCY
  while (currentIndex < accounts.length) {
    const batch = accounts.slice(currentIndex, currentIndex + currentConcurrency)
    publishHealthProgress(accounts, results, currentIndex, progressOptions)
    const batchResults = await Promise.all(batch.map((account, offset) => testBrowserAccount(account, {
      source: 'browser-direct-credential',
      index: currentIndex + offset + 1
    })))
    results.push(...batchResults)
    const nextConcurrency = nextBrowserHealthConcurrency(currentConcurrency, batchResults)
    batchHistory.push(buildBrowserHealthBatchHistoryItem(batchHistory.length + 1, currentIndex, batchResults, currentConcurrency, nextConcurrency))
    currentIndex += batch.length
    currentConcurrency = nextConcurrency
    publishHealthProgress(accounts, results, currentIndex, progressOptions)
  }
  const stabilizedResults = await recheckBrowserTestFailures(accounts, results, progressOptions)
  return buildCredentialHealthReport(stabilizedResults, options.orderQuery ? 'browser-direct-openai-me-probe+ldxp-order-query' : 'browser-direct-openai-me-probe', { batchHistory })
}

async function recheckBrowserTestFailures(accounts, results, progressOptions = {}) {
  const failedItems = results
    .map((result, index) => ({
      index,
      result,
      account: accounts[index]
    }))
    .filter((item) => item.account && isHealthTestFailed(item.result))

  if (!failedItems.length) return results

  const updated = [...results]
  for (let start = 0; start < failedItems.length; start += HEALTH_FAILED_RECHECK_CONCURRENCY) {
    const batch = failedItems.slice(start, start + HEALTH_FAILED_RECHECK_CONCURRENCY)
    const batchResults = await Promise.all(batch.map((item) => testBrowserAccount(item.account, {
      source: 'browser-direct-credential-recheck',
      index: item.index + 1
    })))
    batchResults.forEach((recheckResult, offset) => {
      const item = batch[offset]
      const previous = item.result
      if (recheckResult.usable || !isHealthTestFailed(recheckResult)) {
        updated[item.index] = {
          ...recheckResult,
          rechecked: true,
          recovered_by_recheck: recheckResult.usable === true,
          first_pass_status: previous.status,
          first_pass_message: firstString(previous.message)
        }
        return
      }
      updated[item.index] = {
        ...previous,
        rechecked: true,
        recovered_by_recheck: false,
        message: `二次核验后仍测试失败：${firstString(recheckResult.message, previous.message)}`,
        recheck: {
          status: recheckResult.status,
          message: firstString(recheckResult.message),
          probe: recheckResult.probe
        }
      }
    })
    publishHealthProgress(accounts, updated, accounts.length, progressOptions)
  }

  return updated
}

function nextBrowserHealthConcurrency(currentConcurrency, batchResults) {
  const total = Math.max(1, batchResults.length)
  const transientFailures = batchResults.filter(isHealthTestFailed).length
  const failureRatio = transientFailures / total
  if (failureRatio >= 0.25) {
    return Math.max(HEALTH_BROWSER_MIN_CONCURRENCY, currentConcurrency - 2)
  }
  if (transientFailures === 0 && currentConcurrency < HEALTH_BROWSER_MAX_CONCURRENCY) {
    return Math.min(HEALTH_BROWSER_MAX_CONCURRENCY, currentConcurrency + 1)
  }
  return currentConcurrency
}

function buildBrowserHealthBatchHistoryItem(batchNumber, startIndex, batchResults, concurrency, nextConcurrency) {
  const total = batchResults.length
  const testFailed = batchResults.filter(isHealthTestFailed).length
  const usable = batchResults.filter((item) => item.usable).length
  return {
    batch: batchNumber,
    start_index: startIndex + 1,
    size: total,
    concurrency,
    usable,
    test_failed: testFailed,
    transient_failure_ratio: total ? Number((testFailed / total).toFixed(3)) : 0,
    next_concurrency: nextConcurrency
  }
}

async function runProxyHealthTestsWithProgress(accounts, options = {}) {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return null
  if (!Array.isArray(accounts) || !accounts.length) return null

  const normalizedAccounts = accounts.map((account, index) => ({
    ...objectOrEmpty(account),
    index: Number(account?.index) || index + 1
  }))
  const results = []
  for (let start = 0; start < normalizedAccounts.length; start += HEALTH_TEST_CONCURRENCY) {
    const batch = normalizedAccounts.slice(start, start + HEALTH_TEST_CONCURRENCY)
    publishHealthProgress(normalizedAccounts, results, start, options)
    const batchResults = await Promise.all(batch.map(async (account, offset) => {
      const index = start + offset
      const report = await tryAdminAccountProxyTests([account], options)
      return {
        report,
        account,
        index
      }
    }))

    const missingProxy = batchResults.find((item) => !item.report)
    if (missingProxy) {
      return results.length ? buildHealthProgressReport(normalizedAccounts, results, start, options, { done: false }) : null
    }

    results.push(...batchResults.map((item) => normalizeProgressResult(item.report, item.account, item.index)))
    publishHealthProgress(normalizedAccounts, results, start + batch.length, options)
  }

  return buildHealthProgressReport(normalizedAccounts, results, normalizedAccounts.length, options, { done: true })
}

function publishHealthProgress(accounts, completedResults, currentIndex, options = {}) {
  if (state.target !== 'health') return
  const report = buildHealthProgressReport(accounts, completedResults, currentIndex, options)
  state.latestHealthReport = report
  setLatestOutput(JSON.stringify(report, null, 2))
  renderHealthReport(report)
  const formatted = formatHealthReport(report)
  updateStats(formatted.meta, buildHealthProgressStatus(report))
}

function buildHealthProgressReport(accounts, completedResults, currentIndex, options = {}, extra = {}) {
  const total = accounts.length
  const doneCount = Math.min(completedResults.length, total)
  const normalizedCurrent = Math.min(Math.max(Number(currentIndex) || 0, doneCount), total)
  const results = [
    ...completedResults,
    ...accounts.slice(doneCount).map((account, offset) => {
      const pendingIndex = doneCount + offset
      return buildPendingHealthResult(account, pendingIndex, pendingIndex === normalizedCurrent, options)
    })
  ]
  const isDirect = options.directCredentials === true
  const failed = completedResults.filter(isHealthTestFailed).length
  const usageLimited = completedResults.filter(isHealthUsageLimited).length
  const refreshed = completedResults.filter((item) => item.refreshed === true).length
  const baseMethod = isDirect
    ? (options.browserFallback ? 'browser-direct-openai-me-probe-progress' : 'local-node-gpt5.5-reply-probe-progress')
    : 'sub2api-admin-account-test-proxy-progress'
  return {
    type: isDirect ? 'local-account-health-result' : 'sub2api-admin-account-health-result',
    generated_at: new Date().toISOString(),
    method: options.orderQuery ? `${baseMethod}+ldxp-order-query` : baseMethod,
    endpoint: isDirect ? (options.browserFallback ? OPENAI_ME_ENDPOINT : '/api/admin-account-test direct_credentials') : '/api/v1/admin/accounts/{id}/test',
    target_model: options.browserFallback ? OPENAI_ME_ENDPOINT : HEALTH_REPLY_MODEL,
    model_aliases: HEALTH_REPLY_MODEL_ALIASES,
    total,
    usable: completedResults.filter((item) => item.usable).length,
    unusable: completedResults.filter((item) => !item.usable && !isHealthTestFailed(item) && !isHealthUsageLimited(item)).length,
    usage_limited: usageLimited,
    refreshed,
    failed,
    progress: {
      current: normalizedCurrent,
      completed: doneCount,
      total,
      percent: total ? Math.round((doneCount / total) * 100) : 100,
      done: extra.done === true || doneCount >= total
    },
    ...(options.orderQuery ? {
      source_orders: Array.isArray(options.sourceOrders) ? options.sourceOrders : [],
      order_lookup: Array.isArray(options.orderLookup) ? options.orderLookup : []
    } : {}),
    results
  }
}

function normalizeProgressResult(report, account, index) {
  const results = Array.isArray(report?.results) ? report.results : []
  const item = results[0] || {}
  return {
    ...item,
    index: Number(account?.index) || index + 1,
    name: firstString(item.name, account?.name, account?.email, `账号 ${index + 1}`),
    email: firstString(item.email, account?.email),
    checked_at: firstString(item.checked_at, new Date().toISOString())
  }
}

function buildPendingHealthResult(account, index, testing = false, options = {}) {
  const credentials = objectOrEmpty(account?.credentials)
  const email = firstString(account?.email, credentials.email, validEmailFromText(account?.name))
  return {
    source: 'local-health-progress',
    index: Number(account?.index) || index + 1,
    id: firstString(account?.id, account?._id, account?.account_id, account?.accountId),
    name: firstString(account?.name, email, account?.id, `账号 ${index + 1}`),
    email,
    usable: false,
    status: testing ? 'testing' : 'pending',
    model: options.browserFallback ? OPENAI_ME_ENDPOINT : HEALTH_REPLY_MODEL,
    reply: '',
    message: testing
      ? (options.browserFallback ? '浏览器本地验 JWT，并直连 /v1/me...' : '正在测试...')
      : '等待测试',
    has_access_token: Boolean(firstString(credentials.access_token, credentials.accessToken)),
    has_refresh_token: Boolean(firstString(credentials.refresh_token, credentials.refreshToken)),
    checked_at: ''
  }
}

function buildHealthProgressStatus(report) {
  const progress = report?.progress || {}
  const total = Number(progress.total || report?.total || 0) || 0
  const completed = Number(progress.completed ?? progress.current ?? 0) || 0
  if (progress.done) {
    const parts = [
      `可用 ${report.usable ?? 0} 个`,
      `不可用 ${report.unusable ?? 0} 个`
    ]
    if (report.usage_limited) parts.push(`额度用尽 ${report.usage_limited} 个`)
    if (report.refreshed) parts.push(`自动刷新 ${report.refreshed} 个`)
    if (report.recovered_by_recheck) parts.push(`复核找回 ${report.recovered_by_recheck} 个`)
    if (report.failed) parts.push(`测试失败 ${report.failed} 个`)
    return `测活完成：${parts.join('，')}`
  }
  const browserDirectMe = /browser-direct-openai-me/i.test(firstString(report?.method))
  if (browserDirectMe) {
    return total ? `正在测活 OpenAI 认证：${completed}/${total}（浏览器直连，自适应并发 ${HEALTH_BROWSER_MIN_CONCURRENCY}-${HEALTH_BROWSER_MAX_CONCURRENCY}）` : '正在测活 OpenAI 认证...'
  }
  return total ? `正在测活 GPT5.5：${completed}/${total}（并发 ${HEALTH_TEST_CONCURRENCY}）` : '正在测活 GPT5.5...'
}

async function tryAdminAccountProxyTests(accounts, options = {}) {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return null

  try {
    const response = await fetch('/api/admin-account-test', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        accounts,
        direct_credentials: options.directCredentials === true
      })
    })
    const payload = await readBrowserPayload(response)
    if (response.status === 404 || response.status === 405) return null
    if (!response.ok || payload?.ok === false) {
      throw new Error(readBrowserMessage(payload, `HTTP ${response.status}`))
    }
    return payload?.report || payload
  } catch (error) {
    if (/404|405|Failed to fetch|资源不存在|只支持 GET\/HEAD/i.test(error.message || '')) return null
    return buildAdminCallFailureReport(accounts, normalizeAdminApiErrorMessage(error.message || '后台代理测试接口不可用'))
  }
}

function buildAdminCallFailureReport(accounts, message) {
  const results = accounts.map((account, index) => ({
    source: 'sub2api-admin-api-proxy',
    index: account.index || index + 1,
    id: account.id,
    name: firstString(account.name, account.email, account.id),
    email: firstString(account.email),
    usable: false,
    status: normalizeHealthFailureStatus(message, 'admin_test_failed'),
    model: HEALTH_REPLY_MODEL,
    reply: '',
    message,
    checked_at: new Date().toISOString()
  }))
  return buildAdminHealthReport(results, 'sub2api-admin-account-test-proxy')
}

function buildCredentialHealthReport(results, method, options = {}) {
  const browserDirectMe = /browser-direct-openai-me/i.test(firstString(method))
  return {
    type: 'local-account-health-result',
    generated_at: new Date().toISOString(),
    method,
    endpoint: browserDirectMe ? OPENAI_ME_ENDPOINT : undefined,
    target_model: browserDirectMe ? OPENAI_ME_ENDPOINT : HEALTH_REPLY_MODEL,
    ...(browserDirectMe ? {} : { model_aliases: HEALTH_REPLY_MODEL_ALIASES }),
    diagnostics: browserDirectMe ? buildBrowserHealthDiagnostics(results, options) : {},
    total: results.length,
    usable: results.filter((item) => item.usable).length,
    unusable: results.filter((item) => !item.usable && !isHealthTestFailed(item) && !isHealthUsageLimited(item)).length,
    usage_limited: results.filter(isHealthUsageLimited).length,
    refreshed: results.filter((item) => item.refreshed === true).length,
    failed: results.filter(isHealthTestFailed).length,
    rechecked: results.filter((item) => item.rechecked === true).length,
    recovered_by_recheck: results.filter((item) => item.recovered_by_recheck === true).length,
    results
  }
}

function buildBrowserHealthDiagnostics(results, options = {}) {
  const probeAttemptCounts = results.map((item) => countHealthProbeAttempts(item.probe)).map((value) => Number(value) || 0)
  const refreshAttemptCounts = results.map((item) => Number(item.refresh_attempts ?? item.refresh?.attempts?.length) || 0)
  return {
    endpoint: OPENAI_ME_ENDPOINT,
    browser_concurrency_start: HEALTH_BROWSER_TEST_CONCURRENCY,
    browser_concurrency_min: HEALTH_BROWSER_MIN_CONCURRENCY,
    browser_concurrency_max: HEALTH_BROWSER_MAX_CONCURRENCY,
    failed_recheck_concurrency: HEALTH_FAILED_RECHECK_CONCURRENCY,
    max_v1_me_attempts_per_pass: HEALTH_ME_PROBE_ATTEMPTS,
    max_refresh_attempts: HEALTH_REFRESH_ATTEMPTS,
    v1_me_timeout_seconds: Math.round(HEALTH_ME_REQUEST_TIMEOUT_MS / 1000),
    refresh_timeout_seconds: Math.round(HEALTH_REFRESH_REQUEST_TIMEOUT_MS / 1000),
    token_expiry_skew_seconds: Math.round(HEALTH_TOKEN_EXPIRY_SKEW_MS / 1000),
    total_probe_attempts: probeAttemptCounts.reduce((sum, count) => sum + count, 0),
    total_refresh_attempts: refreshAttemptCounts.reduce((sum, count) => sum + count, 0),
    recovered_by_retry: results.filter((item) => item.probe?.recovered_by_retry === true).length,
    rechecked: results.filter((item) => item.rechecked === true).length,
    recovered_by_recheck: results.filter((item) => item.recovered_by_recheck === true).length,
    token_expiring_soon: results.filter((item) => item.access_token_expires_soon === true).length,
    test_failed_not_unusable: results.filter(isHealthTestFailed).length,
    batch_history: Array.isArray(options.batchHistory) ? options.batchHistory : []
  }
}

function buildAdminHealthReport(results, method = 'sub2api-admin-account-test') {
  return {
    type: 'sub2api-admin-account-health-result',
    generated_at: new Date().toISOString(),
    method,
    endpoint: '/api/v1/admin/accounts/{id}/test',
    target_model: HEALTH_REPLY_MODEL,
    total: results.length,
    usable: results.filter((item) => item.usable).length,
    unusable: results.filter((item) => !item.usable && !isHealthTestFailed(item) && !isHealthUsageLimited(item)).length,
    usage_limited: results.filter(isHealthUsageLimited).length,
    refreshed: results.filter((item) => item.refreshed === true).length,
    failed: results.filter(isHealthTestFailed).length,
    results
  }
}

function normalizeAdminApiErrorMessage(message) {
  const text = firstString(message, '后台测试接口不可用')
  if (/Failed to fetch|NetworkError|Load failed/i.test(text)) {
    return '浏览器无法访问后台测试接口（跨域、网络不可达或未开放当前页面来源）'
  }
  if (/401|Unauthorized|unauthorized|未授权|未登录/i.test(text)) {
    return '后台未登录或当前登录态无权限'
  }
  if (/403|Forbidden|forbidden|禁止访问/i.test(text)) {
    return '后台拒绝访问当前账号测试接口'
  }
  return text
}

async function loadAdminAccounts() {
  const accounts = []
  const pageSize = 100
  const maxPages = 200
  for (let page = 1; page <= maxPages; page += 1) {
    const payload = await adminApiFetch(`/admin/accounts?page=${page}&page_size=${pageSize}`, { method: 'GET' })
    const rows = toAdminArray(payload)
    accounts.push(...rows)
    const total = getAdminTotal(payload)
    if (!rows.length || (total && accounts.length >= total) || rows.length < pageSize) break
  }
  return accounts
}

async function adminApiFetch(path, options = {}) {
  const bases = getAdminApiBases()
  const errors = []
  for (const base of bases) {
    try {
      const headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
      const authToken = firstString(localStorage.getItem('auth_token'))
      if (authToken) headers.Authorization = `Bearer ${authToken}`
      const response = await fetch(`${base}${path}`, {
        credentials: 'include',
        ...options,
        headers
      })
      const payload = await readBrowserPayload(response)
      if (!response.ok) {
        throw new Error(readBrowserMessage(payload, `${response.status} ${response.statusText}`))
      }
      return payload
    } catch (error) {
      errors.push(`${base}: ${error.message || error}`)
    }
  }
  throw new Error(errors[errors.length - 1] || errors[0] || '后台测试接口不可访问')
}

function getAdminApiBases() {
  const bases = []
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    bases.push(`${location.origin}/api/v1`)
  }
  bases.push(ADMIN_API_BASE)
  return [...new Set(bases.map((base) => base.replace(/\/+$/, '')))]
}

function normalizeAdminTestResult(payload) {
  const sse = normalizeAdminSseTestResult(payload)
  if (sse) return sse

  const data = unwrapAdminPayload(payload)
  const explicit = data && typeof data === 'object'
    ? (data.success ?? data.ok ?? data.passed ?? data.healthy ?? data.available)
    : undefined
  return {
    success: explicit === undefined ? true : Boolean(explicit),
    model: firstString(data?.model, data?.test_model, data?.request?.model),
    reply: firstString(data?.reply, data?.response, data?.content, data?.output_text),
    message: firstString(data?.message, data?.error, data?.reason, data?.status),
    data
  }
}

function normalizeAdminSseTestResult(payload) {
  const rawText = firstString(payload?.__rawText, typeof payload === 'string' ? payload : '')
  if (!rawText) return null

  const events = parseSseDataEvents(rawText)
  if (!events.length) {
    const text = rawText.slice(0, 300)
    return /error|not found|failed|unauthorized|forbidden/i.test(text)
      ? { success: false, model: HEALTH_REPLY_MODEL, reply: '', message: text, data: { raw: text } }
      : null
  }

  const errorEvent = events.find((event) => {
    const type = firstString(event?.type).toLowerCase()
    return type === 'error' || firstString(event?.error)
  })
  if (errorEvent) {
    return {
      success: false,
      model: firstString(errorEvent.model, HEALTH_REPLY_MODEL),
      reply: firstString(errorEvent.reply, errorEvent.content),
      message: firstString(errorEvent.error, errorEvent.message, '后台接口测试不可用'),
      data: errorEvent
    }
  }

  const completeEvent = [...events].reverse().find((event) => firstString(event?.type) === 'test_complete')
  if (completeEvent) {
    const explicit = completeEvent.success ?? completeEvent.ok ?? completeEvent.passed ?? completeEvent.healthy ?? completeEvent.available
    return {
      success: explicit === undefined ? true : Boolean(explicit),
      model: firstString(completeEvent.model, HEALTH_REPLY_MODEL),
      reply: firstString(completeEvent.reply, completeEvent.content, completeEvent.output_text),
      message: firstString(completeEvent.message, completeEvent.status, '后台接口测试完成'),
      data: completeEvent
    }
  }

  const lastEvent = events[events.length - 1]
  return {
    success: false,
    model: firstString(lastEvent?.model, HEALTH_REPLY_MODEL),
    reply: firstString(lastEvent?.reply, lastEvent?.content, lastEvent?.output_text),
    message: firstString(lastEvent?.message, lastEvent?.status, '后台测试流未返回完成事件'),
    data: lastEvent
  }
}

function parseSseDataEvents(text) {
  const events = []
  const dataLines = []
  const flush = () => {
    if (!dataLines.length) return
    const data = dataLines.join('\n').trim()
    dataLines.length = 0
    if (!data || data === '[DONE]') return
    try {
      events.push(JSON.parse(data))
    } catch {
      events.push({ type: 'message', message: data.slice(0, 300) })
    }
  }

  for (const line of String(text).split(/\r?\n/)) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
      continue
    }
    if (!line.trim()) flush()
  }
  flush()
  return events
}

function toAdminArray(payload) {
  const value = unwrapAdminPayload(payload)
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return []
  return value.items || value.records || value.list || value.accounts || value.data || []
}

function getAdminTotal(payload) {
  const value = unwrapAdminPayload(payload)
  if (!value || typeof value !== 'object') return 0
  return Number(value.total || value.count || value.total_count || 0) || 0
}

function unwrapAdminPayload(payload) {
  if (payload && typeof payload === 'object' && payload.code === 0 && 'data' in payload) return payload.data
  if (payload && typeof payload === 'object' && 'data' in payload && !Array.isArray(payload.data)) return payload.data
  return payload
}

function buildWantedAdminAccountKeys(accounts) {
  const keys = new Set()
  accounts.forEach((account) => {
    const credentials = objectOrEmpty(account.credentials)
    addAccountKey(keys, account.name)
    addAccountKey(keys, credentials.email)
    addAccountKey(keys, credentials.chatgpt_account_id)
  })
  return keys
}

function buildAdminAccountKeys(account) {
  const credentials = objectOrEmpty(account.credentials)
  const keys = new Set()
  addAccountKey(keys, account.name)
  addAccountKey(keys, account.email)
  addAccountKey(keys, credentials.email)
  addAccountKey(keys, credentials.chatgpt_account_id)
  return [...keys]
}

function addAccountKey(keys, value) {
  const text = firstString(value).toLowerCase()
  if (text) keys.add(text)
}

function getAdminAccountId(account) {
  return firstString(account?.id, account?._id, account?.account?.id)
}

function getAdminAccountName(account) {
  return firstString(account?.name, account?.email, account?.credentials?.email, account?.account_id, account?.id)
}

function getAdminAccountEmail(account) {
  return firstString(account?.email, account?.credentials?.email, validEmailFromText(account?.name))
}

function validEmailFromText(value) {
  const text = firstString(value)
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  return match?.[0] || ''
}

async function runServerHealthCheck(input) {
  const response = await fetch('/api/local-health', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ input })
  })

  const text = await response.text()
  let payload = null
  if (text.trim()) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = { message: text.slice(0, 300) }
    }
  }

  if (!response.ok || payload?.ok === false) {
    const message = payload?.message || `本地测活请求失败：HTTP ${response.status}`
    throw new Error(message.includes('资源不存在')
      ? '当前访问地址没有启用测活接口'
      : message)
  }

  const report = payload?.report || payload
  return formatHealthReport(report)
}

function formatHealthReport(report) {
  const results = Array.isArray(report?.results) ? report.results : []
  const usageLimited = Number(report?.usage_limited ?? report?.usageLimited ?? results.filter(isHealthUsageLimited).length) || 0
  const refreshed = Number(report?.refreshed ?? results.filter((item) => item.refreshed === true).length) || 0
  return {
    output: JSON.stringify(report, null, 2),
    report,
    meta: {
      count: Number(report?.total ?? results.length) || 0,
      usable: Number(report?.usable ?? results.filter((item) => item.usable).length) || 0,
      unusable: Number(report?.unusable ?? results.filter((item) => !item.usable && !isHealthTestFailed(item) && !isHealthUsageLimited(item)).length) || 0,
      usageLimited,
      refreshed,
      failed: Number(report?.failed ?? results.filter(isHealthTestFailed).length) || 0,
      rechecked: Number(report?.rechecked ?? results.filter((item) => item.rechecked === true).length) || 0,
      recoveredByRecheck: Number(report?.recovered_by_recheck ?? results.filter((item) => item.recovered_by_recheck === true).length) || 0,
      missingRefreshToken: results.filter((item) => !item.has_refresh_token).length,
      format: '本地测活结果',
      warnings: []
    }
  }
}

function canUseLocalHealthFallback() {
  const host = window.location.hostname.toLowerCase()
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]'
}

async function testBrowserAccount(account, context) {
  const credentials = objectOrEmpty(account.credentials)
  let accessToken = firstString(credentials.access_token, credentials.accessToken)
  const refreshToken = firstString(credentials.refresh_token, credentials.refreshToken)
  const clientId = firstString(credentials.client_id, credentials.clientId, account.client_id, CODEX_CLIENT_ID)
  const email = firstString(credentials.email, account.name)
  const accountId = firstString(credentials.chatgpt_account_id, credentials.account_id, account.account_id)
  const base = {
    source: context.source,
    index: context.index,
    name: firstString(account.name, email, accountId, `账号 ${context.index}`),
    email,
    account_id: accountId,
    has_access_token: Boolean(accessToken),
    has_refresh_token: Boolean(refreshToken),
    checked_at: new Date().toISOString()
  }

  const tokenState = inspectBrowserAccessToken(accessToken)
  if (tokenState.hasJwt) {
    base.access_token_expired = tokenState.expired
    base.access_token_expires_soon = tokenState.expiresSoon
    base.access_token_expires_in_seconds = tokenState.expiresInSeconds
    base.access_token_expires_at = tokenState.expiresAt
  }

  let initialRefreshResult = null
  if (!accessToken && refreshToken) {
    const refreshResult = await tryRefreshBrowserAccessToken(refreshToken, clientId)
    if (refreshResult.ok) {
      initialRefreshResult = refreshResult
      accessToken = refreshResult.accessToken
      base.has_access_token = true
    } else {
      return {
        ...base,
        usable: false,
        status: normalizeHealthFailureStatus(refreshResult.message, 'refresh_failed'),
        model: OPENAI_ME_ENDPOINT,
        reply: '',
        message: refreshResult.message || 'access_token 缺失，refresh_token 自动刷新失败',
        refreshed: false,
        refresh: refreshResult
      }
    }
  }

  if (!accessToken) {
    return {
      ...base,
      usable: false,
      status: 'missing_access_token',
      model: OPENAI_ME_ENDPOINT,
      reply: '',
      message: '缺少 access_token'
    }
  }

  const currentTokenState = inspectBrowserAccessToken(accessToken)
  if (currentTokenState.hasJwt && currentTokenState.needsRefresh) {
    if (refreshToken) {
      const refreshResult = await tryRefreshBrowserAccessToken(refreshToken, clientId)
      if (refreshResult.ok) {
        accessToken = refreshResult.accessToken
        base.has_access_token = true
        const refreshedProbe = await probeBrowserOpenAiMe(accessToken)
        const refreshReason = currentTokenState.expired ? '已过期' : '即将过期'
        if (refreshedProbe.ok) {
          return {
            ...base,
            usable: true,
            status: 'usable',
            model: OPENAI_ME_ENDPOINT,
            reply: refreshedProbe.reply,
            message: refreshedProbe.recovered_by_retry
              ? `本地 JWT ${refreshReason}，已用 refresh_token 刷新；${refreshedProbe.message}`
              : `本地 JWT ${refreshReason}，已用 refresh_token 刷新后 v1/me 认证通过`,
            refreshed: true,
            refreshed_at: new Date().toISOString(),
            refresh_attempts: Math.max(1, Number(refreshResult.attempts?.length) || 1),
            refresh_recovered_by_retry: refreshResult.recovered_by_retry === true,
            probe: refreshedProbe
          }
        }
        return {
          ...base,
          usable: false,
          status: normalizeHealthFailureStatus(refreshedProbe.message, 'unusable'),
          model: OPENAI_ME_ENDPOINT,
          reply: '',
          message: refreshedProbe.message || '自动刷新后 v1/me 认证仍失败',
          refreshed: true,
          refreshed_at: new Date().toISOString(),
          refresh_attempts: Math.max(1, Number(refreshResult.attempts?.length) || 1),
          refresh_recovered_by_retry: refreshResult.recovered_by_retry === true,
          probe: refreshedProbe
        }
      }
      return {
        ...base,
        usable: false,
        status: normalizeHealthFailureStatus(refreshResult.message, 'refresh_failed'),
        model: OPENAI_ME_ENDPOINT,
        reply: '',
        message: refreshResult.message || `本地 JWT ${currentTokenState.expired ? '已过期' : '即将过期'}，refresh_token 自动刷新失败`,
        refreshed: false,
        refresh: refreshResult
      }
    }

    if (!currentTokenState.expired) {
      base.access_token_expires_soon = true
      base.access_token_expires_in_seconds = currentTokenState.expiresInSeconds
    } else {
      return {
        ...base,
        usable: false,
        status: 'access_token_expired',
        model: OPENAI_ME_ENDPOINT,
        reply: '',
        message: `本地 JWT 已过期（${currentTokenState.expiresAt || 'exp 已过期'}），未发送网络测活请求`
      }
    }

  }

  const accessProbe = await probeBrowserOpenAiMe(accessToken)
  if (accessProbe.ok) {
    return {
      ...base,
      usable: true,
      status: 'usable',
      model: OPENAI_ME_ENDPOINT,
      reply: accessProbe.reply,
      message: initialRefreshResult
        ? `缺少 access_token，已用 refresh_token 刷新后 ${accessProbe.message || 'v1/me 认证通过'}`
        : (base.access_token_expires_soon
          ? `JWT 将在 ${base.access_token_expires_in_seconds} 秒内过期，当前 ${accessProbe.message || 'v1/me 认证通过'}`
          : (accessProbe.message || '浏览器直连 v1/me 认证通过')),
      refreshed: Boolean(initialRefreshResult),
      ...(initialRefreshResult ? {
        refreshed_at: new Date().toISOString(),
        refresh_attempts: Math.max(1, Number(initialRefreshResult.attempts?.length) || 1),
        refresh_recovered_by_retry: initialRefreshResult.recovered_by_retry === true
      } : {}),
      probe: accessProbe
    }
  }

  if (refreshToken && isRefreshableAuthError(accessProbe.message)) {
    const refreshResult = await tryRefreshBrowserAccessToken(refreshToken, clientId)
    if (refreshResult.ok) {
      const retryProbe = await probeBrowserOpenAiMe(refreshResult.accessToken)
      if (retryProbe.ok) {
        return {
          ...base,
          usable: true,
          status: 'usable',
          model: OPENAI_ME_ENDPOINT,
          reply: retryProbe.reply,
          message: retryProbe.recovered_by_retry
            ? `v1/me 返回认证失效，已用 refresh_token 自动刷新；${retryProbe.message}`
            : 'v1/me 返回认证失效，已用 refresh_token 自动刷新后认证通过',
          refreshed: true,
          refreshed_at: new Date().toISOString(),
          refresh_attempts: Math.max(1, Number(refreshResult.attempts?.length) || 1),
          refresh_recovered_by_retry: refreshResult.recovered_by_retry === true,
          probe: retryProbe
        }
      }

      return {
        ...base,
        usable: false,
        status: normalizeHealthFailureStatus(retryProbe.message, 'unusable'),
        model: OPENAI_ME_ENDPOINT,
        reply: '',
        message: retryProbe.message || '自动刷新后 v1/me 认证仍失败',
        refreshed: true,
        refreshed_at: new Date().toISOString(),
        refresh_attempts: Math.max(1, Number(refreshResult.attempts?.length) || 1),
        refresh_recovered_by_retry: refreshResult.recovered_by_retry === true,
        probe: retryProbe
      }
    }

    return {
      ...base,
      usable: false,
      status: normalizeHealthFailureStatus(refreshResult.message, 'refresh_failed'),
      model: OPENAI_ME_ENDPOINT,
      reply: '',
      message: refreshResult.message || 'v1/me 返回认证失效，refresh_token 自动刷新失败',
      refreshed: false,
      probe: accessProbe,
      refresh: refreshResult
    }
  }

  if (!refreshToken && isRefreshableAuthError(accessProbe.message)) {
    return {
      ...base,
      usable: false,
      status: 'refresh_required',
      model: OPENAI_ME_ENDPOINT,
      reply: '',
      message: 'v1/me 返回认证失效，缺少 refresh_token，无法自动刷新',
      probe: accessProbe
    }
  }

  return {
    ...base,
    usable: false,
    status: normalizeHealthFailureStatus(accessProbe.message, 'unusable'),
    model: OPENAI_ME_ENDPOINT,
    reply: '',
    message: accessProbe.message || 'v1/me 认证失败',
    refreshed: Boolean(initialRefreshResult),
    ...(initialRefreshResult ? {
      refreshed_at: new Date().toISOString(),
      refresh_attempts: Math.max(1, Number(initialRefreshResult.attempts?.length) || 1),
      refresh_recovered_by_retry: initialRefreshResult.recovered_by_retry === true
    } : {}),
    probe: accessProbe
  }
}

async function probeBrowserOpenAiMe(accessToken) {
  const attempts = []
  for (let attempt = 1; attempt <= HEALTH_ME_PROBE_ATTEMPTS; attempt += 1) {
    const result = await probeBrowserOpenAiMeOnce(accessToken, attempt)
    attempts.push(result)
    if (result.ok) {
      return {
        ...result,
        attempts,
        recovered_by_retry: attempt > 1,
        message: attempt > 1 ? `第 ${attempt} 次请求后 v1/me 认证通过` : result.message
      }
    }
    if (!isRetryableOpenAiMeProbe(result) || attempt >= HEALTH_ME_PROBE_ATTEMPTS) {
      return {
        ...result,
        attempts,
        message: isRetryableOpenAiMeProbe(result)
          ? `连续 ${attempts.length} 次浏览器直连 v1/me 失败，暂列测试失败，不判定账号不可用：${result.message}`
          : result.message
      }
    }
    await sleepBrowser(HEALTH_RETRY_BASE_DELAY_MS * attempt)
  }

  const last = attempts[attempts.length - 1] || {}
  return {
    ok: false,
    endpoint: OPENAI_ME_ENDPOINT,
    status: Number(last.status) || 0,
    model: OPENAI_ME_ENDPOINT,
    reply: '',
    retryable: true,
    attempts,
    message: '浏览器直连 v1/me 未完成，暂列测试失败'
  }
}

async function probeBrowserOpenAiMeOnce(accessToken, attempt = 1) {
  try {
    const response = await fetchWithBrowserTimeout(OPENAI_ME_ENDPOINT, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json'
      }
    }, HEALTH_ME_REQUEST_TIMEOUT_MS)
    const payload = await readBrowserPayload(response)
    const message = readBrowserMessage(payload, response.statusText)
    if (response.ok) {
      return {
        ok: true,
        endpoint: OPENAI_ME_ENDPOINT,
        status: response.status,
        model: OPENAI_ME_ENDPOINT,
        reply: summarizeOpenAiMePayload(payload),
        attempt,
        message: 'v1/me 认证通过',
        profile: sanitizeOpenAiMePayload(payload)
      }
    }
    return {
      ok: false,
      endpoint: OPENAI_ME_ENDPOINT,
      status: response.status,
      model: OPENAI_ME_ENDPOINT,
      reply: '',
      attempt,
      retryable: isRetryableHttpStatus(response.status) || isTransientHealthProbeMessage(message),
      message: message || `v1/me 请求失败：HTTP ${response.status}`
    }
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? `v1/me 请求超时（${HEALTH_ME_REQUEST_TIMEOUT_MS / 1000} 秒）`
      : `浏览器直连 v1/me 失败：${error.message || '请求失败'}`
    return {
      ok: false,
      endpoint: OPENAI_ME_ENDPOINT,
      status: 0,
      model: OPENAI_ME_ENDPOINT,
      reply: '',
      attempt,
      retryable: true,
      message
    }
  }
}

function isRetryableOpenAiMeProbe(result) {
  return result?.retryable === true || isRetryableHttpStatus(result?.status) || isTransientHealthProbeMessage(result?.message)
}

function isRetryableHttpStatus(status) {
  const code = Number(status)
  return code === 0 || code === 408 || code === 409 || code === 425 || code === 429 || code >= 500
}

function isTransientHealthProbeMessage(message) {
  return /连续 \d+ 次浏览器直连|Failed to fetch|NetworkError|Load failed|AbortError|abort|timeout|timed out|超时|CORS|ERR_|EOF|network|temporar|rate limit|too many requests|429|5\d\d/i.test(firstString(message))
}

function sleepBrowser(delayMs) {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs))
}

function inspectBrowserAccessToken(accessToken) {
  const claims = decodeBrowserJwtPayload(accessToken)
  const exp = Number(claims.exp)
  const hasJwt = Boolean(Object.keys(claims).length)
  const hasExp = Number.isFinite(exp) && exp > 0
  const expiresAt = hasExp ? new Date(exp * 1000).toISOString() : ''
  const expiresInMs = hasExp ? (exp * 1000) - Date.now() : 0
  const expired = hasExp ? expiresInMs <= 0 : false
  const expiresSoon = hasExp ? expiresInMs > 0 && expiresInMs <= HEALTH_TOKEN_EXPIRY_SKEW_MS : false
  return {
    hasJwt,
    hasExp,
    exp: hasExp ? exp : 0,
    expiresAt,
    expiresInSeconds: hasExp ? Math.max(0, Math.floor(expiresInMs / 1000)) : 0,
    expired,
    expiresSoon,
    needsRefresh: expired || expiresSoon
  }
}

function decodeBrowserJwtPayload(token) {
  const parts = firstString(token).split('.')
  if (parts.length < 2) return {}
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const binary = window.atob(padded)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return objectOrEmpty(JSON.parse(new TextDecoder().decode(bytes)))
  } catch {
    return {}
  }
}

function summarizeOpenAiMePayload(payload) {
  const text = firstString(
    payload?.email,
    payload?.user?.email,
    payload?.id,
    payload?.user?.id,
    payload?.object,
    '认证通过'
  )
  return text.slice(0, 160)
}

function sanitizeOpenAiMePayload(payload) {
  if (!payload || typeof payload !== 'object') return {}
  const allowed = {}
  ;['id', 'object', 'email', 'name'].forEach((key) => {
    const value = firstString(payload[key])
    if (value) allowed[key] = value.slice(0, 160)
  })
  const user = objectOrEmpty(payload.user)
  ;['id', 'email', 'name'].forEach((key) => {
    const value = firstString(user[key])
    if (value) allowed[`user_${key}`] = value.slice(0, 160)
  })
  return allowed
}

async function probeBrowserGpt55Reply(accessToken) {
  const errors = []
  for (const model of HEALTH_REPLY_MODEL_ALIASES) {
    for (const request of buildGpt55ProbeRequests(model)) {
      try {
        const response = await fetchWithBrowserTimeout(request.endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: JSON.stringify(request.body)
        })
        const payload = await readBrowserPayload(response)
        const reply = extractReplyText(payload)
        const message = readBrowserMessage(payload, response.statusText)
        if (response.ok && reply) {
          return {
            ok: true,
            endpoint: request.endpoint,
            status: response.status,
            model,
            reply,
            message: 'GPT5.5 已回复'
          }
        }
        errors.push({
          model,
          endpoint: request.endpoint,
          status: response.status,
          message: message || (reply ? '返回不完整' : '没有返回回复内容')
        })
      } catch (error) {
        errors.push({
          model,
          endpoint: request.endpoint,
          status: 0,
          message: error.message || '请求失败'
        })
      }
    }
  }

  const lastError = errors[errors.length - 1] || {}
  return {
    ok: false,
    endpoint: OPENAI_RESPONSES_ENDPOINT,
    status: lastError.status || 0,
    model: HEALTH_REPLY_MODEL,
    reply: '',
    message: lastError.message || 'GPT5.5 无法回复',
    errors
  }
}

async function tryRefreshBrowserAccessToken(refreshToken, clientId = CODEX_CLIENT_ID) {
  const attempts = []
  for (let attempt = 1; attempt <= HEALTH_REFRESH_ATTEMPTS; attempt += 1) {
    try {
      const payload = await refreshBrowserAccessToken(refreshToken, clientId)
      const accessToken = firstString(payload?.access_token, payload?.accessToken)
      attempts.push({
        attempt,
        status: 200,
        retryable: false,
        message: accessToken ? '刷新 access_token 成功' : 'token 接口未返回新的 access_token'
      })
      if (!accessToken) {
        return {
          ok: false,
          attempts,
          message: 'token 接口未返回新的 access_token'
        }
      }
      return {
        ok: true,
        accessToken,
        expires_in: payload?.expires_in,
        token_type: payload?.token_type,
        attempts,
        recovered_by_retry: attempt > 1
      }
    } catch (error) {
      const message = error.message || 'refresh_token 自动刷新失败'
      const status = Number(error.status) || 0
      const retryable = isRetryableHttpStatus(status) || isTransientHealthProbeMessage(message)
      attempts.push({
        attempt,
        status,
        retryable,
        message
      })
      if (!retryable || attempt >= HEALTH_REFRESH_ATTEMPTS) {
        return {
          ok: false,
          attempts,
          message: retryable
            ? `连续 ${attempts.length} 次刷新 access_token 失败，暂列刷新失败：${message}`
            : message
        }
      }
      await sleepBrowser(HEALTH_RETRY_BASE_DELAY_MS * attempt)
    }
  }
  return {
    ok: false,
    attempts,
    message: 'refresh_token 自动刷新未完成'
  }
}

async function refreshBrowserAccessToken(refreshToken, clientId = CODEX_CLIENT_ID) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: firstString(clientId, CODEX_CLIENT_ID),
    refresh_token: refreshToken
  })
  const response = await fetchWithBrowserTimeout(CODEX_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  }, HEALTH_REFRESH_REQUEST_TIMEOUT_MS)
  const payload = await readBrowserPayload(response)
  if (!response.ok) {
    const error = new Error(readBrowserMessage(payload, `HTTP ${response.status} ${response.statusText}`))
    error.status = response.status
    throw error
  }
  return payload
}

function buildGpt55ProbeRequests(model) {
  return [
    {
      endpoint: OPENAI_RESPONSES_ENDPOINT,
      body: {
        model,
        input: HEALTH_REPLY_PROMPT,
        max_output_tokens: 24
      }
    },
    {
      endpoint: OPENAI_CHAT_COMPLETIONS_ENDPOINT,
      body: {
        model,
        messages: [
          {
            role: 'user',
            content: HEALTH_REPLY_PROMPT
          }
        ],
        max_tokens: 24
      }
    }
  ]
}

async function fetchWithBrowserTimeout(url, options, timeoutMs = HEALTH_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    })
  } finally {
    window.clearTimeout(timer)
  }
}

function extractReplyText(payload) {
  const direct = firstString(payload?.output_text)
  if (direct) return direct.slice(0, 160)

  const output = Array.isArray(payload?.output) ? payload.output : []
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : []
    for (const part of content) {
      const text = firstString(part?.text, part?.output_text)
      if (text) return text.slice(0, 160)
    }
  }

  const choiceText = firstString(payload?.choices?.[0]?.message?.content, payload?.choices?.[0]?.text)
  return choiceText.slice(0, 160)
}

async function readBrowserPayload(response) {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return { __rawText: text, message: text.slice(0, 200) }
  }
}

function readBrowserMessage(payload, fallback = '') {
  return firstString(
    payload?.error_description,
    payload?.error?.message,
    payload?.detail,
    payload?.message,
    fallback
  )
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function updateStats(meta, status) {
  elements.statCount.textContent = String(meta.count ?? 0)
  elements.statMissingRefresh.textContent = String(meta.missingRefreshToken ?? 0)
  elements.statFormat.textContent = meta.format || currentOutputLabel()
  elements.statStatus.textContent = status
  elements.statFormat.title = meta.format || currentOutputLabel()
  elements.statStatus.title = status
}

async function readSelectedFile(event) {
  const file = event.target.files?.[0]
  if (!file) return
  await loadInputFile(file)
  event.target.value = ''
}

async function loadInputFile(file) {
  const text = await file.text()
  elements.sourceText.value = text
  elements.outputText.value = ''
  resetDownloadCursor()
  setLatestOutput('')
  state.latestHealthFilter = null
  if (readCodexCodeCallback(text)) {
    updateStats({ count: 1, missingRefreshToken: 0, format: currentOutputLabel(), warnings: [] }, '已识别 Codex 授权 code')
  } else {
    inspectCurrentInput(text)
  }
  await convertCurrent({
    successMessage: `已读取 ${file.name}，输出为 ${currentOutputLabel()}`
  })
}

async function readRepairFiles(event) {
  const files = Array.from(event.target.files || [])
  if (!files.length) return

  const documents = []
  const skipped = []
  for (const file of files) {
    try {
      documents.push({
        sourceName: file.name,
        value: JSON.parse(await file.text())
      })
    } catch (error) {
      skipped.push(`${file.name}：${error.message || 'JSON 解析失败'}`)
    }
  }

  state.repairDocuments = documents
  event.target.value = ''
  resetDownloadCursor()
  updateRepairStatus(skipped)

  if (state.target === 'repair' && elements.sourceText.value.trim()) {
    await convertCurrent({
      silent: true,
      successMessage: '二验 JSON 已读取并修正'
    })
  }
}

function clearRepairFiles() {
  state.repairDocuments = []
  elements.repairFileInput.value = ''
  elements.outputText.value = ''
  setLatestOutput('')
  resetDownloadCursor()
  updateRepairStatus()
  if (state.target === 'repair') {
    updateStats({ count: 0, missingRefreshToken: 0, format: currentOutputLabel(), warnings: [] }, '待上传二验 JSON')
  }
}

function updateRepairStatus(skipped = []) {
  if (!state.repairDocuments.length) {
    elements.repairStatus.textContent = skipped.length
      ? `未读取有效二验 JSON；${skipped.join('；')}`
      : '等待上传带 refresh_token 和旧 access_token 的 JSON。'
    elements.repairStatus.classList.toggle('is-error', skipped.length > 0)
    elements.repairStatus.classList.remove('is-ok')
    return
  }

  elements.repairStatus.textContent = skipped.length
    ? `已读取 ${state.repairDocuments.length} 个修正文件，跳过 ${skipped.length} 个。`
    : `已读取 ${state.repairDocuments.length} 个修正文件。`
  elements.repairStatus.classList.toggle('is-error', skipped.length > 0)
  elements.repairStatus.classList.toggle('is-ok', skipped.length === 0)
}

function refreshOutputPreview() {
  if (state.target === 'health') {
    elements.outputText.hidden = true
    elements.healthResult.hidden = false
    renderHealthReport(state.latestHealthReport)
    return
  }

  elements.outputText.hidden = false
  elements.healthResult.hidden = true
  if (!state.latestOutput.trim()) {
    elements.outputText.value = ''
    return
  }
  elements.outputText.value = state.latestOutput
}

function renderHealthReport(report) {
  if (!elements.healthResult) return
  const results = Array.isArray(report?.results) ? report.results : []
  if (!report || !results.length) {
    elements.healthResult.innerHTML = '<div class="health-table-wrap"><table class="health-table"><tbody><tr><td>测活结果会显示在这里</td></tr></tbody></table></div>'
    return
  }

  const usable = Number(report.usable ?? results.filter((item) => item.usable).length) || 0
  const failed = Number(report.failed ?? results.filter(isHealthTestFailed).length) || 0
  const usageLimited = Number(report.usage_limited ?? report.usageLimited ?? results.filter(isHealthUsageLimited).length) || 0
  const refreshed = Number(report.refreshed ?? results.filter((item) => item.refreshed === true).length) || 0
  const rechecked = Number(report.rechecked ?? results.filter((item) => item.rechecked === true).length) || 0
  const recoveredByRecheck = Number(report.recovered_by_recheck ?? results.filter((item) => item.recovered_by_recheck === true).length) || 0
  const unusable = Number(report.unusable ?? results.filter((item) => !item.usable && !isHealthTestFailed(item) && !isHealthUsageLimited(item)).length) || 0
  const total = Number(report.total ?? results.length) || 0
  const model = firstString(report.target_model, HEALTH_REPLY_MODEL)
  const progress = normalizeHealthProgress(report, total)
  const isAdminReport = isAdminHealthReport(report)
  const isOpenAiMeReport = isBrowserOpenAiMeReport(report)
  const usableLabel = isAdminReport ? '后台判定可用' : (isOpenAiMeReport ? 'OpenAI 认证通过' : 'GPT5.5 可回复')
  const unusableLabel = isAdminReport ? '不可用/未测出' : (isOpenAiMeReport ? '认证失败/不可用' : '不可用')
  const progressMarkup = progress ? `
    <div class="health-progress" aria-label="测活进度">
      <div class="health-progress__header">
        <strong>${progress.done ? '测活完成' : '正在测活'}</strong>
        <span>${progress.completed}/${progress.total} · ${progress.percent}%</span>
      </div>
      <div class="health-progress__bar"><span style="width: ${progress.percent}%"></span></div>
    </div>
  ` : ''
  const rows = results.map((item) => `
    <tr>
      <td>${escapeHtml(item.index || '')}</td>
      <td>${escapeHtml(firstString(item.name, item.email, item.account_id, `账号 ${item.index || ''}`))}</td>
      <td>${escapeHtml(firstString(item.email, '-'))}</td>
      <td><span class="health-badge ${getHealthBadgeClass(item)}">${escapeHtml(getHealthResultLabel(item))}</span></td>
      <td>${escapeHtml(firstString(item.model, model))}</td>
      <td>${escapeHtml(firstString(item.reply, '-'))}</td>
      <td>${escapeHtml(formatHealthMessage(item))}</td>
      <td>${escapeHtml(formatCheckedAt(item.checked_at))}</td>
    </tr>
  `).join('')

  elements.healthResult.innerHTML = `
    ${progressMarkup}
    <div class="health-summary">
      <div class="health-summary__card"><span>总数</span><strong>${total}</strong></div>
      <div class="health-summary__card"><span>${usableLabel}</span><strong>${usable}</strong></div>
      <div class="health-summary__card"><span>${unusableLabel}</span><strong>${unusable}</strong></div>
      ${usageLimited ? `<div class="health-summary__card"><span>额度用尽</span><strong>${usageLimited}</strong></div>` : ''}
      ${refreshed ? `<div class="health-summary__card"><span>自动刷新</span><strong>${refreshed}</strong></div>` : ''}
      ${rechecked ? `<div class="health-summary__card"><span>二次核验</span><strong>${rechecked}</strong></div>` : ''}
      ${recoveredByRecheck ? `<div class="health-summary__card"><span>复核找回</span><strong>${recoveredByRecheck}</strong></div>` : ''}
      ${failed ? `<div class="health-summary__card"><span>测试失败</span><strong>${failed}</strong></div>` : ''}
      <div class="health-summary__card"><span>测试模型</span><strong>${escapeHtml(model)}</strong></div>
    </div>
    <div class="health-table-wrap">
      <table class="health-table">
        <thead>
          <tr>
            <th>#</th>
            <th>账号</th>
            <th>邮箱</th>
            <th>结果</th>
            <th>模型</th>
            <th>回复</th>
            <th>说明</th>
            <th>时间</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `
}

function getHealthResultLabel(item) {
  if (isHealthPending(item)) return item?.status === 'testing' ? '测试中' : '等待'
  if (isHealthUsageLimited(item)) return '额度用尽'
  if (isHealthTestFailed(item)) return '测试失败'
  return item?.usable ? '可用' : '不可用'
}

function getHealthBadgeClass(item) {
  if (isHealthPending(item)) return 'is-warning'
  if (isHealthUsageLimited(item)) return 'is-warning'
  if (isHealthTestFailed(item)) return 'is-warning'
  return item?.usable ? 'is-ok' : 'is-error'
}

function isHealthPending(item) {
  return item?.status === 'pending' || item?.status === 'testing'
}

function isHealthUsageLimited(item) {
  return item?.status === 'usage_limited' || isUsageLimitMessage(item?.message) || isUsageLimitMessage(item?.probe?.message)
}

function isHealthTestFailed(item) {
  return item?.status === 'admin_test_failed' || item?.status === 'test_failed'
}

function normalizeHealthFailureStatus(message, fallback) {
  if (isUsageLimitMessage(message)) return 'usage_limited'
  if (isTransientHealthProbeMessage(message)) return 'test_failed'
  return fallback
}

function isRefreshableAuthError(message) {
  return /token has been invalidated|authentication token has been invalidated|invalidated oauth token|oauth token .*invalidated|invalid_token|expired token|token expired|unauthorized|401/i.test(firstString(message))
}

function isUsageLimitMessage(value) {
  return /usage limit (?:has been )?reached|usage_limit|insufficient_quota|quota exceeded|exceeded your current quota|额度已用尽|额度用完|用量已用尽|用量用完/i.test(firstString(value))
}

function normalizeHealthProgress(report, fallbackTotal) {
  const progress = report?.progress
  if (!progress) return null
  const total = Number(progress.total ?? fallbackTotal) || 0
  const completed = Math.min(Number(progress.completed ?? progress.current ?? 0) || 0, total)
  const percent = total ? Math.max(0, Math.min(100, Number(progress.percent ?? Math.round((completed / total) * 100)))) : 100
  return {
    total,
    completed,
    percent,
    done: progress.done === true
  }
}

function isAdminHealthReport(report) {
  return firstString(report?.method).startsWith('sub2api-admin-account-test')
}

function isBrowserOpenAiMeReport(report) {
  return /browser-direct-openai-me/i.test(firstString(report?.method))
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatCheckedAt(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString()
}

function formatHealthMessage(item) {
  if (isHealthPending(item)) {
    return item?.status === 'testing' ? '正在测试当前账号' : '等待前面的账号完成'
  }
  if (item?.recovered_by_recheck) {
    return `二次核验找回：${firstString(item?.message, '认证通过')}`
  }
  if (item?.status === 'refresh_failed') {
    return 'refresh_token 失效或刷新失败'
  }
  if (item?.status === 'refresh_required') {
    return '缺少 refresh_token，无法自动刷新'
  }
  const message = firstString(item?.message, item?.status, '-')
  if (/Incorrect API key|invalid_api_key|Unauthorized|401/i.test(message)) {
    return '凭证不可用或未授权'
  }
  if (/account not found|ACCOUNT_NOT_FOUND|账号不存在|账号已删除/i.test(message)) {
    return '后台账号不存在或已删除'
  }
  if (/model|not found|does not exist/i.test(message)) {
    return 'GPT5.5 模型不可用'
  }
  if (isUsageLimitMessage(message)) {
    return '额度已用尽'
  }
  if (/rate limit|429|quota/i.test(message)) {
    return '额度或频率受限'
  }
  if (/abort|timeout|timed out/i.test(message)) {
    return '请求超时'
  }
  return message.length > 120 ? `${message.slice(0, 120)}...` : message
}

function scheduleAutoConvert() {
  window.clearTimeout(inputTimer)
  const input = elements.sourceText.value.trim()
  if (!input) {
    elements.outputText.value = ''
    resetDownloadCursor()
    setLatestOutput('')
    state.latestHealthFilter = null
    updateStats({ count: 0, missingRefreshToken: 0, format: currentOutputLabel(), warnings: [] }, '待转换')
    return
  }
  syncDownloadScope(`${input}\n${getRepairSignature()}`)
  elements.outputText.value = ''
  state.latestHealthReport = null
  state.latestHealthFilter = null
  setLatestOutput('')
  refreshOutputPreview()
  inputTimer = window.setTimeout(() => {
    if (state.target === 'health') {
      try {
        const inspection = inspectHealthInput(input)
        updateStats({
          count: inspection.count,
          missingRefreshToken: inspection.missingRefreshToken,
          format: currentOutputLabel(),
          warnings: []
        }, inspection.status)
      } catch {
        elements.statStatus.textContent = '等待完整格式'
      }
      return
    }

    if (readCodexCodeCallback(input)) {
      void convertCurrent({ silent: false })
      return
    }

    try {
      inspectCurrentInput(input)
      void convertCurrent({ silent: true })
    } catch {
      elements.statStatus.textContent = '等待完整格式'
    }
  }, 650)
}

function checkCurrentFormat() {
  const input = elements.sourceText.value.trim()
  if (!input) {
    showToast('请先粘贴或上传内容')
    return
  }

  try {
    if (readCodexCodeCallback(input)) {
      updateStats({ count: 1, missingRefreshToken: 0, format: currentOutputLabel(), warnings: [] }, '已识别 Codex 授权 code')
      showToast('已识别授权 code，点击转换会先换取 RT')
      return
    }

    if (state.target === 'health') {
      const inspection = inspectHealthInput(input)
      showToast(`识别为 ${inspection.label}，当前输出 ${currentOutputLabel()}`)
      return
    }

    const inspection = inspectCurrentInput(input)
    showToast(`识别为 ${inspection.label}，当前输出 ${currentOutputLabel()}`)
  } catch (error) {
    elements.statStatus.textContent = '格式错误'
    showToast(error.message || '格式无法识别')
  }
}

async function startCodexLogin() {
  const pendingWindow = window.open('about:blank', '_blank')
  if (pendingWindow) {
    pendingWindow.opener = null
  }

  try {
    const authRequest = await buildCodexAuthRequest()
    state.codexAuth = authRequest
    elements.codexAuthUrl.value = authRequest.url
    elements.codexCodeVerifier.value = authRequest.codeVerifier
    openCodexLoginDialog()
    openExternalUrl(authRequest.url, pendingWindow)
  } catch (error) {
    if (pendingWindow && !pendingWindow.closed) {
      pendingWindow.close()
    }
    showToast(error.message || '授权链接生成失败')
  }
}

function openCodexLoginDialog() {
  elements.codexLoginDialog.classList.add('is-visible')
  elements.codexLoginDialog.setAttribute('aria-hidden', 'false')
}

function closeCodexLoginDialog() {
  elements.codexLoginDialog.classList.remove('is-visible')
  elements.codexLoginDialog.setAttribute('aria-hidden', 'true')
}

async function copyCodexAuthUrl() {
  if (!state.codexAuth.url) {
    showToast('请先生成授权链接')
    return
  }
  await navigator.clipboard.writeText(state.codexAuth.url)
  showToast('已复制授权链接')
}

function openCodexAuthUrl() {
  if (!state.codexAuth.url) {
    startCodexLogin()
    return
  }
  openExternalUrl(state.codexAuth.url)
}

function openExternalUrl(url, pendingWindow = null) {
  if (pendingWindow && !pendingWindow.closed) {
    pendingWindow.location.replace(url)
    showToast('已打开 Codex 授权页')
    return
  }

  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  if (!opened) {
    showToast('浏览器拦截了新标签，请复制授权链接手动打开')
    return
  }
  showToast('已打开 Codex 授权页')
}

async function buildCodexAuthRequest() {
  const codeVerifier = randomBase64Url(48)
  const codeChallenge = await buildCodeChallenge(codeVerifier)
  const oauthState = randomBase64Url(24)
  const url = new URL(CODEX_AUTH_ENDPOINT)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', CODEX_CLIENT_ID)
  url.searchParams.set('redirect_uri', CODEX_REDIRECT_URI)
  url.searchParams.set('scope', CODEX_SCOPE)
  url.searchParams.set('audience', CODEX_AUDIENCE)
  url.searchParams.set('state', oauthState)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('id_token_add_organizations', 'true')
  url.searchParams.set('codex_cli_simplified_flow', 'true')
  url.searchParams.set('originator', 'sub_cpa_converter')
  saveCodexPkce(oauthState, codeVerifier)

  return {
    url: url.toString(),
    codeVerifier,
    oauthState
  }
}

async function resolveCodexCodeCallbackInput(input) {
  const callback = readCodexCodeCallback(input)
  if (!callback) return input
  const cacheKey = `${callback.state}:${callback.code}`
  if (state.lastCodexCodeExchange.key === cacheKey && state.lastCodexCodeExchange.input) {
    return state.lastCodexCodeExchange.input
  }

  elements.statStatus.textContent = '正在换取 RT'
  const token = await exchangeCodexCode(callback)
  const expiresAt = Number.isFinite(Number(token.expires_in))
    ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString()
    : ''

  const conversionInput = JSON.stringify(pruneEmpty({
    type: 'codex',
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    id_token: token.id_token,
    expired: expiresAt,
    expires_at: expiresAt,
    token_type: token.token_type,
    scope: token.scope,
    client_id: CODEX_CLIENT_ID,
    session_source: 'codex_oauth_code'
  }))
  state.lastCodexCodeExchange = {
    key: cacheKey,
    input: conversionInput
  }
  return conversionInput
}

async function exchangeCodexCode(callback) {
  const codeVerifier = readCodexCodeVerifier(callback.state)
  if (!codeVerifier) {
    throw new Error('检测到授权 code，但找不到对应 code_verifier。请重新点击“登录 Codex”，授权后不要清空浏览器本地数据，再把新的回调链接粘贴回来。')
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CODEX_CLIENT_ID,
    code: callback.code,
    redirect_uri: CODEX_REDIRECT_URI,
    code_verifier: codeVerifier
  })

  let response
  try {
    response = await fetch(CODEX_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    })
  } catch {
    throw new Error('浏览器无法连接 Codex token 接口，可能被跨域或网络策略拦截。请重新点击“登录 Codex”后再试。')
  }

  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    const message = firstString(
      payload?.error_description,
      payload?.error?.message,
      payload?.message,
      payload?.error,
      response.statusText,
      '换取 RT 失败'
    )
    throw new Error(`Codex 授权 code 换 RT 失败：${message}`)
  }

  if (!payload?.refresh_token) {
    throw new Error('Codex token 接口没有返回 refresh_token，无法生成 RT 账号。请重新登录 Codex 再试。')
  }

  clearCodexPkce(callback.state)
  return payload
}

function readCodexCodeCallback(input) {
  const text = String(input ?? '').replace(/&amp;/g, '&').trim()
  const candidates = text.match(/https?:\/\/[^\s"'<>]+/g) || [text]

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate)
      const code = firstString(url.searchParams.get('code'), url.hash ? new URLSearchParams(url.hash.replace(/^#/, '')).get('code') : '')
      const oauthState = firstString(url.searchParams.get('state'), url.hash ? new URLSearchParams(url.hash.replace(/^#/, '')).get('state') : '')
      const error = firstString(url.searchParams.get('error'), url.hash ? new URLSearchParams(url.hash.replace(/^#/, '')).get('error') : '')
      if (error || !code || !oauthState) continue
      return {
        code,
        state: oauthState
      }
    } catch {
      // 不是 URL 就交给原有解析逻辑处理。
    }
  }

  return null
}

function saveCodexPkce(oauthState, codeVerifier) {
  try {
    localStorage.setItem(`${CODEX_PKCE_STORAGE_PREFIX}${oauthState}`, JSON.stringify({
      codeVerifier,
      createdAt: Date.now()
    }))
  } catch {
    // localStorage 不可用时仍保留内存态，当前页面不刷新即可继续换 RT。
  }
}

function readCodexCodeVerifier(oauthState) {
  const currentState = getCurrentCodexOauthState()
  if (oauthState && oauthState === currentState && state.codexAuth.codeVerifier) {
    return state.codexAuth.codeVerifier
  }

  try {
    const raw = localStorage.getItem(`${CODEX_PKCE_STORAGE_PREFIX}${oauthState}`)
    if (!raw) return ''
    const payload = JSON.parse(raw)
    return firstString(payload?.codeVerifier)
  } catch {
    return ''
  }
}

function clearCodexPkce(oauthState) {
  try {
    localStorage.removeItem(`${CODEX_PKCE_STORAGE_PREFIX}${oauthState}`)
  } catch {
    // 清理失败不影响转换结果。
  }
}

function getCurrentCodexOauthState() {
  try {
    return new URL(state.codexAuth.url).searchParams.get('state') || state.codexAuth.oauthState
  } catch {
    return state.codexAuth.oauthState
  }
}

function firstString(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue
    if (typeof value === 'object') continue
    const text = String(value).trim()
    if (text) return text
  }
  return ''
}

function pruneEmpty(source) {
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== '' && value !== null && value !== undefined)
  )
}

async function buildCodeChallenge(codeVerifier) {
  const bytes = utf8Bytes(codeVerifier)
  if (!globalThis.crypto?.subtle) {
    return base64UrlFromBytes(sha256Bytes(bytes))
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return base64UrlFromBytes(new Uint8Array(digest))
}

function randomBase64Url(byteLength) {
  const bytes = new Uint8Array(byteLength)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  return base64UrlFromBytes(bytes)
}

function base64UrlFromBytes(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function sha256Bytes(inputBytes) {
  const initialHash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ])
  const constants = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ])
  const bitLength = inputBytes.length * 8
  const paddedLength = Math.ceil((inputBytes.length + 9) / 64) * 64
  const padded = new Uint8Array(paddedLength)
  padded.set(inputBytes)
  padded[inputBytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(paddedLength - 4, bitLength, false)

  const hash = new Uint32Array(initialHash)
  const words = new Uint32Array(64)
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false)
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotateRight(words[index - 15], 7) ^ rotateRight(words[index - 15], 18) ^ (words[index - 15] >>> 3)
      const s1 = rotateRight(words[index - 2], 17) ^ rotateRight(words[index - 2], 19) ^ (words[index - 2] >>> 10)
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0
    }

    let [a, b, c, d, e, f, g, h] = hash
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + s1 + ch + constants[index] + words[index]) >>> 0
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (s0 + maj) >>> 0
      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }

    hash[0] = (hash[0] + a) >>> 0
    hash[1] = (hash[1] + b) >>> 0
    hash[2] = (hash[2] + c) >>> 0
    hash[3] = (hash[3] + d) >>> 0
    hash[4] = (hash[4] + e) >>> 0
    hash[5] = (hash[5] + f) >>> 0
    hash[6] = (hash[6] + g) >>> 0
    hash[7] = (hash[7] + h) >>> 0
  }

  const output = new Uint8Array(32)
  const outputView = new DataView(output.buffer)
  hash.forEach((part, index) => outputView.setUint32(index * 4, part, false))
  return output
}

function rotateRight(value, bits) {
  return (value >>> bits) | (value << (32 - bits))
}

function utf8Bytes(value) {
  return new TextEncoder().encode(value)
}

function inspectCurrentInput(text) {
  const orderInspection = inspectOrderNumberConversionInput(text)
  if (orderInspection) {
    updateStats({
      count: orderInspection.count,
      missingRefreshToken: orderInspection.missingRefreshToken,
      format: currentOutputLabel(),
      warnings: []
    }, `已识别 ${orderInspection.label}`)
    return orderInspection
  }

  const inspection = inspectInputFormat(text)
  updateStats({
    count: inspection.count,
    missingRefreshToken: inspection.missingRefreshToken,
    format: currentOutputLabel(),
    warnings: []
  }, `已识别 ${inspection.label}`)
  return inspection
}

function inspectOrderNumberConversionInput(text) {
  if (state.target !== 'sub' && state.target !== 'cpa') return null
  const orderNos = extractLdxpOrderNos(text)
  if (!orderNos.length) return null
  return {
    kind: 'order',
    label: 'LDXP 订单号（仅自营订单可转）',
    count: orderNos.length,
    missingRefreshToken: 0
  }
}

function inspectHealthInput(text) {
  const orderNos = extractLdxpOrderNos(text)
  if (orderNos.length) {
    return {
      count: orderNos.length,
      missingRefreshToken: 0,
      label: 'LDXP 订单号',
      status: `待按订单号查询并测活 ${orderNos.length} 个订单（仅自营订单可读取卡密）`
    }
  }

  const adminIds = extractAdminAccountIds(text)
  if (adminIds.length) {
    return {
      count: adminIds.length,
      missingRefreshToken: 0,
      label: 'Sub2API 后台账号 ID',
      status: `待测活后台账号 ${adminIds.length} 个`
    }
  }

  const inspection = inspectInputFormat(text)
  return {
    ...inspection,
    status: '待测活 GPT5.5'
  }
}

function extractLdxpOrderNos(input) {
  const ids = new Set()
  for (const match of String(input ?? '').toUpperCase().matchAll(LDXP_ORDER_NO_PATTERN)) {
    ids.add(match[0])
  }
  return [...ids]
}

function handleDragEnter(event) {
  event.preventDefault()
  dragDepth += 1
  showDropOverlay()
}

function handleDragOver(event) {
  event.preventDefault()
  event.dataTransfer.dropEffect = 'copy'
  showDropOverlay()
}

function handleDragLeave(event) {
  event.preventDefault()
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) {
    hideDropOverlay()
  }
}

async function handleDrop(event) {
  event.preventDefault()
  dragDepth = 0
  hideDropOverlay()
  const file = event.dataTransfer.files?.[0]
  if (!file) {
    showToast('没有检测到文件')
    return
  }
  try {
    await loadInputFile(file)
  } catch (error) {
    elements.statStatus.textContent = '格式错误'
    showToast(error.message || '格式无法识别')
  }
}

function showDropOverlay() {
  elements.dropZone.classList.add('is-dragging')
  elements.dropOverlay.classList.add('is-visible')
}

function hideDropOverlay() {
  elements.dropZone.classList.remove('is-dragging')
  elements.dropOverlay.classList.remove('is-visible')
}

function downloadOutput() {
  if (!state.latestOutput.trim()) {
    showToast('没有可下载的输出')
    return
  }
  if (state.target === 'repair') {
    downloadBlob(new Blob([state.latestOutput], { type: 'application/json' }), 'second-verify-fixed.json')
    showToast('已下载二验修正 JSON')
    return
  }
  if (state.target === 'health') {
    const csv = buildHealthCsv(state.latestHealthReport)
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'gpt5.5-health-result.csv')
    showToast('已下载本地测活结果')
    return
  }
  openDownloadDialog()
}

function openDownloadDialog() {
  const count = getCurrentOutputCount()
  const remaining = Math.max(0, count - state.downloadCursor)
  elements.downloadLimit.value = ''
  elements.downloadLimit.max = String(remaining || count)
  elements.downloadLimit.placeholder = state.downloadCursor > 0 ? `剩余 ${remaining} 条` : `全部 ${count} 条`
  elements.downloadHint.textContent = state.target === 'sub'
    ? buildDownloadHint(count, remaining, '确认后下载一个 Sub2API JSON 文件。')
    : buildDownloadHint(count, remaining, '确认后下载 ZIP，每个账号一个 CPA JSON 文件。')
  elements.downloadDialog.classList.add('is-visible')
  elements.downloadDialog.setAttribute('aria-hidden', 'false')
  window.setTimeout(() => elements.downloadLimit.focus(), 0)
}

function closeDownloadDialog() {
  elements.downloadDialog.classList.remove('is-visible')
  elements.downloadDialog.setAttribute('aria-hidden', 'true')
}

function confirmDownload(event) {
  event.preventDefault()
  const count = getCurrentOutputCount()
  if (count <= 0) {
    showToast('没有可下载的输出')
    return
  }

  if (state.target === 'repair') {
    downloadBlob(new Blob([state.latestOutput], { type: 'application/json' }), 'second-verify-fixed.json')
    closeDownloadDialog()
    showToast('已下载二验修正 JSON')
    return
  }

  if (state.downloadCursor >= count) {
    state.downloadCursor = 0
  }

  const requestedLimit = getDownloadLimit()
  const remaining = count - state.downloadCursor
  const limit = requestedLimit ? Math.min(requestedLimit, remaining) : remaining
  if (state.target === 'sub') {
    const payload = JSON.parse(state.latestOutput)
    const limited = sliceSubPayload(payload, state.downloadCursor, limit)
    const text = JSON.stringify(limited, null, 2)
    downloadBlob(new Blob([text], { type: 'application/json' }), 'sub2api-import.json')
    advanceDownloadCursor(limit, count)
    closeDownloadDialog()
    showDownloadToast(limit, count)
    return
  }

  const records = parseCpaOutputRecords(state.latestOutput)
  const zipBytes = buildCpaZip(records, limit, state.downloadCursor)
  downloadBlob(new Blob([zipBytes], { type: 'application/zip' }), 'cpa-accounts.zip')
  advanceDownloadCursor(limit, count)
  closeDownloadDialog()
  showDownloadToast(limit, count)
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function buildHealthCsv(report) {
  const rows = Array.isArray(report?.results) ? report.results : []
  const header = [
    '序号',
    '账号',
    '邮箱',
    '结果',
    '状态码',
    '模型/端点',
    '回复',
    '说明',
    'JWT到期时间',
    'JWT剩余秒',
    'JWT即将过期',
    '已自动刷新',
    '刷新尝试',
    'v1/me尝试',
    '二次核验',
    '复核找回',
    '首次失败状态',
    '首次失败说明',
    '时间'
  ]
  const lines = [header]
  rows.forEach((item) => {
    lines.push([
      item.index || '',
      firstString(item.name, item.email, item.account_id),
      firstString(item.email),
      getHealthResultLabel(item),
      firstString(item.status),
      firstString(item.model, report?.target_model, HEALTH_REPLY_MODEL),
      firstString(item.reply),
      formatHealthMessage(item),
      firstString(item.access_token_expires_at),
      item.access_token_expires_in_seconds ?? '',
      item.access_token_expires_soon ? '是' : '否',
      item.refreshed ? '是' : '否',
      firstString(item.refresh_attempts, item.refresh?.attempts?.length),
      countHealthProbeAttempts(item.probe),
      item.rechecked ? '是' : '否',
      item.recovered_by_recheck ? '是' : '否',
      firstString(item.first_pass_status),
      firstString(item.first_pass_message),
      firstString(item.checked_at)
    ])
  })
  return `${lines.map((line) => line.map(csvCell).join(',')).join('\n')}\n`
}

function countHealthProbeAttempts(probe) {
  return Array.isArray(probe?.attempts) ? probe.attempts.length : firstString(probe?.attempt)
}

function csvCell(value) {
  const text = String(value ?? '')
  return `"${text.replace(/"/g, '""')}"`
}

function getDownloadLimit() {
  const value = Number(elements.downloadLimit.value)
  if (!Number.isFinite(value) || value <= 0) {
    return 0
  }
  return Math.floor(value)
}

function getCurrentOutputCount() {
  if (!state.latestOutput.trim()) return 0
  if (state.target === 'repair') {
    return 1
  }
  if (state.target === 'health') {
    return Array.isArray(state.latestHealthReport?.results) ? state.latestHealthReport.results.length : 0
  }
  if (state.target === 'sub') {
    return (JSON.parse(state.latestOutput).accounts || []).length
  }
  return parseCpaOutputRecords(state.latestOutput).length
}

function parseCpaOutputRecords(output) {
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
}

function setLatestOutput(output) {
  state.latestOutput = String(output || '')
}

function resetDownloadCursor() {
  state.downloadCursor = 0
  state.outputSignature = ''
}

function syncDownloadScope(input) {
  const nextSignature = `${state.target}\n${String(input || '').trim()}`
  if (nextSignature === state.outputSignature) return
  state.outputSignature = nextSignature
  state.downloadCursor = 0
}

function getRepairSignature() {
  return state.repairDocuments
    .map((documentItem) => `${documentItem.sourceName}:${JSON.stringify(documentItem.value).length}`)
    .join('|')
}

function buildDownloadHint(count, remaining, suffix) {
  if (state.downloadCursor > 0 && remaining > 0) {
    return `当前共 ${count} 条，已下载 ${state.downloadCursor} 条，本次从第 ${state.downloadCursor + 1} 条开始；${suffix}`
  }
  if (state.downloadCursor >= count && count > 0) {
    return `当前共 ${count} 条，上一轮已下载完；本次将从第 1 条重新开始。`
  }
  return `当前共 ${count} 条；${suffix}`
}

function advanceDownloadCursor(downloadedCount, totalCount) {
  state.downloadCursor += downloadedCount
  if (state.downloadCursor > totalCount) {
    state.downloadCursor = totalCount
  }
}

function showDownloadToast(downloadedCount, totalCount) {
  const nextStart = state.downloadCursor + 1
  if (state.downloadCursor >= totalCount) {
    showToast(`已下载 ${downloadedCount} 条，当前内容已全部下载`)
    return
  }
  showToast(`已下载 ${downloadedCount} 条，下次从第 ${nextStart} 条开始`)
}

function pasteDemo() {
  state.latestHealthFilter = null
  if (state.target === 'repair') {
    const accessToken = buildDemoJwt({ exp: Math.floor(Date.now() / 1000) + 86400, email: 'repair@example.com' })
    elements.sourceText.value = JSON.stringify({
      user: {
        id: 'repair-account',
        email: 'repair@example.com',
        name: 'repair@example.com'
      },
      expires: new Date(Date.now() + 86400_000).toISOString(),
      accessToken
    }, null, 2)
    state.repairDocuments = [{
      sourceName: 'repair-demo.json',
      value: {
        type: 'codex',
        email: 'repair@example.com',
        account_id: 'repair-account',
        access_token: 'old-access-token',
        refresh_token: 'keep-refresh-token',
        nested: { keep: true }
      }
    }]
    updateRepairStatus()
  } else if (state.target === 'health') {
    elements.sourceText.value = JSON.stringify({
      items: [
        { id: 101, name: '后台账号 A' },
        { id: 102, name: '后台账号 B' },
        { id: 103, name: '后台账号 C' }
      ]
    }, null, 2)
  } else if (state.target === 'sub') {
    elements.sourceText.value = JSON.stringify({
      type: 'codex',
      account_id: 'demo-account',
      email: 'demo@example.com',
      name: 'demo@example.com',
      plan_type: 'plus',
      access_token: buildDemoJwt({ exp: Math.floor(Date.now() / 1000) + 86400, email: 'demo@example.com' }),
      refresh_token: 'demo-refresh-token',
      id_token: buildDemoJwt({
        email: 'demo@example.com',
        'https://api.openai.com/auth': {
          chatgpt_account_id: 'demo-account',
          chatgpt_user_id: 'demo-user',
          chatgpt_plan_type: 'plus'
        }
      }),
      last_refresh: new Date().toISOString()
    }, null, 2)
  } else {
    elements.sourceText.value = JSON.stringify({
      user: {
        id: 'demo-web-user',
        email: 'web-demo@example.com',
        name: 'web-demo@example.com'
      },
      expires: new Date(Date.now() + 86400_000).toISOString(),
      accessToken: buildDemoJwt({ exp: Math.floor(Date.now() / 1000) + 86400, email: 'web-demo@example.com' })
    }, null, 2)
  }
  inspectCurrentInput(elements.sourceText.value)
  convertCurrent({ successMessage: '示例已自动转换' })
}

function buildDemoJwt(payload) {
  const encode = (value) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.demo`
}

function currentOutputLabel() {
  if (state.target === 'repair') return '二验 JSON 修正'
  if (state.target === 'health') return '本地测活结果'
  return state.target === 'sub' ? 'Sub2API' : 'CPA JSONL'
}

function showToast(message) {
  elements.toast.textContent = message
  elements.toast.classList.add('is-visible')
  window.clearTimeout(showToast.timer)
  showToast.timer = window.setTimeout(() => {
    elements.toast.classList.remove('is-visible')
  }, 2200)
}

export {
  buildCredentialHealthReport,
  containsSensitiveCredentialInput,
  inspectBrowserAccessToken,
  isRetryableHttpStatus,
  isTransientHealthProbeMessage,
  normalizeHealthFailureStatus,
  probeBrowserOpenAiMe,
  testBrowserAccount,
  tryRefreshBrowserAccessToken
}
