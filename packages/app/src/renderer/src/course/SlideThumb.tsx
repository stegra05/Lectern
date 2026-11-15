import { useEffect, useRef, useState } from 'react'
import { lectureColour, two } from '../lecture.ts'

/** Slide pictures for this session, by course, lecture and slide. Null: the engine has none. */
const cache = new Map<string, Promise<string | null>>()

/**
 * The one lazy picture load outside the store: a slide is asked for only once its row scrolls
 * into view, so a lecture of 50 cards does not render 50 slides up front.
 */
function load(course: string, lecture: number, slide: number): Promise<string | null> {
  const key = `${course}/${lecture}/${slide}`
  let found = cache.get(key)
  if (!found) {
    found = (async () => {
      let png = null as string | null
      await window.lectern.run({ type: 'slide', course, lecture, slide }, (event) => {
        if (event.type === 'slide') png = event.png
      })
      return png ? `data:image/png;base64,${png}` : null
    })().catch(() => null)
    cache.set(key, found)
  }
  return found
}

export function SlideThumb({
  course,
  lecture,
  slide,
}: {
  course: string
  lecture: number
  slide: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    let live = true
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      observer.disconnect()
      void load(course, lecture, slide).then((url) => {
        if (live) setSrc(url)
      })
    })
    observer.observe(element)
    return () => {
      live = false
      observer.disconnect()
    }
  }, [course, lecture, slide])

  const label = `Slide ${slide} of lecture ${two(lecture)}`
  if (src) {
    return (
      <div ref={ref} className="panel-thumb">
        <img src={src} alt={label} />
      </div>
    )
  }
  // Line lengths vary with the slide number, so neighbouring stand-ins do not look copied.
  const widths = [44, 30 + ((slide * 7) % 16), 28 + ((slide * 11) % 18)]
  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      className="panel-thumb panel-thumb-drawn"
      style={{ ['--thumb-colour' as string]: lectureColour(lecture) }}
    >
      <i style={{ width: 34 }} />
      {widths.map((w, i) => (
        <i key={i} style={{ width: w }} />
      ))}
      <span className="panel-thumb-number num">{slide}</span>
    </div>
  )
}
