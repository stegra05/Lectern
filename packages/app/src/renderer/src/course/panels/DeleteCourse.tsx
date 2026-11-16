import { useState } from 'react'
import { useStore } from '../../store.ts'

/**
 * The last thing in a course's details: a quiet way to delete the course. Pressing it only asks,
 * in place, naming the course, what goes and what stays.
 */
export function DeleteCourse() {
  const course = useStore((s) => s.course)
  const sending = useStore((s) => s.sending !== null && s.sending.course === s.course?.id)
  const deleteCourse = useStore((s) => s.deleteCourse)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!course) return null

  if (!asking) {
    return (
      <section className="panel-section panel-section-rule course-delete">
        <button
          type="button"
          className="btn btn-quiet course-delete-action"
          disabled={sending}
          onClick={() => setAsking(true)}
        >
          Delete course
        </button>
      </section>
    )
  }

  return (
    <section
      className="panel-section panel-section-rule course-delete"
      role="group"
      aria-labelledby="course-delete-ask"
    >
      <h2 id="course-delete-ask" className="panel-h2">
        Delete {course.name}?
      </h2>
      <p className="course-delete-text">
        This removes the course, the cards of its lectures and Lectern&rsquo;s copies of your PDFs.
        Its deck in Anki stays as it is, with your progress, and so do your own files.
      </p>
      <div className="course-delete-buttons">
        <button type="button" className="btn" disabled={busy} onClick={() => setAsking(false)}>
          Keep course
        </button>
        <button
          type="button"
          className="btn course-delete-action"
          disabled={busy || sending}
          onClick={() => {
            setBusy(true)
            void deleteCourse().finally(() => setBusy(false))
          }}
        >
          <span className="course-delete-name">Delete {course.name}</span>
        </button>
      </div>
    </section>
  )
}
