import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import '../landing.css'

/* Empirical numbers are read from the live control API. When no run data
   exists yet they render as an em dash rather than a fabricated figure. */
function fmtPct(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`
}
function fmtSecs(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(2)}s`
}
function fmtNum(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : String(value)
}

/* Presentation-only scroll reveal. */
function useReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll('.landing .rv'))
    if (!('IntersectionObserver' in window)) {
      els.forEach((e) => e.classList.add('in'))
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in')
            io.unobserve(e.target)
          }
        })
      },
      { threshold: 0.12 },
    )
    els.forEach((e) => io.observe(e))
    return () => io.disconnect()
  }, [])
}

function Check({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function Arrow({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  )
}

function HeroSeam({ patchLabel }: { patchLabel: string }) {
  return (
    <svg viewBox="0 0 960 64" fill="none" aria-hidden="true">
      <line stroke="#d9d3c8" strokeWidth={2} x1={0} x2={380} y1={32} y2={32} />
      <circle cx={30} cy={32} fill="#8b9096" r={3} />
      <circle cx={180} cy={32} fill="#8b9096" r={3} />
      <circle cx={360} cy={32} fill="#a02e26" r={4} />
      <path
        d="M380 32 L394 24 L404 38 L416 26 L534 32"
        stroke="#a02e26"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
      />
      <path
        className="lp-draw"
        d="M416 26 L534 32 L960 32"
        stroke="#1b8a6b"
        strokeLinecap="round"
        strokeWidth={2.5}
      />
      <line stroke="#e6e2dc" strokeWidth={2} x1={534} x2={960} y1={32} y2={32} />
      <circle cx={680} cy={32} fill="#1b8a6b" r={3.5} />
      <circle cx={840} cy={32} fill="#1b8a6b" r={3.5} />
      <circle cx={940} cy={32} fill="#1b8a6b" r={3.5} />
      <circle className="lp-travel" cx={0} cy={32} fill="#a02e26" r={4} />
      <text
        fill="#a02e26"
        fontFamily="JetBrains Mono, monospace"
        fontSize={11}
        fontWeight={600}
        x={398}
        y={14}
      >
        422 · request rejected
      </text>
      <text
        fill="#146b52"
        fontFamily="JetBrains Mono, monospace"
        fontSize={11}
        fontWeight={600}
        x={560}
        y={58}
      >
        Repaired in {patchLabel}
      </text>
    </svg>
  )
}

function StationTrack() {
  return (
    <svg viewBox="0 0 1152 48" fill="none" aria-hidden="true">
      <line stroke="#d9d3c8" strokeWidth={2} x1={0} x2={96} y1={24} y2={24} />
      <path
        d="M96 24 L110 16 L124 32 L136 20 L150 24"
        stroke="#a02e26"
        strokeLinejoin="round"
        strokeWidth={2}
      />
      <line stroke="#d9d3c8" strokeDasharray="5 5" strokeWidth={2} x1={150} x2={768} y1={24} y2={24} />
      <line stroke="#1b8a6b" strokeWidth={2} x1={768} x2={1152} y1={24} y2={24} />
      <circle cx={96} cy={24} fill="#a02e26" r={5} stroke="#ffffff" strokeWidth={2} />
      <circle cx={288} cy={24} fill="#ffffff" r={5} stroke="#8b9096" strokeWidth={2} />
      <circle cx={480} cy={24} fill="#ffffff" r={5} stroke="#8b9096" strokeWidth={2} />
      <circle cx={672} cy={24} fill="#ffffff" r={5} stroke="#8b9096" strokeWidth={2} />
      <circle cx={864} cy={24} fill="#1b8a6b" r={5} stroke="#ffffff" strokeWidth={2} />
      <circle cx={1056} cy={24} fill="#1b8a6b" r={5} stroke="#ffffff" strokeWidth={2} />
    </svg>
  )
}

function OutcomeHealed() {
  return (
    <svg viewBox="0 0 240 32" fill="none" aria-hidden="true">
      <line stroke="#d9d3c8" strokeWidth={2} x1={0} x2={80} y1={16} y2={16} />
      {[86, 96, 106, 116, 126].map((x) => (
        <line key={x} stroke="#1b8a6b" strokeWidth={2.5} x1={x} x2={x} y1={8} y2={24} />
      ))}
      <line stroke="#1b8a6b" strokeWidth={2} x1={132} x2={240} y1={16} y2={16} />
      <circle cx={236} cy={16} fill="#1b8a6b" r={3} />
    </svg>
  )
}

function OutcomeRefused() {
  return (
    <svg viewBox="0 0 240 32" fill="none" aria-hidden="true">
      <line stroke="#d9d3c8" strokeWidth={2} x1={0} x2={110} y1={16} y2={16} />
      <line stroke="#b7791f" strokeWidth={3.5} x1={110} x2={110} y1={8} y2={24} />
      <line stroke="#d9d3c8" strokeDasharray="2 5" strokeWidth={2} x1={122} x2={240} y1={16} y2={16} />
    </svg>
  )
}

function OutcomeNotDrift() {
  return (
    <svg viewBox="0 0 240 32" fill="none" aria-hidden="true">
      <line stroke="#8b9096" strokeDasharray="7 7" strokeWidth={2} x1={0} x2={240} y1={16} y2={16} />
      <circle cx={120} cy={16} fill="#ffffff" r={4.5} stroke="#8b9096" strokeWidth={2} />
    </svg>
  )
}

function ClosingSeam() {
  return (
    <svg viewBox="0 0 440 24" fill="none" aria-hidden="true">
      <line stroke="#d9d3c8" strokeWidth={2} x1={0} x2={160} y1={12} y2={12} />
      <path d="M160 12 L170 6 L180 18 L190 10 L198 12" stroke="#a02e26" strokeLinecap="round" strokeWidth={2} />
      {[204, 212, 220, 228].map((x) => (
        <line key={x} stroke="#1b8a6b" strokeWidth={2.5} x1={x} x2={x} y1={4} y2={20} />
      ))}
      <line stroke="#1b8a6b" strokeWidth={2} x1={236} x2={440} y1={12} y2={12} />
    </svg>
  )
}

function Connector() {
  return (
    <svg viewBox="0 0 100 24" fill="none" aria-hidden="true">
      <line stroke="currentColor" strokeWidth={1.5} x1={0} x2={84} y1={12} y2={12} />
      <polyline fill="none" points="78,6 88,12 78,18" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  )
}

const STRIP = [
  'Detects breaking changes',
  'Repairs in memory',
  'Validates every patch',
  'Refuses when unsafe',
  'Audits every decision',
  'No restarts needed',
]

export function LandingPage() {
  const status = useApi(() => api.status(), [])
  const metrics = useApi(() => api.metrics(), [])
  useReveal()

  const healing = metrics.data?.agents?.healing?.overall
  const baseline = metrics.data?.agents?.baseline?.overall

  const mttrHeal = healing?.available ? healing.mttr_median ?? null : null
  const patchLabel = fmtSecs(mttrHeal)
  const runId = status.data?.last_run?.run_id

  return (
    <div className="landing">
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <Link className="lp-brand" to="/" aria-label="Reflex home">
            <span className="lp-brand-mark">R</span>
            <span>Reflex Registry</span>
          </Link>
          <nav className="lp-nav-links" aria-label="Page sections">
            <a href="#the-break">The break</a>
            <a href="#how-it-works">How it works</a>
            <a href="#safety">Safety</a>
            <a href="#evidence">Evidence</a>
          </nav>
          <Link className="lp-nav-cta" to="/login">
            Open console
            <Arrow size={14} />
          </Link>
        </div>
      </header>

      <main>
        {/* ===== HERO ===== */}
        <section className="lp-hero">
          <div className="lp-hero-grid-bg" aria-hidden="true" />
          <div className="lp-hero-inner">
            <div>
              <span className="lp-pill">
                <span className="lp-pill-dot" />
                Live drift repair for agent tooling
              </span>
              <h1 className="lp-h1">APIs change. <em>Agents shouldn&rsquo;t break.</em></h1>
              <p className="lp-lead">
                Reflex detects runtime schema drift, repairs the tool definition in memory, and refuses
                when a safe repair can&rsquo;t be justified.
              </p>
              <div className="lp-cta-row">
                <Link className="lp-btn lp-btn-solid" to="/login">
                  Open console
                  <Arrow size={15} />
                </Link>
                <a className="lp-btn lp-btn-ghost" href="#how-it-works">
                  See how it works
                </a>
              </div>
              <div className="lp-hero-proof">
                <span><Check />Live schema diffing</span>
                <span><Check />In-memory repair, no restart</span>
                <span><Check />Logged refusals</span>
              </div>
            </div>

            <div className="lp-terminal" role="img" aria-label="Illustration of a failing request being repaired">
              <div className="lp-term-bar"><i /><i /><i /><span>replay — illustration</span></div>
              <div className="lp-term-body">
                <div className="lp-term-old">{'{"user_id": "123"}'}</div>
                <div className="lp-term-new">{'{"target": {"id": 123}}'}</div>
                <div className="lp-term-hdr">+ header X-Tenant-Token</div>
                <div className="lp-term-status">
                  <span className="lp-term-dot" />
                  <span>Patched in memory, <b>no restart</b></span>
                  <span className="lp-term-note" style={{ marginLeft: 8, opacity: 0.75 }}>Illustration</span>
                </div>
              </div>
            </div>
          </div>

          <div className="lp-seam-wrap">
            <HeroSeam patchLabel={patchLabel} />
            <div className="lp-seam-meta">
              <span>Failing request</span>
              <span>Audit entry {runId ? `#${runId}` : '—'}</span>
              <span>Illustration · repaired-in time from recorded runs</span>
            </div>
          </div>
        </section>

        {/* ===== MARQUEE ===== */}
        <div className="lp-strip" aria-hidden="true">
          <div className="lp-strip-track">
            {[...STRIP, ...STRIP].map((s, i) => (
              <span key={i}>{s}</span>
            ))}
          </div>
        </div>

        {/* ===== THE BREAK ===== */}
        <section className="lp-section" id="the-break">
          <div className="lp-container-md">
            <div className="lp-section-head rv">
              <span className="lp-eyebrow">01 · What breaking looks like</span>
              <h2 className="lp-h2">The API kept running. The tool definition didn&rsquo;t.</h2>
            </div>

            <div className="lp-break-grid">
              <div className="lp-panel rv">
                <div>
                  <div className="lp-panel-head">
                    <span className="lp-panel-title">Before · what the agent sends</span>
                    <span className="lp-status lp-status-bad">
                      <span className="lp-status-dot" /> Failing
                    </span>
                  </div>
                  <pre className="lp-code">
                    <code>
                      {'{\n  '}
                      <span className="tok-key-warn">&quot;user_id&quot;</span>
                      {': '}
                      <span className="tok-str">&quot;123&quot;</span>
                      {'\n}'}
                    </code>
                  </pre>
                </div>
                <div className="lp-panel-foot">
                  <span>invoice_service / v1</span>
                  <span>422 · rejected</span>
                </div>
              </div>

              <div className="lp-fracture rv" aria-hidden="true">
                <span className="lp-fracture-badge"><Arrow size={18} /></span>
              </div>

              <div className="lp-panel rv" style={{ ['--d' as string]: '120ms' }}>
                <div>
                  <div className="lp-panel-head">
                    <span className="lp-panel-title">After · what the API expects</span>
                    <span className="lp-status lp-status-ok">
                      <span className="lp-status-dot" /> Verified
                    </span>
                  </div>
                  <pre className="lp-code">
                    <code>
                      {'{\n  '}
                      <span className="tok-key-ok">&quot;target&quot;</span>
                      {': {\n    '}
                      <span className="tok-key-ok">&quot;id&quot;</span>
                      {': '}
                      <span className="tok-str">123</span>
                      {'\n  }\n}'}
                    </code>
                  </pre>
                  <div className="lp-note">
                    <Check size={13} />
                    <span>+ header X-Tenant-Token, resolved from the secrets store</span>
                  </div>
                </div>
                <div className="lp-panel-foot">
                  <span>invoice_service / v2.4</span>
                  <span>200 · ok</span>
                </div>
              </div>
            </div>

            <p className="lp-section-foot rv">
              Without repair, the agent keeps sending the outdated shape, burning through retries while the workflow stalls.
            </p>
          </div>
        </section>

        {/* ===== HOW IT WORKS ===== */}
        <section className="lp-section bg-tint" id="how-it-works">
          <div className="lp-container">
            <div className="lp-section-head rv">
              <span className="lp-eyebrow">02 · How it works</span>
              <h2 className="lp-h2">Six steps between a failure and a fix.</h2>
              <p className="lp-sub">
                A deterministic pipeline sits between your agent and the upstream API, turning a
                rejected request into either a verified patch or a logged refusal.
                {status.data?.llm_repair_enabled
                  ? ' When the rules engine has no confident candidate, a config-gated LLM fallback may propose a mapping once — it passes through the same validation gate or is refused.'
                  : ''}
              </p>
            </div>

            <div className="lp-track-card rv">
              <StationTrack />
              <div className="lp-track-labels">
                {['Classify', 'Gather evidence', 'Propose patch', 'Validate', 'Hot-patch', 'Retry & verify'].map((s) => (
                  <span key={s}>{s}</span>
                ))}
              </div>
            </div>

            <div className="lp-stations">
              <Station index="01" title="Classify" foot="Sorts drift from auth, limits, and outages">
                Is this schema drift — or an expired credential, a rate limit, or a server problem?
              </Station>
              <Station index="02" title="Gather evidence" foot="Reads the live contract">
                Fetches the current schema and diffs it against what the tool last sent successfully.
              </Station>
              <Station index="03" title="Propose patch" foot="Derived from evidence, never guessed">
                Builds a candidate mapping from the diff. No invented fields, no invented values.
              </Station>
              <Station index="04" title="Validate" foot="Four checks before anything changes">
                Confirms types line up, values have a source, nothing is ambiguous, and writes are safe.
              </Station>
              <Station index="05" title="Hot-patch" foot="In memory, no restart">
                Applies the fix to the running registry. The process never restarts, nothing goes cold.
              </Station>
              <Station index="06" title="Retry & verify" foot="Every step written to the audit log">
                Retries within a cap, confirms the upstream result, and records the whole trail.
              </Station>
            </div>
          </div>
        </section>

        {/* ===== OUTCOMES ===== */}
        <section className="lp-section" id="safety">
          <div className="lp-container-md">
            <div className="lp-section-head rv">
              <span className="lp-eyebrow">03 · Safety</span>
              <h2 className="lp-h2">Every failure ends one of three ways.</h2>
              <p className="lp-sub">
                Reflex never forces a result. When the evidence doesn&rsquo;t support a safe fix,
                it stops and says why.
              </p>
            </div>

            <div className="lp-outcomes">
              <div className="lp-outcome rv">
                <div>
                  <div className="lp-outcome-visual">
                    <OutcomeHealed />
                  </div>
                  <span className="lp-outcome-badge" style={{ color: '#146b52' }}>
                    HEALED
                  </span>
                  <p>
                    The evidence points to one safe fix. Reflex patches it, verifies it upstream,
                    and keeps the result cached.
                  </p>
                </div>
                <div className="lp-outcome-foot">Fixed automatically</div>
              </div>

              <div className="lp-outcome rv" style={{ ['--d' as string]: '120ms' }}>
                <div>
                  <div className="lp-outcome-visual">
                    <OutcomeRefused />
                  </div>
                  <span className="lp-outcome-badge" style={{ color: '#8a5b15' }}>
                    REFUSED
                  </span>
                  <p>
                    The mapping is ambiguous, a credential is missing, or a write looks risky.
                    Nothing is guessed — the reason is logged.
                  </p>
                </div>
                <div className="lp-outcome-foot">Stopped safely</div>
              </div>

              <div className="lp-outcome rv" style={{ ['--d' as string]: '240ms' }}>
                <div>
                  <div className="lp-outcome-visual">
                    <OutcomeNotDrift />
                  </div>
                  <span className="lp-outcome-badge" style={{ color: '#5e646e' }}>
                    NOT DRIFT
                  </span>
                  <p>
                    Timeouts, 5xx errors, and revoked credentials aren&rsquo;t schema problems, so they
                    skip the patcher and go straight to normal retries.
                  </p>
                </div>
                <div className="lp-outcome-foot">Passed through</div>
              </div>
            </div>

            <p className="lp-quote rv">&ldquo;A refusal is a result, not a failure.&rdquo;</p>
          </div>
        </section>

        {/* ===== EVIDENCE ===== */}
        <section className="lp-section bg-tint" id="evidence">
          <div className="lp-container-md">
            <div className="lp-section-head rv">
              <span className="lp-eyebrow">04 · Evidence</span>
              <h2 className="lp-h2">Measured against a fixed-schema baseline.</h2>
              <p className="lp-sub">
                Rename, retype, re-nest, and new-header perturbations — replayed against both agents
                under identical conditions.
              </p>
            </div>

            <div className="lp-scorecard rv">
              <div className="lp-score-head">
                <div>Metric</div>
                <div>
                  <span className="lp-dot lp-dot-warn" />
                  Baseline
                </div>
                <div>
                  <span className="lp-dot lp-dot-ok" />
                  Reflex
                </div>
              </div>

              <div className="lp-score-row">
                <div className="lp-score-metric">
                  <strong>Adaptation rate</strong>
                  <div className="lp-score-desc">
                    Share of breaking changes recovered without manual intervention
                  </div>
                </div>
                <div className="lp-score-val">{fmtPct(baseline?.ztar)}</div>
                <div className="lp-score-val lp-score-val-ok">{fmtPct(healing?.ztar)}</div>
              </div>

              <div className="lp-score-row">
                <div className="lp-score-metric">
                  <strong>Median recovery time</strong>
                  <div className="lp-score-desc">
                    From rejected request to verified retry
                  </div>
                </div>
                <div className="lp-score-val">{fmtSecs(baseline?.mttr_median)}</div>
                <div className="lp-score-val lp-score-val-ok">{fmtSecs(healing?.mttr_median)}</div>
              </div>

              <div className="lp-score-row">
                <div className="lp-score-metric">
                  <strong>Wrong patches</strong>
                  <div className="lp-score-desc">
                    Fixes that corrupted data or wrote to the wrong place
                  </div>
                </div>
                <div className="lp-score-val">{fmtNum(baseline?.wrong_patches)}</div>
                <div className="lp-score-val lp-score-val-ok">{fmtNum(healing?.wrong_patches)}</div>
              </div>
            </div>

            <div className="lp-score-note rv">
              <span>
                Figures come from the latest benchmark run recorded by the control API — mock cases, not customer traffic.
              </span>
              <span className="font-mono">n = {fmtNum(metrics.data?.n_records)} runs</span>
            </div>
          </div>
        </section>

        {/* ===== TOPOLOGY ===== */}
        <section className="lp-section bg-navy" id="under-the-hood">
          <div className="lp-container-md">
            <div className="lp-section-head rv">
              <span className="lp-eyebrow">05 · Architecture</span>
              <h2 className="lp-h2">Three parts, clean boundaries.</h2>
              <p className="lp-sub">
                The console observes, the control API decides, the mock API breaks on purpose.
                Secrets never leave the backend.
              </p>
            </div>

            <div className="lp-topology rv">
              <div className="lp-topo-grid">
                <div className="lp-box">
                  <div className="lp-box-title">Console</div>
                  <div className="lp-box-sub">Observe &amp; replay</div>
                  <div className="lp-box-foot">React · live events</div>
                </div>
                <div className="lp-connector">
                  <Connector />
                </div>
                <div className="lp-box lp-box-core">
                  <div className="lp-core-tag">Core</div>
                  <div className="lp-box-title">Control API</div>
                  <div className="lp-box-sub">repair · registry · audit</div>
                  <div className="lp-box-foot">Isolated process</div>
                </div>
                <div className="lp-connector">
                  <Connector />
                </div>
                <div className="lp-box">
                  <div className="lp-box-title">Mock API</div>
                  <div className="lp-box-sub">breaks on purpose</div>
                  <div className="lp-box-foot">Versioned schema</div>
                </div>
              </div>

              <div className="lp-topo-foot">
                <span>Small memory footprint</span>
                <span className="lp-accent">
                  Credentials stay inside the backend boundary.
                </span>
                <span>Full audit trail</span>
              </div>
            </div>
          </div>
        </section>

        {/* ===== CLOSING ===== */}
        <section className="lp-closing">
          <div className="lp-closing-inner rv">
            <span className="lp-closing-eyebrow">Try it in under a minute</span>
            <h2>Break it. Watch it heal.</h2>
            <p>Pick a breaking change, replay it against both agents, and read the full trail.</p>
            <div className="lp-closing-seam">
              <ClosingSeam />
            </div>
            <div className="lp-closing-actions">
              <Link className="lp-btn lp-btn-solid" to="/login">
                Open console
                <Arrow size={15} />
              </Link>
              <a className="lp-btn lp-btn-outline" href="#evidence">
                See the numbers
              </a>
            </div>
            <div className="lp-closing-foot">
              Demo login included · no setup beyond the console
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-brand">
            <span className="lp-brand-mark" style={{ width: 24, height: 24, fontSize: 12 }}>R</span>
            <span>Reflex Registry</span>
            <span className="lp-footer-dot" />
          </div>
          <div className="lp-footer-meta">
            <Link to="/login">Operator sign in</Link>
            <span>Self-healing tool registry under runtime API schema drift</span>
          </div>
        </div>
      </footer>
    </div>
  )
}

function Station({
  index,
  title,
  foot,
  children,
}: {
  index: string
  title: string
  foot: string
  children: ReactNode
}) {
  return (
    <div className="lp-station rv">
      <div>
        <span className="lp-station-num">{index} / 06</span>
        <h3>{title}</h3>
        <p>{children}</p>
      </div>
      <div className="lp-station-foot">
        <Check size={13} />
        {foot}
      </div>
    </div>
  )
}
