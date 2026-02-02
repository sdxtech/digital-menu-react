import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './styles/global.css'
import App from './App.tsx'
import { AuthProvider } from './lib/auth'
import { ChefDataProvider } from './lib/chef-data'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ChefDataProvider>
          <App />
        </ChefDataProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
