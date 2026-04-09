import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout }       from './components/Layout'
import Login            from './pages/Login'
import Overview         from './pages/Overview'
import Database         from './pages/Database'
import DatabaseTable    from './pages/DatabaseTable'
import CronJobs         from './pages/CronJobs'
import Logs             from './pages/Logs'
import Backups          from './pages/Backups'
import Location         from './pages/Location'
import Upload           from './pages/Upload'
import Config           from './pages/Config'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Layout />}>
          <Route path="/"                element={<Overview />} />
          <Route path="/db"              element={<Database />} />
          <Route path="/db/table/:table" element={<DatabaseTable />} />
          <Route path="/crons"           element={<CronJobs />} />
          <Route path="/logs"            element={<Logs />} />
          <Route path="/backups"         element={<Backups />} />
          <Route path="/location"        element={<Location />} />
          <Route path="/upload"          element={<Upload />} />
          <Route path="/config"          element={<Config />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
