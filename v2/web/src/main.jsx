import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import { ThemeProvider } from './lib/theme';
import { ToastProvider } from './lib/toast';
import { ErrorBoundary } from './components/ui';
import { AppShell } from './components/AppShell';
import { setAuthFailureHandler } from './lib/api';
import { supabase } from './lib/supabase';
import { setCurrentOrg } from './lib/org';
import Login from './pages/Login';
import AuthCallback from './pages/AuthCallback';
import ResetPassword from './pages/ResetPassword';
import Onboarding from './pages/Onboarding';
import Dashboard from './pages/Dashboard';
import Journal from './pages/Journal';
import Attendance from './pages/Attendance';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import Tasks from './pages/Tasks';
import Documents from './pages/Documents';
import DocumentDetail from './pages/DocumentDetail';
import Members from './pages/Members';
import Guide from './pages/Guide';
import Settings from './pages/Settings';
import Account from './pages/Account';
import Admin from './pages/Admin';
import NotFound from './pages/NotFound';
import './index.css';

// API 401s → kill the session and bounce to /login (registered once).
setAuthFailureHandler(() => {
  supabase.auth.signOut();
  setCurrentOrg(null);
  location.assign('/login');
});

const qc = new QueryClient();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <ThemeProvider>
      <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <ErrorBoundary>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route element={<AppShell />}>
              <Route index element={<Dashboard />} />
              <Route path="journal" element={<Journal />} />
              <Route path="attendance" element={<Attendance />} />
              <Route path="projects" element={<Projects />} />
              <Route path="projects/:id" element={<ProjectDetail />} />
              <Route path="tasks" element={<Tasks />} />
              <Route path="documents" element={<Documents />} />
              <Route path="documents/:id" element={<DocumentDetail />} />
              <Route path="members" element={<Members />} />
              <Route path="guide" element={<Guide />} />
              <Route path="settings/*" element={<Settings />} />
              <Route path="account" element={<Account />} />
              <Route path="admin" element={<Admin />} />
              <Route path="*" element={<NotFound />} />
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
