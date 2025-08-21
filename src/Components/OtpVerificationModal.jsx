import React, { useState, useEffect } from 'react';
import { requestOtpEmail, verifyWithdrawalOtp, cancelWithdrawal } from '../utils/api';
import './OtpVerificationModal.css';

const OtpVerificationModal = ({ 
  isOpen, 
  onClose, 
  onSuccess, 
  withdrawalData,
  onError,
  resendParams
}) => {
  const [otpCode, setOtpCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [timeLeft, setTimeLeft] = useState(300); // 5 minutes in seconds
  const [isResending, setIsResending] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setOtpCode('');
      setError('');
      setSuccess('');
      setIsLoading(false);
      setTimeLeft(300);
      // Fire off an OTP email when the modal opens
      (async () => {
        try {
          const withdrawalId = withdrawalData?.request_id || withdrawalData?.id;
          await requestOtpEmail({ purpose: 'WITHDRAWAL', withdrawalId });
        } catch (e) {
          // Show a gentle message but let user try resend
          setError(e?.message || 'Failed to send OTP email. You can try Resend.');
        }
      })();
    }
  }, [isOpen, withdrawalData]);

  // Countdown timer
  useEffect(() => {
    let timer;
    if (isOpen && timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            setError('OTP has expired. Please request a new withdrawal.');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isOpen, timeLeft]);

  const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const handleOtpChange = (e) => {
    const value = e.target.value.replace(/\D/g, ''); // Only numbers
    if (value.length <= 6) {
      setOtpCode(value);
      setError('');
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpCode || otpCode.length !== 6) {
      setError('Please enter a valid 6-digit OTP');
      return;
    }

    if (timeLeft <= 0) {
      setError('OTP has expired. Please request a new withdrawal.');
      return;
    }

    setIsLoading(true);
    setError('');
    
    try {
      // Verify OTP against server and perform deduction + mark OTP_VERIFIED via RPC
  const result = await verifyWithdrawalOtp(otpCode);
  // Immediately notify parent and close, same as UTR flow
  onSuccess(result);
  onClose();
      
    } catch (err) {
  setError(err.message || 'Failed to verify OTP. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !isLoading && otpCode.length === 6 && timeLeft > 0) {
      handleVerifyOtp();
    }
  };

  const handleCancel = async () => {
    setOtpCode('');
    setError('');
    setSuccess('');
    try {
      const withdrawalId = withdrawalData?.request_id || withdrawalData?.id;
      if (withdrawalId) {
        await cancelWithdrawal(withdrawalId, 'user cancelled before OTP verification');
      }
    } catch (e) {
      // Non-blocking: just close even if cancel fails
      console.warn('Cancel withdrawal failed:', e?.message || e);
    } finally {
      onClose();
    }
  };

  const handleResendOtp = async () => {
    if (isResending) return;
    setIsResending(true);
    setError('');
    setSuccess('');
    try {
      const withdrawalId = withdrawalData?.request_id || withdrawalData?.id;
      await requestOtpEmail({ purpose: 'WITHDRAWAL', withdrawalId });
      // Reset timer and state
      setTimeLeft(300);
      setOtpCode('');
      setSuccess('A new OTP has been sent to your email.');
    } catch (e) {
      setError(e.message || 'Failed to resend OTP. Please try again.');
    } finally {
      // brief delay to allow icon spin animation
      setTimeout(() => setIsResending(false), 600);
    }
  };

  const getTimerClass = () => {
    if (timeLeft <= 0) return 'expired';
    if (timeLeft <= 60) return 'warning';
    return '';
  };

  if (!isOpen || !withdrawalData) return null;

  return (
    <div className="otp-modal-overlay" onClick={(e) => e.target === e.currentTarget && handleCancel()}>
      <div className="otp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="otp-modal-header">
          <button className="close-btn" onClick={handleCancel}>×</button>
          <div className="otp-icon">🔐</div>
          <h2>Verify Withdrawal</h2>
          <p>Enter the OTP sent to your email address</p>
        </div>

        <div className="otp-modal-content">
          {/* Withdrawal Information */}
          <div className="withdrawal-info">
            <h3>Withdrawal Details</h3>
            <div className="info-row">
              <span className="info-label">Amount:</span>
              <span className="info-value amount-value">₹{withdrawalData.amount}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Method:</span>
              <span className="info-value">
                {(() => {
                  const m = String(withdrawalData.method || withdrawalData.withdrawalMethod || '').toUpperCase();
                  const d = withdrawalData.details || {};
                  if (m === 'UPI') return d.upiId ? `UPI (${d.upiId})` : 'UPI';
                  if (m === 'BANK') {
                    const acc = d.accountNumber || d.account_number;
                    return acc ? `Bank (A/C ${String(acc).slice(-4).padStart(4,'*')})` : 'Bank Transfer';
                  }
                  return m || '—';
                })()}
              </span>
            </div>
            <div className="info-row">
              <span className="info-label">Status:</span>
              <span className="info-value">{withdrawalData.status}</span>
            </div>
          </div>

          {/* Timer Display */}
          <div className={`timer-display ${getTimerClass()}`}>
            {timeLeft > 0 
              ? `OTP expires in: ${formatTime(timeLeft)}`
              : 'OTP has expired'
            }
          </div>

          {/* Resend OTP */}
          {timeLeft <= 0 && (
            <button
              type="button"
              className={`resend-otp-btn ${isResending ? 'spinning' : ''}`}
              onClick={handleResendOtp}
              disabled={isResending}
            >
              <span className="refresh-icon" aria-hidden>↻</span>
              <span> Resend OTP</span>
            </button>
          )}

          {/* OTP Input Section */}
          <div className="otp-section">
            <label htmlFor="otpInput">Enter 6-digit OTP</label>
            <div className="otp-input-container">
              <input
                id="otpInput"
                type="text"
                className={`otp-input ${error ? 'error' : ''}`}
                placeholder="000000"
                value={otpCode}
                onChange={handleOtpChange}
                onKeyPress={handleKeyPress}
                maxLength={6}
                disabled={isLoading || timeLeft <= 0}
                autoFocus
              />
            </div>
          </div>

          {/* Info Box */}
          <div className="otp-info">
            <p className="otp-info-text">
              📧 We've sent a 6-digit verification code to your registered email address. 
              The OTP is valid for 5 minutes only.
            </p>
          </div>

          {/* Error/Success Messages */}
          {error && (
            <div className="error-message">
              ⚠️ {error}
            </div>
          )}

          {success && (
            <div className="success-message">
              ✅ {success}
            </div>
          )}

          {/* Action Buttons */}
          <div className="otp-actions">
            <button 
              className="cancel-btn" 
              onClick={handleCancel}
              disabled={isLoading}
            >
              Cancel
            </button>
            <button 
              className={`verify-btn ${isLoading ? 'loading' : ''}`}
              onClick={handleVerifyOtp}
              disabled={isLoading || otpCode.length !== 6 || timeLeft <= 0}
            >
              {isLoading ? 'Verifying...' : 'Verify & Withdraw'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OtpVerificationModal;
