import { useEffect, useState } from 'react'

type WorktableMode = 'native' | 'worktable'

const MODE_KEY = 'dsh.worktable.mode.v1'
const MODE_ERROR_EVENT = 'dsh-worktable-mode-error'
const DESKTOP_RESTART_PATH = '/api/desktop/restart'

function readMode(): WorktableMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'worktable' ? 'worktable' : 'native'
  } catch {
    return 'native'
  }
}

function saveMode(mode: WorktableMode): boolean {
  try {
    localStorage.setItem(MODE_KEY, mode)
    return true
  } catch {
    return false
  }
}

function isWorktableMode(value: unknown): value is WorktableMode {
  return value === 'native' || value === 'worktable'
}

/** The server-side file is authoritative after a Desktop relaunch. */
async function readPersistedMode(): Promise<WorktableMode | null> {
  try {
    const response = await fetch('/api/worktable/mode', { cache: 'no-store' })
    if (!response.ok) return null
    const body = await response.json()
    return body?.persisted === true && isWorktableMode(body?.mode) ? body.mode : null
  } catch {
    return null
  }
}

async function persistMode(mode: WorktableMode) {
  const response = await fetch('/api/worktable/mode', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode }),
  })
  if (response.ok) return

  let detail = ''
  try {
    const body = await response.json()
    if (typeof body?.error === 'string' && body.error) detail = '：' + body.error
  } catch { /* response detail is optional */ }
  throw new Error('模式设置未被保存（HTTP ' + response.status + '）' + detail)
}

function errorMessage(cause: unknown) {
  return cause instanceof Error && cause.message ? cause.message : String(cause)
}

function reportModeError(message: string) {
  try {
    window.dispatchEvent(new CustomEvent<string>(MODE_ERROR_EVENT, { detail: message }))
  } catch {
    console.error('[dsh-worktable] ' + message)
  }
}

/** DSH Desktop owns this same-origin endpoint and queues an orderly relaunch after its response. */
async function requestDesktopRestart() {
  const response = await fetch(DESKTOP_RESTART_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  if (response.status === 202) return

  let detail = ''
  try {
    const body = await response.json()
    if (typeof body?.error === 'string' && body.error) detail = '：' + body.error
  } catch { /* response detail is optional */ }
  throw new Error('Desktop 重启请求未被接受（HTTP ' + response.status + '）' + detail)
}

/** The only UI injected in native mode, so the user can return to worktable mode. */
function ModeSwitchAction() {
  const [mode, setMode] = useState<WorktableMode>(() => readMode())
  const [synced, setSynced] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [error, setError] = useState('')
  const target: WorktableMode = mode === 'worktable' ? 'native' : 'worktable'

  useEffect(() => {
    const onModeError = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail
      setError(detail || '工作台加载失败；请切回原生 Desktop 模式后重试。')
    }
    window.addEventListener(MODE_ERROR_EVENT, onModeError)
    return () => window.removeEventListener(MODE_ERROR_EVENT, onModeError)
  }, [])

  useEffect(() => {
    let disposed = false
    void readPersistedMode().then((persisted) => {
      if (disposed) return
      if (persisted) {
        saveMode(persisted)
        setMode(persisted)
      }
      setSynced(true)
    })
    return () => { disposed = true }
  }, [])

  const switchMode = async () => {
    setRestarting(true)
    setError('')
    try {
      await persistMode(target)
      saveMode(target)
      setMode(target)
      await requestDesktopRestart()
    } catch (cause) {
      setRestarting(false)
      setError('模式未切换，Desktop 未重启：' + errorMessage(cause))
    }
  }

  return (
    <div style={{ display: 'grid', gap: 6, margin: '8px 0', padding: '8px 10px', borderTop: '1px solid rgba(127,127,127,.2)' }}>
      <span style={{ fontSize: 12, opacity: 0.8 }}>{mode === 'worktable' ? '工作台模式已开启' : '原生 Desktop 模式'}</span>
      <button type="button" disabled={restarting || !synced} onClick={switchMode}>
        {restarting ? '正在重启…' : !synced ? '正在读取模式…' : target === 'worktable' ? '开启工作台并重启' : '关闭工作台并重启'}
      </button>
      {error && <span role="alert" style={{ color: '#d68b30', fontSize: 12 }}>{error}</span>}
    </div>
  )
}

// Native mode must be able to mount the return switch even when optional
// worktable-only services are unavailable in a given Desktop build.
export const inject = ['slots']

export function apply(ctx: any) {
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'dsh-worktable-mode',
    order: 19,
  }, ModeSwitchAction), 'dsh-worktable: mode switch')

  // Keep the native bootstrap dependency surface deliberately small.  The
  // complete service set is requested only after the saved mode selects the
  // worktable.
  let worktableMounted = false
  const mountWorktable = () => {
    if (worktableMounted) return
    worktableMounted = true
    const worktableContext = ctx as {
      inject(services: string[], callback: (scoped: any) => void): void
    }
    worktableContext.inject(['locale', 'sessions', 'conversation', 'workspaces'], (scoped) => {
      void import('./worktable')
        .then(({ apply: applyWorktable }) => applyWorktable(scoped))
        .catch((cause) => {
          const message = '工作台加载失败；请切回原生 Desktop 模式后重试：' + errorMessage(cause)
          console.error('[dsh-worktable] ' + message)
          reportModeError(message)
        })
    })
  }

  // Wait for the persistent value before mounting. This avoids a stale
  // renderer localStorage entry overriding the user's last explicit switch.
  void readPersistedMode().then((persisted) => {
    const mode = persisted ?? readMode()
    if (persisted) saveMode(persisted)
    if (mode === 'worktable') mountWorktable()
  })
}
