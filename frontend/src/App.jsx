import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import LandingPage from './pages/LandingPage';
import NotFound from './pages/NotFound';
import DashboardLayout from './layouts/DashboardLayout';
import DashboardOverview from './pages/dashboard/DashboardOverview';
import TunnelView from './pages/dashboard/TunnelView';
const TunnelTwin = lazy(() => import('./pages/twin/TunnelTwin'));
import Inspections from './pages/dashboard/Inspections';
import InspectionVideos from './pages/dashboard/InspectionVideos';
import AIDetections from './pages/dashboard/AIDetections';
import DefectDetail from './pages/dashboard/DefectDetail';
import MapsLocation from './pages/dashboard/MapsLocation';
import Reports from './pages/dashboard/Reports';
import Assets from './pages/dashboard/Assets';
import Settings from './pages/dashboard/Settings';
const NewInspection = lazy(() => import('./pages/inspection/NewInspection'));
import Users from './pages/dashboard/Users';
import Login from './auth/Login';
import Register from './auth/Register';
import { AuthProvider } from './auth/AuthContext';
import ProtectedRoute from './auth/ProtectedRoute';
import { DiveProvider } from './ui/DiveProvider';
import { ToastProvider } from './ui/ToastProvider';
import { SonarRings } from './ui/Sonar';
import { PERMISSIONS } from './auth/permissions';

function RouteFallback() {
  return (
    <div className="auth-loading" role="status" aria-live="polite" style={{ position: 'relative' }}>
      <SonarRings className="sonar--small" />
      <span>Loading…</span>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
      <DiveProvider>
      <ToastProvider>
      <ErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
        <Routes>
        {/* Landing page */}
        <Route path="/" element={<LandingPage />} />

        {/* Immersive 3D digital twin of the tunnel */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/tunnel-twin" element={<ProtectedRoute><TunnelTwin /></ProtectedRoute>} />
        <Route path="/twin" element={<ProtectedRoute><TunnelTwin /></ProtectedRoute>} />

        {/* New Inspection — full page under DashboardLayout */}
        <Route path="/inspection" element={<ProtectedRoute permission={PERMISSIONS.DETECTIONS_CREATE}><DashboardLayout /></ProtectedRoute>}>
          <Route path="new" element={<NewInspection />} />
        </Route>

        {/* Route aliases for navigation consistency */}
        <Route path="/analytics" element={<Navigate to="/dashboard/tunnel" replace />} />
        <Route path="/reports" element={<Navigate to="/dashboard/reports" replace />} />

        {/* Dashboard — all nested under DashboardLayout */}
        <Route path="/dashboard" element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
          <Route index element={<DashboardOverview />} />
          <Route path="tunnel" element={<TunnelView />} />
          <Route path="tunnel-twin" element={<TunnelTwin />} />
          <Route path="twin" element={<TunnelTwin />} />
          <Route path="analytics" element={<TunnelView />} />
          <Route path="inspection/new" element={<ProtectedRoute permission={PERMISSIONS.DETECTIONS_CREATE}><NewInspection /></ProtectedRoute>} />
          <Route path="inspections" element={<Inspections />} />
          <Route path="inspections/videos" element={<InspectionVideos />} />
          <Route path="detections" element={<AIDetections />} />
          <Route path="detections/:id" element={<DefectDetail />} />
          <Route path="maps" element={<MapsLocation />} />
          <Route path="reports" element={<Reports />} />
          <Route path="assets" element={<Assets />} />
          <Route path="settings" element={<Settings />} />
          <Route path="users" element={<ProtectedRoute permission={PERMISSIONS.USERS_MANAGE}><Users /></ProtectedRoute>} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<NotFound />} />
      </Routes>
        </Suspense>
    </ErrorBoundary>
      </ToastProvider>
      </DiveProvider>
      </AuthProvider>
  </BrowserRouter>
  );
}
