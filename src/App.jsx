import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { CssBaseline } from '@mui/material';
import Homepage from './Components/Homepage';
import ProtectedRoute from './Components/ProtectedRoute';
import AdminPage from './Components/AdminPage';
import UserPage from './Components/UserPage';
import TermsPage from './Components/TermsPage';
import PrivacyPage from './Components/PrivacyPage';
import { initializeFromStorage } from './redux/userSlice';
import './App.css';

// Create a simple theme
const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#667eea',
    },
    secondary: {
      main: '#764ba2',
    },
  },
});

function App() {
  const dispatch = useDispatch();
  const location = useLocation();
  const navigate = useNavigate();
  const isAuthenticated = useSelector((state) => state.user.isAuthenticated);

  // Initialize user data from sessionStorage on app start
  useEffect(() => {
    dispatch(initializeFromStorage());
  }, [dispatch]);

  // Persist last visited route
  useEffect(() => {
    try {
      const path = location.pathname + (location.search || '') + (location.hash || '');
      sessionStorage.setItem('ui.lastRoute', path);
    } catch {}
  }, [location.pathname, location.search, location.hash]);

  // Restore last route on first load (e.g., after refresh) if needed
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('ui.lastRoute');
      // Only auto-restore if user is authenticated and we're on home
      if (isAuthenticated && saved && saved !== '/' && location.pathname === '/') {
        navigate(saved, { replace: true });
      }
    } catch {}
    // run when auth state or location root changes
  }, [isAuthenticated]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Routes>
        {/* Keep homepage at root to keep URL clean without hashes */}
        <Route path="/" element={<Homepage />} />
        {/* Standalone pages */}
  <Route path="/terms" element={<TermsPage />} />
  <Route path="/privacy" element={<PrivacyPage />} />
        <Route
          path="/admin"
          element={
            <ProtectedRoute allowedRoles={['ADMIN']}>
              <AdminPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/user"
          element={
            <ProtectedRoute allowedRoles={['USER']}>
              <UserPage />
            </ProtectedRoute>
          }
        />
  {/* Redirect any unknown routes to homepage */}
  <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ThemeProvider>
  );
}

export default App;
