import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

const Header = () => {
		const { isAuthenticated, role } = useSelector((state) => state.user);
	const navigate = useNavigate();
	const location = useLocation();
		const [isScrolled, setIsScrolled] = useState(false);

		useEffect(() => {
			const onScroll = () => setIsScrolled(window.scrollY > 50);
			window.addEventListener('scroll', onScroll);
			return () => window.removeEventListener('scroll', onScroll);
		}, []);

	const handleLoginClick = (e) => {
		e.preventDefault();
		if (isAuthenticated) {
			navigate(role === 'ADMIN' ? '/admin' : '/user');
		} else {
			// Let pages open their own sign-in modal via custom event
			window.dispatchEvent(new CustomEvent('open-signin-modal'));
		}
	};

		return (
			<nav className={`navbar ${isScrolled ? 'scrolled' : ''}`}>
			<div className="nav-container">
					<Link to="/" className="nav-brand" style={{ textDecoration: 'none' }}>
					<span className="trophy-icon">🏆</span>
					<span className="brand-text">PrimeArena</span>
				</Link>

				<div className="nav-links">
						<Link to="/" className="nav-link">Home</Link>
						{isAuthenticated ? (
							<button onClick={handleLoginClick} className="login-btn">Dashboard</button>
						) : (
							<div style={{ display: 'flex', gap: '0.75rem' }}>
								<button onClick={() => {
									window.dispatchEvent(new CustomEvent('open-signin-modal'));
								}} className="login-btn">Sign In</button>
								<button onClick={() => {
									window.dispatchEvent(new CustomEvent('open-signup-modal'));
								}} className="login-btn">Sign Up</button>
							</div>
						)}
				</div>
			</div>
		</nav>
	);
};

export default Header;
