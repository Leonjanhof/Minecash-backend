// WebSocket Server - Central real-time communication hub
// Purpose: Handle all WebSocket connections, room management, and real-time events

const WebSocket = require('ws');
const ChatManager = require('../services/chat-manager');
const RoomManager = require('./room-manager');
const SessionManager = require('../services/session-manager');
const LoggingService = require('./logging-service');

class WebSocketServer {
  constructor(envManager) {
    this.wss = null;
    this.envManager = envManager;
    this.gameEngine = null; // Will be set by main server
    this.logger = new LoggingService();
    
    // Rate limiting
    this.rateLimit = new Map(); // userId -> { count: number, resetTime: number }
    this.rateLimitConfig = {
      maxMessages: 10, // Max messages per window
      windowMs: 10000, // 10 second window
      resetTime: 60000 // Reset rate limit after 1 minute of no activity
    };
    
    // Initialize managers with direct broadcast function
    this.chatManager = new ChatManager(envManager, (gamemode, message) => {
      this.broadcastToRoom(gamemode, message);
    });
    this.roomManager = new RoomManager(envManager, (gamemode, message) => {
      this.broadcastToRoom(gamemode, message);
    }, this.chatManager);
    this.sessionManager = new SessionManager(envManager);
  }

  // Initialize WebSocket server
  async initialize(server, gameEngine = null) {
    this.wss = new WebSocket.Server({ server });
    this.gameEngine = gameEngine;
    this.setupEventHandlers();
    
    // Start connection keep-alive mechanism
    this.startKeepAlive();
    
    // Start periodic crash state broadcast if game engine is available
    if (this.gameEngine) {
      // Clear any existing broadcast interval
      if (this.crashBroadcastInterval) {
        clearInterval(this.crashBroadcastInterval);
      }
      
      this.crashBroadcastInterval = setInterval(async () => {
        try {
          await this.broadcastCrashState();
        } catch (error) {
          this.logger.error('error broadcasting crash state:', error);
        }
      }, 1000); // Reduced from 16ms to 1000ms (1 second) to prevent spam
    }
    
    await this.logger.info('websocket server initialized');
  }

  // Get Supabase client using environment variables
  getSupabaseClient() {
    const { createClient } = require('@supabase/supabase-js');
    const dbConfig = this.envManager.getDatabaseConfig();
    return createClient(dbConfig.url, dbConfig.anonKey);
  }

  // Get Supabase admin client with service role key (bypasses RLS)
  getSupabaseAdminClient() {
    const { createClient } = require('@supabase/supabase-js');
    const dbConfig = this.envManager.getDatabaseConfig();
    return createClient(dbConfig.url, dbConfig.serviceKey);
  }

  // Setup WebSocket event handlers
  setupEventHandlers() {
    this.wss.on('connection', (ws, req) => {
      this.handleConnection(ws, req);
    });
  }

  // Handle new WebSocket connection
  handleConnection(ws, req) {
    // Only log connections for debugging, not every connection
    // this.logger.info('new webSocket connection established');

    // Set up ping/pong for connection keep-alive
    ws.isAlive = true;
    ws.lastPong = Date.now();
    
    ws.on('pong', () => {
      ws.isAlive = true;
      ws.lastPong = Date.now();
    });

    // Handle incoming messages
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        
        // Handle ping/pong messages
        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          return;
        }
        
