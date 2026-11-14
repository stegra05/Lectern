import './controls.css'

export interface Segment<T extends string> {
  value: T
  label: string
  disabled?: boolean
  /** Why the segment cannot be chosen, shown as a tooltip. */
  title?: string
}

/** A two or three way switch, the system's segmented control. */
export function Segmented<T extends string>({
  label,
  value,
  segments,
  onChange,
  large,
}: {
  label: string
  value: T
  segments: Segment<T>[]
  onChange: (value: T) => void
  large?: boolean
}) {
  return (
    <div role="group" aria-label={label} className={large ? 'segmented large' : 'segmented'}>
      {segments.map((s) => (
        <button
          key={s.value}
          type="button"
          aria-pressed={s.value === value}
          disabled={s.disabled}
          title={s.title}
          onClick={() => onChange(s.value)}
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}
