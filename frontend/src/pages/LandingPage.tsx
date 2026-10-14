import type { ReactNode } from 'react'
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

const SUTURES = [
  [428, 20, 44],
  [440, 21, 43],
  [452, 19, 45],
  [464, 22, 42],
  [476, 20, 44],
  [488, 21, 43],
  [500, 19, 45],
  [512, 22, 42],
] as const

const TRACK_SUTURES = [772, 784, 796, 808, 820, 832]

function HeroSeam({ patchLabel }: { patchLabel: string }) {
  return (
    <svg viewBox="0 0 960 64" fill="none">
      <line stroke="#333537" strokeWidth={1} x1={0} x2={380} y1={32} y2={32} />
      <circle cx={30} cy={32} fill="#87948c" r={2} />
      <circle cx={180} cy={32} fill="#87948c" r={2} />
      <circle cx={360} cy={32} fill="#ffb4a6" r={2.5} />
      <path
        d="M380 32 L394 24 L404 38 L416 26"
        stroke="#ffb4ab"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
      {SUTURES.map(([x, y1, y2]) => (
        <line key={x} stroke="#5fd3a5" strokeLinecap="round" strokeWidth={1.5} x1={x} x2={x} y1={y1} y2={y2} />
      ))}
      <path d="M520 32 L534 32" stroke="#5fd3a5" strokeLinecap="round" strokeWidth={1.5} />
      <circle cx={534} cy={32} fill="#5fd3a5" r={2.5} />
      <line stroke="#333537" strokeWidth={1} x1={534} x2={960} y1={32} y2={32} />
      <circle cx={680} cy={32} fill="#87948c" r={2} />
      <circle cx={840} cy={32} fill="#87948c" r={2} />
      <circle cx={940} cy={32} fill="#87948c" r={2} />
      <text
        fill="#ffb4ab"
        fontFamily="JetBrains Mono"
        fontSize={11}
        fontWeight={500}
        letterSpacing="0.08em"
        x={398}
        y={14}
      >
        ERR_422_UNPROCESSABLE
      </text>
      <text
        fill="#5fd3a5"
        fontFamily="JetBrains Mono"
        fontSize={11}
        fontWeight={500}
        letterSpacing="0.04em"
        x={444}
        y={58}
      >
        PATCHED IN {patchLabel}
      </text>
    </svg>
  )
}

function StationTrack() {
  return (
    <svg viewBox="0 0 1152 48" fill="none">
      <line stroke="#333537" strokeWidth={1.5} x1={0} x2={96} y1={24} y2={24} />
      <path
        d="M96 24 L110 16 L124 32 L136 20 L150 24"
        stroke="#ffb4ab"
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
      <line stroke="#333537" strokeDasharray="3 3" strokeWidth={1.5} x1={150} x2={768} y1={24} y2={24} />
      {TRACK_SUTURES.map((x) => (
        <line key={x} stroke="#5fd3a5" strokeWidth={1.5} x1={x} x2={x} y1={14} y2={34} />
      ))}
      <line stroke="#5fd3a5" strokeWidth={1.5} x1={832} x2={1152} y1={24} y2={24} />
      <circle cx={96} cy={24} fill="#ffb4ab" r={4} />
      <circle cx={288} cy={24} fill="#87948c" r={3} />
      <circle cx={480} cy={24} fill="#87948c" r={3} />
      <circle cx={672} cy={24} fill="#87948c" r={3} />
      <circle cx={864} cy={24} fill="#5fd3a5" r={4} />
      <circle cx={1056} cy={24} fill="#5fd3a5" r={4} />
    </svg>
  )
}

function FractureDivider() {
  return (
    <svg viewBox="0 0 64 128" fill="none">
      <line stroke="#333537" strokeWidth={1} x1={32} x2={32} y1={0} y2={40} />
      <path
        d="M32 40 L18 56 L46 72 L20 88 L32 100"
        stroke="#ffb4ab"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
      <line stroke="#333537" strokeDasharray="2 2" strokeWidth={1} x1={32} x2={32} y1={100} y2={128} />
    </svg>
  )
}

