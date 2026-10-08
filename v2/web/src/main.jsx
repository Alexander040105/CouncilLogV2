import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import { ThemeProvider } from './lib/theme';
import { ToastProvider } from './lib/toast';
import { ErrorBoundary, PageLoader } from './components/ui';
import { AppShell } from './components/AppShell';
import { UpdatePrompt } from './components/UpdatePrompt';
import { setAuthFailureHandler } from './lib/api';
import { supabase } from './lib/supabase';
import { setCurrentOrg, setOrgPicked } from './lib/org';
import Login from './pages/Login';
import AuthCallback from './pages/AuthCallback';
import ResetPassword from './pages/ResetPassword';
import Onboarding from './pages/Onboarding';
import './index.css';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Journal = lazy(() => import('./pages/Journal'));
const Attendance = lazy(() => import('./pages/Attendance'));
const Projects = lazy(() => import('./pages/Projects'));
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'));
const Budget = lazy(() => import('./pages/Budget'));
const FinancialReport = lazy(() => import('./pages/FinancialReport'));
const Tasks = lazy(() => import('./pages/Tasks'));
const Agenda = lazy(() => import('./pages/Agenda'));
const Documents = lazy(() => import('./pages/Documents'));
const DocumentDetail = lazy(() => import('./pages/DocumentDetail'));
const Members = lazy(() => import('./pages/Members'));
const Guide = lazy(() => import('./pages/Guide'));
const Settings = lazy(() => import('./pages/Settings'));
const Account = lazy(() => import('./pages/Account'));
const Admin = lazy(() => import('./pages/Admin'));
const OrgPicker = lazy(() => import('./pages/OrgPicker'));
const NotFound = lazy(() => import('./pages/NotFound'));

// Lazy pages suspend inside AppShell's Outlet — the shell stays mounted.
const P = (Page) => (
  <Suspense fallback={<PageLoader />}><Page /></Suspense>
);

// API 401s → kill the session and bounce to /login (registered once).
setAuthFailureHandler(() => {
  supabase.auth.signOut();
  setCurrentOrg(null);
  setOrgPicked(false);
  location.assign('/login');
});

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      // 30s default floor: kills refetch-on-mount chatter against a
      // serverless API. Refetch-on-focus off globally — mutations already
      // invalidate their own keys; focus-refetch doubled request volume on
      // every tab switch for no visible gain.
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Org config changes at the speed of a semester, not a session — 5min stale
// window on the near-static keys (pairs with the API's 60s cache tier).
for (const key of ['positions', 'members', 'templates', 'chains', 'contacts',
                   'duty', 'orgchart', 'school-years', 'projects', 'org']) {
  qc.setQueryDefaults([key], { staleTime: 5 * 60_000 });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <ThemeProvider>
      <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <ErrorBoundary>
          <UpdatePrompt />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route element={<AppShell />}>
              <Route index element={P(Dashboard)} />
              <Route path="orgs" element={P(OrgPicker)} />
              <Route path="journal" element={P(Journal)} />
              <Route path="attendance" element={P(Attendance)} />
              <Route path="projects" element={P(Projects)} />
              <Route path="projects/:id" element={P(ProjectDetail)} />
              <Route path="projects/:id/report" element={P(FinancialReport)} />
              <Route path="budget" element={P(Budget)} />
              <Route path="tasks" element={P(Tasks)} />
              <Route path="agenda" element={P(Agenda)} />
              <Route path="documents" element={P(Documents)} />
              <Route path="documents/:id" element={P(DocumentDetail)} />
              <Route path="members" element={P(Members)} />
              <Route path="guide" element={P(Guide)} />
              <Route path="settings/*" element={P(Settings)} />
              <Route path="account" element={P(Account)} />
              <Route path="admin" element={P(Admin)} />
              <Route path="*" element={P(NotFound)} />
            </Route>
          </Routes>
          </ErrorBoundary>
        </BrowserRouter>
      </AuthProvider>
      </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
