import { Link, useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { useState, useEffect } from 'react';
import { setSupabaseSession } from '../redux/userSlice';
import { supabase } from '../supabaseClient';
import GoogleSignInModal from './GoogleSignInModal';
import Header from './Header';
import SupportModal from './SupportModal';
import './Homepage.css';

const Homepage = () => {
  const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
  const dispatch = useDispatch();
  const { isAuthenticated, userData, role } = useSelector((state) => state.user);
  const navigate = useNavigate();
  const [showSignInModal, setShowSignInModal] = useState(false);
  const [modalTitle, setModalTitle] = useState('Sign In');
  const [showSupport, setShowSupport] = useState(false);
  // Show global snack messages on homepage as alerts (simple)
  useEffect(() => {
    const onUiSnack = (e) => {
      const { message } = e.detail || {};
      if (message) {
        try { alert(message); } catch {}
      }
    };
    window.addEventListener('ui:snackbar', onUiSnack);
    return () => window.removeEventListener('ui:snackbar', onUiSnack);
  }, []);
  // Listen for header login requests
  useEffect(() => {
    const open = () => setShowSignInModal(true);
    window.addEventListener('open-signin-modal', open);
    return () => window.removeEventListener('open-signin-modal', open);
  }, []);

  // Supabase session listener
  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session) {
        const adminEmail = import.meta.env.VITE_ADMIN_EMAIL;
        const role = session.user.email === adminEmail ? 'ADMIN' : 'USER';
        
  // No backend required; set session data locally
  sessionStorage.setItem('userRole', role);
  sessionStorage.setItem('userName', session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email?.split('@')[0] || '');
  sessionStorage.setItem('userEmail', session.user.email || '');
  if (session.user.user_metadata?.avatar_url) sessionStorage.setItem('userAvatar', session.user.user_metadata?.avatar_url);
  dispatch(setSupabaseSession({ session, role }));
  navigate(role === 'ADMIN' ? '/admin' : '/user');
      }
    });
    return () => { listener.subscription.unsubscribe(); };
  }, [dispatch, navigate]);

  const handleGoogleSignIn = async () => {
    await supabase.auth.signInWithOAuth({ provider: 'google', options:{ redirectTo: window.location.origin } });
  };

  const handleSignInClick = () => {
    setModalTitle('Sign In');
    setShowSignInModal(true);
  };

  const handleSignUpClick = () => {
    setModalTitle('Sign Up');
    setShowSignInModal(true);
  };

  const handleLoginClick = (e) => {
    e.preventDefault();
    if (isAuthenticated) {
      window.location.href = role === 'ADMIN' ? '/admin' : '/user';
    } else {
      handleSignInClick();
    }
  };

  // Upcoming tournaments data (mirrors the design you shared)

  // Listen for header signup as well
  useEffect(() => {
    const openSignup = () => { setModalTitle('Sign Up'); setShowSignInModal(true); };
    window.addEventListener('open-signup-modal', openSignup);
    return () => window.removeEventListener('open-signup-modal', openSignup);
  }, []);

  return (
    <div 
      className="homepage" 
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0f0625 0%, #1a0d3d 30%, #2d1b69 60%, #4c1d95 100%)',
        margin: 0,
        padding: 0
      }}
    >
  {/* Header */}
  <Header />

      {/* Hero Section */}
  <section 
        className="hero-section"
        style={{
          background: 'linear-gradient(135deg, #0f0625 0%, #1a0d3d 30%, #2d1b69 60%, #4c1d95 100%)',
          color: 'white',
          padding: '120px 20px 80px',
          textAlign: 'center',
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        <div className="hero-content">
          <h1 className="hero-title">Join Epic Gaming Tournaments</h1>
          <p className="hero-subtitle">
            Compete with the best players, win amazing prizes, and climb the
            leaderboards in your favorite games.
          </p>
          
          <div className="hero-actions">
            {!isAuthenticated && (
              <button onClick={handleSignInClick} className="btn btn-primary" style={{fontSize: '1.2rem', padding: '18px 40px', display: 'flex', alignItems: 'center', gap: '0.75rem'}}>
                🚀 Get Started Now
              </button>
            )}
          </div>
        </div>
      </section>

  {/* Sections moved to dedicated pages: Terms and Privacy */}

      {/* Stats Section */}
      <section className="stats-section">
        <div className="container">
          <div className="stats-grid">
            <div className="stat-item">
              <div className="stat-number">1000+</div>
              <div className="stat-label">Active Players</div>
            </div>
            <div className="stat-item">
              <div className="stat-number">₹50K+</div>
              <div className="stat-label">Prizes Distributed</div>
            </div>
            <div className="stat-item">
              <div className="stat-number">200+</div>
              <div className="stat-label">Tournaments Completed</div>
            </div>
            <div className="stat-item">
              <div className="stat-number">24/7</div>
              <div className="stat-label">Support Available</div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <div className="container">
          <div className="footer-content">
            <div className="footer-brand">
              <span className="trophy-icon">🏆</span>
              <span className="brand-text">PrimeArena</span>
            </div>
            <div className="footer-links">
              <Link to="/terms" className="footer-link">Terms</Link>
              <Link to="/privacy" className="footer-link">Privacy</Link>
              <a href="#support" className="footer-link" onClick={(e)=>{ e.preventDefault(); setShowSupport(true); }}>Support</a>
            </div>
          </div>
          <div className="footer-bottom">
            <p>&copy; 2025 PrimeArena. All rights reserved.</p>
          </div>
        </div>
      </footer>

      {/* Google Sign-In Modal */}
      <GoogleSignInModal
        isOpen={showSignInModal}
        onClose={() => setShowSignInModal(false)}
        onGoogleSignIn={handleGoogleSignIn}
        title={modalTitle}
      />

      {/* Support Modal */}
      <SupportModal
        isOpen={showSupport}
        onClose={() => setShowSupport(false)}
        defaultEmail={userData?.email || sessionStorage.getItem('userEmail') || ''}
        defaultPhone={userData?.phone || sessionStorage.getItem('userPhone') || ''}
      />
    </div>
  );
};

export default Homepage;
