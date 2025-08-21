import React, { useState } from 'react';
import './ConsentModal.css';

const ConsentModal = ({ isOpen, onClose, onAgree, title = "Terms & Conditions" }) => {
  const [isChecked, setIsChecked] = useState(false);

  if (!isOpen) return null;

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleAgreeAndContinue = () => {
    if (isChecked) {
      onAgree();
      onClose();
      setIsChecked(false); // Reset for next time
    }
  };

  const handleClose = () => {
    setIsChecked(false); // Reset checkbox when closing
    onClose();
  };

  return (
    <div className="consent-modal-overlay" onClick={handleOverlayClick}>
      <div className="consent-modal">
        <div className="consent-modal-header">
          <h2>{title}</h2>
          <button className="close-btn" onClick={handleClose}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        
        <div className="consent-modal-content">
          <div className="simple-points">
            <p>• Must be 16+ years old with valid Free Fire account</p>
            <p>• No cheating, hacking, or toxic behavior allowed</p>
            <p>• Entry fees required, prizes distributed within 1 hour</p>
            <p>• Your data is secure and never shared with third parties</p>
          </div>

          <div className="consent-checkbox">
            <label className="checkbox-container">
              <input
                type="checkbox"
                checked={isChecked}
                onChange={(e) => setIsChecked(e.target.checked)}
              />
              <span className="checkmark"></span>
              <span className="checkbox-text">
                I agree to the <span className="terms-highlight">Terms and Conditions</span> and <span className="terms-highlight">Privacy Policy</span>
              </span>
            </label>
          </div>

          <div className="consent-actions">
            <button 
              className="cancel-btn" 
              onClick={handleClose}
            >
              Cancel
            </button>
            <button 
              className={`agree-btn ${!isChecked ? 'disabled' : ''}`}
              onClick={handleAgreeAndContinue}
              disabled={!isChecked}
            >
              Agree & Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConsentModal;
