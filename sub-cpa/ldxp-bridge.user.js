// ==UserScript==
// @name         Sub CPA LDXP Merchant-Token 自动桥接
// @namespace    sub-cpa-converter
// @version      1.0.0
// @description  自动把 pay.ldxp.cn 已登录浏览器里的 Merchant-Token 写入本机 sub-cpa-converter 服务
// @match        https://pay.ldxp.cn/*
// @run-at       document-idle
// @grant        none
// @connect      127.0.0.1
// @connect      localhost
// ==/UserScript==

(function () {
  'use strict'

  const BRIDGE_ENDPOINT = "http://127.0.0.1:5178/api/ldxp-token"
  const TOKEN_KEY_PATTERN = /merchant|token|auth/i
  const TOKEN_VALUE_PATTERN = /^[A-Za-z0-9._-]{16,1024}$/
  let lastSentToken = ''

  function firstString(...values) {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    return ''
  }

  function decodeValue(value) {
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }

  function normalizeTokenValue(value) {
    const text = firstString(value)
    if (!text) return ''
    if (TOKEN_VALUE_PATTERN.test(text)) return text
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object') {
        const nested = firstString(
          parsed.value,
          parsed.merchantToken,
          parsed.merchant_token,
          parsed.token,
          parsed.authToken,
          parsed.auth_token
        )
        if (TOKEN_VALUE_PATTERN.test(nested)) return nested
      }
    } catch {
      // 忽略非 JSON 存储值。
    }
    return ''
  }

  function redact(value) {
    const text = firstString(value)
    return text.length > 12 ? text.slice(0, 6) + '...' + text.slice(-4) : '[已隐藏]'
  }

  function collectCandidates(storeName, store) {
    const rows = []
    if (!store) return rows
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index)
      const value = normalizeTokenValue(store.getItem(key))
      if (!TOKEN_KEY_PATTERN.test(key || '') || !value) continue
      rows.push({ storeName, key, value })
    }
    return rows
  }

  function collectCookieCandidates() {
    return String(document.cookie || '')
      .split(';')
      .map((row) => row.trim())
      .filter(Boolean)
      .map((row) => {
        const index = row.indexOf('=')
        const key = index >= 0 ? row.slice(0, index).trim() : row
        const rawValue = index >= 0 ? row.slice(index + 1) : ''
        return { storeName: 'cookie', key, value: normalizeTokenValue(decodeValue(rawValue)) }
      })
      .filter((row) => TOKEN_KEY_PATTERN.test(row.key || '') && row.value)
  }

  function scoreCandidate(candidate) {
    const key = String(candidate.key || '')
    let score = 0
    if (/merchant[-_]?token/i.test(key)) score += 100
    if (/merchant/i.test(key)) score += 60
    if (/^token$/i.test(key)) score += 40
    if (/auth[-_]?token/i.test(key)) score += 30
    if (/^[0-9a-f-]{32,40}$/i.test(candidate.value)) score += 15
    if (candidate.storeName === 'localStorage') score += 5
    return score
  }

  function pickMerchantToken() {
    const candidates = [
      ...collectCandidates('localStorage', window.localStorage),
      ...collectCandidates('sessionStorage', window.sessionStorage),
      ...collectCookieCandidates()
    ].sort((left, right) => scoreCandidate(right) - scoreCandidate(left))
    return candidates[0] || null
  }

  async function bridgeMerchantToken(reason) {
    const candidate = pickMerchantToken()
    if (!candidate) {
      console.warn('[sub-cpa] 未找到疑似 LDXP Merchant-Token，确认当前 pay.ldxp.cn 页面已经登录后刷新。')
      return
    }
    if (candidate.value === lastSentToken && reason === 'poll') return

    try {
      const response = await fetch(BRIDGE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: candidate.value,
          source: 'ldxp-auto-bridge-userscript',
          store: candidate.storeName,
          key: candidate.key,
          reason
        })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload.ok === false) {
        console.warn('[sub-cpa] LDXP 登录态自动桥接失败：', payload.message || response.status)
        return
      }
      lastSentToken = candidate.value
      console.info('[sub-cpa] LDXP Merchant-Token 已自动桥接到本机服务：', {
        store: candidate.storeName,
        key: candidate.key,
        token: redact(candidate.value)
      })
    } catch (error) {
      console.warn('[sub-cpa] 无法连接本机 sub-cpa-converter 服务，请确认 5178 页面已启动：', error && error.message ? error.message : error)
    }
  }

  bridgeMerchantToken('load')
  window.addEventListener('storage', () => bridgeMerchantToken('storage'))
  window.setInterval(() => bridgeMerchantToken('poll'), 15000)
})()
