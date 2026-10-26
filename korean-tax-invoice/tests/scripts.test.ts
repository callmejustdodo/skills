/**
 * scripts/issue.mjs 를 실제로 돌려본다.
 *
 * 사람이 승인하는 화면과 자동화가 읽는 종료 코드가 이 스크립트의 출력이다.
 * 라이브러리가 맞아도 여기가 틀리면 사람은 틀린 내용을 승인하고, 자동화는
 * 접수된 건을 "다시 해도 된다"로 읽는다.
 *
 * 검증 모드는 네트워크를 타지 않는다. --confirm 은 로컬 스텁 서버로만 보낸다.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const example = JSON.parse(readFileSync(join(root, 'examples/request.json'), 'utf8')) as Record<
  string,
  unknown
>
let dir = ''

beforeAll(() => {
  // 스크립트는 dist/ 를 쓴다. 지금 소스로 빌드해야 소스와 같은 동작을 검사한다.
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'], {
    cwd: root,
  })
  dir = mkdtempSync(join(tmpdir(), 'kti-'))
}, 60_000)

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

function writeRequest(overrides: Record<string, unknown>): string {
  const file = join(dir, `${Math.random().toString(36).slice(2)}.json`)
  writeFileSync(file, JSON.stringify({ ...example, ...overrides }))
  return file
}

function dryRun(overrides: Record<string, unknown>, extraArgs: string[] = []): { code: number | null; out: string } {
  const r = spawnSync(process.execPath, ['scripts/issue.mjs', writeRequest(overrides), ...extraArgs], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, BOLTA_API_KEY: 'test_dummy' },
  })
  return { code: r.status, out: r.stdout + r.stderr }
}

type Reply = { status: number; body: unknown; headers?: Record<string, string> }

/** 볼타 대신 쓰는 로컬 스텁. route(path) 가 응답을 고르고, 받은 요청은 hits 에 쌓인다. */
async function startStub(route: (path: string) => Reply | undefined) {
  const hits: string[] = []
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://stub').pathname
    hits.push(`${req.method} ${path}`)
    const reply = route(path) ?? { status: 404, body: {} }
    req.resume()
    const raw = Buffer.isBuffer(reply.body)
    res.writeHead(reply.status, {
      'Content-Type': raw ? 'application/pdf' : 'application/json',
      ...reply.headers,
    })
    res.end(raw ? reply.body : typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { base, hits, close: () => server.close() }
}

/** 스크립트를 스텁에 대고 돌린다. 셸 값이 .env 를 이긴다 — 실제 볼타로 나갈 길이 없다. */
async function runScript(script: string, args: string[], base: string): Promise<{ code: number | null; out: string }> {
  const child = spawn(process.execPath, [`scripts/${script}`, ...args], {
    cwd: root,
    env: { ...process.env, BOLTA_API_KEY: 'test_dummy', BOLTA_API_BASE_URL: base },
  })
  let out = ''
  child.stdout.on('data', (d) => (out += d))
  child.stderr.on('data', (d) => (out += d))
  const code = await new Promise<number | null>((resolve) => child.on('close', resolve))
  return { code, out }
}

type Routes = Partial<Record<'issuers' | 'issue' | 'refStatus' | 'invoice', Reply>>

/** --confirm 으로 돌린다. 스텁이 받은 요청도 돌려준다. */
async function confirmRun(routes: Routes): Promise<{ code: number | null; out: string; hits: string[] }> {
  const stub = await startStub((path) =>
    path === '/v1/issuers'
      ? routes.issuers
      : path === '/v1/taxInvoices/issue'
        ? routes.issue
        : path === '/v1/taxInvoices/issue/status'
          ? routes.refStatus
          : path.startsWith('/v1/taxInvoices/')
            ? routes.invoice
            : undefined,
  )
  try {
    return { ...(await runScript('issue.mjs', [writeRequest({}), '--confirm'], stub.base)), hits: stub.hits }
  } finally {
    stub.close()
  }
}

/** 예제 요청의 공급자(243-13-02906)를 발급자로 등록해 둔 목록. */
const registered: Reply = {
  status: 200,
  body: [{ identificationNumber: '2431302906', organizationName: '널포인터스튜디오' }],
}
const SUBMIT = 'POST /v1/taxInvoices/issue'

describe('확인 화면 금액', () => {
  it('과세는 10% 세액을 보여준다', () => {
    const { code, out } = dryRun({})
    expect(code).toBe(0)
    expect(out).toMatch(/세액\s+10,000원/)
    expect(out).toMatch(/합계\s+110,000원/)
    expect(out).toContain('과세 (10%)')
  })

  it('영세율은 세액 0원으로 보여준다', () => {
    // 예전에는 화면만 10% 로 계산해 110,000원으로 보였고, 볼타에는 세액 0 이 나갔다.
    const { code, out } = dryRun({ taxType: 'ZERO_RATE' })
    expect(code).toBe(0)
    expect(out).toMatch(/세액\s+0원/)
    expect(out).toMatch(/합계\s+100,000원/)
    expect(out).toContain('영세율')
  })

  it('면세는 세액 0원으로 보여준다', () => {
    const { code, out } = dryRun({ taxType: 'TAX_FREE' })
    expect(code).toBe(0)
    expect(out).toMatch(/세액\s+0원/)
    expect(out).toMatch(/합계\s+100,000원/)
    expect(out).toContain('면세')
  })

  it('구분과 관리번호를 보여준다', () => {
    const { out } = dryRun({ purpose: 'RECEIPT' })
    expect(out).toMatch(/구분\s+영수/)
    expect(out).toMatch(/관리번호\s+myapp-inv-2026-09-001/)
  })
})

describe('요청 파일 필수 항목', () => {
  it('invoiceId 가 없으면 막는다', () => {
    // 그대로 두면 모든 요청이 "kti-undefined" 관리번호를 나눠 쓴다.
    const { code, out } = dryRun({ invoiceId: undefined })
    expect(code).toBe(1)
    expect(out).toContain('발행할 수 없습니다')
    expect(out).toContain('invoiceId')
  })

  it('헤더에 못 싣는 invoiceId 는 막는다', () => {
    const { code, out } = dryRun({ invoiceId: '2026-09-고객사' })
    expect(code).toBe(1)
    expect(out).toContain('영문·숫자')
  })

  it('verified 를 빠뜨리면 막는다', () => {
    // 빠뜨린 파일이 "확인됨"으로 통과하면 사람 확인 단계가 있으나 마나다.
    const { code, out } = dryRun({ verified: undefined })
    expect(code).toBe(1)
    expect(out).toContain('거래처 정보가 아직 확인되지 않았습니다')
    expect(out).toContain('"verified": true')
  })

  it('verified 가 true 가 아닌 값이면 막는다', () => {
    const { code } = dryRun({ verified: 'yes' })
    expect(code).toBe(1)
  })

  it('모르는 옵션은 막는다', () => {
    // --confrim 오타가 검증만 하고 0 으로 끝나면 발행된 줄 안다.
    const { code, out } = dryRun({}, ['--confrim'])
    expect(code).toBe(1)
    expect(out).toContain('알 수 없는 옵션')
  })
})

describe('--confirm 종료 코드', () => {
  it('접수되면 0', async () => {
    const r = await confirmRun({ issuers: registered, issue: { status: 200, body: { issuanceKey: 'K' } } })
    expect(r.code).toBe(0)
    expect(r.out).toContain('접수 완료: K')
  })

  it('등록되지 않은 공급자는 접수 전에 1 로 막는다', async () => {
    const r = await confirmRun({
      issuers: { status: 200, body: [{ identificationNumber: '1234567890', organizationName: '예시상사' }] },
    })
    expect(r.code).toBe(1)
    expect(r.out).toContain('볼타에 등록된 발급자가 아닙니다')
    expect(r.hits).not.toContain(SUBMIT)
  })

  it('발급자 조회가 실패하면 접수하지 않고 1', async () => {
    const r = await confirmRun({ issuers: { status: 500, body: '{}' } })
    expect(r.code).toBe(1)
    expect(r.hits).not.toContain(SUBMIT)
  })

  it('5xx 는 2', async () => {
    const r = await confirmRun({ issuers: registered, issue: { status: 503, body: '{}' } })
    expect(r.code).toBe(2)
    expect(r.out).toContain('다시 실행하지 마세요')
  })

  it('2xx 본문이 null 이면 2', async () => {
    // 일반 오류로 새서 1("다시 해도 된다")로 끝나던 자리다.
    const r = await confirmRun({ issuers: registered, issue: { status: 200, body: 'null' } })
    expect(r.code).toBe(2)
  })

  it('거절됐고 관리번호도 접수 기록이 없으면 1', async () => {
    const r = await confirmRun({
      issuers: registered,
      issue: { status: 400, body: { message: '필수값 누락' } },
      refStatus: { status: 400, body: { code: 'INVALID_REQUEST', message: '존재하지 않는 요청' } },
    })
    expect(r.code).toBe(1)
    expect(r.out).toContain('접수되지 않았으므로')
  })

  it('거절됐지만 이 관리번호가 이미 접수돼 있으면 3', async () => {
    // 내용을 고쳤거나 다음 날 재실행하면 같은 관리번호에 다른 내용이 가서 400 이 난다.
    // 이걸 "접수 안 됨"으로 읽으면 invoiceId 를 바꿔 두 번째 계산서를 낸다.
    const r = await confirmRun({
      issuers: registered,
      issue: { status: 400, body: { message: '같은 관리번호로 다른 요청' } },
      refStatus: { status: 200, body: { issuanceKey: 'IssuanceKey_OLD' } },
    })
    expect(r.code).toBe(3)
    expect(r.out).toContain('이미 접수된 건')
    expect(r.out).toContain('IssuanceKey_OLD')
  })

  it('거절됐고 관리번호가 "접수 단계에서 실패"면 1 과 새 invoiceId 안내', async () => {
    // 포인트 부족(402)이 이렇게 온다. "이미 접수됨"(3)으로 읽으면 안 된다 — 발행되지 않았다.
    const r = await confirmRun({
      issuers: registered,
      issue: { status: 402, body: { message: '포인트 잔액이 부족합니다.' } },
      refStatus: {
        status: 200,
        body: {
          issuanceKey: 'IssuanceKey_F',
          message: '요청이 접수 단계에서 실패해 발행되지 않았습니다. 새 clientReferenceId 로 요청해주세요.',
        },
      },
    })
    expect(r.code).toBe(1)
    expect(r.out).toContain('발행되지 않았습니다')
    expect(r.out).toContain('새 invoiceId')
  })

  it('거절 뒤 관리번호 조회까지 실패하면 2', async () => {
    const r = await confirmRun({
      issuers: registered,
      issue: { status: 400, body: { message: '거절' } },
      refStatus: { status: 500, body: '{}' },
    })
    expect(r.code).toBe(2)
  })
})

describe('download-pdf', () => {
  const pdf = Buffer.from('%PDF-1.4\n% stub\n')

  /** api(base) 가 PDF 조회 응답을 차례로 준다. 파일은 스텁의 /files/k.pdf 에서 내려받는다. */
  async function pdfRun(api: (base: string) => Reply[], file: Reply = { status: 200, body: pdf }) {
    const queue: Reply[] = []
    const stub = await startStub((path) =>
      path === '/v1/taxInvoices/K/pdf' ? queue.shift() : path === '/files/k.pdf' ? file : undefined,
    )
    queue.push(...api(stub.base))
    const out = join(dir, `pdf-${Math.random().toString(36).slice(2)}`)
    try {
      return { ...(await runScript('download-pdf.mjs', ['K', '--out', out], stub.base)), dir: out, hits: stub.hits }
    } finally {
      stub.close()
    }
  }

  const ready = (base: string, filename: string): Reply => ({
    status: 200,
    body: { issuanceKey: 'K', status: 'READY', downloadUrl: `${base}/files/k.pdf`, filename },
  })

  it('준비되면 파일로 저장하고 마지막 줄에 경로를 찍는다', async () => {
    const r = await pdfRun((base) => [ready(base, '전자세금계산서_20261024_데모파트너스.pdf')])
    expect(r.code).toBe(0)
    const saved = join(r.dir, '전자세금계산서_20261024_데모파트너스.pdf')
    expect(r.out.trim().split('\n').at(-1)).toBe(`저장: ${saved}`)
    expect(readFileSync(saved)).toEqual(pdf)
    expect(r.out).toContain('샘플 PDF')
  })

  it('파일 이름의 경로 구분자는 걸러낸다', async () => {
    // 파일 이름에 거래처 상호가 들어간다. "/" 가 섞이면 다른 폴더에 써질 수 있다.
    const r = await pdfRun((base) => [ready(base, '../전자세금계산서_데모/파트너스')])
    expect(r.code).toBe(0)
    expect(readdirSync(r.dir)).toEqual(['_전자세금계산서_데모_파트너스.pdf'])
  })

  it('만드는 중(202)이면 Retry-After 만큼 기다렸다 다시 묻는다', async () => {
    const r = await pdfRun((base) => [
      { status: 202, body: { status: 'PENDING', downloadUrl: null }, headers: { 'Retry-After': '0' } },
      ready(base, 'k.pdf'),
    ])
    expect(r.code).toBe(0)
    expect(r.hits.filter((h) => h === 'GET /v1/taxInvoices/K/pdf')).toHaveLength(2)
  })

  it('PDF 가 아닌 응답은 저장하지 않는다', async () => {
    // 만료 안내 페이지 같은 것을 .pdf 로 남기지 않는다.
    const r = await pdfRun((base) => [ready(base, 'k.pdf')], { status: 200, body: '<html>expired</html>' })
    expect(r.code).toBe(1)
    expect(r.out).toContain('PDF 가 아닙니다')
    expect(existsSync(join(r.dir, 'k.pdf'))).toBe(false)
  })

  it('발행 전이면 1 과 상태 조회 안내', async () => {
    const r = await pdfRun(() => [
      {
        status: 400,
        body: { code: 'TAX_INVOICE_RETRIEVE_NOT_AVAILABLE', message: 'PDF를 받을 수 없는 발행 건입니다.' },
      },
    ])
    expect(r.code).toBe(1)
    expect(r.out).toContain('TAX_INVOICE_RETRIEVE_NOT_AVAILABLE')
    expect(r.out).toContain('check-status.mjs K')
  })
})