        this.handleMessage(ws, data);
      } catch (error) {
        this.logger.error('error parsing webSocket message:', error);
        ws.send(JSON.stringify({ 
          type: 'error', 
          message: 'Invalid message format' 
        }));
      }
    });

    // Send current game state immediately for sync
    setTimeout(() => {
      this.sendCurrentGameState(ws);
    }, 100);

    // Handle connection close
    ws.on('close', () => {
      this.handleDisconnection(ws);
    });

    // Handle errors
    ws.on('error', (error) => {
      this.logger.error('webSocket error:', error);
      this.handleDisconnection(ws);
    });

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'welcome',
      message: 'Connected to MineCash WebSocket server',
      timestamp: new Date().toISOString()
    }));
  }

  // Check rate limit for user
  checkRateLimit(userId) {
    const now = Date.now();
    const userLimit = this.rateLimit.get(userId);
    
    if (!userLimit) {
      // First message from user
      this.rateLimit.set(userId, {
        count: 1,
        resetTime: now + this.rateLimitConfig.windowMs
      });
      return true;
    }
    
    // Check if rate limit window has expired
    if (now > userLimit.resetTime) {
      // Reset rate limit
      this.rateLimit.set(userId, {
        count: 1,
        resetTime: now + this.rateLimitConfig.windowMs
      });
      return true;
    }
    
    // Check if user has exceeded rate limit
    if (userLimit.count >= this.rateLimitConfig.maxMessages) {
      return false;
    }
    
    // Increment message count
    userLimit.count++;
    return true;
  }

  // Clean up old rate limit entries
  cleanupRateLimit() {
    const now = Date.now();
    for (const [userId, limit] of this.rateLimit.entries()) {
      if (now > limit.resetTime + this.rateLimitConfig.resetTime) {
        this.rateLimit.delete(userId);
      }
    }
  }

  // Handle incoming WebSocket messages
  handleMessage(ws, data) {
    const { type, gamemode, token, ...payload } = data;
    
    // Get user ID for rate limiting
    const connection = this.roomManager.getConnection(ws);
    const userId = connection?.userData?.id || 'anonymous';
    
    // Check rate limit for non-system messages
    if (type !== 'ping' && type !== 'pong' && !this.checkRateLimit(userId)) {
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Rate limit exceeded. Please wait before sending more messages.',
        timestamp: new Date().toISOString()
      }));
      return;
    }

    switch (type) {
      case 'join_game':
        this.roomManager.handleJoinGame(ws, gamemode, token);
        break;
      
      case 'place_bet':
        this.handlePlaceBet(ws, payload);
        break;
      
      case 'game_action':
        this.handleGameAction(ws, payload);
        break;
      
      case 'chat_message':
        this.chatManager.handleChatMessage(ws, payload, connection);
        break;
      
      case 'leave_game':
        this.roomManager.handleLeaveGame(ws, gamemode);
        break;
      
      case 'request_game_state':
        this.handleRequestGameState(ws, payload);
        break;
      
      default:
        ws.send(JSON.stringify({
          type: 'error',
          message: `Unknown message type: ${type}`
        }));
    }
  }

  // Handle place bet event
  async handlePlaceBet(ws, payload) {
    try {
      const connection = this.roomManager.getConnection(ws);
      if (!connection || !connection.gamemode) {
        ws.send(JSON.stringify({
          type: 'not_in_game_room',
          message: 'Not connected to a game'
        }));
        return;
      }

      const { amount, betType = 'normal' } = payload;
      if (!amount || amount <= 0) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Invalid bet amount'
        }));
        return;
      }

      const username = connection.userData?.username || 'anonymous';
      this.logger.info(`user ${username} placing bet: ${amount} in ${connection.gamemode}`);
      
      // Process bet through game engine if available
      if (this.gameEngine) {
        try {
          const userId = connection.userData?.id || 'anonymous';
          const gameId = `${connection.gamemode}-main`;
          const result = await this.gameEngine.processBet(gameId, userId, { amount, betType });
          
          if (result.success) {
            // Send success response - use bet_confirmed to match frontend expectations
            ws.send(JSON.stringify({
              type: 'bet_confirmed',
              amount,
              betType,
              result,
              timestamp: new Date().toISOString()
            }));
            
            // Get updated game state for crash
            if (connection.gamemode === 'crash') {
              const userId = connection.userData?.id || 'anonymous';
              const crashState = await this.gameEngine.getGameState(gameId, userId);
              
              // Broadcast updated game state - use crash_state_update for crash
              this.broadcastToRoom(connection.gamemode, {
                type: 'crash_state_update',
                state: crashState,
                action: 'bet_placed',
                userData: connection.userData,
                timestamp: new Date().toISOString()
              });
            }
          } else {
            // Send failure response with proper message
            ws.send(JSON.stringify({
              type: 'bet_failed',
              amount,
              betType,
              message: result.message || 'Bet placement failed',
              timestamp: new Date().toISOString()
            }));
          }
          
        } catch (gameError) {
          this.logger.error('game engine error:', gameError);
          ws.send(JSON.stringify({
            type: 'error',
            message: gameError.message || 'Failed to place bet'
          }));
          return;
        }
      }
      
      // Broadcast bet to room (only for successful bets)
      this.broadcastToRoom(connection.gamemode, {
        type: 'bet_placed',
        userData: connection.userData,
        amount,
        betType,
        gamemode: connection.gamemode,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      this.logger.error('error processing bet:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to process bet'
      }));
    }
  }

  // Handle request game state event
  async handleRequestGameState(ws, payload) {
    try {
      const connection = this.roomManager.getConnection(ws);
      if (!connection || !connection.gamemode) {
        ws.send(JSON.stringify({
          type: 'not_in_game_room',
          message: 'Not connected to a game'
        }));
        return;
      }

      const userId = connection.userData?.id || 'anonymous';
      const gameId = `${connection.gamemode}-main`;
      
      // Get game state from game engine if available
      if (this.gameEngine) {
        try {
          const gameState = await this.gameEngine.getGameState(gameId, userId);
          
          // Send appropriate message type based on gamemode
          const messageType = connection.gamemode === 'crash' ? 'crash_state_update' : 'game_state_update';
          
          ws.send(JSON.stringify({
            type: messageType,
            gamemode: connection.gamemode,
            state: gameState,
            timestamp: new Date().toISOString()
          }));
          
        } catch (gameError) {
          this.logger.error('game engine error:', gameError);
          ws.send(JSON.stringify({
            type: 'error',
            message: gameError.message || 'Failed to get game state'
          }));
        }
      }
      
    } catch (error) {
      this.logger.error('error getting game state:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to get game state'
      }));
    }
  }

  // Handle game action event
  async handleGameAction(ws, payload) {
    try {
      const connection = this.roomManager.getConnection(ws);
      if (!connection || !connection.gamemode) {
        ws.send(JSON.stringify({
          type: 'not_in_game_room',
          message: 'Not connected to a game'
        }));
        return;
      }

      const { action, targetMultiplier } = payload;
      if (!action) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'No action specified'
        }));
        return;
      }

      const username = connection.userData?.username || 'anonymous';
      this.logger.info(`user ${username} performed game action: ${action} in ${connection.gamemode}`);
      
      // Process game action through game engine if available
      if (this.gameEngine) {
        try {
          const userId = connection.userData?.id || 'anonymous';
          const gameId = `${connection.gamemode}-main`;
          const result = await this.gameEngine.processGameAction(gameId, userId, action, { targetMultiplier });
          
          if (result.success) {
            // Send success response with proper structure for frontend
            const responseMessage = {
              type: 'game_action_success',
              action,
              result,
              timestamp: new Date().toISOString()
            };
            
            // Add cashout-specific properties for frontend compatibility
            if (action === 'cashout' && result.cashoutValue) {
              responseMessage.cashoutMultiplier = result.cashoutValue;
              responseMessage.cashoutAmount = result.cashoutAmount;
            }
            
            // Add auto-cashout-specific properties for frontend compatibility
            if (action === 'auto_cashout' && result.targetValue) {
              responseMessage.targetMultiplier = result.targetValue;
            }
            
            ws.send(JSON.stringify(responseMessage));
            
            // Get updated game state for crash
            if (connection.gamemode === 'crash') {
              const userId = connection.userData?.id || 'anonymous';
              const crashState = await this.gameEngine.getGameState(gameId, userId);
              
              // Broadcast updated game state - use crash_state_update for crash
              this.broadcastToRoom(connection.gamemode, {
                type: 'crash_state_update',
                state: crashState,
                action: action,
                userData: connection.userData,
                timestamp: new Date().toISOString()
              });
            }
          } else {
            // Send failure response with proper message
            ws.send(JSON.stringify({
              type: 'game_action_failed',
              action,
              message: result.message || 'Game action failed',
              timestamp: new Date().toISOString()
            }));
          }
          
        } catch (gameError) {
          this.logger.error('game engine error:', gameError);
          ws.send(JSON.stringify({
            type: 'error',
            message: gameError.message || 'Failed to process game action'
          }));
          return;
        }
      }
      
      // Broadcast action to room (only for successful actions or general game actions)
      this.broadcastToRoom(connection.gamemode, {
        type: 'game_action',
        userData: connection.userData,
        action,
        gamemode: connection.gamemode,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      this.logger.error('error processing game action:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to process game action'
      }));
    }
  }

  // Handle disconnection
  handleDisconnection(ws) {
    try {
      // Use room manager to handle disconnection
      this.roomManager.handleDisconnection(ws);
      
      // Remove from session manager
      this.sessionManager.removeConnectionFromSession(ws);
      
      this.logger.info('connection disconnected and cleaned up');
    } catch (error) {
      this.logger.error('error handling disconnection:', error);
    }
  }

  // Broadcast message to all users in a specific game room
  broadcastToRoom(gamemode, message) {
    if (!this.wss) return;
    
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        const connection = this.roomManager.getConnection(client);
        if (connection && connection.gamemode === gamemode) {
          client.send(JSON.stringify(message));
        }
      }
    });
  }

  // Send message to specific user
  sendToUser(userId, message) {
    if (!this.wss) return;
    
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        const connection = this.roomManager.getConnection(client);
        if (connection && connection.userData && connection.userData.id === userId) {
          client.send(JSON.stringify(message));
        }
      }
    });
  }

  // Send current game state to a specific connection
  async sendCurrentGameState(ws) {
    try {
      const connection = this.roomManager.getConnection(ws);
      if (!connection || !connection.gamemode) {
        return;
      }

      const userId = connection.userData?.id || 'anonymous';
      const gameId = `${connection.gamemode}-main`;
      
      // Get game state from game engine if available
      if (this.gameEngine) {
        try {
          const gameState = await this.gameEngine.getGameState(gameId, userId);
          
          // Send appropriate message type based on gamemode
          const messageType = connection.gamemode === 'crash' ? 'crash_state_update' : 'game_state_update';
          
          ws.send(JSON.stringify({
            type: messageType,
            gamemode: connection.gamemode,
            state: gameState,
            timestamp: new Date().toISOString()
          }));
          
        } catch (gameError) {
          this.logger.error('game engine error:', gameError);
          ws.send(JSON.stringify({
            type: 'error',
            message: gameError.message || 'Failed to get game state'
          }));
        }
      }
      
    } catch (error) {
      this.logger.error('error sending current game state:', error);
    }
  }

  // Get room statistics
  getRoomStats() {
    return this.roomManager.getRoomStats();
  }

  // Log room state for debugging
  logRoomState() {
    this.roomManager.logRoomState();
  }

  // Broadcast crash game state to all crash room users
  async broadcastCrashState() {
    try {
      if (!this.gameEngine) {
        return;
      }

      const gameId = 'crash-main';
      const crashState = await this.gameEngine.getGameState(gameId);
      
      if (crashState) {
        this.broadcastToRoom('crash', {
          type: 'crash_state_update',
          state: crashState,
          timestamp: new Date().toISOString()
        });
      }
      
    } catch (error) {
      this.logger.error('error broadcasting crash state:', error);
    }
  }

  // Start keep-alive mechanism
  startKeepAlive() {
    // Send ping every 30 seconds to keep connections alive
    this.keepAliveInterval = setInterval(() => {
      if (this.wss) {
        this.wss.clients.forEach((ws) => {
          if (ws.readyState === WebSocket.OPEN) {
            // Check if connection is still alive
            if (ws.isAlive === false) {
              // Connection is dead, terminate it
              ws.terminate();
              return;
            }
            
            // Only send ping to clients who are in game rooms
            const connection = this.roomManager.getConnection(ws);
            if (connection && connection.gamemode) {
              // Mark as not alive and send ping
              ws.isAlive = false;
              ws.ping();
              
              // Send a JSON ping message as well for better compatibility
              ws.send(JSON.stringify({ 
                type: 'ping', 
                timestamp: Date.now() 
              }));
            }
          }
        });
      }
    }, 30000); // 30 seconds
    
    // Start memory monitoring
    this.memoryMonitorInterval = setInterval(() => {
      const memUsage = process.memoryUsage();
      const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
      const rssMB = Math.round(memUsage.rss / 1024 / 1024);
      
      // Clean up rate limit entries
      this.cleanupRateLimit();
      
      // Log memory usage every 5 minutes
      if (heapUsedMB > 100 || rssMB > 200) {
        this.logger.info(`Memory usage - Heap: ${heapUsedMB}MB, RSS: ${rssMB}MB, External: ${Math.round(memUsage.external / 1024 / 1024)}MB`);
        
        // Force garbage collection if memory usage is high
        if (heapUsedMB > 150 && global.gc) {
          global.gc();
          this.logger.info(`Forced garbage collection at ${heapUsedMB}MB heap usage`);
        }
      }
    }, 5 * 60 * 1000); // 5 minutes
  }

  // Graceful shutdown method
  async shutdown() {
    try {
      await this.logger.info('shutting down websocket server...');
      
      // Clear broadcast intervals
      if (this.crashBroadcastInterval) {
        clearInterval(this.crashBroadcastInterval);
        this.crashBroadcastInterval = null;
      }
      
      // Clear keep-alive interval
      if (this.keepAliveInterval) {
        clearInterval(this.keepAliveInterval);
        this.keepAliveInterval = null;
      }
      
      // Clear memory monitor interval
      if (this.memoryMonitorInterval) {
        clearInterval(this.memoryMonitorInterval);
        this.memoryMonitorInterval = null;
      }
      
      // Close all WebSocket connections
      if (this.wss) {
        this.wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.close(1000, 'Server shutting down');
          }
        });
        
        // Close the WebSocket server
        this.wss.close(() => {
          this.logger.info('websocket server closed');
        });
      }
      
      // Clean up managers
      if (this.roomManager) {
        this.roomManager.cleanup();
      }
      
      if (this.sessionManager) {
        this.sessionManager.cleanup();
      }
      
      if (this.chatManager) {
        this.chatManager.cleanup();
      }
      
      // Clean up game engine
      if (this.gameEngine) {
        this.gameEngine.cleanup();
      }
      
      await this.logger.info('websocket server shutdown complete');
    } catch (error) {
      await this.logger.error('error during websocket shutdown:', error);
    }
  }
}

module.exports = WebSocketServer;