#!/usr/bin/env node
/**
 * 세금계산서 발행. 실제로 나간다.
 *
 * Claude 가 이 스크립트를 돌리기 전에 반드시 사용자에게 내용을 보여주고
 * 확인받아야 한다 — 발행은 되돌릴 수 없다.
 *
 *   node scripts/issue.mjs <요청파일.json>
 *   node scripts/issue.mjs <요청파일.json> --confirm    실제 발행
 *
 * --confirm 없이 돌리면 검증만 하고 무엇을 보낼지 보여준다. 이게 기본값인
 * 이유는 명확하다: 실수로 실행됐을 때 아무 일도 일어나지 않아야 한다.
 *
 * 요청 파일 형식은 examples/request.json 을 보라.
 *
 * 종료 코드 — 자동화가 이걸로 다음 행동을 정한다
 * ----------------------------------------------
 *   0  검증 통과(검증만 한 경우) 또는 접수 완료
 *   1  접수하지 않았다. 고쳐서 다시 실행해도 안전하다
 *   2  접수 여부를 모른다. 다시 실행하지 말고 관리번호로 조회한다
 *   3  이 관리번호로 이미 접수된 건이 있다. 다시 보내지 않는다
 */

import './load-env.mjs'
import { readFileSync } from 'node:fs'

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// dist 가 없으면 import 가 ERR_MODULE_NOT_FOUND 로 죽는다. 스킬로 설치한
// 직후 가장 먼저 밟는 지뢰라, 스택 트레이스 대신 할 일을 알려준다.
// ESM 정적 import 는 코드 실행 전에 해석되므로 동적 import 를 쓴다.
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
if (!existsSync(join(root, 'dist'))) {
  console.error('빌드가 필요합니다:\n')
  console.error('  npm install && npm run build\n')
  console.error('(스크립트가 dist/ 를 사용합니다. 최초 1회만 하면 됩니다.)')
  process.exit(1)
}

const { validateIssueRequest, formatIssues } = await import('../dist/core/validate.js')
const {
  buildClientReferenceId,
  formatBusinessNumber,
  formatKstDate,
  invoiceTotals,
} = await import('../dist/core/rules.js')
const { BoltaProvider, findIssuer } = await import('../dist/providers/bolta/index.js')
const { ProviderRejectedError, ProviderUncertainError } = await import('../dist/core/types.js')

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))
const CONFIRM = args.includes('--confirm')
// --confrim 같은 오타가 조용히 검증만 하고 0 으로 끝나면, 종료 코드만 보는
// 자동화는 발행된 줄 안다.
const unknownFlags = args.filter((a) => a.startsWith('--') && a !== '--confirm')

if (!file || unknownFlags.length > 0) {
  if (unknownFlags.length > 0) console.error(`알 수 없는 옵션: ${unknownFlags.join(', ')}`)
  console.error('사용법: node scripts/issue.mjs <요청파일.json> [--confirm]')
  process.exit(1)
}

function money(n) {
  return n.toLocaleString('ko-KR')
}

const TAX_TYPE = { TAXABLE: '과세 (10%)', ZERO_RATE: '영세율 (0%)', TAX_FREE: '면세 (세액 없음)' }
const PURPOSE = { CLAIM: '청구', RECEIPT: '영수' }

