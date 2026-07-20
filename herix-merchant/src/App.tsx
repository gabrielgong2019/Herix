import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './contexts/AuthContext'
import { AppLayout } from './components/layout/AppLayout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Tasks from './pages/Tasks'
import TaskForm from './pages/TaskForm'
import TaskDetail from './pages/TaskDetail'
import TaskMetaEdit from './pages/TaskMetaEdit'
import Reviews from './pages/Reviews'
import Wallet from './pages/Wallet'
import Settings from './pages/Settings'
import DataUpload from './pages/DataUpload'
import Onboard from './pages/Onboard'
import PartnerTasks from './pages/PartnerTasks'
import PartnerTaskDetail from './pages/PartnerTaskDetail'

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
})

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <BrowserRouter basename="/merchant">
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/onboard" element={<Onboard />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/tasks" element={<Tasks />} />
              <Route path="/tasks/new" element={<TaskForm />} />
              <Route path="/tasks/:id" element={<TaskDetail />} />
              <Route path="/tasks/:id/edit" element={<TaskForm />} />
              <Route path="/tasks/:id/meta" element={<TaskMetaEdit />} />
              <Route path="/partner" element={<PartnerTasks />} />
              <Route path="/partner/:id" element={<PartnerTaskDetail />} />
              <Route path="/reviews" element={<Reviews />} />
              <Route path="/wallet" element={<Wallet />} />
              <Route path="/csv" element={<DataUpload />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
