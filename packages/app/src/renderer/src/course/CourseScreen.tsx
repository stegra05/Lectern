import { useState, type DragEvent } from 'react'
import { CourseMap } from '../map/CourseMap.tsx'
import { useStore } from '../store.ts'
import { Icon } from '../ui/Icon.tsx'
import { Segmented } from '../ui/Segmented.tsx'
import { TitleBar } from '../ui/TitleBar.tsx'
import { BottomBar } from './BottomBar.tsx'
import { CopyForChat } from './CopyForChat.tsx'
import { SidePanel } from './SidePanel.tsx'
import './course.css'

/**
 * The frame inside a course, the same before and after generation: title bar, the map edge to
 * edge, the slim bar at the bottom and the one side panel. PDFs can be dropped anywhere on it.
 */
export function CourseScreen() {
  const course = useStore((s) => s.course)
  const openCourses = useStore((s) => s.openCourses)
  const openSettings = useStore((s) => s.openSettings)
  const addFiles = useStore((s) => s.addFiles)
  const running = useStore((s) => s.run !== null)
  const [dropping, setDropping] = useState(false)

  if (!course) return null

  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files')

  return (
    <div
      className="course-screen"
      onDragOver={(event) => {
        if (running || !hasFiles(event)) return
        event.preventDefault()
        setDropping(true)
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDropping(false)
      }}
      onDrop={(event) => {
        if (running || !hasFiles(event)) return
        event.preventDefault()
        setDropping(false)
        void addFiles([...event.dataTransfer.files])
      }}
    >
      <CourseMap />
      <TitleBar
        left={
          <nav aria-label="Location" style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <button type="button" className="crumb" onClick={() => void openCourses()}>
              Courses
            </button>
            <span className="crumb-sep">
              <Icon name="chevronRight" size={11} stroke={1.7} />
            </span>
            <b className="crumb-here">{course.name}</b>
          </nav>
        }
        centre={
          <Segmented
            label="Map view"
            value="lectures"
            onChange={() => {}}
            segments={[
              { value: 'lectures', label: 'Lectures' },
              {
                value: 'themes',
                label: 'Themes',
                disabled: true,
                title: 'Themes across lectures come in a later version.',
              },
            ]}
          />
        }
        right={
          <button type="button" className="icon-btn" aria-label="Settings" onClick={openSettings}>
            <Icon name="gear" size={16} stroke={1.3} />
          </button>
        }
      />
      <CopyForChat />
      <SidePanel />
      <BottomBar />
      {dropping && (
        <div className="drop-veil" aria-hidden="true">
          <div className="drop-veil-card material">
            <Icon name="doc" size={20} stroke={1.3} />
            <b>Drop your lecture PDFs</b>
            <span className="t-secondary">
              One PDF per lecture. They join the track in course order.
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
