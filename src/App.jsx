import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { BackendProvider } from './contexts/BackendContext'
import { Layout }       from './components/Layout'
import Login            from './pages/Login'
import Overview         from './pages/Overview'
import Database         from './pages/Database'
import DatabaseTable    from './pages/DatabaseTable'
import Schedule         from './pages/Schedule'
import Logs             from './pages/Logs'
import Backups          from './pages/Backups'
import Location         from './pages/Location'
import Upload           from './pages/Upload'
import Config           from './pages/Config'
import Trevor           from './pages/Trevor'
import Codex           from './pages/Codex'
import ML              from './pages/ML'
import Places          from './pages/Places'

export default function App() {
  return (
    <BackendProvider>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Layout />}>
          <Route path="/"                element={<Overview />} />
          <Route path="/db"              element={<Database />} />
          <Route path="/db/table/:table" element={<DatabaseTable />} />
          <Route path="/crons"           element={<Schedule />} />
          <Route path="/logs"            element={<Logs />} />
          <Route path="/backups"         element={<Backups />} />
          <Route path="/location"        element={<Location />} />
          <Route path="/upload"          element={<Upload />} />
          <Route path="/config"          element={<Config />} />
          <Route path="/trevor"          element={<Trevor />} />
          <Route path="/codex"           element={<Codex />} />
          <Route path="/ml"              element={<ML />} />
          <Route path="/places"          element={<Places />} />
        </Route>
      </Routes>
    </BrowserRouter>
    </BackendProvider>
  )
}
