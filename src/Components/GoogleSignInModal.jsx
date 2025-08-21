import React, { useState } from 'react';
import './GoogleSignInModal.css';
import ConsentModal from './ConsentModal';

const GoogleSignInModal = ({ isOpen, onClose, onGoogleSignIn, title = "Sign In" }) => {
  const [showConsentModal, setShowConsentModal] = useState(false);

  if (!isOpen) return null;

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleGoogleSignIn = () => {
    // Show consent modal instead of directly signing in
    setShowConsentModal(true);
  };

  const handleConsentAgree = () => {
    // Now proceed with Google sign in after consent
    onGoogleSignIn();
    setShowConsentModal(false);
    onClose();
  };

  const handleConsentClose = () => {
    setShowConsentModal(false);
  };

  return (
    <>
      <div className="google-signin-modal-overlay" onClick={handleOverlayClick}>
        <div className="google-signin-modal">
          <div className="google-signin-modal-header">
            <h2>{title}</h2>
            <button className="close-btn" onClick={onClose}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          
          <div className="google-signin-modal-content">
            <div className="signin-welcome">
              <div className="welcome-icon">🏆</div>
              <h3>Welcome to PrimeArena</h3>
              <p>Join thousands of gamers competing in epic tournaments</p>
            </div>

            <button className="google-signin-btn" onClick={handleGoogleSignIn}>
              <svg className="google-icon" width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>

            <div className="signin-features">
              <div className="feature-item">
                <span className="feature-icon">⚡</span>
                <span>Quick & Secure Login</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">🎮</span>
                <span>Join Tournaments Instantly</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">🏆</span>
                <span>Track Your Progress</span>
              </div>
            </div>

            <p className="privacy-note">
              By continuing, you agree to our Terms of Service and Privacy Policy
            </p>
          </div>
        </div>
      </div>

      {/* Consent Modal */}
      <ConsentModal
        isOpen={showConsentModal}
        onClose={handleConsentClose}
        onAgree={handleConsentAgree}
        title="Terms & Conditions Agreement"
      />
    </>
  );
};

export default GoogleSignInModal;
