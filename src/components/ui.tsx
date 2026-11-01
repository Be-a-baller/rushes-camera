import { useEffect, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'

export function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            aria-label="閉じる"
            className="fixed inset-0 z-40 bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.section
            role="dialog"
            aria-label={title}
            className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[85dvh] w-full max-w-xl flex-col rounded-t-2xl border-t border-line bg-panel pb-[env(safe-area-inset-bottom)]"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
          >
            <header className="flex items-center justify-between px-4 py-2">
              <h2 className="text-base font-semibold">{title}</h2>
              <button aria-label="閉じる" onClick={onClose} className="grid size-11 place-items-center text-dim">
                <X size={20} />
              </button>
            </header>
            <div className="flex flex-col gap-5 overflow-y-auto overscroll-contain px-4 pb-6">{children}</div>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  )
}

export function Segmented<T extends string | number>({ id, label, value, options, onChange, disabled }: {
  id: string
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] text-dim">{label}</span>
      <div role="radiogroup" aria-label={label} className={`flex rounded-lg bg-black p-1 ${disabled ? 'opacity-50' : ''}`}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            role="radio"
            aria-checked={o.value === value}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`relative h-10 min-w-0 flex-1 font-mono text-[13px] ${o.value === value ? 'text-ink' : 'text-fg'}`}
          >
            {o.value === value && (
              <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-md bg-lamp" transition={{ duration: 0.22, ease: 'easeOut' }} />
            )}
            <span className="relative">{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex min-h-11 items-center justify-between gap-4 text-left">
      <span className="min-w-0">
        <span className="block text-[15px]">{label}</span>
        {hint && <span className="block text-[13px] text-dim">{hint}</span>}
      </span>
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ${checked ? 'bg-lamp' : 'bg-raised'}`}>
        <motion.span
          className="absolute top-0.5 left-0.5 size-6 rounded-full bg-fg"
          animate={{ x: checked ? 20 : 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        />
      </span>
    </button>
  )
}
