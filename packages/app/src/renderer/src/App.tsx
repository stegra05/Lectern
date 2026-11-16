import { useEffect } from 'react'
import { CourseScreen } from './course/CourseScreen.tsx'
import { Courses } from './screens/Courses.tsx'
import { FirstRun } from './screens/FirstRun.tsx'
import { Settings } from './screens/Settings.tsx'
import { useStore } from './store.ts'

export function App() {
  const screen = useStore((s) => s.screen)
  const start = useStore((s) => s.start)
  useEffect(() => {
    void start()
  }, [start])

  switch (screen) {
    case 'loading':
      return null
    case 'first-run':
      return <FirstRun />
    case 'courses':
      return <Courses />
    case 'course':
      return <CourseScreen />
    case 'settings':
      return <Settings />
  }
}
