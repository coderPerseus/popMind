import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Badge } from '../ui/badge'
import './styles.css'

export default function WelcomeKit() {
  return (
    <div className="welcome-shell">
      <motion.div
        className="welcome-content"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
      >
        <div className="welcome-wordmark">popMind</div>
        <DarkModeToggle />
      </motion.div>
    </div>
  )
}

const DarkModeToggle = () => {
  const [isDarkMode, setIsDarkMode] = useState(false)

  useEffect(() => {
    setIsDarkMode(document.documentElement.classList.contains('dark'))
  }, [])

  const toggleDarkMode = () => {
    document.documentElement.classList.toggle('dark')
    setIsDarkMode(!isDarkMode)
  }

  return (
    <div className="theme-toggle">
      <Badge variant="secondary" onClick={toggleDarkMode}>
        {isDarkMode ? 'Dark' : 'Light'}
      </Badge>
    </div>
  )
}
