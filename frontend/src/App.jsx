import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import DashboardLayout from './layouts/DashboardLayout';
import DashboardOverview from './pages/dashboard/DashboardOverview';
import TunnelView from './pages/dashboard/TunnelView';
import TunnelTwin from './pages/twin/TunnelTwin';
import Inspections from './pages/dashboard/Inspections';
import InspectionVideos from './pages/dashboard/InspectionVideos';
import AIDetections from './pages/dashboard/AIDetections';
import DefectDetail from './pages/dashboard/DefectDetail';
import MapsLocation from './pages/dashboard/MapsLocation';
import Reports from './pages/dashboard/Reports';
import Assets from './pages/dashboard/Assets';
import Settings from './pages/dashboard/Settings';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Landing page */}
        <Route path="/" element={<LandingPage />} />

        {/* Immersive 3D Digital Twin Rover Simulator */}
        <Route path="/tunnel-twin" element={<TunnelTwin />} />

        {/* Dashboard — all nested under DashboardLayout */}
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<DashboardOverview />} />
          <Route path="tunnel" element={<TunnelView />} />
          <Route path="tunnel-twin" element={<TunnelTwin />} />
          <Route path="inspections" element={<Inspections />} />
          <Route path="inspections/videos" element={<InspectionVideos />} />
          <Route path="detections" element={<AIDetections />} />
          <Route path="detections/:id" element={<DefectDetail />} />
          <Route path="maps" element={<MapsLocation />} />
          <Route path="reports" element={<Reports />} />
          <Route path="assets" element={<Assets />} />
          <Route path="settings" element={<Settings />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
