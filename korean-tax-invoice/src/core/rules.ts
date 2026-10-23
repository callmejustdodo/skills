/**
 * 프로바이더와 무관한 한국 전자세금계산서 규칙.
 *
 * 어느 ASP 를 쓰든 똑같이 적용되는 것들이다 — 사업자등록번호 체계, 과세기간을
 * 가르는 작성일자, 부가세 계산.
 */

/**
 * 사업자등록번호 체크섬 검증 (국세청 표준 알고리즘).
 *
 * ASP 서버도 검증하지만 그 전에 걸러야 한다. 잘못된 번호로 발행을 시도했다는
 * 기록 자체를 남기지 않는 게 낫고, 오타를 사람에게 즉시 알릴 수 있다.
 *
 * 판독(OCR·LLM)으로 얻은 번호에 특히 유용하다. 상호는 오독해도 알 길이
 * 없지만 사업자등록번호는 체크섬이 있어 대부분 걸린다.
 */
export function isValidBusinessNumber(value: string): boolean {
  const digits = value.replace(/[^0-9]/g, '')
  if (digits.length !== 10) return false

  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5]
  let sum = 0
  for (let i = 0; i < 9; i += 1) {
    sum += Number(digits[i]) * weights[i]!
  }
  sum += Math.floor((Number(digits[8]) * 5) / 10)

  const check = (10 - (sum % 10)) % 10
  return check === Number(digits[9])
}

/** 하이픈을 뗀 10자리. */
export function normalizeBusinessNumber(value: string): string {
  return value.replace(/[^0-9]/g, '')
}

/** 000-00-00000 형태로. 사람에게 보여줄 때 쓴다. */
export function formatBusinessNumber(value: string): string {
  const d = normalizeBusinessNumber(value)
  if (d.length !== 10) return value
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`
}

const KST_TIMEZONE = 'Asia/Seoul'

/**
 * 작성일자를 YYYY-MM-DD 로 만든다. 항상 한국 시간 기준이다.
 *
 * 로컬 시간대(getFullYear 등)를 쓰면 서버가 어디서 도는지에 따라 날짜가
 * 하루 밀린다. Vercel·GitHub Actions·대부분의 클라우드가 UTC 라, KST
 * 9월 30일 00:00 이 UTC 로는 9월 29일 15:00 이어서 하루 이른 작성일자가 찍힌다.
 *
 * 세금계산서 작성일자는 과세기간을 가르는 값이다. 월말 발행분이 전월로
 * 넘어가면 부가세 신고가 어긋난다. 실제로 CI(UTC)에서 이 버그를 겪었다.
 */
export function formatKstDate(date: Date): string {
  // en-CA 로케일이 YYYY-MM-DD 를 그대로 돌려준다.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: KST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/** 부가가치세율 10%. */
export const VAT_RATE = 0.1

/**
 * 과세 유형에 따른 세액.
 *
 * 영세율과 면세는 세액이 0 이다. 둘의 차이는 매입세액 공제 여부인데,
 * 발행 시점에는 똑같이 0 을 쓴다.
 */
export function calculateTax(supplyCost: number, taxType: string = 'TAXABLE'): number {
  if (taxType !== 'TAXABLE') return 0
  return Math.round(supplyCost * VAT_RATE)
}

/**
 * 품목 하나의 세액 — 프로바이더에 실제로 보내는 값.
 *
 * 면세는 세액 칸 자체가 없어서 null 이다(볼타는 0 을 거절한다). 확인 화면도
 * 이 함수로 계산해야 사람이 본 금액과 실제로 나가는 금액이 같다. 화면만 따로
 * 10% 로 계산하면 영세율·면세 계산서가 세액이 붙은 채로 보이고, 사람은 틀린
 * 금액을 보고 승인하게 된다.
 */
export function itemTax(
  item: { supplyCost: number; tax?: number },
  taxType: string = 'TAXABLE',
): number | null {
  if (taxType === 'TAX_FREE') return null
  return item.tax ?? calculateTax(item.supplyCost, taxType)
}

/** 공급가액·세액·합계. 확인 화면에 보여줄 값이다. */
export function invoiceTotals(
  items: { supplyCost: number; tax?: number }[],
  taxType: string = 'TAXABLE',
): { supplyCost: number; tax: number; total: number } {
  const supplyCost = items.reduce((sum, it) => sum + it.supplyCost, 0)
  const tax = items.reduce((sum, it) => sum + (itemTax(it, taxType) ?? 0), 0)
  return { supplyCost, tax, total: supplyCost + tax }
}

/**
 * 멱등성 키를 만든다.
 *
 * 같은 청구 건을 재시도할 때 **같은 값**이 나와야 프로바이더가 중복을
 * 막아준다. 재시도마다 새로 만들면 멱등성이 아예 동작하지 않는다.
 *
 * 그래서 시각이나 난수를 섞지 않는다 — 발행 대상의 고유 id 만 쓴다.
 *
 * 재료가 비면 던진다. 그대로 두면 "kti-undefined" 같은 값이 나오고, 서로 다른
 * 청구 건이 같은 관리번호를 나눠 쓰게 된다.
 *
 * 쓸 수 있는 문자도 제한한다. 관리번호는 HTTP 헤더로 나가는데, 한글처럼 헤더에
 * 못 싣는 문자가 있으면 요청이 나가기도 전에 실패한다. 그 실패는 "응답을 못
 * 받음"으로 분류돼 재요청 금지가 뜨고, 조회하면 "접수 안 됨"이 나와 끝없이 돈다.
 */
export function buildClientReferenceId(prefix: string, invoiceId: string | number): string {
  const id = typeof invoiceId === 'number' && Number.isFinite(invoiceId) ? String(invoiceId) : invoiceId
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error(
      '관리번호를 만들 청구 건 식별자(invoiceId)가 없습니다. 재시도 때 같은 관리번호를 써야 중복 발행이 막히므로 필수입니다.',
    )
  }
  if (typeof prefix !== 'string' || !prefix.trim()) {
    throw new Error('관리번호 접두어(referencePrefix)가 비어 있습니다.')
  }
  const ref = `${prefix}-${id}`
  if (!REFERENCE_ID_PATTERN.test(ref)) {
    throw new Error(
      `관리번호에는 영문·숫자와 . _ : - 만 쓸 수 있습니다 (${ref}). 요청 헤더로 나가는 값이라 한글이나 공백이 있으면 요청 자체가 실패합니다.`,
    )
  }
  return ref
}

/** 관리번호에 쓸 수 있는 문자. 헤더에 안전하게 실리는 것만 허용한다. */
const REFERENCE_ID_PATTERN = /^[A-Za-z0-9._:-]+$/