async function main() {
  const raw = JSON.parse(readFileSync(file, 'utf8'))

  // writeDate 는 JSON 에서 문자열로 온다.
  //
  // 생략하면 오늘(KST)로 채운다. 예제 파일에 고정 날짜를 박아두면 시간이
  // 지나 미래 날짜가 되고, 볼타가 "작성일자는 현재 날짜와 같거나 이전이어야
  // 합니다" 로 거절한다 — 예제가 문서의 경고를 그대로 위반하게 된다.
  const request = {
    ...raw,
    writeDate: raw.writeDate ? new Date(raw.writeDate) : new Date(),
    items: (raw.items ?? []).map((it) => ({
      ...it,
      ...(it.date ? { date: new Date(it.date) } : {}),
    })),
  }

  // 1) 검증 — 프로바이더를 부르기 전에 우리가 먼저 막는다.
  //
  // verified 는 명시적으로 true 여야 통과한다. 빠뜨린 요청 파일이 "확인됨"으로
  // 지나가면 사람 확인 단계가 있으나 마나다.
  const check = validateIssueRequest(request, { verified: raw.verified === true })
  const issues = check.ok ? [] : [...check.issues]

  // 관리번호(멱등성 키)를 먼저 만든다. invoiceId 가 없으면 여기서 막는다 —
  // 그대로 두면 모든 요청이 "kti-undefined" 를 나눠 쓴다.
  let refId
  try {
    refId = buildClientReferenceId(raw.referencePrefix ?? 'kti', raw.invoiceId)
  } catch (e) {
    issues.push({ reason: 'invalid_reference_id', message: e.message })
  }

  if (issues.length > 0) {
    console.log('발행할 수 없습니다:\n')
    console.log(formatIssues(issues))
    if (raw.verified !== true) {
      console.log('\n거래처 정보를 사람이 확인했다면 요청 파일에 "verified": true 를 넣으세요.')
    }
    console.log('\n위 항목을 채운 뒤 다시 실행하세요.')
    process.exit(1)
  }

  // 세액은 볼타에 보내는 값과 같은 함수로 계산한다. 화면만 10% 로 따로 계산하면
  // 영세율·면세 계산서가 세액이 붙은 채로 보이고, 사람은 그 금액을 보고 승인한다.
  const taxType = request.taxType ?? 'TAXABLE'
  const { supplyCost, tax, total } = invoiceTotals(request.items, taxType)

  console.log('=== 발행 내용 ===\n')
  console.log(`  공급자     ${request.supplier.organizationName} (${formatBusinessNumber(request.supplier.identificationNumber)})`)
  console.log(`  공급받는자 ${request.buyer.organizationName} (${formatBusinessNumber(request.buyer.identificationNumber)})`)
  console.log(`  대표자     ${request.buyer.representativeName}`)
  console.log(`  받는사람   ${request.buyer.contacts.map((c) => c.email).join(', ')}`)
  // 화면에도 KST 로 보여준다. toISOString() 을 쓰면 UTC 라 하루 밀려 보이고,
  // 실제로 보내는 값(볼타 페이로드)과 화면이 어긋난다.
  console.log(`  작성일자   ${formatKstDate(request.writeDate)}`)
  console.log(`  구분       ${PURPOSE[request.purpose ?? 'CLAIM'] ?? request.purpose}`)
  console.log(`  과세유형   ${TAX_TYPE[taxType] ?? taxType}`)
  console.log(`  관리번호   ${refId}`)
  console.log()
  for (const it of request.items) {
    console.log(`  · ${it.name}  ${money(it.supplyCost)}원`)
  }
  console.log()
  console.log(`  공급가액   ${money(supplyCost)}원`)
  console.log(`  세액       ${money(tax)}원`)
  console.log(`  합계       ${money(total)}원`)

  // 키가 없어도 검증 결과는 끝까지 보여준다. 여기서 BoltaProvider 를 먼저
  // 만들면 생성자가 던져서 "환경" 줄도 못 찍고 중간에 잘린 것처럼 보인다.
  const key = process.env.BOLTA_API_KEY
  const env = !key
    ? '키 없음 — 발행할 수 없습니다'
    : key.startsWith('test_')
      ? '테스트 (가상)'
      : '라이브 — 실제 국세청 발행'
  console.log(`\n  환경       ${env}`)

  if (!CONFIRM) {
    console.log('\n검증만 했습니다. 실제로 발행하려면 --confirm 을 붙이세요.')
    if (!key) {
      console.log('발행하려면 BOLTA_API_KEY 가 필요합니다.')
    }
    return
  }

  const provider = new BoltaProvider()

  // 발급자로 등록되지 않은 공급자로는 발행이 안 된다. 예제 파일의 공급자를
  // 그대로 두는 실수가 흔해서, 접수 전에 볼타의 발급자 목록과 대조한다.
  // 이 조회가 실패하면 main 의 catch 로 빠진다 — 아직 접수 전이라 종료 코드 1 이 맞다.
  const issuers = await provider.listIssuers()
  if (!findIssuer(issuers, request.supplier.identificationNumber)) {
    const known = issuers.map(
      (it) => `${it.organizationName} (${formatBusinessNumber(it.identificationNumber)})`,
    )
    console.log('\n발행할 수 없습니다:\n')
    console.log(
      `• 공급자 ${request.supplier.organizationName} (${formatBusinessNumber(request.supplier.identificationNumber)}) 는 볼타에 등록된 발급자가 아닙니다.`,
    )
    console.log(`  등록된 발급자: ${known.join(', ') || '없음'}`)
    console.log('\n접수하지 않았습니다. 공급자를 고친 뒤 다시 실행하세요.')
    process.exit(1)
  }

  try {
    const result = await provider.submit(request, refId)
    console.log(`\n접수 완료: ${result.issuanceKey}`)
    console.log('\n※ "접수"이지 "발행 완료"가 아닙니다.')
    console.log('   결과는 웹훅으로 오거나, 상태 조회로 확인할 수 있습니다:')
    console.log(`   node scripts/check-status.mjs ${result.issuanceKey}`)
  } catch (e) {
    if (e instanceof ProviderRejectedError) {
      // 거절이 곧 "접수 안 됨"은 아니다. 같은 관리번호가 이미 접수됐는데 내용이
      // 달라지면(내용을 고쳤거나, 작성일자가 바뀐 다음 날 재실행) 볼타는 400 으로
      // 거절한다. 그걸 "고쳐서 다시"로 읽으면 invoiceId 를 바꿔 두 번째 계산서를
      // 내게 된다. 그래서 관리번호로 한 번 더 확인한다.
      let prior
      try {
        prior = await provider.getStatusByReferenceId(refId)
      } catch {
        uncertain(`거절 응답(HTTP ${e.status})을 받았지만 이 관리번호의 접수 여부를 확인하지 못했습니다.`, refId)
      }
      if (prior.status === 'FAILED') {
        // 볼타가 요청 기록은 남겼지만 접수 단계에서 실패해 발행하지 않은 경우(예: 포인트 부족 402).
        console.error(`\n거절됨 (HTTP ${e.status}): ${e.message}`)
        console.error('  접수 단계에서 실패해 발행되지 않았습니다.')
        console.error('  볼타는 같은 관리번호를 다시 받지 않습니다. 원인을 고친 뒤 새 invoiceId 로 요청하세요.')
        process.exit(1)
      }
      if (prior.status !== 'UNKNOWN') {
        console.error(`\n이 관리번호로 이미 접수된 건이 있습니다: ${refId}`)
        console.error(`  상태 ${prior.status}${prior.issuanceKey ? `, issuanceKey ${prior.issuanceKey}` : ''}`)
        console.error(`  볼타 응답 (HTTP ${e.status}): ${e.message}`)
        console.error('\n  ⚠️  다시 보내지 마세요. invoiceId 를 바꿔 보내면 두 번째 계산서가 나갑니다.')
        console.error('  내용을 바로잡아야 하면 SKILL.md 의 "잘못 발행했을 때"(수정세금계산서)를 따르세요.')
        process.exit(3)
      }
      console.error(`\n거절됨 (HTTP ${e.status}): ${e.message}`)
      console.error('  접수되지 않았으므로 내용을 고쳐 다시 시도할 수 있습니다.')
      process.exit(1)
    }
    // 불확실 오류뿐 아니라 예상하지 못한 오류도 여기서 "모름"으로 다룬다. 요청을
    // 보낸 뒤일 수 있는 자리라, "다시 해도 된다"(종료 코드 1)로 새면 안 된다.
    uncertain(
      e instanceof ProviderUncertainError ? e.message : `예상하지 못한 오류: ${e?.message ?? e}`,
      refId,
    )
  }
}

// 여기가 중복 발행이 나는 자리다.
function uncertain(message, refId) {
  console.error('\n접수 여부를 알 수 없습니다.')
  console.error(`  ${message}`)
  console.error('\n  ⚠️  다시 실행하지 마세요. 같은 계산서가 두 장 발행될 수 있습니다.')
  console.error('  관리번호로 조회해서 접수됐는지 먼저 확인하세요:')
  console.error(`  node scripts/check-status.mjs --ref ${refId}`)
  process.exit(2)
}

main().catch((e) => {
  console.error('실패:', e.message)
  process.exit(1)
})