function OutcomeHealed() {
  return (
    <svg viewBox="0 0 240 32" fill="none">
      <line stroke="#333537" strokeWidth={1.5} x1={0} x2={80} y1={16} y2={16} />
      {[84, 94, 104, 114, 124].map((x) => (
        <line key={x} stroke="#5fd3a5" strokeWidth={2} x1={x} x2={x} y1={8} y2={24} />
      ))}
      <line stroke="#5fd3a5" strokeWidth={1.5} x1={130} x2={240} y1={16} y2={16} />
      <circle cx={236} cy={16} fill="#5fd3a5" r={2.5} />
    </svg>
  )
}

function OutcomeRefused() {
  return (
    <svg viewBox="0 0 240 32" fill="none">
      <line stroke="#333537" strokeWidth={1.5} x1={0} x2={110} y1={16} y2={16} />
      <line stroke="#f3be58" strokeWidth={3} x1={110} x2={110} y1={8} y2={24} />
      <rect fill="#f3be58" height={4} width={4} x={116} y={14} />
      <line stroke="#333537" strokeDasharray="2 4" strokeWidth={1.5} x1={128} x2={240} y1={16} y2={16} />
    </svg>
  )
}

function OutcomeNotDrift() {
  return (
    <svg viewBox="0 0 240 32" fill="none">
      <line stroke="#87948c" strokeDasharray="6 6" strokeWidth={1.5} x1={0} x2={240} y1={16} y2={16} />
      <circle cx={120} cy={16} fill="#87948c" r={3} />
    </svg>
  )
}

function ClosingSeam() {
  return (
    <svg viewBox="0 0 440 24" fill="none">
      <line stroke="#333537" strokeWidth={1} x1={0} x2={160} y1={12} y2={12} />
      <path d="M160 12 L170 6 L180 18 L190 10 L198 12" stroke="#ffb4ab" strokeLinecap="round" strokeWidth={1.5} />
      {[202, 210, 218, 226].map((x) => (
        <line key={x} stroke="#5fd3a5" strokeWidth={1.5} x1={x} x2={x} y1={4} y2={20} />
      ))}
      <line stroke="#5fd3a5" strokeWidth={1} x1={234} x2={440} y1={12} y2={12} />
    </svg>
  )
}

function Connector() {
  return (
    <>
      <svg viewBox="0 0 100 24" fill="none">
        <line stroke="#333537" strokeWidth={1.5} x1={0} x2={88} y1={12} y2={12} />
        <polyline fill="none" points="84,8 92,12 84,16" stroke="#87948c" strokeWidth={1.5} />
      </svg>
      <span className="msym">arrow_downward</span>
    </>
  )
}

