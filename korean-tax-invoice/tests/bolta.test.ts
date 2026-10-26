import { describe, expect, it, vi } from 'vitest'
import { BoltaProvider, findIssuer } from '../src/providers/bolta/index.js'
import { ProviderRejectedError, ProviderUncertainError } from '../src/core/types.js'
import type { IssueRequest } from '../src/core/types.js'

function makeRequest(overrides: Partial<IssueRequest> = {}): IssueRequest {
  return {
    supplier: {
      identificationNumber: '243-13-02906',
      organizationName: '널포인터스튜디오',
      representativeName: '김성구 외 1 명',
      businessType: '정보통신업',
      businessItem: '응용 소프트웨어 개발 및 공급업',
      contact: { email: 'ops@example.com' },
    },
    buyer: {
      identificationNumber: '220-81-62517',
      organizationName: '고객사',
      representativeName: '홍길동',
      contacts: [{ email: 'tax@client.co.kr' }],
    },
    items: [{ name: '이용료', supplyCost: 100_000 }],
    writeDate: new Date('2026-09-29T15:00:00Z'), // KST 09-30
    ...overrides,
  }
}

function okFetch(body: unknown) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch
}

function errFetch(status: number, body: string) {
  return vi.fn(async () => ({
    ok: false,
    status,
    json: async () => JSON.parse(body),
    text: async () => body,
  })) as unknown as typeof fetch
}

/** 호출마다 다음 응답을 준다. Error 를 넣으면 그 호출에서 던진다. */
function seqFetch(
  ...responses: ({ status: number; body: unknown; headers?: Record<string, string> } | Error)[]
) {
  const queue = [...responses]
  return vi.fn(async () => {
    const next = queue.shift()
    if (!next) throw new Error('예상하지 못한 fetch 호출')
    if (next instanceof Error) throw next
    const text = typeof next.body === 'string' ? next.body : JSON.stringify(next.body)
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      headers: new Headers(next.headers ?? {}),
      json: async () => JSON.parse(text),
      text: async () => text,
    }
  }) as unknown as typeof fetch
}

/** n 번째 호출의 URL. */
function calledUrl(f: typeof fetch, n: number): string {
  return (f as unknown as { mock: { calls: [string][] } }).mock.calls[n]![0]
}

/** fetch 목이 실제로 보낸 요청을 꺼낸다. */
function sentRequest(f: typeof fetch): { url: string; init: RequestInit & { headers: Record<string, string>; body: string } } {
  const calls = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls
  const [url, init] = calls[0]!
  return { url, init: init as never }
}

