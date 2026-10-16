import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './styles/global.css'
import 'bootstrap-icons/font/bootstrap-icons.css'
import App from './App.tsx'
import { AuthProvider } from './lib/auth'
import { ChefDataProvider } from './lib/chef-data'
import { QueryProvider } from './lib/QueryProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <QueryProvider>
          <ChefDataProvider>
            <App />
          </ChefDataProvider>
        </QueryProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
