import React, { useState, useEffect } from 'react';
import './ProfileCompletionModal.css';

const ProfileCompletionModal = ({ isOpen, onClose, onSubmit, userData }) => {
  const [formData, setFormData] = useState({
    displayName: userData?.name || '',
    phoneNumber: '',
    gameId: ''
  });
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({});

  // Reset form data when modal opens or userData changes
  useEffect(() => {
    if (isOpen) {
      setFormData({
        displayName: userData?.name || '',
        phoneNumber: userData?.phoneNumber || '',
        gameId: userData?.gameId || ''
      });
      setErrors({});
    }
  }, [isOpen, userData]);

  const handleChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({
        ...prev,
        [field]: ''
      }));
    }
  };

  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.displayName.trim()) {
      newErrors.displayName = 'Display name is required';
    }
    
    if (!formData.phoneNumber.trim()) {
      newErrors.phoneNumber = 'Phone number is required';
    } else if (!/^\+?[\d\s-()]{10,15}$/.test(formData.phoneNumber.trim())) {
      newErrors.phoneNumber = 'Please enter a valid phone number';
    }
    
    if (!formData.gameId.trim()) {
      newErrors.gameId = 'Game ID is required';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }
    
    setIsLoading(true);
    try {
      await onSubmit({
        displayName: formData.displayName.trim(),
        phoneNumber: formData.phoneNumber.trim(),
        gameId: formData.gameId.trim()
      });
    } catch (error) {
      console.error('Profile completion failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOverlayClick = (e) => {
    // Only close if clicking directly on the overlay (not on modal content)
    if (e.target === e.currentTarget) {
      onClose(); // Allow closing by clicking overlay
    }
    // If clicking on modal content, do nothing (don't close)
  };

  if (!isOpen) return null;

  return (
    <div className="profile-completion-overlay" onClick={handleOverlayClick}>
      <div 
        className="profile-completion-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="profile-completion-header">
          <div className="completion-icon">🎮</div>
          <h2>Complete Your Gaming Profile</h2>
          <p>Before adding money to your wallet, please complete your gaming profile</p>
          <button 
            type="button" 
            className="close-btn" 
            onClick={onClose}
            title="Close without completing"
          >
            ×
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="profile-completion-form">
          <div className="form-section">
            <h3>👤 Player Information</h3>
            
            <div className="input-group">
              <label htmlFor="displayName">Display Name</label>
              <input
                id="displayName"
                type="text"
                placeholder="Enter your display name"
                value={formData.displayName}
                onChange={(e) => handleChange('displayName', e.target.value)}
                className={errors.displayName ? 'error' : ''}
                disabled={isLoading}
              />
              {errors.displayName && <span className="error-text">{errors.displayName}</span>}
            </div>

            <div className="input-group">
              <label htmlFor="email">Email Address</label>
              <div className="email-input-wrapper">
                <svg viewBox="0 0 24 24" className="gmail-icon-input">
                  <path fill="#EA4335" d="M5 7v10l7-5V9l-7-2z"/>
                  <path fill="#FBBC05" d="M19 7v10l-7-5V9l7-2z"/>
                  <path fill="#EA4335" d="M5 7l7 5 7-5V5H5v2z"/>
                  <path fill="#34A853" d="M5 17h14v2H5z"/>
                </svg>
                <input
                  id="email"
                  type="email"
                  value={userData?.email || ''}
                  disabled={true}
                  className="readonly-input email-input"
                  title="Email cannot be changed"
                />
              </div>
              <span className="info-text">✓ Verified email address</span>
            </div>
            
            <div className="input-group">
              <label htmlFor="phoneNumber">Phone Number</label>
              <input
                id="phoneNumber"
                type="tel"
                placeholder="Enter your phone number"
                value={formData.phoneNumber}
                onChange={(e) => handleChange('phoneNumber', e.target.value)}
                className={errors.phoneNumber ? 'error' : ''}
                disabled={isLoading}
              />
              {errors.phoneNumber && <span className="error-text">{errors.phoneNumber}</span>}
            </div>
            
            <div className="input-group">
              <label htmlFor="gameId">Game ID</label>
              <input
                id="gameId"
                type="text"
                placeholder="Enter your Game ID"
                value={formData.gameId}
                onChange={(e) => handleChange('gameId', e.target.value)}
                className={errors.gameId ? 'error' : ''}
                disabled={isLoading}
              />
              {errors.gameId && <span className="error-text">{errors.gameId}</span>}
            </div>
          </div>
          
          <div className="profile-completion-actions">
            <button 
              type="submit" 
              className="complete-btn"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <div className="loading-spinner"></div>
                  Saving Profile...
                </>
              ) : (
                'Complete Profile & Continue'
              )}
            </button>
          </div>
        </form>
        
        <div className="completion-note">
          <div className="note-icon">ℹ️</div>
          <p>This information will be saved to your profile and used for tournament registrations.</p>
        </div>
      </div>
    </div>
  );
};

export default ProfileCompletionModal;
