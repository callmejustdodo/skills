#!/usr/bin/env node
/**
 * 발행 완료된 세금계산서 PDF 를 내려받는다. 포인트를 쓰지 않는다.
 *
 *   node scripts/download-pdf.mjs <issuanceKey> [--out <폴더>]
 *
 * 볼타는 5분짜리 다운로드 주소를 준다. 주소를 그대로 넘기면 금방 죽으니
 * 파일로 받아 둔다. 처음 조회하면 볼타가 PDF 를 만들기 시작하고, 준비될
 * 때까지 Retry-After 만큼 기다렸다 다시 묻는다.
 *
 * 테스트 키는 이 계산서가 아니라 볼타의 샘플 PDF 를 준다.
 *
 * 저장하면 마지막 줄에 "저장: <경로>" 를 찍는다. 자동화는 이 줄을 읽는다.
 */

import './load-env.mjs'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

// dist 가 없으면 import 가 ERR_MODULE_NOT_FOUND 로 죽는다. 스킬로 설치한
// 직후 가장 먼저 밟는 지뢰라, 스택 트레이스 대신 할 일을 알려준다.
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
if (!existsSync(join(root, 'dist'))) {
  console.error('빌드가 필요합니다:\n')
  console.error('  npm install && npm run build\n')
  console.error('(스크립트가 dist/ 를 사용합니다. 최초 1회만 하면 됩니다.)')
  process.exit(1)
}

const { BoltaProvider } = await import('../dist/providers/bolta/index.js')
const { ProviderRejectedError } = await import('../dist/core/types.js')

/** 준비를 기다리는 최대 시간. 볼타는 보통 몇 초 안에 만든다. */
const MAX_WAIT_MS = 120_000

const args = process.argv.slice(2)
const outAt = args.indexOf('--out')
const key = args.find((a, i) => !a.startsWith('--') && !(outAt >= 0 && i === outAt + 1))
const unknownFlags = args.filter((a) => a.startsWith('--') && a !== '--out')

if (!key || unknownFlags.length > 0 || (outAt >= 0 && !args[outAt + 1])) {
  if (unknownFlags.length > 0) console.error(`알 수 없는 옵션: ${unknownFlags.join(', ')}`)
  console.error('사용법: node scripts/download-pdf.mjs <issuanceKey> [--out <폴더>]')
  process.exit(1)
}

const outDir = resolve(outAt >= 0 ? args[outAt + 1] : '.')

/**
 * 볼타 파일 이름에는 거래처 상호가 들어간다. 경로 구분자나 제어 문자가
 * 섞이면 엉뚱한 위치에 써질 수 있어 걸러낸다.
 */
function safeName(filename) {
  const base = (filename ?? '').replace(/[/\\\x00-\x1f]/g, '_').replace(/^\.+/, '').trim()
  const name = base || `${key}.pdf`
  return name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`
}

async function main() {
  const provider = new BoltaProvider()
  const started = Date.now()

  let pdf = await provider.getPdf(key)
  while (pdf.status === 'PENDING') {
    const waitMs = Math.min(pdf.retryAfterSeconds, 30) * 1000
    if (Date.now() - started + waitMs > MAX_WAIT_MS) {
      console.error('PDF 가 아직 준비되지 않았습니다. 잠시 뒤 다시 실행하세요.')
      process.exit(1)
    }
    console.log(`PDF 를 만드는 중입니다. ${waitMs / 1000}초 뒤 다시 확인합니다.`)
    await new Promise((r) => setTimeout(r, waitMs))
    pdf = await provider.getPdf(key)
  }

  const res = await fetch(pdf.downloadUrl, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`PDF 다운로드 실패 (HTTP ${res.status})`)
  const bytes = Buffer.from(await res.arrayBuffer())
  // 만료 안내 같은 엉뚱한 응답을 .pdf 로 저장하지 않는다.
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error('받은 파일이 PDF 가 아닙니다.')
  }

  mkdirSync(outDir, { recursive: true })
  const path = join(outDir, safeName(pdf.filename))
  writeFileSync(path, bytes)

  console.log(`issuanceKey: ${key}`)
  if (provider.isTestKey()) {
    console.log('※ 테스트 키라 볼타의 샘플 PDF 입니다. 이 계산서의 내용이 아닙니다.')
  }
  console.log(`저장: ${path}`)
}

main().catch((e) => {
  if (e instanceof ProviderRejectedError) {
    console.error(`PDF 를 받을 수 없습니다 (HTTP ${e.status}${e.code ? `, ${e.code}` : ''}): ${e.message}`)
    if (e.status === 400) {
      console.error('발행 완료된 건만 PDF 가 있습니다. 상태를 먼저 확인하세요:')
      console.error(`  node scripts/check-status.mjs ${key}`)
    }
    process.exit(1)
  }
  console.error('실패:', e.message)
  process.exit(1)
})
