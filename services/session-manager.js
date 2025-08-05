// Session Manager - Handle individual game sessions
// Purpose: Manage user sessions, game state persistence, and reconnection logic

class SessionManager {
  constructor(envManager) {
    this.activeSessions = new Map(); // sessionId -> session data
    this.userSessions = new Map(); // userId -> sessionId
    this.sessionTimeouts = new Map(); // sessionId -> timeout
    this.connectionSessions = new Map(); // ws -> sessionId
    this.envManager = envManager;
    this.sessionTimeout = 30 * 60 * 1000; // 30 minutes default timeout
  }

  // Generate unique session ID
  generateSessionId() {
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Create new game session
  createSession(userId, gamemode, userData, ws = null) {
    try {
      // End any existing session for this user
      const existingSessionId = this.userSessions.get(userId);
      if (existingSessionId) {
        this.endSession(existingSessionId);
      }

      const sessionId = this.generateSessionId();
      const sessionData = {
        sessionId: sessionId,
        userId: userId,
        gamemode: gamemode,
        userData: userData,
        startTime: Date.now(),
        lastActivity: Date.now(),
        connections: ws ? new Set([ws]) : new Set(),
        gameData: {},
        statistics: {
          messagesCount: 0,
          actionsCount: 0,
          roomSwitches: 0
        }
      };

      // Store session
      this.activeSessions.set(sessionId, sessionData);
      this.userSessions.set(userId, sessionId);
      
      if (ws) {
        this.connectionSessions.set(ws, sessionId);
      }

      // Set up session timeout
      this.setupSessionTimeout(sessionId);

      console.log(`session created for user ${userData.username}: ${sessionId}`);
      return sessionId;
    } catch (error) {
      console.error('error creating session:', error);
      return null;
    }
  }

  // Get user's active session
  getUserSession(userId) {
    const sessionId = this.userSessions.get(userId);
    if (!sessionId) {
      return null;
    }

    const session = this.activeSessions.get(sessionId);
    if (!session) {
      // Clean up orphaned reference
      this.userSessions.delete(userId);
      return null;
    }

    // Check if session has expired
    if (this.isSessionExpired(session)) {
      this.endSession(sessionId);
      return null;
    }

    return session;
  }

  // Get session by ID
  getSession(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return null;
    }

    // Check if session has expired
    if (this.isSessionExpired(session)) {
      this.endSession(sessionId);
      return null;
    }

    return session;
  }

  // Get session by WebSocket connection
  getSessionByConnection(ws) {
    const sessionId = this.connectionSessions.get(ws);
    if (!sessionId) {
      return null;
    }

    return this.getSession(sessionId);
  }

  // Update session data
  updateSession(sessionId, newData) {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        return false;
      }

      // Update session data
      Object.assign(session, newData);
      session.lastActivity = Date.now();

      // Extend session timeout
      this.extendSessionTimeout(sessionId);

