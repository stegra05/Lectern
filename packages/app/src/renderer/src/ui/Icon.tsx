/** Line icons on a 16 unit grid, drawn in the current text colour. */

const PATHS = {
  chevronRight: ['M6 3.5 10.5 8 6 12.5'],
  chevronLeft: ['M10 3.5 5.5 8 10 12.5'],
  minus: ['M3.5 8h9'],
  plus: ['M8 3.5v9', 'M3.5 8h9'],
  pencil: ['M10.6 3.2l2.2 2.2-6.9 6.9-2.7.5.5-2.7z', 'M9.4 4.4l2.2 2.2'],
  fit: ['M2.75 6V2.75H6', 'M10 2.75h3.25V6', 'M13.25 10v3.25H10', 'M6 13.25H2.75V10'],
  close: ['M4.5 4.5l7 7', 'M11.5 4.5l-7 7'],
  check: ['M3.5 8.5l3 3 6-7'],
  panel: ['M2.5 3.5h11v9h-11z', 'M9.5 3.5v9'],
  flag: ['M4.5 13.5v-11', 'M4.5 3.5h7l-1.5 2.5 1.5 2.5h-7'],
  gear: [
    'M8 5.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z',
    'M13.2 9.6l1.1.9-1.3 2.2-1.4-.5a5 5 0 0 1-1.4.8L10 14.5H7.4l-.2-1.5a5 5 0 0 1-1.4-.8l-1.4.5-1.3-2.2 1.1-.9a5 5 0 0 1 0-1.6l-1.1-.9 1.3-2.2 1.4.5a5 5 0 0 1 1.4-.8l.2-1.5H10l.2 1.5a5 5 0 0 1 1.4.8l1.4-.5 1.3 2.2-1.1.9a5 5 0 0 1 0 1.6z',
  ],
  key: [
    'M10.5 8.5a3 3 0 1 0-2.6-1.5L2.5 12.4v1.1h2v-1.2h1.3v-1.3h1.3l1.2-1.2a3 3 0 0 0 2.2.7z',
    'M11.2 4.9v.01',
  ],
  card: ['M2.5 3.5h11v9h-11z', 'M5 6.5h6', 'M5 9h3.5'],
  info: ['M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z', 'M8 7.3v3.6', 'M8 5.1v.01'],
  doc: ['M4 2.5h5.5L12 5v8.5H4z', 'M9.5 2.5V5H12'],
  warning: ['M8 2.8 14 13H2z', 'M8 6.8v3', 'M8 11.4v.01'],
} as const

export type IconName = keyof typeof PATHS

export function Icon({
  name,
  size = 14,
  stroke = 1.6,
}: {
  name: IconName
  size?: number
  stroke?: number
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block', flex: 'none' }}
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
