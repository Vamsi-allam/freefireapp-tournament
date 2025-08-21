import React, { useState, useEffect } from 'react';
import './ProfileEditModal.css';

const ProfileEditModal = ({ isOpen, onClose, onSubmit, userData }) => {
  const [formData, setFormData] = useState({
    name: '',
    phoneNumber: '',
    gameId: ''
  });
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({});

  // Reset form data when modal opens or userData changes
  useEffect(() => {
    if (isOpen) {
      setFormData({
        name: userData?.name || '',
        phoneNumber: userData?.phone || userData?.phonenumber || '',
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
    
    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
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
        name: formData.name.trim(),
        phoneNumber: formData.phoneNumber.trim(),
        gameId: formData.gameId.trim()
      });
    } catch (error) {
      console.error('Profile update failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOverlayClick = (e) => {
    // Only close if clicking directly on the overlay (not on modal content)
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="profile-edit-overlay" onClick={handleOverlayClick}>
      <div 
        className="profile-edit-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="profile-edit-header">
          <div className="edit-icon">✏️</div>
          <h2>Edit Your Profile</h2>
          <p>Update your gaming profile information</p>
          <button 
            type="button" 
            className="close-btn" 
            onClick={onClose}
            title="Close"
          >
            ×
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="profile-edit-form">
          <div className="form-section">
            <h3>👤 Personal Information</h3>
            
            <div className="input-group">
              <label htmlFor="editName">Display Name</label>
              <input
                id="editName"
                type="text"
                placeholder="Enter your display name"
                value={formData.name}
                onChange={(e) => handleChange('name', e.target.value)}
                className={errors.name ? 'error' : ''}
                disabled={isLoading}
              />
              {errors.name && <span className="error-text">{errors.name}</span>}
            </div>

            <div className="input-group">
              <label htmlFor="editEmail">Email Address</label>
              <div className="email-input-wrapper">
                <svg viewBox="0 0 48 48" className="gmail-icon-input">
                  <path fill="#4285F4" d="M24,9.5c3.54,0,6.71,1.22,9.21,3.6l6.85-6.85C35.9,2.38,30.47,0,24,0 C14.62,0,6.51,5.38,2.56,13.22l7.98,6.19C12.43,13.72,17.74,9.5,24,9.5z"/>
                  <path fill="#34A853" d="M46.98,24.55c0-1.57-0.15-3.09-0.38-4.55H24v9.02h12.94c-0.58,2.96-2.26,5.48-4.78,7.18l7.73,6 c4.51-4.18,7.09-10.36,7.09-17.65C46.98,24.55,46.98,24.55,46.98,24.55z"/>
                  <path fill="#FBBC05" d="M10.53,28.59c-0.48-1.45-0.76-2.99-0.76-4.59s0.27-3.14,0.76-4.59l-7.98-6.19C0.92,16.46,0,20.12,0,24 c0,3.88,0.92,7.54,2.56,10.78L10.53,28.59z"/>
                  <path fill="#EA4335" d="M24,48c6.48,0,11.93-2.13,15.89-5.81l-7.73-6c-2.15,1.45-4.92,2.3-8.16,2.3 c-6.26,0-11.57-4.22-13.47-9.91l-7.98,6.19C6.51,42.62,14.62,48,24,48z"/>
                  <path fill="none" d="M0,0h48v48H0V0z"/>
                </svg>
                <input
                  id="editEmail"
                  type="email"
                  value={userData?.email || ''}
                  disabled={true}
                  className="readonly-input email-input"
                  title="Email cannot be changed"
                />
              </div>
              <span className="info-text">🔒 Email cannot be changed</span>
            </div>
            
            <div className="input-group">
              <label htmlFor="editPhone">Phone Number</label>
              <input
                id="editPhone"
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
              <label htmlFor="editGameId">Game ID</label>
              <input
                id="editGameId"
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
          
          <div className="profile-edit-actions">
            <button 
              type="button" 
              className="cancel-btn"
              onClick={onClose}
              disabled={isLoading}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="save-btn"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <div className="loading-spinner"></div>
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ProfileEditModal;
