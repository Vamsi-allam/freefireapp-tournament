import Header from './Header';
import GoogleSignInModal from './GoogleSignInModal';
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import './Homepage.css';
import SupportModal from './SupportModal';

const PrivacyPage = () => {
	const [showSignInModal, setShowSignInModal] = useState(false);
	const [modalTitle, setModalTitle] = useState('Sign In');
	const [showSupport, setShowSupport] = useState(false);

	// Listen for header sign-in modal events
	useEffect(() => {
		const openSignIn = () => {
			setModalTitle('Sign In');
			setShowSignInModal(true);
		};
		const openSignUp = () => {
			setModalTitle('Sign Up');
			setShowSignInModal(true);
		};
		
		window.addEventListener('open-signin-modal', openSignIn);
		window.addEventListener('open-signup-modal', openSignUp);
		
		return () => {
			window.removeEventListener('open-signin-modal', openSignIn);
			window.removeEventListener('open-signup-modal', openSignUp);
		};
	}, []);

	return (
		<div className="homepage" style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f0625 0%, #1a0d3d 30%, #2d1b69 60%, #4c1d95 100%)' }}>
			<Header />
			<section className="rules-section" style={{ paddingTop: '120px' }}>
				<div className="container">
					<h2 className="section-title">Privacy Policy</h2>

					<div className="rules-grid">
						<div className="rule-category">
							<div className="rule-icon">🔒</div>
							<h3 className="rule-title">Data Collection</h3>
							<ul className="rule-list">
								<li>We collect only essential information for tournament participation</li>
								<li>Personal details include name, email, phone number, and gaming ID</li>
								<li>Payment information is processed securely through encrypted channels</li>
								<li>Game statistics and match results are recorded for leaderboards</li>
								<li>Device information may be collected for security purposes</li>
							</ul>
						</div>

						<div className="rule-category">
							<div className="rule-icon">🛡️</div>
							<h3 className="rule-title">Data Protection</h3>
							<ul className="rule-list">
								<li>All personal data is encrypted and stored on secure servers</li>
								<li>We use industry-standard SSL encryption for data transmission</li>
								<li>Access to user data is limited to authorized personnel only</li>
								<li>Regular security audits ensure data protection compliance</li>
								<li>Your password is never stored in plain text format</li>
							</ul>
						</div>

						<div className="rule-category">
							<div className="rule-icon">👤</div>
							<h3 className="rule-title">Data Usage</h3>
							<ul className="rule-list">
								<li>Personal information is used solely for tournament management</li>
								<li>We may send tournament notifications and updates via email</li>
								<li>Statistical data helps improve our platform and services</li>
								<li>We never sell or share your data with third parties</li>
								<li>Marketing communications can be opted out at any time</li>
							</ul>
						</div>

						<div className="rule-category">
							<div className="rule-icon">⚖️</div>
							<h3 className="rule-title">Your Rights</h3>
							<ul className="rule-list">
								<li>You can request access to all your stored personal data</li>
								<li>Data correction requests are processed within 48 hours</li>
								<li>Account deletion removes all associated personal information</li>
								<li>You can opt-out of non-essential communications anytime</li>
								<li>Contact our support team for any privacy-related queries</li>
							</ul>
						</div>
					</div>

					<div className="rules-footer">
						<p className="rules-note">
							We are committed to protecting your privacy and ensuring the security of your personal information. 
							This privacy policy is regularly updated to reflect current practices and legal requirements.
						</p>
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

			{/* Sign In Modal */}
			<GoogleSignInModal
				isOpen={showSignInModal}
				onClose={() => setShowSignInModal(false)}
				onGoogleSignIn={async () => {
					const { supabase } = await import('../supabaseClient');
					await supabase.auth.signInWithOAuth({ 
						provider: 'google', 
						options: { redirectTo: window.location.origin } 
					});
				}}
				title={modalTitle}
			/>

			{/* Support Modal */}
			<SupportModal
				isOpen={showSupport}
				onClose={() => setShowSupport(false)}
				defaultEmail={sessionStorage.getItem('userEmail') || ''}
				defaultPhone={sessionStorage.getItem('userPhone') || ''}
			/>
		</div>
	);
};

export default PrivacyPage;