      return true;
    } catch (error) {
      console.error('error updating session:', error);
      return false;
    }
  }

  // Add connection to session
  addConnectionToSession(ws, sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.connections.add(ws);
      this.connectionSessions.set(ws, sessionId);
      session.lastActivity = Date.now();
      console.log(`connection added to session ${sessionId}`);
    }
  }

  // Remove connection from session
  removeConnectionFromSession(ws) {
    const sessionId = this.connectionSessions.get(ws);
    if (sessionId) {
      const session = this.activeSessions.get(sessionId);
      if (session) {
        session.connections.delete(ws);
        this.connectionSessions.delete(ws);
        
        // If no more connections, start session cleanup timer
        if (session.connections.size === 0) {
          this.startSessionCleanupTimer(sessionId);
        }
      }
    }
  }

  // Handle user reconnection
  async handleReconnection(userId, ws) {
    try {
      const session = this.getUserSession(userId);
      if (!session) {
        return null;
      }

      // Add new connection to existing session
      this.addConnectionToSession(ws, session.sessionId);

      console.log(`user ${session.userData.username} reconnected to session ${session.sessionId}`);
      
      return {
        sessionId: session.sessionId,
        gamemode: session.gamemode,
        userData: session.userData,
        gameData: session.gameData,
        reconnected: true
      };
    } catch (error) {
      console.error('error handling reconnection:', error);
      return null;
    }
  }

  // End game session
  endSession(sessionId) {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        return false;
      }

      // Clear timeout
      if (this.sessionTimeouts.has(sessionId)) {
        clearTimeout(this.sessionTimeouts.get(sessionId));
        this.sessionTimeouts.delete(sessionId);
      }

      // Remove all connections
      for (const ws of session.connections) {
        this.connectionSessions.delete(ws);
      }

      // Remove session mappings
      this.activeSessions.delete(sessionId);
      this.userSessions.delete(session.userId);

      console.log(`session ended: ${sessionId} for user ${session.userData.username}`);
      return true;
    } catch (error) {
      console.error('error ending session:', error);
      return false;
    }
  }

  // Check session validity
  isSessionValid(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return false;
    }

    return !this.isSessionExpired(session);
  }

  // Check if session has expired
  isSessionExpired(session) {
    const now = Date.now();
    return (now - session.lastActivity) > this.sessionTimeout;
  }

  // Set up session timeout
  setupSessionTimeout(sessionId) {
    if (this.sessionTimeouts.has(sessionId)) {
      clearTimeout(this.sessionTimeouts.get(sessionId));
    }

    const timeout = setTimeout(() => {
      this.handleSessionTimeout(sessionId);
    }, this.sessionTimeout);

    this.sessionTimeouts.set(sessionId, timeout);
  }

  // Extend session timeout
  extendSessionTimeout(sessionId) {
    this.setupSessionTimeout(sessionId);
  }

  // Start session cleanup timer (when no connections)
  startSessionCleanupTimer(sessionId) {
    // Give 5 minutes for reconnection before cleanup
    const cleanupTimeout = setTimeout(() => {
      const session = this.activeSessions.get(sessionId);
      if (session && session.connections.size === 0) {
        console.log(`cleaning up session ${sessionId} (no connections)`);
        this.endSession(sessionId);
      }
    }, 5 * 60 * 1000); // 5 minutes

    // Store cleanup timeout separately
    if (!this.cleanupTimeouts) {
      this.cleanupTimeouts = new Map();
    }
    this.cleanupTimeouts.set(sessionId, cleanupTimeout);
  }

  // Get session statistics
  getSessionStats(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return null;
    }

    const duration = Date.now() - session.startTime;
    const isActive = session.connections.size > 0;

    return {
      sessionId: sessionId,
      userId: session.userId,
      username: session.userData.username,
      gamemode: session.gamemode,
      duration: duration,
      startTime: session.startTime,
      lastActivity: session.lastActivity,
      isActive: isActive,
      connectionCount: session.connections.size,
      statistics: session.statistics
    };
  }

  // Get all active session statistics
  getAllSessionStats() {
    const stats = [];
    for (const [sessionId, session] of this.activeSessions) {
      stats.push(this.getSessionStats(sessionId));
    }
    return stats;
  }

  // Handle session timeout
  handleSessionTimeout(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      console.log(`session timeout: ${sessionId} for user ${session.userData.username}`);
      this.endSession(sessionId);
    }
  }

  // Update session activity (called on user actions)
  updateActivity(sessionId, activityType = 'general') {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.lastActivity = Date.now();
      
      // Update statistics
      switch (activityType) {
        case 'message':
          session.statistics.messagesCount++;
          break;
        case 'action':
          session.statistics.actionsCount++;
          break;
        case 'room_switch':
          session.statistics.roomSwitches++;
          break;
      }

      this.extendSessionTimeout(sessionId);
    }
  }

  // Migrate session to new server (placeholder for future clustering)
  async migrateSession(sessionId, newServerId) {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        return false;
      }

      // In a clustered environment, this would transfer session data
      // to another server instance
      console.log(`session migration requested: ${sessionId} to ${newServerId}`);
      
      // For now, just log the migration request
      return true;
    } catch (error) {
      console.error('error migrating session:', error);
      return false;
    }
  }

  // Clean up all sessions
  cleanup() {
    for (const [sessionId] of this.activeSessions) {
      this.endSession(sessionId);
    }
    
    if (this.cleanupTimeouts) {
      for (const [sessionId, timeout] of this.cleanupTimeouts) {
        clearTimeout(timeout);
      }
      this.cleanupTimeouts.clear();
    }
  }
}

module.exports = SessionManager; 