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

  // Handle incoming WebSocket messages
  handleMessage(ws, data) {
    const { type, gamemode, token, ...payload } = data;

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
        const connection = this.roomManager.getConnection(ws);
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
      const { amount, gameId } = payload;
      const connection = this.roomManager.getConnection(ws);
      
      if (!connection || !connection.gamemode) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Not in a game room'
        }));
        return;
      }

      // Process bet through game engine if available
      if (this.gameEngine) {
        try {
          const userId = connection.userData?.id || 'anonymous';
          const result = await this.gameEngine.processBet(connection.gamemode, userId, {
            amount: parseFloat(amount),
            betType: 'standard'
          });
          
          if (result.success) {
            // Only log successful bets
            const username = connection.userData?.username || 'anonymous';
            this.logger.info(`user ${username} placed bet: ${amount} in ${connection.gamemode}`);
            // Bet was successful
            // Get updated game state
            if (connection.gamemode === 'crash') {
              const userId = connection.userData?.id || 'anonymous';
              const crashState = await this.gameEngine.getCrashGameState(userId);
              
              // Broadcast updated game state
              this.broadcastToRoom(connection.gamemode, {
                type: 'game_state_update',
                gamemode: connection.gamemode,
                state: crashState,
                timestamp: new Date().toISOString()
              });
            }
            
            // Send success confirmation
            ws.send(JSON.stringify({
              type: 'bet_confirmed',
              amount,
              gameId,
              betAmount: amount,
              message: result.message || 'Bet placed successfully'
            }));
            
            // Broadcast bet to room
            this.broadcastToRoom(connection.gamemode, {
              type: 'bet_placed',
              userData: connection.userData,
              amount,
              gameId,
              gamemode: connection.gamemode,
              timestamp: new Date().toISOString()
            });
            
          } else {
            // Bet failed - send friendly message
            ws.send(JSON.stringify({
              type: 'bet_failed',
              message: result.message || 'Bet failed',
              phase: result.phase,
              minBet: result.minBet,
              maxBet: result.maxBet,
              allowedPhases: result.allowedPhases
            }));
            return;
          }
          
        } catch (gameError) {
          this.logger.error('game engine error:', gameError);
          ws.send(JSON.stringify({
            type: 'error',
            message: gameError.message || 'Failed to process bet'
          }));
          return;
        }
      }
      
    } catch (error) {
      this.logger.error('error placing bet:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to place bet'
      }));
    }
  }

  // Handle request game state
  async handleRequestGameState(ws, payload) {
    try {
      const connection = this.roomManager.getConnection(ws);
      if (!connection || !connection.gamemode) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Not in a game room'
        }));
        return;
      }

      if (connection.gamemode === 'crash') {
        await this.sendCurrentGameState(ws);
      }
    } catch (error) {
      this.logger.error('error handling game state request:', error);
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
          type: 'error',
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
          const result = await this.gameEngine.processGameAction(connection.gamemode, userId, action, targetMultiplier);
          
          if (result.success) {
            // Send success response
            ws.send(JSON.stringify({
              type: 'game_action_success',
              action,
              result,
              timestamp: new Date().toISOString()
            }));
            
            // Get updated game state for crash
            if (connection.gamemode === 'crash') {
              const userId = connection.userData?.id || 'anonymous';
              const crashState = await this.gameEngine.getCrashGameState(userId);
              
              // Broadcast updated game state
              this.broadcastToRoom(connection.gamemode, {
                type: 'game_state_update',
                gamemode: connection.gamemode,
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

  // Broadcast message to all users in a gamemode room
  broadcastToRoom(gamemode, message) {
    const room = this.roomManager.getRoomUsers(gamemode);
    if (room && room.size > 0) {
      const messageStr = JSON.stringify(message);
      room.forEach(connection => {
        if (connection.readyState === WebSocket.OPEN) {
          connection.send(messageStr);
        }
      });
    }
  }

  // Send message to specific user
  sendToUser(userId, message) {
    try {
      // Find all connections for this user
      const userConnections = this.roomManager.getUserConnections(userId);
      
      if (userConnections && userConnections.length > 0) {
        const messageStr = JSON.stringify(message);
        
        for (const connection of userConnections) {
          if (connection.ws && connection.ws.readyState === WebSocket.OPEN) {
            connection.ws.send(messageStr);
          }
        }
        
        this.logger.info(`sent message to user ${userId}:`, message);
      } else {
        this.logger.warn(`user ${userId} not found or not connected`);
      }
    } catch (error) {
      this.logger.error(`error sending message to user ${userId}:`, error);
    }
  }

  // Send current game state to specific user
  async sendCurrentGameState(ws) {
    if (!this.gameEngine) return;
    
    try {
      const connection = this.roomManager.getConnection(ws);
      if (connection && connection.userData) {
        const userId = connection.userData.id || 'anonymous';
        const crashState = await this.gameEngine.getCrashGameState(userId);
        const crashHistory = await this.gameEngine.getCrashHistory(20);
        
        const message = {
          type: 'crash_state_update',
          state: {
            ...crashState,
            last_rounds: crashHistory.map(round => ({
              multiplier: Number(round.crash_multiplier),
              roundNumber: round.round_number
            }))
          },
          history: crashHistory,
          timestamp: new Date().toISOString()
        };
        
        ws.send(JSON.stringify(message));
        // Removed excessive logging - only log errors
      }
    } catch (error) {
      this.logger.error('error sending current game state:', error);
    }
  }

  // Debug method: Get room statistics
  getRoomStats() {
    return this.roomManager.getAllRoomStats();
  }

  // Debug method: Log current room state
  logRoomState() {
    const stats = this.getRoomStats();
    this.logger.info('current room state:', JSON.stringify(stats, null, 2));
  }

  // Broadcast crash state to all users in crash room
  async broadcastCrashState() {
    if (!this.gameEngine) return;
    
    const crashHistory = await this.gameEngine.getCrashHistory(20);
    
    const crashRoom = this.roomManager.getRoomUsers('crash');
    if (crashRoom && crashRoom.size > 0) {
      for (const ws of crashRoom) {
        if (ws.readyState === WebSocket.OPEN) {
          const connection = this.roomManager.getConnection(ws);
          if (connection && connection.userData) {
            // Get state with user's specific bet information
            const userId = connection.userData.id || 'anonymous';
            const crashState = await this.gameEngine.getCrashGameState(userId);
            
            const message = {
              type: 'crash_state_update',
              state: {
                ...crashState,
                last_rounds: crashHistory.map(round => ({
                  multiplier: Number(round.crash_multiplier),
                  roundNumber: round.round_number
                }))
              },
              history: crashHistory,
              timestamp: new Date().toISOString()
            };
            
            ws.send(JSON.stringify(message));
          }
        }
      }
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