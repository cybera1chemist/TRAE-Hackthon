import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { AppProviders } from './app/providers'
import { ErrorBoundary } from './app/ErrorBoundary'
import { router } from './app/router'
import { initTheme } from './app/theme'
import './styles/index.css'
import './styles/theme.css'
import './styles/fonts.css'

initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    </ErrorBoundary>
  </StrictMode>,
)
