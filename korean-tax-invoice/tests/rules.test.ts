import { describe, expect, it } from 'vitest'
import {
  isValidBusinessNumber,
  normalizeBusinessNumber,
  formatBusinessNumber,
  formatKstDate,
  calculateTax,
  itemTax,
  invoiceTotals,
  buildClientReferenceId,
} from '../src/core/rules.js'

describe('isValidBusinessNumber', () => {
  it('실제 사업자등록번호를 통과시킨다', () => {
    expect(isValidBusinessNumber('2431302906')).toBe(true)
    expect(isValidBusinessNumber('243-13-02906')).toBe(true)
  })

  it('체크섬이 틀리면 거절한다', () => {
    // 마지막 자리만 바꿨다. 판독 오류나 오타가 이렇게 들어온다.
    expect(isValidBusinessNumber('2431302907')).toBe(false)
  })

  it('자릿수가 다르면 거절한다', () => {
    expect(isValidBusinessNumber('243130290')).toBe(false)
    expect(isValidBusinessNumber('24313029061')).toBe(false)
    expect(isValidBusinessNumber('')).toBe(false)
  })

  it('숫자가 아닌 문자는 무시하고 판정한다', () => {
    expect(isValidBusinessNumber('243 13 02906')).toBe(true)
  })
})

describe('사업자등록번호 형식', () => {
  it('하이픈을 뗀다', () => {
    expect(normalizeBusinessNumber('243-13-02906')).toBe('2431302906')
  })

  it('사람이 읽을 형태로 만든다', () => {
    expect(formatBusinessNumber('2431302906')).toBe('243-13-02906')
  })

  it('10자리가 아니면 원본을 그대로 돌려준다', () => {
    expect(formatBusinessNumber('123')).toBe('123')
  })
})

describe('formatKstDate', () => {
  it('한국 시간 기준으로 날짜를 만든다', () => {
    // KST 2026-09-30 00:00 = UTC 2026-09-29 15:00
    // 로컬 시간대를 쓰면 UTC 서버에서 09-29 가 나온다.
    const d = new Date('2026-09-29T15:00:00Z')
    expect(formatKstDate(d)).toBe('2026-09-30')
  })

  it('서버 시간대와 무관하게 같은 값을 준다', () => {
    // 이 테스트가 CI(UTC)에서 실제로 깨졌던 버그를 고정한다.
    const d = new Date('2026-09-29T15:30:00Z')
    expect(formatKstDate(d)).toBe('2026-09-30')
  })

  it('월말 경계를 정확히 다룬다', () => {
    // 과세기간이 갈리는 지점이다. 하루 밀리면 부가세 신고가 어긋난다.
    expect(formatKstDate(new Date('2026-09-30T14:59:59Z'))).toBe('2026-09-30')
    expect(formatKstDate(new Date('2026-09-30T15:00:00Z'))).toBe('2026-10-01')
  })
})

describe('calculateTax', () => {
  it('과세는 10%', () => {
    expect(calculateTax(100_000)).toBe(10_000)
  })

  it('반올림한다', () => {
    expect(calculateTax(12_345)).toBe(1_235)
  })

  it('영세율·면세는 0', () => {
    expect(calculateTax(100_000, 'ZERO_RATE')).toBe(0)
    expect(calculateTax(100_000, 'TAX_FREE')).toBe(0)
  })
})

describe('itemTax — 실제로 보내는 세액', () => {
  it('과세는 10%', () => {
    expect(itemTax({ supplyCost: 100_000 }, 'TAXABLE')).toBe(10_000)
  })

  it('영세율은 0', () => {
    expect(itemTax({ supplyCost: 100_000 }, 'ZERO_RATE')).toBe(0)
  })

  it('면세는 세액 칸이 없어 null', () => {
    // 볼타는 면세에 0 을 보내면 거절한다.
    expect(itemTax({ supplyCost: 100_000 }, 'TAX_FREE')).toBeNull()
  })

  it('세액을 직접 적었으면 그 값을 쓴다', () => {
    expect(itemTax({ supplyCost: 100_000, tax: 9_999 }, 'TAXABLE')).toBe(9_999)
  })
})

describe('invoiceTotals — 확인 화면 금액', () => {
  const items = [{ supplyCost: 100_000 }, { supplyCost: 50_000 }]

  it('과세는 세액을 더한다', () => {
    expect(invoiceTotals(items, 'TAXABLE')).toEqual({ supplyCost: 150_000, tax: 15_000, total: 165_000 })
  })

  it('영세율·면세는 세액 없이 합계가 공급가액과 같다', () => {
    // 화면만 10% 로 계산하던 시절에는 여기가 165,000원으로 보였다.
    // 사람은 틀린 금액을 보고 승인하고, 볼타에는 150,000원이 나갔다.
    expect(invoiceTotals(items, 'ZERO_RATE')).toEqual({ supplyCost: 150_000, tax: 0, total: 150_000 })
    expect(invoiceTotals(items, 'TAX_FREE')).toEqual({ supplyCost: 150_000, tax: 0, total: 150_000 })
  })
})

describe('buildClientReferenceId', () => {
  it('invoiceId 가 비면 던진다', () => {
    // 그대로 두면 "kti-undefined" 가 나와 서로 다른 청구 건이 관리번호를 나눠 쓴다.
    expect(() => buildClientReferenceId('kti', undefined as unknown as string)).toThrow(/invoiceId/)
    expect(() => buildClientReferenceId('kti', '')).toThrow(/invoiceId/)
    expect(() => buildClientReferenceId('kti', '   ')).toThrow(/invoiceId/)
  })

  it('숫자 invoiceId 도 받는다', () => {
    // JSON 요청 파일에서는 숫자로 올 수 있다.
    expect(buildClientReferenceId('myapp', 1001)).toBe('myapp-1001')
  })

  it('객체 invoiceId 는 던진다', () => {
    // String({}) 는 "[object Object]" 라 kti-undefined 와 같은 공유 키가 된다.
    expect(() => buildClientReferenceId('kti', {} as unknown as string)).toThrow(/invoiceId/)
  })

  it('접두어가 비면 접두어를 탓한다', () => {
    expect(() => buildClientReferenceId('  ', 'inv_1')).toThrow(/referencePrefix/)
  })

  it('헤더에 못 싣는 문자는 던진다', () => {
    // 한글이 섞이면 요청이 나가기도 전에 실패하고, 그 실패가 "모름"으로
    // 분류돼 재요청 금지와 "접수 안 됨" 조회 사이를 끝없이 돈다.
    expect(() => buildClientReferenceId('kti', '2026-09-고객사')).toThrow(/영문·숫자/)
    expect(() => buildClientReferenceId('kti', 'inv 1')).toThrow(/영문·숫자/)
    expect(buildClientReferenceId('scenic', 'slack-1792774165.512439')).toBe('scenic-slack-1792774165.512439')
  })

  it('같은 입력에 같은 값을 준다', () => {
    // 재시도할 때 같은 값이어야 프로바이더가 중복을 막아준다.
    // 시각이나 난수를 섞으면 멱등성이 아예 동작하지 않는다.
    const a = buildClientReferenceId('myapp', 'inv_1')
    const b = buildClientReferenceId('myapp', 'inv_1')
    expect(a).toBe(b)
  })

  it('다른 청구 건은 다른 값을 준다', () => {
    expect(buildClientReferenceId('myapp', 'inv_1')).not.toBe(
      buildClientReferenceId('myapp', 'inv_2'),
    )
  })
})
