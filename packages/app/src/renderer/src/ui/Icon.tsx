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
    'M8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z',
    'M6.81 3.56L6.82 1.81A6.3 6.3 0 0 1 9.18 1.81L9.19 3.56A4.6 4.6 0 0 1 11.25 4.75L12.77 3.88A6.3 6.3 0 0 1 13.95 5.93L12.44 6.81A4.6 4.6 0 0 1 12.44 9.19L13.95 10.07A6.3 6.3 0 0 1 12.77 12.12L11.25 11.25A4.6 4.6 0 0 1 9.19 12.44L9.18 14.19A6.3 6.3 0 0 1 6.82 14.19L6.81 12.44A4.6 4.6 0 0 1 4.75 11.25L3.23 12.12A6.3 6.3 0 0 1 2.05 10.07L3.56 9.19A4.6 4.6 0 0 1 3.56 6.81L2.05 5.93A6.3 6.3 0 0 1 3.23 3.88L4.75 4.75A4.6 4.6 0 0 1 6.81 3.56Z',
  ],
  key: [
    'M5.25 8a2.75 2.75 0 1 0 0 5.5 2.75 2.75 0 0 0 0-5.5z',
    'M7.2 8.8l6.3-6.3',
    'M11.4 4.6l1.5 1.5',
    'M9.6 6.4l1.2 1.2',
  ],
  card: ['M2.5 3.5h11v9h-11z', 'M5 6.5h6', 'M5 9h3.5'],
  info: ['M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z', 'M8 7.3v3.6', 'M8 5.1v.01'],
  doc: ['M4 2.5h5.5L12 5v8.5H4z', 'M9.5 2.5V5H12'],
  warning: ['M8 2.8 14 13H2z', 'M8 6.5v2.3', 'M8 11v.01'],
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
