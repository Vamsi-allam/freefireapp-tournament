import { createSlice } from '@reduxjs/toolkit';
 
const initialState = {
  userData: {
    name: sessionStorage.getItem('userName') || null,
    email: sessionStorage.getItem('userEmail') || null,
    phone: sessionStorage.getItem('userPhone') || null,
    gameId: sessionStorage.getItem('userGameId') || null,
    role: sessionStorage.getItem('userRole') || null,
    avatar: sessionStorage.getItem('userAvatar') || null
  },
  isAuthenticated: !!sessionStorage.getItem('token') || !!sessionStorage.getItem('supabaseSession'),
  role: sessionStorage.getItem('userRole') || null,
  token: sessionStorage.getItem('token') || sessionStorage.getItem('supabaseAccessToken') || null
};
 
const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    setUser: (state, action) => {
      state.userData = {
        name: action.payload.name,
        email: action.payload.email,
        phone: action.payload.phone,
        gameId: action.payload.gameId,
        role: action.payload.role,
        avatar: action.payload.avatar || null
      };
      state.isAuthenticated = true;
      state.role = action.payload.role;
      state.token = action.payload.token;
      sessionStorage.setItem('token', action.payload.token);
      sessionStorage.setItem('userRole', action.payload.role);
      sessionStorage.setItem('userName', action.payload.name);
      sessionStorage.setItem('userEmail', action.payload.email);
      sessionStorage.setItem('userPhone', action.payload.phone);
      if (action.payload.avatar) sessionStorage.setItem('userAvatar', action.payload.avatar);
    },
    setSupabaseSession: (state, action) => {
      const { session, role } = action.payload;
      if (!session) return;
      const user = session.user;
      state.userData = {
        name: user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0],
        email: user.email,
        phone: sessionStorage.getItem('userPhone') || user.user_metadata?.phone || null,
        gameId: sessionStorage.getItem('userGameId') || null,
        role: role,
        avatar: sessionStorage.getItem('userAvatar') || user.user_metadata?.avatar_url || null
      };
      state.isAuthenticated = true;
      state.role = role;
      state.token = session.access_token;
      sessionStorage.setItem('supabaseSession', JSON.stringify(session));
      sessionStorage.setItem('supabaseAccessToken', session.access_token);
      sessionStorage.setItem('userRole', role);
      sessionStorage.setItem('userName', state.userData.name || '');
      sessionStorage.setItem('userEmail', state.userData.email || '');
      if (state.userData.phone) sessionStorage.setItem('userPhone', state.userData.phone);
      if (state.userData.gameId) sessionStorage.setItem('userGameId', state.userData.gameId);
      if (state.userData.avatar) sessionStorage.setItem('userAvatar', state.userData.avatar);
    },
    updateProfile: (state, action) => {
      // Update user profile with new information, preserving existing data
      if (action.payload.displayName) {
        state.userData.name = action.payload.displayName;
        sessionStorage.setItem('userName', action.payload.displayName);
      }
      if (action.payload.phoneNumber) {
        state.userData.phone = action.payload.phoneNumber;
        sessionStorage.setItem('userPhone', action.payload.phoneNumber);
      }
      if (action.payload.gameId) {
        state.userData.gameId = action.payload.gameId;
        sessionStorage.setItem('userGameId', action.payload.gameId);
      }
      // Preserve avatar if not explicitly updated
      if (action.payload.avatar !== undefined) {
        state.userData.avatar = action.payload.avatar;
        if (action.payload.avatar) {
          sessionStorage.setItem('userAvatar', action.payload.avatar);
        } else {
          sessionStorage.removeItem('userAvatar');
        }
      }
    },
    clearUser: (state) => {
      state.userData = {
        name: null,
        email: null,
        phone: null,
        gameId: null,
        role: null,
        avatar: null
      };
      state.isAuthenticated = false;
      state.role = null;
      state.token = null;
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('userRole');
  sessionStorage.removeItem('userName');
  sessionStorage.removeItem('userEmail');
  sessionStorage.removeItem('userPhone');
  sessionStorage.removeItem('userGameId');
  sessionStorage.removeItem('userAvatar');
  sessionStorage.removeItem('supabaseSession');
  sessionStorage.removeItem('supabaseAccessToken');
  sessionStorage.removeItem('needsProfileCompletion');
    },
    // Optional alias for clarity in components
    logout: (state) => {
      // reuse logic
      const s = state;
      s.userData = { name: null, email: null, phone: null, gameId: null, role: null, avatar: null };
      s.isAuthenticated = false;
      s.role = null;
      s.token = null;
      try {
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('userRole');
        sessionStorage.removeItem('userName');
        sessionStorage.removeItem('userEmail');
        sessionStorage.removeItem('userPhone');
        sessionStorage.removeItem('userGameId');
        sessionStorage.removeItem('userAvatar');
        sessionStorage.removeItem('supabaseSession');
        sessionStorage.removeItem('supabaseAccessToken');
        sessionStorage.removeItem('needsProfileCompletion');
      } catch {}
    },
    initializeFromStorage: (state) => {
      const sessionStr = sessionStorage.getItem('supabaseSession');
      if (sessionStr) {
        try {
          const session = JSON.parse(sessionStr);
          state.isAuthenticated = true;
          state.token = session.access_token;
          state.role = sessionStorage.getItem('userRole');
          state.userData = {
            name: sessionStorage.getItem('userName'),
            email: sessionStorage.getItem('userEmail'),
            phone: sessionStorage.getItem('userPhone'),
            gameId: sessionStorage.getItem('userGameId'),
            role: sessionStorage.getItem('userRole'),
            avatar: sessionStorage.getItem('userAvatar')
          };
          return;
        } catch {}
      }
      const token = sessionStorage.getItem('token');
      if (token) {
        state.isAuthenticated = true;
        state.token = token;
        state.role = sessionStorage.getItem('userRole');
        state.userData = {
          name: sessionStorage.getItem('userName'),
          email: sessionStorage.getItem('userEmail'),
          phone: sessionStorage.getItem('userPhone'),
          gameId: sessionStorage.getItem('userGameId'),
          role: sessionStorage.getItem('userRole'),
          avatar: sessionStorage.getItem('userAvatar')
        };
      }
    }
  },
});
 
export const { setUser, clearUser, initializeFromStorage, setSupabaseSession, updateProfile } = userSlice.actions;
export const selectUser = (state) => state.user.userData;
export const selectIsAuthenticated = (state) => state.user.isAuthenticated;
export const selectRole = (state) => state.user.role;
 
export default userSlice.reducer;