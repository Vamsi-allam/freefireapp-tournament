import Header from './Header';
import GoogleSignInModal from './GoogleSignInModal';
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import './Homepage.css';
import SupportModal from './SupportModal';

const TermsPage = () => {
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
					<h2 className="section-title">Rules and Conditions</h2>

					<div className="rules-grid">
						<div className="rule-category">
							<div className="rule-icon">🎮</div>
							<h3 className="rule-title">Tournament Rules</h3>
							<ul className="rule-list">
								<li>Players must be 16 years or older to participate</li>
								<li>All participants must have a valid Free Fire account</li>
								<li>Use of hacks, cheats, or third-party software is strictly prohibited</li>
								<li>Teams must check-in 5-10 minutes before tournament start</li>
								<li>Late entries will not be accepted after registration closes</li>
							</ul>
						</div>

						<div className="rule-category">
							<div className="rule-icon">💰</div>
							<h3 className="rule-title">Payment & Prizes</h3>
							<ul className="rule-list">
								<li>Entry fees must be paid before tournament registration</li>
								<li>Refunds are only available 10 minutes before tournament start</li>
								<li>Prize money will be distributed within 1 hours after tournament</li>
								<li>Winners must provide valid bank details for prize transfer</li>
								<li>All transactions are secure and verified</li>
							</ul>
						</div>

						<div className="rule-category">
							<div className="rule-icon">⚖️</div>
							<h3 className="rule-title">Fair Play Policy</h3>
							<ul className="rule-list">
								<li>Respect all players and maintain sportsmanship</li>
								<li>Any form of harassment or toxic behavior will result in ban</li>
								<li>Disputes will be resolved by tournament administrators</li>
								<li>Admin decisions are final and cannot be appealed</li>
								<li>Screenshot evidence required for any complaints</li>
							</ul>
						</div>

						<div className="rule-category">
							<div className="rule-icon">📱</div>
							<h3 className="rule-title">Technical Requirements</h3>
							<ul className="rule-list">
								<li>Stable internet connection required (minimum 10 Mbps)</li>
								<li>Device must support Free Fire game smoothly</li>
								<li>Players must join Discord server for communication</li>
								<li>Room IDs and passwords will be shared 5 minutes before match</li>
								<li>Technical issues during match will not warrant restart</li>
							</ul>
						</div>
					</div>

					<div className="rules-footer">
						<p className="rules-note">
							By participating in our tournaments, you agree to all the above terms and conditions. 
							Violation of any rule may result in disqualification and ban from future tournaments.
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

export default TermsPage;
