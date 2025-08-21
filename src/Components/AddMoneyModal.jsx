import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import './AddMoneyModal.css';
import { initiateUpi, submitUpiUtr } from '../utils/api';
import { Snackbar, Alert, IconButton, Tooltip } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

const AddMoneyModal = ({ isOpen, onClose, onAddMoney }) => {
  const [amount, setAmount] = useState(() => {
    try { return sessionStorage.getItem('ui.addMoney.amount') || ''; } catch { return ''; }
  });
  const [selectedMethod, setSelectedMethod] = useState(() => {
    // Force default to QR Code; if an older session saved 'upi', override to 'qrcode'
    try {
      const saved = sessionStorage.getItem('ui.addMoney.method');
      return saved && saved !== 'upi' ? saved : 'qrcode';
    } catch { return 'qrcode'; }
  });
  const [isLoading, setIsLoading] = useState(false);
  const [showUpiForm, setShowUpiForm] = useState(() => {
    try { return sessionStorage.getItem('ui.addMoney.showUpiForm') === 'true'; } catch { return false; }
  });
  const [upiPaymentData, setUpiPaymentData] = useState(() => {
    try {
      const raw = sessionStorage.getItem('ui.addMoney.upiPaymentData');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });
  const [utrNumber, setUtrNumber] = useState(() => {
    try { return sessionStorage.getItem('ui.addMoney.utr') || ''; } catch { return ''; }
  });
  const [submittingUtr, setSubmittingUtr] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  // Snackbar state (used for non-copy messages)
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'info' });
  const openSnack = (message, severity = 'info') => setSnack({ open: true, message, severity });
  const closeSnack = () => setSnack(s => ({ ...s, open: false }));

  // Minimal bottom-center toast specifically for copy feedback
  const [copyToast, setCopyToast] = useState(false);

  // Copy helper
  const handleCopy = async (text) => {
    try {
      await navigator.clipboard.writeText(String(text || ''));
      // Show unobtrusive bottom-center toast like on mobile
      setCopyToast(true);
      setTimeout(() => setCopyToast(false), 1200);
    } catch {
      openSnack('Failed to copy', 'error');
    }
  };

  // Payee details from environment (Vite exposes only VITE_*). Fallbacks keep current defaults.
  const PAYEE_VPA = (import.meta.env.VITE_UPI_PAYEE_VPA || import.meta.env.VITE_PAYEE_VPA);
  const PAYEE_NAME = (import.meta.env.VITE_UPI_PAYEE_NAME || import.meta.env.VITE_PAYEE_NAME || 'PrimeArena');

  // Detect if user is on mobile
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setAmount('');
  // Reset to QR Code only (UPI method temporarily disabled in UI)
  setSelectedMethod('qrcode');
      setIsLoading(false);
      setShowUpiForm(false);
      setUpiPaymentData(null);
      setUtrNumber('');
      setSubmittingUtr(false);
      setQrCodeUrl('');
      try {
        sessionStorage.removeItem('ui.addMoney.amount');
        sessionStorage.removeItem('ui.addMoney.method');
        sessionStorage.removeItem('ui.addMoney.showUpiForm');
        sessionStorage.removeItem('ui.addMoney.upiPaymentData');
        sessionStorage.removeItem('ui.addMoney.utr');
      } catch {}
    }
  }, [isOpen]);

  // Generate QR code when UPI payment data is available
  useEffect(() => {
    if (upiPaymentData && upiPaymentData.qrCodeData) {
      QRCode.toDataURL(upiPaymentData.qrCodeData, {
        width: 200,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      })
      .then(url => {
        setQrCodeUrl(url);
      })
      .catch(err => {
        console.error('Error generating QR code:', err);
      });
    }
  }, [upiPaymentData]);

  // Persist progress for refresh-resume
  useEffect(() => {
    try { sessionStorage.setItem('ui.addMoney.amount', amount); } catch {}
  }, [amount]);
  useEffect(() => {
    try { sessionStorage.setItem('ui.addMoney.method', selectedMethod); } catch {}
  }, [selectedMethod]);
  useEffect(() => {
    try { sessionStorage.setItem('ui.addMoney.showUpiForm', String(showUpiForm)); } catch {}
  }, [showUpiForm]);
  useEffect(() => {
    try {
      if (upiPaymentData) {
        sessionStorage.setItem('ui.addMoney.upiPaymentData', JSON.stringify(upiPaymentData));
      }
    } catch {}
  }, [upiPaymentData]);
  useEffect(() => {
    try { sessionStorage.setItem('ui.addMoney.utr', utrNumber); } catch {}
  }, [utrNumber]);

  // Build a UPI deeplink locally (fallback when backend isn't available)
  const buildLocalUpiDeepLink = (amt) => {
    const params = new URLSearchParams({
      pa: PAYEE_VPA,
      pn: PAYEE_NAME,
      am: String(Number(amt || 0).toFixed(2)),
      cu: 'INR',
      tn: 'Wallet top-up'
    });
    return `upi://pay?${params.toString()}`;
  };

  const quickAmounts = [30, 50, 100, 200, 500, 1000];

  const handleQuickSelect = (value) => {
    setAmount(value.toString());
  };

  const handleUpiPayment = async (paymentApp) => {
    if (!amount || parseFloat(amount) < 30) {
      openSnack('Minimum add money amount is ₹30', 'warning');
      return;
    }

    setIsLoading(true);
    try {
      // Try backend first; if it fails we'll fall back to local UPI link
      let data;
      try {
        data = await initiateUpi(parseFloat(amount), undefined, paymentApp);
      } catch (e) {
        const deeplink = buildLocalUpiDeepLink(amount);
        data = {
          id: `local-${Date.now()}`,
          amount: Number(amount),
          deeplink,
          payeeVpa: PAYEE_VPA,
          payeeName: PAYEE_NAME,
          note: 'Wallet top-up',
          paymentApp,
          // No referenceId here; we'll generate a standard REF_* when submitting UTR
        };
      }

      const qrData = data.deeplink || data.deepLink || buildLocalUpiDeepLink(amount);
      // Ensure payee info reflects the provided VPA
      setUpiPaymentData({
        ...data,
        payeeVpa: PAYEE_VPA,
        payeeName: PAYEE_NAME,
  qrCodeData: qrData
      });
      setShowUpiForm(true);
      // If mobile and deep link is available, try to open the app
      if (isMobile && qrData && paymentApp !== 'QRCode') {
        window.location.href = qrData;
      }
    } catch (error) {
  console.error('Error initiating UPI payment:', error);
  openSnack('Failed to initiate UPI payment. Please try again.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddMoney = async () => {
    if (selectedMethod === 'upi') {
      // Show UPI options
      setShowUpiForm(true);
      return;
    }
    if (selectedMethod === 'qrcode') {
      // Always start QR Code flow (both mobile and desktop)
      await handleUpiPayment('QRCode');
      return;
    }

    if (!amount || parseFloat(amount) < 30) {
      openSnack('Minimum add money amount is ₹30', 'warning');
      return;
    }

    setIsLoading(true);
    try {
      await onAddMoney(parseFloat(amount), selectedMethod);
      setAmount('');
      onClose();
    } catch (error) {
      console.error('Error adding money:', error);
      openSnack('Failed to add money. Please try again.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleUtrSubmission = async () => {
    const utr = utrNumber.trim();
    if (!utr) {
      openSnack('Please enter UTR number', 'warning');
      return;
    }
    // Enforce exactly 12 numeric digits for UTR
    if (!/^\d{12}$/.test(utr)) {
      openSnack('UTR must be exactly 12 digits', 'warning');
      return;
    }

    setSubmittingUtr(true);
    try {
      // Submit with full context; backend will create record if needed
      await submitUpiUtr(upiPaymentData, utr);
      openSnack('UTR submitted successfully! Our team will verify and credit shortly.', 'success');
      // Delay closing so the snackbar is visible
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (error) {
      console.error('Error submitting UTR:', error);
  openSnack(error.message || 'Failed to submit UTR. Please try again.', 'error');
    } finally {
      setSubmittingUtr(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="add-money-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="add-money-modal" onClick={(e) => e.stopPropagation()}>
        <div className="add-money-header">
          <button className="close-btn" onClick={onClose}>×</button>
          <div className="add-money-icon">+</div>
          <h2>Add Money to Wallet</h2>
          <p>Add money to your PrimeArena wallet for tournament entries</p>
        </div>

        <div className="add-money-content">
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
                placeholder="Enter amount (min ₹30)"
                min="30"
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
                  className={`quick-amount-btn ${amount === value.toString() ? 'selected' : ''}`}
                  onClick={() => handleQuickSelect(value)}
                >
                  ₹{value}
                </button>
              ))}
            </div>
          </div>

          <div className="payment-method-section">
            <label>Payment Method</label>
            <div className={`payment-methods ${showUpiForm || upiPaymentData ? 'locked' : ''}`}>
              {/*
                UPI payment selector temporarily disabled in UI per request; keep code for future.
                <div 
                  className={`payment-method ${selectedMethod === 'upi' ? 'selected' : ''}`}
                  onClick={() => { if (!(showUpiForm || upiPaymentData)) { setSelectedMethod('upi'); } }}
                >
                  <div className="payment-icon upi-icon">📱</div>
                  <div className="payment-info">
                    <div className="payment-name">UPI Payment</div>
                    <div className="payment-desc">Pay via PhonePe, GooglePay, Paytm or QR Code</div>
                  </div>
                  <div className={`radio ${selectedMethod === 'upi' ? 'selected' : ''}`}></div>
                </div>
              */}

              <div 
                className={`payment-method ${selectedMethod === 'qrcode' ? 'selected' : ''}`}
                onClick={() => { if (!(showUpiForm || upiPaymentData)) { setSelectedMethod('qrcode'); } }}
              >
                <div className="payment-icon qr-icon">🔗</div>
                <div className="payment-info">
                  <div className="payment-name">QR Code Payment</div>
                  <div className="payment-desc">Scan QR with any UPI app</div>
                </div>
                <div className={`radio ${selectedMethod === 'qrcode' ? 'selected' : ''}`}></div>
              </div>
            </div>
            {(showUpiForm || upiPaymentData) && (
              <div className="locked-hint">Payment method locked during UPI flow</div>
            )}
          </div>

          {/* UPI Payment Options */}
          {showUpiForm && !upiPaymentData && (
            <div className="upi-options-section">
              <h3>Choose UPI Payment Method</h3>
              <div className="upi-apps">
                {isMobile ? (
                  <>
                    <button 
                      className="upi-app-btn phonepe" 
                      onClick={() => handleUpiPayment('PhonePe')}
                      disabled={isLoading}
                    >
                      <span className="upi-app-icon">📱</span>
                      <span className="upi-app-name">PhonePe</span>
                    </button>
                    <button 
                      className="upi-app-btn googlepay" 
                      onClick={() => handleUpiPayment('GooglePay')}
                      disabled={isLoading}
                    >
                      <span className="upi-app-icon">💰</span>
                      <span className="upi-app-name">Google Pay</span>
                    </button>
                    <button 
                      className="upi-app-btn paytm" 
                      onClick={() => handleUpiPayment('Paytm')}
                      disabled={isLoading}
                    >
                      <span className="upi-app-icon">💳</span>
                      <span className="upi-app-name">Paytm</span>
                    </button>
                    <button 
                      className="upi-app-btn qr-code" 
                      onClick={() => handleUpiPayment('QRCode')}
                      disabled={isLoading}
                    >
                      <span className="upi-app-icon">⚡</span>
                      <span className="upi-app-name">QR Code</span>
                    </button>
                  </>
                ) : (
                  <button 
                    className="upi-app-btn qr-code large" 
                    onClick={() => handleUpiPayment('QRCode')}
                    disabled={isLoading}
                  >
                    <span className="upi-app-icon">📱</span>
                    <span className="upi-app-name">Pay with UPI QR Code</span>
                    <span className="upi-app-desc">Scan with any UPI app</span>
                  </button>
                )}
              </div>
              <button 
                className="back-btn" 
                onClick={() => setShowUpiForm(false)}
              >
                ← Back to Payment Methods
              </button>
            </div>
          )}

          {/* UPI Payment Instructions */}
          {upiPaymentData && (
            <div className="upi-payment-section">
              <h3>Complete Your Payment</h3>
              <div className="payment-details">
                <div className="detail-row">
                  <span className="label">Amount:</span>
                  <span className="value">₹{upiPaymentData.amount}</span>
                </div>
                {upiPaymentData.referenceId && (
                  <div className="detail-row">
                    <span className="label">Reference:</span>
                    <span className="value">{upiPaymentData.referenceId}</span>
                  </div>
                )}
                <div className="detail-row">
                  <span className="label">Payee UPI:</span>
                  <span className="value">
                    {upiPaymentData.payeeVpa}
                    <Tooltip title="Copy" arrow>
                      <IconButton
                        size="small"
                        onClick={() => handleCopy(upiPaymentData.payeeVpa)}
                        sx={{ color: '#3b82f6', ml: 0.8, p: 0.5 }}
                        aria-label="Copy UPI ID"
                      >
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </span>
                </div>
                <div className="detail-row">
                  <span className="label">Payee Name:</span>
                  <span className="value">{upiPaymentData.payeeName}</span>
                </div>
                {upiPaymentData.paymentApp && (
                  <div className="detail-row">
                    <span className="label">Method:</span>
                    <span className="value">{upiPaymentData.paymentApp}</span>
                  </div>
                )}
              </div>

              {upiPaymentData.qrCodeData ? (
                <div className="qr-code-section">
                  <div className="qr-code-container">
                    {qrCodeUrl ? (
                      <img src={qrCodeUrl} alt="UPI QR Code" className="qr-code-image" />
                    ) : (
                      <div className="qr-placeholder">
                        <div className="qr-text">
                          📱 Generating QR Code...
                        </div>
                      </div>
                    )}
                  </div>
                  <p className="qr-instruction">
                    1. Open any UPI app (PhonePe, GooglePay, Paytm, etc.)<br/>
                    2. Scan the QR code above<br/>
                    3. Complete the payment of ₹{upiPaymentData.amount}<br/>
                    4. Enter UTR number below after successful payment
                  </p>
                  <div className="qr-actions">
                    {upiPaymentData.deeplink && upiPaymentData.paymentApp !== 'QRCode' && (
                      <a href={upiPaymentData.deeplink} className="open-upi-link" target="_blank" rel="noreferrer">
                        Or tap to open your UPI app
                      </a>
                    )}
                    {qrCodeUrl && (
                      <a
                        href={qrCodeUrl}
                        download={`upi-qr-${upiPaymentData.amount}.png`}
                        className="download-qr-btn"
                      >
                        Download QR
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mobile-payment-section">
                  <p className="payment-instruction">
                    {isMobile ? 
                      "Complete the payment in the opened app and return here to submit UTR." :
                      "Use the UPI link to complete payment and return here to submit UTR."
                    }
                  </p>
                  {upiPaymentData.deeplink && (
                    <a href={upiPaymentData.deeplink} className="open-upi-link" target="_blank" rel="noreferrer">
                      Open UPI App
                    </a>
                  )}
                </div>
              )}

              <div className="utr-submission">
                <label>UTR Number (After Payment)</label>
                <input
                  type="text"
                  value={utrNumber}
                  onChange={(e) => setUtrNumber(e.target.value.replace(/\D/g, '').slice(0, 12))}
                  placeholder="Enter 12-digit UTR number"
                  className="utr-input"
                  maxLength={12}
                  inputMode="numeric"
                  pattern="\\d{12}"
                />
                <button
                  className="submit-utr-btn"
                  onClick={handleUtrSubmission}
                  disabled={submittingUtr || utrNumber.trim().length !== 12}
                >
                  {submittingUtr ? 'Submitting...' : 'Submit UTR & Complete'}
                </button>
              </div>

              <button 
                className="back-btn" 
                onClick={() => {
                  setUpiPaymentData(null);
                  setShowUpiForm(false);
                }}
              >
                ← Start New Payment
              </button>
            </div>
          )}

          {!showUpiForm && (
            <>
              <div className="secure-payment-info">
                <div className="secure-icon">🔒</div>
                <div className="secure-text">
                  <div className="secure-title">Secure Payment</div>
                  <ul className="secure-features">
                    <li>• 256-bit SSL encryption</li>
                    <li>• Manual verification for UPI</li>
                    <li>• 24-hour processing</li>
                    <li>• Email notifications</li>
                  </ul>
                </div>
              </div>

              <div className="minimum-amount-warning">
                ⚠️ Minimum add money amount is ₹30
              </div>

              <div className="modal-actions">
                <button className="cancel-btn" onClick={onClose} disabled={isLoading}>
                  Cancel
                </button>
                <button 
                  className="add-money-btn" 
                  onClick={handleAddMoney}
                  disabled={isLoading || !amount || parseFloat(amount) < 30}
                >
                  {isLoading
                    ? 'Processing...'
                    : selectedMethod === 'upi'
                      ? 'Continue with UPI'
                      : selectedMethod === 'qrcode'
                        ? 'Continue with QR'
                        : `Add ₹${amount || 0}`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      {/* Copy toast (bottom-center, dark background, white text) */}
      {copyToast && (
        <div className="bottom-copy-toast" role="status" aria-live="polite">Copied</div>
      )}

      <Snackbar
        open={snack.open}
        autoHideDuration={3500}
        onClose={closeSnack}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert onClose={closeSnack} severity={snack.severity} variant="filled" sx={{ width: '100%' }}>
          {snack.message}
        </Alert>
      </Snackbar>
    </div>
  );
};

export default AddMoneyModal;
