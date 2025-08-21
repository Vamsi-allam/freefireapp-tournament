import React, { useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useDispatch, useSelector } from 'react-redux';
import { setSupabaseSession } from '../redux/userSlice';
import { useNavigate } from 'react-router-dom';

const SignIn = () => {
  const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { isAuthenticated, role } = useSelector(state=>state.user);

  useEffect(()=>{
    if (isAuthenticated) {
      navigate(role === 'ADMIN' ? '/admin' : '/user');
    }
  },[isAuthenticated,role,navigate]);

  useEffect(()=>{
    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session)=>{
      if (session) {
        const adminEmail = import.meta.env.VITE_ADMIN_EMAIL;
        const r = session.user.email === adminEmail ? 'ADMIN' : 'USER';
        
  // Directly set session; backend no longer used
  sessionStorage.setItem('userRole', r);
  sessionStorage.setItem('userName', session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email?.split('@')[0] || '');
  sessionStorage.setItem('userEmail', session.user.email || '');
  if (session.user.user_metadata?.avatar_url) sessionStorage.setItem('userAvatar', session.user.user_metadata?.avatar_url);
  dispatch(setSupabaseSession({ session, role: r }));
  navigate(r === 'ADMIN' ? '/admin' : '/user');
      }
    });
    return ()=>listener.subscription.unsubscribe();
  },[dispatch,navigate]);

  const handleGoogle = async () => {
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + '/signin' } });
  };

  return (
    <div className='signin-container' style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div className='signin-box' style={{textAlign:'center'}}>
        <h2 className='signin-heading'>Sign in</h2>
        <p className='signin-sub-heading'>Continue with your Google account</p>
        <button onClick={handleGoogle} className='signin-button' style={{marginTop:'1rem'}}>Continue with Google</button>
      </div>
    </div>
  );
};

export default SignIn;