// Outbound HTTP for user-supplied URLs, with SSRF protection.
// Every hop is validated twice: the URL itself (scheme, port, literal IPs) and
// the address the socket actually connects to (guarded DNS lookup), so a
// hostname that resolves to a private address is refused at connect time.
import dns from 'node:dns'
import net from 'node:net'
import { Agent, fetch as undiciFetch } from 'undici'

export class BlockedUrlError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BlockedUrlError'
  }
}

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0
}

const blockedV4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 3],
].map(([base, bits]) => [ipv4ToInt(base), bits])

function isBlockedV4(ip) {
  const value = ipv4ToInt(ip)
  return blockedV4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
    return (value & mask) === (base & mask)
  })
}

function expandV6(ip) {
  let address = ip.toLowerCase().split('%')[0]
  const lastColon = address.lastIndexOf(':')
  const tail = address.slice(lastColon + 1)
  if (tail.includes('.')) {
    const value = ipv4ToInt(tail)
    address = `${address.slice(0, lastColon + 1)}${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`
  }
  const [head, rest] = address.split('::')
  const headParts = head ? head.split(':') : []
  const restParts = rest !== undefined && rest !== '' ? rest.split(':') : []
  const missing = rest === undefined ? 0 : 8 - headParts.length - restParts.length
  return [...headParts, ...Array(Math.max(0, missing)).fill('0'), ...restParts].map((part) => parseInt(part || '0', 16))
}

function isBlockedV6(ip) {
  const groups = expandV6(ip)
  if (groups.length !== 8 || groups.some((group) => Number.isNaN(group))) return true
  if (groups.every((group) => group === 0)) return true // ::
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true // ::1
  const embeddedV4 = `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`
  if (groups.slice(0, 5).every((group) => group === 0) && (groups[5] === 0xffff || groups[5] === 0)) return isBlockedV4(embeddedV4) // v4-mapped / v4-compatible
  if (groups[0] === 0x64 && groups[1] === 0xff9b) return isBlockedV4(embeddedV4) // NAT64
  if ((groups[0] & 0xfe00) === 0xfc00) return true // unique local fc00::/7
  if ((groups[0] & 0xffc0) === 0xfe80) return true // link-local fe80::/10
  if ((groups[0] & 0xff00) === 0xff00) return true // multicast
  if (groups[0] === 0x2001 && groups[1] === 0xdb8) return true // documentation
  return false
}

export function isBlockedIp(ip) {
  const family = net.isIP(ip)
  if (family === 4) return isBlockedV4(ip)
  if (family === 6) return isBlockedV6(ip)
  return true
}

const blockedHostSuffixes = ['.localhost', '.local', '.internal', '.intranet', '.lan', '.home', '.corp', '.test', '.invalid', '.example']

export function normalizeUrl(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

export function assertPublicUrl(value) {
  let url
  try {
    url = new URL(normalizeUrl(value))
  } catch {
    throw new BlockedUrlError('Enter a valid website URL.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BlockedUrlError('Only http and https URLs are supported.')
  if (url.username || url.password) throw new BlockedUrlError('URLs with embedded credentials are not supported.')
  if (url.port && !['80', '443'].includes(url.port)) throw new BlockedUrlError('Only standard web ports are supported.')
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new BlockedUrlError('This address is not publicly reachable.')
    return url
  }
  if (!host.includes('.') || host === 'localhost' || blockedHostSuffixes.some((suffix) => host.endsWith(suffix))) {
    throw new BlockedUrlError('Enter a public website URL.')
  }
  return url
}

export function guardedLookup(hostname, options, callback) {
  const cb = typeof options === 'function' ? options : callback
  const opts = typeof options === 'function' ? {} : options || {}
  dns.lookup(hostname, { ...opts, all: true }, (error, addresses) => {
    if (error) return cb(error)
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: net.isIP(addresses) }]
    if (!list.length || list.some((entry) => isBlockedIp(entry.address))) {
      return cb(new BlockedUrlError('This host resolves to a non-public address.'))
    }
    if (opts.all) return cb(null, list)
    cb(null, list[0].address, list[0].family)
  })
}

let sharedAgent
function defaultAgent() {
  sharedAgent ||= new Agent({ connect: { lookup: guardedLookup, timeout: 8000 }, headersTimeout: 15000, bodyTimeout: 15000 })
  return sharedAgent
}

async function readLimited(response, maxBytes) {
  if (!response.body) return { text: '', bytes: 0, truncated: false }
  const reader = response.body.getReader()
  const chunks = []
  let bytes = 0
  let truncated = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > maxBytes) {
      chunks.push(value.subarray(0, value.byteLength - (bytes - maxBytes)))
      truncated = true
      await reader.cancel().catch(() => {})
      break
    }
    chunks.push(value)
  }
  return { text: Buffer.concat(chunks).toString('utf8'), bytes: Math.min(bytes, maxBytes), truncated }
}

export const DEFAULT_UA = 'Mozilla/5.0 (compatible; GEOOptimizerAI/2.0; +https://geo-optimizer-ai.sasmaz.digital)'

// createSafeFetch({ fetchImpl }) lets tests swap the network layer; URL validation still applies.
export function createSafeFetch({ fetchImpl } = {}) {
  const doFetch = fetchImpl || ((url, init) => undiciFetch(url, { ...init, dispatcher: defaultAgent() }))
  return async function safeFetch(target, { headers = {}, timeoutMs = 10000, maxBytes = 1_500_000, maxRedirects = 5, method = 'GET' } = {}) {
    const started = Date.now()
    const redirects = []
    let current = assertPublicUrl(target)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      for (let hop = 0; hop <= maxRedirects; hop += 1) {
        const response = await doFetch(current.href, {
          method,
          redirect: 'manual',
          signal: controller.signal,
          headers: { 'User-Agent': DEFAULT_UA, Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8', ...headers },
        })
        const location = response.headers.get('location')
        if (response.status >= 300 && response.status < 400 && location) {
          await response.body?.cancel?.().catch(() => {})
          const next = assertPublicUrl(new URL(location, current).href)
          redirects.push({ from: current.href, to: next.href, status: response.status })
          current = next
          continue
        }
        const body = method === 'HEAD' ? { text: '', bytes: 0, truncated: false } : await readLimited(response, maxBytes)
        return {
          ok: response.status >= 200 && response.status < 300,
          status: response.status,
          url: current.href,
          redirects,
          headers: Object.fromEntries(response.headers.entries()),
          contentType: response.headers.get('content-type') || '',
          ms: Date.now() - started,
          ...body,
        }
      }
      throw new Error('Too many redirects')
    } catch (error) {
      if (error instanceof BlockedUrlError) throw error
      if (error?.cause instanceof BlockedUrlError) throw error.cause
      const reason = error.name === 'AbortError' ? 'Request timed out' : (error.cause?.code || error.cause?.message || error.message || 'Request failed')
      return { ok: false, status: 0, url: current.href, redirects, headers: {}, contentType: '', ms: Date.now() - started, text: '', bytes: 0, truncated: false, error: String(reason) }
    } finally {
      clearTimeout(timer)
    }
  }
}