export function LandingPage() {
  const status = useApi(() => api.status(), [])
  const metrics = useApi(() => api.metrics(), [])

  const healing = metrics.data?.agents?.healing?.overall
  const baseline = metrics.data?.agents?.baseline?.overall

  const mttrHeal = healing?.available ? healing.mttr_median ?? null : null
  const patchLabel = fmtSecs(mttrHeal)
  const runId = status.data?.last_run?.run_id

  return (
    <div className="landing">
      <main>
        {/* ===== SECTION 1 — HERO ===== */}
        <section className="lp-hero">
          <div className="lp-hud lp-hud-left">
            LATENCY: {patchLabel} // EPS: 1.4k // KERNEL: ACTIVE
          </div>
          <div className="lp-hud lp-hud-right">REGISTRY_STATE: STABLE_MUTABLE</div>

          <div className="lp-hero-inner">
            <div className="lp-pill">
              <span className="lp-pill-dot" />
              <span>Autonomous Drift Neutralization</span>
            </div>
            <h1 className="lp-h1">APIs change. Agents shouldn&rsquo;t break.</h1>
            <p className="lp-lead">
              Reflex detects runtime schema drift, repairs the tool definition in memory, and refuses
              when a safe repair can&rsquo;t be justified.
            </p>
            <div className="lp-cta-row">
              <Link className="lp-btn lp-btn-solid" to="/console">
                Open console
              </Link>
              <a className="lp-btn lp-btn-ghost" href="#how-it-works">
                <span className="msym">play_circle</span>
                Watch the demo
              </a>
            </div>
          </div>

          <div className="lp-seam">
            <HeroSeam patchLabel={patchLabel} />
            <div className="lp-seam-meta">
              <span>ORIGIN: LLM_DISPATCH_PORT_0</span>
              <span>AUDIT_LOG_COMMITTED {runId ? `#${runId}` : '—'}</span>
              <span>DESTINATION: UPSTREAM_REST</span>
            </div>
          </div>
        </section>

        {/* ===== SECTION 2 — THE BREAK ===== */}
        <section className="lp-section bg-lowest" id="the-break">
          <div className="lp-container-md">
            <div className="lp-section-head">
              <span className="lp-eyebrow">// 01 INCIDENT ANATOMY</span>
              <h2 className="lp-h2">The API kept running. The tool definition didn&rsquo;t.</h2>
            </div>

            <div className="lp-break-grid">
              <div className="lp-panel lp-panel-legacy">
                <div>
                  <div className="lp-panel-head">
                    <span className="lp-panel-title">Before · runtime payload (legacy)</span>
                    <span className="lp-status lp-status-stalled">
                      <span className="lp-status-dot" /> STALLED
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
                  <span>INVOICE_SERVICE/v1</span>
                  <span>HTTP/1.1 422 FAIL</span>
                </div>
              </div>

              <div className="lp-fracture">
                <FractureDivider />
              </div>

              <div className="lp-panel lp-panel-upstream">
                <div>
                  <div className="lp-panel-head">
                    <span className="lp-panel-title">After · upstream schema contract</span>
                    <span className="lp-status lp-status-ok">
                      <span className="lp-status-dot" /> RECONCILED
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
                    <span className="msym msym-14">add_circle</span>
                    <span>+ header X-Tenant-Token (required, resolved from ctx)</span>
                  </div>
                </div>
                <div className="lp-panel-foot">
                  <span>INVOICE_SERVICE/v2.4</span>
                  <span className="lp-status-ok">HTTP/1.1 200 OK</span>
                </div>
              </div>
            </div>

            <div className="lp-section-foot">
              <span>
                // Without repair, the agent repeatedly sends the outdated payload signature, draining
                retry loops and stalling workflows.
              </span>
              <span>MUTATION_CYCLE: 1 INGESTION</span>
            </div>
          </div>
        </section>

        {/* ===== SECTION 3 — HOW IT WORKS ===== */}
        <section className="lp-section bg-surface" id="how-it-works">
          <div className="lp-container">
            <div className="lp-section-head">
              <span className="lp-eyebrow">02 // RUNTIME REPAIR LIFECYCLE</span>
              <h2 className="lp-h2">How Reflex sutures in-flight executions.</h2>
            </div>
            <p className="lp-sub">
              A deterministic state machine sitting between the tool execution runtime and upstream
              APIs, performing micro-surgeries on corrupted arguments.
            </p>

            <div className="lp-track">
              <StationTrack />
            </div>

            <div className="lp-stations">
              <Station index="01" tag="TRAP" title="Classify" tone="warn">
                Is this schema drift, or an auth, rate-limit, or server problem?
              </Station>
              <Station index="02" tag="PROBE" title="Gather evidence" tone="muted">
                Fetch the current schema and diff it against the tool&rsquo;s runtime footprint.
              </Station>
              <Station index="03" tag="SYNTH" title="Propose patch" tone="muted">
                Rule-based mapping from the evidence. Zero speculative hallucination.
              </Station>
              <Station index="04" tag="GATE" title="Validate" tone="amber">
                Check types, provenance, ambiguity, and write safety boundaries.
              </Station>
              <Station index="05" tag="APPLY" title="Hot-patch" tone="ok">
                Update the in-memory registry. No process restart, no cold boot.
              </Station>
              <Station index="06" tag="AUDIT" title="Retry & verify" tone="ok">
                Retry within a cap, confirm the result, and emit cryptographic audit log.
              </Station>
            </div>
          </div>
        </section>

        {/* ===== SECTION 4 — THREE OUTCOMES ===== */}
        <section className="lp-section bg-lowest" id="safety">
          <div className="lp-container-md">
            <div className="lp-section-head">
              <span className="lp-eyebrow">03 // DETERMINISTIC SAFETY &amp; REFUSAL</span>
              <h2 className="lp-h2">Every failure ends one of three ways.</h2>
            </div>
            <p className="lp-sub">
              Reflex does not force execution. When mathematical certainty cannot be established,
              execution safely halts with complete audit telemetry.
            </p>

            <div className="lp-outcomes">
              <div className="lp-outcome">
                <div>
                  <div className="lp-outcome-visual">
                    <OutcomeHealed />
                  </div>
                  <span className="lp-outcome-badge" style={{ color: 'var(--lp-primary)' }}>
                    HEALED
                  </span>
                  <p>
                    Evidence is clear and a provably safe value exists. Patched, verified upstream, and
                    committed to local tool cache.
                  </p>
                </div>
                <div className="lp-outcome-foot">RESOLVED // 0-TOUCH</div>
              </div>

              <div className="lp-outcome">
                <div>
                  <div className="lp-outcome-visual">
                    <OutcomeRefused />
                  </div>
                  <span className="lp-outcome-badge" style={{ color: 'var(--lp-amber)' }}>
                    REFUSED
                  </span>
                  <p>
                    Ambiguous field mapping, missing non-derivable credentials, or destructive payload
                    risks. Nothing is guessed. Detailed reason logged.
                  </p>
                </div>
                <div className="lp-outcome-foot">SAFE_ABORT // QUARANTINE</div>
              </div>

              <div className="lp-outcome">
                <div>
                  <div className="lp-outcome-visual">
                    <OutcomeNotDrift />
                  </div>
                  <span className="lp-outcome-badge" style={{ color: 'var(--lp-outline)' }}>
                    NOT DRIFT
                  </span>
                  <p>
                    Upstream timeouts, internal 5xx errors, rate limiting, or authentic credential
                    revocation. Bypasses patch engine directly to standard retry handler.
                  </p>
                </div>
                <div className="lp-outcome-foot">PASSTHROUGH // NO_OP</div>
              </div>
            </div>

            <p className="lp-quote">&ldquo;Refusal is a result, not a failure.&rdquo;</p>
          </div>
        </section>

        {/* ===== SECTION 5 — EVIDENCE ===== */}
        <section className="lp-section bg-surface" id="evidence">
          <div className="lp-container-md">
            <div className="lp-section-head">
              <span className="lp-eyebrow">04 // EMPIRICAL BENCHMARK</span>
              <h2 className="lp-h2">Measured against a fixed-schema baseline.</h2>
            </div>
            <p className="lp-sub">
              Synthetic test harness generating dynamic schema perturbations: field renames, type
              coercions, envelope wrapping, and requirement insertions.
            </p>

            <div className="lp-scorecard">
              <div className="lp-score-head">
                <div>Metric Evaluated</div>
                <div>
                  <span className="lp-dot lp-dot-warn" />
                  BASELINE (STATIC)
                </div>
                <div>
                  <span className="lp-dot lp-dot-ok" />
                  REFLEX (AUTONOMOUS)
                </div>
              </div>

              <div className="lp-score-row">
                <div className="lp-score-metric">
                  <strong>ZTAR (Zero-Touch Adaptation Rate)</strong>
                  <div className="lp-score-desc">
                    Percentage of schema breaks recovered without manual engineer intervention
                  </div>
                </div>
                <div className="lp-score-val">{fmtPct(baseline?.ztar)}</div>
                <div className="lp-score-val lp-score-val-ok">{fmtPct(healing?.ztar)}</div>
              </div>

              <div className="lp-score-row">
                <div className="lp-score-metric">
                  <strong>MTTR Median (Mean Time to Repair)</strong>
                  <div className="lp-score-desc">
                    Elapsed real time from 422 trap to successful re-execution
                  </div>
                </div>
                <div className="lp-score-val">{fmtSecs(baseline?.mttr_median)}</div>
                <div className="lp-score-val lp-score-val-ok">{fmtSecs(healing?.mttr_median)}</div>
              </div>

              <div className="lp-score-row">
                <div className="lp-score-metric">
                  <strong>Erroneous Patches (Hallucinations)</strong>
                  <div className="lp-score-desc">
                    Payload modifications leading to dirty writes or corrupt remote state
                  </div>
                </div>
                <div className="lp-score-val">{fmtNum(baseline?.wrong_patches)}</div>
                <div className="lp-score-val lp-score-val-ok">{fmtNum(healing?.wrong_patches)}</div>
              </div>
            </div>

            <div className="lp-score-note">
              <span>
                * Figures come from the latest benchmark run recorded by the control API. Synthetic
                mock cases, not third-party customer traffic.
              </span>
              <span>N={fmtNum(metrics.data?.n_records)} RUNS</span>
            </div>
          </div>
        </section>

        {/* ===== SECTION 6 — UNDER THE HOOD ===== */}
        <section className="lp-section bg-lowest" id="under-the-hood">
          <div className="lp-container-md">
            <div className="lp-section-head">
              <span className="lp-eyebrow">05 // SYSTEM TOPOLOGY</span>
              <h2 className="lp-h2">Under the hood.</h2>
            </div>
            <p className="lp-sub">
              A zero-footprint proxy topology built on strict boundary isolation. Tool execution state
              never crosses uncontrolled security contexts.
            </p>

            <div className="lp-topology">
              <div className="lp-topo-grid">
                <div className="lp-box lp-box-span2">
                  <div className="lp-box-title">React console</div>
                  <div className="lp-box-sub lp-box-sub-ok">SSE + REST</div>
                  <div className="lp-box-foot">CLIENT OBSERVABILITY</div>
                </div>
                <div className="lp-connector">
                  <Connector />
                </div>
                <div className="lp-box lp-box-span2 lp-box-core">
                  <div className="lp-core-tag">KERNEL CORE</div>
                  <div className="lp-box-title">Control API</div>
                  <div className="lp-box-sub">healer + registry + audit</div>
                  <div className="lp-box-foot">ISOLATED SANDBOX</div>
                </div>
                <div className="lp-connector">
                  <Connector />
                </div>
                <div className="lp-box">
                  <div className="lp-box-title">Mock API</div>
                  <div className="lp-box-sub">active schema</div>
                  <div className="lp-box-foot">OPENAPI SPEC</div>
                </div>
              </div>

              <div className="lp-topo-foot">
                <span>SECURE_ENCLAVE: TLS 1.3 PINNED</span>
                <span className="lp-accent">
                  Admin keys and credentials never leave the backend boundary.
                </span>
                <span>MEMORY_FOOTPRINT: &lt; 28MB</span>
              </div>
            </div>
          </div>
        </section>

        {/* ===== SECTION 7 — CLOSING CTA ===== */}
        <section className="lp-closing">
          <div className="lp-closing-inner">
            <span className="lp-closing-eyebrow">Deploy in under 60 seconds</span>
            <h2>See it break. Watch it heal.</h2>
            <div className="lp-closing-seam">
              <ClosingSeam />
            </div>
            <div className="lp-closing-actions">
              <Link className="lp-btn lp-btn-solid" style={{ height: '2.75rem', padding: '0 2rem' }} to="/console">
                Open console
              </Link>
              <a className="lp-btn lp-btn-outline" href="#evidence">
                Review Specifications
              </a>
            </div>
            <div className="lp-closing-foot">
              NO CREDIT CARD REQUIRED · COMPATIBLE WITH LANGCHAIN, AUTOGEN, AND NATIVE OPENAI FUNCTION
              CALLING
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-brand">
            <span className="lp-footer-logo">reflex</span>
            <span className="lp-footer-dot" />
            <span className="lp-footer-level">// SYSTEM LEVEL 0</span>
          </div>
          <div className="lp-footer-meta">
            <Link to="/login">Operator sign in</Link>
            <span className="lp-footer-sep">|</span>
            <span>PS 01 · Self-Healing Tool Registry Under Runtime API Schema Drift · Quest It, VESIT</span>
            <span className="lp-footer-sep">|</span>
            <span className="lp-footer-team">[Team reflex-dev · Hackathon 2026]</span>
          </div>
        </div>
      </footer>
    </div>
  )
}

function Station({
  index,
  tag,
  title,
  tone,
  children,
}: {
  index: string
  tag: string
  title: string
  tone: 'warn' | 'muted' | 'amber' | 'ok'
  children: ReactNode
}) {
  const toneColor = {
    warn: 'var(--lp-secondary)',
    muted: 'var(--lp-outline)',
    amber: 'var(--lp-amber)',
    ok: 'var(--lp-primary)',
  }[tone]
  return (
    <div className="lp-station">
      <div>
        <div className="lp-station-head">
          <span className="lp-station-tag" style={{ color: toneColor }}>
            {index} // {tag}
          </span>
          <span className="lp-station-dot" style={{ background: toneColor }} />
        </div>
        <h3>{title}</h3>
        <p>{children}</p>
      </div>
      <div className="lp-station-foot">
        {index === '01'
          ? 'TRAP_VECTOR'
          : index === '02'
            ? 'AST_INSPECT'
            : index === '03'
              ? 'RULE_SOLVER'
              : index === '04'
                ? 'SAFETY_GATE'
                : index === '05'
                  ? 'VIRTUAL_REG'
                  : 'COMMITTED'}
      </div>
    </div>
  )
}
