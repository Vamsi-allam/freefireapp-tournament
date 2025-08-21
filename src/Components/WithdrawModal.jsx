import React, { useState, useEffect } from 'react';
import { initiateWithdrawal } from '../utils/api';
import OtpVerificationModal from './OtpVerificationModal';
import './WithdrawModal.css';

const WithdrawModal = ({ isOpen, onClose, onWithdraw, currentBalance }) => {
  const [amount, setAmount] = useState('');
  const [selectedMethod, setSelectedMethod] = useState('bank');
  const [bankDetails, setBankDetails] = useState({
    accountNumber: '',
    ifscCode: '',
    accountHolderName: ''
  });
  const [upiId, setUpiId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [withdrawalData, setWithdrawalData] = useState(null);
  const [resendParams, setResendParams] = useState(null); // amount/method/details for resend
  const [error, setError] = useState('');

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setAmount('');
      setSelectedMethod('bank');
      setBankDetails({
        accountNumber: '',
        ifscCode: '',
        accountHolderName: ''
      });
      setUpiId('');
      setIsLoading(false);
      setError('');
      setShowOtpModal(false);
      setWithdrawalData(null);
  setResendParams(null);
    }
  }, [isOpen]);

  const quickAmounts = [100, 500, 1000, 2000, 5000, 10000];

  const handleQuickSelect = (value) => {
    if (value <= currentBalance) {
      setAmount(value.toString());
    }
  };

  const handleWithdraw = async () => {
    // Validate amount
    if (!amount || parseFloat(amount) < 100) {
      setError('Minimum withdraw amount is ₹100');
      return;
    }

    if (parseFloat(amount) > currentBalance) {
      setError('Insufficient balance');
      return;
    }

    // Validate method-specific details
    if (selectedMethod === 'bank') {
      if (!bankDetails.accountNumber || !bankDetails.ifscCode || !bankDetails.accountHolderName) {
        setError('Please fill all bank details');
        return;
      }
    } else if (selectedMethod === 'upi') {
      if (!upiId) {
        setError('Please enter UPI ID');
        return;
      }
    }

    setIsLoading(true);
    setError('');
    
    try {
      // Step 1: Initiate withdrawal with OTP
      const details = selectedMethod === 'bank' ? bankDetails : { upiId };
      const response = await initiateWithdrawal(amount, selectedMethod, details);
      
  // Store withdrawal data for OTP modal, include chosen method and details for display
  setWithdrawalData({ ...response, method: selectedMethod, details });
  // Store params for potential resend
  setResendParams({ amount, method: selectedMethod, details });
      
      // Show OTP verification modal
      setShowOtpModal(true);
      
    } catch (error) {
      console.error('Error initiating withdrawal:', error);
      setError(error.message || 'Failed to initiate withdrawal. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpSuccess = (transactionResult) => {
    // Close all modals immediately (no waiting on network/UI updates)
    setShowOtpModal(false);
    onClose();

    // Fire-and-forget: update parent/UI state in the background
    Promise.resolve(onWithdraw?.(transactionResult)).catch((error) => {
      console.error('Error handling withdrawal success:', error);
      // Non-blocking: UI already closed; optional toast/snackbar could be used
    });
  };

  const handleOtpError = (error) => {
    setError(error);
    setShowOtpModal(false);
  };

  const handleCloseOtpModal = () => {
    setShowOtpModal(false);
    setWithdrawalData(null);
    setResendParams(null);
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="withdraw-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="withdraw-modal" onClick={(e) => e.stopPropagation()}>
          <div className="withdraw-header">
            <button className="close-btn" onClick={onClose}>×</button>
            <div className="withdraw-icon">↓</div>
            <h2>Withdraw Money</h2>
            <p>Withdraw money from your PrimeArena wallet</p>
          </div>

        <div className="withdraw-content">
          <div className="balance-info">
            <span>Available Balance: </span>
            <span className="balance-amount">₹{currentBalance?.toFixed(2) || '0.00'}</span>
          </div>

          <div className="amount-section">
            <label>Amount (₹)</label>
            <div className="amount-input-container">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => e.stopPropagation()}
                onWheel={(e) => e.target.blur()} // Prevent scroll from changing value
                placeholder="Enter amount (min ₹100)"
                min="100"
                max={currentBalance}
                className="amount-input"
              />
              <span className="currency-symbol">₹</span>
            </div>
          </div>

          <div className="quick-select-section">
            <label>Quick Select</label>
            <div className="quick-amounts">
              {quickAmounts.map((value) => (
                <button
                  key={value}
                  className={`quick-amount-btn ${amount === value.toString() ? 'selected' : ''} ${value > currentBalance ? 'disabled' : ''}`}
                  onClick={() => handleQuickSelect(value)}
                  disabled={value > currentBalance}
                >
                  ₹{value}
                </button>
              ))}
            </div>
          </div>

          <div className="withdrawal-method-section">
            <label>Withdrawal Method</label>
            <div className="withdrawal-methods">
              <div 
                className={`withdrawal-method ${selectedMethod === 'bank' ? 'selected' : ''}`}
                onClick={() => setSelectedMethod('bank')}
              >
                <div className="withdrawal-icon bank-icon">🏦</div>
                <div className="withdrawal-info">
                  <div className="withdrawal-name">Bank Transfer</div>
                  <div className="withdrawal-desc">Direct transfer to bank account</div>
                </div>
                <div className={`radio ${selectedMethod === 'bank' ? 'selected' : ''}`}></div>
              </div>

              <div 
                className={`withdrawal-method ${selectedMethod === 'upi' ? 'selected' : ''}`}
                onClick={() => setSelectedMethod('upi')}
              >
                <div className="withdrawal-icon upi-icon">📱</div>
                <div className="withdrawal-info">
                  <div className="withdrawal-name">UPI Transfer</div>
                  <div className="withdrawal-desc">Instant transfer via UPI</div>
                </div>
                <div className={`radio ${selectedMethod === 'upi' ? 'selected' : ''}`}></div>
              </div>
            </div>
          </div>

          {selectedMethod === 'bank' && (
            <div className="bank-details-section">
              <label>Bank Details</label>
              <div className="bank-inputs">
                <input
                  type="text"
                  placeholder="Account Holder Name"
                  value={bankDetails.accountHolderName}
                  onChange={(e) => setBankDetails({...bankDetails, accountHolderName: e.target.value})}
                  className="bank-input"
                />
                <input
                  type="text"
                  placeholder="Account Number"
                  value={bankDetails.accountNumber}
                  onChange={(e) => setBankDetails({...bankDetails, accountNumber: e.target.value})}
                  className="bank-input"
                />
                <input
                  type="text"
                  placeholder="IFSC Code"
                  value={bankDetails.ifscCode}
                  onChange={(e) => setBankDetails({...bankDetails, ifscCode: e.target.value})}
                  className="bank-input"
                />
              </div>
            </div>
          )}

          {selectedMethod === 'upi' && (
            <div className="upi-details-section">
              <label>UPI Details</label>
              <input
                type="text"
                placeholder="Enter UPI ID (e.g., user@paytm)"
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                className="upi-input"
              />
            </div>
          )}

          <div className="withdrawal-info-section">
            <div className="info-icon">ℹ️</div>
            <div className="info-text">
              <div className="info-title">Withdrawal Information</div>
              <ul className="info-features">
                <li>• Processing time: 1-3 business days</li>
                <li>• Minimum withdrawal: ₹100</li>
                <li>• No withdrawal charges</li>
                <li>• Email & SMS notifications</li>
              </ul>
            </div>
          </div>

          <div className="minimum-amount-warning">
            ⚠️ Minimum withdrawal amount is ₹100
          </div>

          {/* Error Display */}
          {error && (
            <div className="error-message" style={{
              background: '#fed7d7',
              color: '#c53030',
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              marginBottom: '1rem',
              fontSize: '0.9rem',
              border: '1px solid #feb2b2'
            }}>
              ⚠️ {error}
            </div>
          )}

          <div className="modal-actions">
            <button className="cancel-btn" onClick={onClose} disabled={isLoading}>
              Cancel
            </button>
            <button 
              className="withdraw-btn" 
              onClick={handleWithdraw}
              disabled={isLoading || !amount || parseFloat(amount) < 100 || parseFloat(amount) > currentBalance}
            >
              {isLoading ? 'Processing...' : `Withdraw ₹${amount || 0}`}
            </button>
          </div>
        </div>
      </div>
      </div>
      
      {/* OTP Verification Modal */}
      <OtpVerificationModal
        isOpen={showOtpModal}
        onClose={handleCloseOtpModal}
        onSuccess={handleOtpSuccess}
        onError={handleOtpError}
  withdrawalData={withdrawalData}
  resendParams={resendParams}
      />
    </>
  );
};

export default WithdrawModal;