/** 보낸 본문을 파싱한다. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sentBody(f: typeof fetch): any {
  return JSON.parse(sentRequest(f).init.body)
}

function makeProvider(fetchImpl: typeof fetch, apiKey = 'test_abc') {
  return new BoltaProvider({ apiKey, fetchImpl })
}

describe('환경 구분', () => {
  it('test_ 키를 테스트로 판정한다', () => {
    expect(makeProvider(okFetch({}), 'test_x').isTestKey()).toBe(true)
  })

  it('live_ 키를 라이브로 판정한다', () => {
    // 이 판정이 틀리면 실제 발행이 테스트인 줄 알고 나간다.
    expect(makeProvider(okFetch({}), 'live_x').isTestKey()).toBe(false)
  })

  it('키가 없으면 생성 자체를 거부한다', () => {
    const saved = process.env.BOLTA_API_KEY
    delete process.env.BOLTA_API_KEY
    expect(() => new BoltaProvider()).toThrow(/BOLTA_API_KEY/)
    if (saved) process.env.BOLTA_API_KEY = saved
  })
})

describe('페이로드', () => {
  it('종목을 businessItem 으로 보낸다', async () => {
    // businessClass 로 보내면 볼타가 조용히 버린다 — 선택 필드라 오류도 없다.
    const f = okFetch({ issuanceKey: 'K' })
    await makeProvider(f).submit(makeRequest(), 'ref-1')

    const body = sentBody(f)
    expect(body.supplier.businessItem).toBe('응용 소프트웨어 개발 및 공급업')
    expect(body.supplier.businessClass).toBeUndefined()
  })

  it('작성일자를 KST 로 만든다', async () => {
    // UTC 로 계산하면 09-29 가 되어 과세기간이 갈린다.
    const f = okFetch({ issuanceKey: 'K' })
    await makeProvider(f).submit(makeRequest(), 'ref-1')

    const body = sentBody(f)
    expect(body.date).toBe('2026-09-30')
  })

  it('공급자 담당자를 manager 로 넣는다', async () => {
    // 문서상 선택처럼 보이지만 없으면 거절된다.
    const f = okFetch({ issuanceKey: 'K' })
    await makeProvider(f).submit(makeRequest(), 'ref-1')

    const body = sentBody(f)
    expect(body.supplier.manager.email).toBe('ops@example.com')
  })

  it('면세는 세액을 null 로 보낸다', async () => {
    // 0 을 보내면 거절된다.
    const f = okFetch({ issuanceKey: 'K' })
    await makeProvider(f).submit(makeRequest({ taxType: 'TAX_FREE' }), 'ref-1')

    const body = sentBody(f)
    expect(body.items[0].tax).toBeNull()
  })

  it('영세율은 세액 0 을 보낸다', async () => {
    // 확인 화면도 같은 itemTax() 로 0 을 보여준다.
    const f = okFetch({ issuanceKey: 'K' })
    await makeProvider(f).submit(makeRequest({ taxType: 'ZERO_RATE' }), 'ref-1')

    const body = sentBody(f)
    expect(body.items[0].tax).toBe(0)
  })

  it('멱등성 키를 헤더로 보낸다', async () => {
    const f = okFetch({ issuanceKey: 'K' })
    await makeProvider(f).submit(makeRequest(), 'ref-abc')

    const { init } = sentRequest(f)
    expect(init.headers['Bolta-Client-Reference-Id']).toBe('ref-abc')
  })
})

describe('오류 구분 — 중복 발행 방지의 핵심', () => {
  it('4xx 는 거절로 던진다 (재요청 안전)', async () => {
    const f = errFetch(400, '{"message":"필수값 누락","code":"INVALID"}')
    await expect(makeProvider(f).submit(makeRequest(), 'ref-1')).rejects.toBeInstanceOf(
      ProviderRejectedError,
    )
  })

  it('5xx 는 불확실로 던진다 (재요청 금지)', async () => {
    // 접수됐는지 알 수 없다. 재요청하면 중복 발행이다.
    const f = errFetch(500, '{"message":"서버 오류"}')
    await expect(makeProvider(f).submit(makeRequest(), 'ref-1')).rejects.toBeInstanceOf(
      ProviderUncertainError,
    )
  })

  it('네트워크 실패는 불확실로 던진다', async () => {
    const f = vi.fn(async () => {
      throw new Error('ECONNRESET')
    }) as unknown as typeof fetch
    await expect(makeProvider(f).submit(makeRequest(), 'ref-1')).rejects.toBeInstanceOf(
      ProviderUncertainError,
    )
  })

  it('200 인데 키가 없으면 불확실로 던진다', async () => {
    const f = okFetch({})
    await expect(makeProvider(f).submit(makeRequest(), 'ref-1')).rejects.toBeInstanceOf(
      ProviderUncertainError,
    )
  })

  it('2xx 인데 본문을 못 읽으면 불확실로 던진다', async () => {
    // 접수됐을 수 있다. 일반 오류로 새면 "거절"처럼 읽혀 재요청으로 이어진다.
    const f = seqFetch({ status: 200, body: '<html>gateway</html>' })
    await expect(makeProvider(f).submit(makeRequest(), 'ref-1')).rejects.toBeInstanceOf(
      ProviderUncertainError,
    )
  })

  it('2xx 본문이 null 이거나 키가 문자열이 아니면 불확실로 던진다', async () => {
    // null 이면 body.issuanceKey 에서 TypeError 가 나 일반 오류로 샜다.
    for (const body of ['null', { issuanceKey: { x: 1 } }, { issuanceKey: '' }]) {
      const f = seqFetch({ status: 200, body })
      await expect(makeProvider(f).submit(makeRequest(), 'ref-1')).rejects.toBeInstanceOf(
        ProviderUncertainError,
      )
    }
  })

  it('불확실 오류는 관리번호를 들고 있다', async () => {
    // 조회로 접수 여부를 확인하려면 이 값이 필요하다.
    const f = errFetch(503, '{}')
    await makeProvider(f)
      .submit(makeRequest(), 'ref-xyz')
      .catch((e) => {
        expect((e as ProviderUncertainError).clientReferenceId).toBe('ref-xyz')
      })
  })
})

describe('상태 조회', () => {
  it('발행 완료 응답은 status 가 없어도 ISSUED 로 본다', async () => {
    // 실측(2026-10, 테스트 키) 응답 모양. status 필드가 없다.
    const f = okFetch({
      issuanceKey: 'IssuanceKey_K',
      issuedAt: '2026-10-23T16:19:56.748471Z',
      ntsTransactionId: 'test_nts_K',
      invoice: { date: '2026-10-24', purpose: 'CLAIM' },
    })
    const r = await makeProvider(f).getStatus('IssuanceKey_K')
    expect(r).toMatchObject({ status: 'ISSUED', ntsConfirmNum: 'test_nts_K' })
  })

  it('issuedAt 도 status 도 없으면 ISSUED 로 넘겨짚지 않는다', async () => {
    const r = await makeProvider(okFetch({ issuanceKey: 'K' })).getStatus('K')
    expect(r.status).toBe('UNKNOWN')
  })

  it('404 는 UNKNOWN', async () => {
    const r = await makeProvider(errFetch(404, '{}')).getStatus('K')
    expect(r.status).toBe('UNKNOWN')
  })
})

describe('관리번호 조회', () => {
  // 실측(2026-09) 접수 확인 응답. message 는 상태가 아니라 안내문이다.
  const accepted = {
    status: 200,
    body: {
      clientReferenceId: 'ref-1',
      issuanceKey: 'IssuanceKey_K',
      message: '요청이 처리되었습니다. 성공/실패 여부는 발행된 세금계산서를 통해 확인해주세요.',
    },
  }

  it('발행까지 끝났으면 ISSUED 와 issuanceKey 를 준다', async () => {
    // 접수 확인에서 멈추면 발행이 끝난 건도 영원히 SUBMITTED 로 보였다.
    const f = seqFetch(accepted, {
      status: 200,
      body: { issuanceKey: 'IssuanceKey_K', issuedAt: '2026-10-23T16:49:33Z', ntsTransactionId: 'test_nts_K' },
    })
    const r = await makeProvider(f).getStatusByReferenceId('ref-1')

    expect(r).toMatchObject({ status: 'ISSUED', issuanceKey: 'IssuanceKey_K', ntsConfirmNum: 'test_nts_K' })
    expect(calledUrl(f, 0)).toContain('clientReferenceId=ref-1')
    expect(calledUrl(f, 1)).toMatch(/\/v1\/taxInvoices\/IssuanceKey_K$/)
  })

  it('아직 발행 전이면 SUBMITTED 와 issuanceKey 를 준다', async () => {
    // issuanceKey 가 있어야 응답을 못 받은 쪽도 이후 상태를 따라갈 수 있다.
    const f = seqFetch(accepted, { status: 404, body: '{}' })
    const r = await makeProvider(f).getStatusByReferenceId('ref-1')
    expect(r).toEqual({ status: 'SUBMITTED', issuanceKey: 'IssuanceKey_K' })
  })

  it('후속 조회가 실패해도 SUBMITTED 로 답한다', async () => {
    // 접수됐다는 사실은 이미 확인했다. "재요청 금지" 쪽으로 답해야 안전하다.
    const f = seqFetch(accepted, new Error('ECONNRESET'))
    const r = await makeProvider(f).getStatusByReferenceId('ref-1')
    expect(r).toEqual({ status: 'SUBMITTED', issuanceKey: 'IssuanceKey_K' })
  })

  it('접수 단계에서 실패한 건은 FAILED 이고 후속 조회를 하지 않는다', async () => {
    // 실측(2026-10, 라이브 키, 포인트 부족 402). issuanceKey 가 있어도 발행되지 않았다.
    const f = seqFetch({
      status: 200,
      body: {
        clientReferenceId: 'ref-1',
        issuanceKey: 'IssuanceKey_F',
        message:
          '요청이 접수 단계에서 실패해 발행되지 않았습니다. 이 건은 세금계산서로 조회되지 않고, 같은 clientReferenceId 로는 다시 요청할 수 없습니다. 새 clientReferenceId 로 요청해주세요.',
      },
    })
    const r = await makeProvider(f).getStatusByReferenceId('ref-1')
    expect(r).toMatchObject({ status: 'FAILED', issuanceKey: 'IssuanceKey_F' })
    expect(r.failureReason).toContain('새 clientReferenceId')
    expect((f as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1)
  })

  it('없는 관리번호는 UNKNOWN 이고 후속 조회를 하지 않는다', async () => {
    const f = seqFetch({ status: 400, body: '{"code":"INVALID_REQUEST","message":"존재하지 않는 요청"}' })
    const r = await makeProvider(f).getStatusByReferenceId('ref-none')
    expect(r).toEqual({ status: 'UNKNOWN' })
    expect((f as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1)
  })
})

describe('PDF 조회', () => {
  it('준비되면 다운로드 주소와 파일 이름을 준다', async () => {
    const f = seqFetch({
      status: 200,
      body: {
        issuanceKey: 'K',
        status: 'READY',
        downloadUrl: 'https://files.example/k.pdf',
        downloadUrlExpiresAt: '2026-10-24T00:05:00Z',
        filename: '전자세금계산서_20261024_고객사.pdf',
      },
    })
    const r = await makeProvider(f).getPdf('K')
    expect(r).toEqual({
      status: 'READY',
      downloadUrl: 'https://files.example/k.pdf',
      expiresAt: '2026-10-24T00:05:00Z',
      filename: '전자세금계산서_20261024_고객사.pdf',
    })
    expect(calledUrl(f, 0)).toMatch(/\/v1\/taxInvoices\/K\/pdf$/)
  })

  it('만드는 중(202)이면 Retry-After 를 담아 PENDING', async () => {
    const f = seqFetch({ status: 202, body: { status: 'PENDING', downloadUrl: null }, headers: { 'Retry-After': '2' } })
    await expect(makeProvider(f).getPdf('K')).resolves.toEqual({ status: 'PENDING', retryAfterSeconds: 2 })
  })

  it('동시 생성이 많으면(429) 역시 기다렸다 다시', async () => {
    const f = seqFetch({ status: 429, body: { code: 'TOO_MANY_IN_FLIGHT' }, headers: { 'Retry-After': '60' } })
    await expect(makeProvider(f).getPdf('K')).resolves.toEqual({ status: 'PENDING', retryAfterSeconds: 60 })
  })

  it('발행 전이면 거절로 던진다', async () => {
    const f = seqFetch({
      status: 400,
      body: { code: 'TAX_INVOICE_RETRIEVE_NOT_AVAILABLE', message: 'PDF를 받을 수 없는 발행 건입니다.' },
    })
    await expect(makeProvider(f).getPdf('K')).rejects.toMatchObject({
      status: 400,
      code: 'TAX_INVOICE_RETRIEVE_NOT_AVAILABLE',
    })
  })
})

describe('발급자 대조', () => {
  const issuers = [
    { identificationNumber: '1234567890', organizationName: '예시상사', representativeName: '김예시' },
  ]

  it('하이픈 유무와 상관없이 사업자번호로 찾는다', () => {
    expect(findIssuer(issuers, '123-45-67890')?.organizationName).toBe('예시상사')
    expect(findIssuer(issuers, '1234567890')?.organizationName).toBe('예시상사')
  })

  it('등록되지 않은 공급자는 undefined', () => {
    // 예제 파일의 공급자를 그대로 두면 여기에 걸린다.
    expect(findIssuer(issuers, '243-13-02906')).toBeUndefined()
  })

  it('발급자 목록을 가져온다', async () => {
    const f = seqFetch({ status: 200, body: issuers })
    await expect(makeProvider(f).listIssuers()).resolves.toEqual(issuers)
    expect(calledUrl(f, 0)).toMatch(/\/v1\/issuers$/)
  })

  it('발급자 목록 조회가 거절되면 던진다', async () => {
    const f = seqFetch({ status: 401, body: '{"message":"인증 실패"}' })
    await expect(makeProvider(f).listIssuers()).rejects.toBeInstanceOf(ProviderRejectedError)
  })

  it('발급자 목록이 배열이 아니면 던진다', async () => {
    // 빈 배열로 넘기면 "등록된 발급자 없음"이라는 틀린 안내가 나간다.
    const f = seqFetch({ status: 200, body: { items: [] } })
    await expect(makeProvider(f).listIssuers()).rejects.toThrow(/배열/)
  })
})

describe('웹훅', () => {
  const provider = makeProvider(okFetch({}))

  it('성공 이벤트를 ISSUED 로 정규화한다', () => {
    const e = provider.parseWebhook({
      eventType: 'TAX_INVOICE_ISSUANCE_SUCCESS',
      data: { issuanceKey: 'K', taxInvoiceUrl: 'https://x' },
    })
    expect(e).toMatchObject({ issuanceKey: 'K', status: 'ISSUED', invoiceUrl: 'https://x' })
  })

  it('실패 이벤트에 사유를 담는다', () => {
    const e = provider.parseWebhook({
      eventType: 'TAX_INVOICE_ISSUANCE_FAILURE',
      data: {
        issuanceKey: 'K',
        cause: { code: 'NOT_FOUND_CERTIFICATE', message: '공동인증서가 없습니다.' },
      },
    })
    expect(e?.status).toBe('FAILED')
    expect(e?.failureReason).toContain('공동인증서')
    expect(e?.failureReason).toContain('NOT_FOUND_CERTIFICATE')
  })

  it('모르는 이벤트는 null', () => {
    expect(provider.parseWebhook({ eventType: 'NEW', data: { issuanceKey: 'K' } })).toBeNull()
  })

  it('issuanceKey 가 없으면 null', () => {
    expect(provider.parseWebhook({ eventType: 'TAX_INVOICE_ISSUANCE_SUCCESS' })).toBeNull()
  })

  it('볼타 IP 만 통과시킨다', () => {
    // 볼타 웹훅에는 서명이 없다. IP 가 사실상의 인증이다.
    expect(provider.verifyWebhookSender({ ip: '43.201.136.252' })).toBe(true)
    expect(provider.verifyWebhookSender({ ip: '1.2.3.4' })).toBe(false)
    expect(provider.verifyWebhookSender({ ip: null })).toBe(false)
  })

  it('x-forwarded-for 는 맨 앞만 본다', () => {
    // 뒤쪽은 프록시라 신뢰할 수 없다.
    expect(provider.verifyWebhookSender({ ip: '1.2.3.4, 43.201.136.252' })).toBe(false)
    expect(provider.verifyWebhookSender({ ip: '43.201.136.252, 1.2.3.4' })).toBe(true)
  })
})
