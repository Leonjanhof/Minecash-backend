// Room Manager - Manage gamemode-specific rooms
// Purpose: Handle room creation, user management, and room-specific operations

const LoggingService = require('./logging-service');

class RoomManager {
  constructor(envManager, broadcastCallback, chatManager) {
    this.rooms = new Map(); // gamemode -> Set of connections
    this.connections = new Map(); // connection -> user data
    this.envManager = envManager;
    this.broadcastToRoom = broadcastCallback; // Function to broadcast to a room
    this.chatManager = chatManager; // Reference to chat manager
    this.logger = new LoggingService();
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

  // Create a new room for a gamemode
  createRoom(gamemode, config = {}) {
    if (!this.rooms.has(gamemode)) {
      this.rooms.set(gamemode, new Set());
      this.logger.info(`room created for gamemode: ${gamemode}`);
    }
  }

  // Handle join game event (extracted from websocket-server.js)
  async handleJoinGame(ws, gamemode, token) {
    try {
      // Check if user is already in the requested gamemode
      const connection = this.connections.get(ws);
      if (connection && connection.gamemode === gamemode) {
        return;
      }
      let userData = null;
      
      // Validate token with Supabase if provided
      if (token) {
        try {
          // Create Supabase client using environment variables
          const supabase = this.getSupabaseClient();
          
          // Get user from token
          const { data: { user }, error: authError } = await supabase.auth.getUser(token);
          
          if (!authError && user) {
            // Get user profile with Discord data using admin client (bypasses RLS)
            const adminSupabase = this.getSupabaseAdminClient();
            const { data: profiles, error: profileError } = await adminSupabase
              .from('users')
              .select('id, username, avatar_url, discord_id')
              .eq('auth_user_id', user.id);
            
            if (!profileError && profiles && profiles.length > 0) {
              // Use the first profile if multiple found
              const profile = profiles[0];
              
              const finalUsername = profile.username || user.user_metadata?.full_name || user.email || 'Anonymous';
              const finalAvatar = profile.avatar_url || user.user_metadata?.avatar_url || 'https://cdn.discordapp.com/embed/avatars/0.png';
              
              userData = {
                id: profile.id,
                authId: user.id,
                username: finalUsername,
                avatar: finalAvatar,
                discordId: profile.discord_id || user.user_metadata?.provider_id
              };
            }
          }
        } catch (tokenError) {
          this.logger.warn('token validation failed:', tokenError);
        }
      }
      
      // Fallback to temporary user if authentication failed
      if (!userData) {
        userData = {
          id: 'temp-user-' + Date.now(),
          authId: null,
          username: 'Anonymous',
          avatar: 'https://cdn.discordapp.com/embed/avatars/0.png',
          discordId: null
        };
      }
      
      // Reuse the connection variable declared earlier
      if (connection) {
        // Only remove from previous room if it's different from target room
        if (connection.gamemode && connection.gamemode !== gamemode && this.rooms.has(connection.gamemode)) {
          const previousRoom = connection.gamemode;
          this.rooms.get(connection.gamemode).delete(ws);
          this.logger.info(`user ${userData.username} left ${previousRoom} room (switching to ${gamemode})`);
          
          // Broadcast user left previous room
          if (connection.userData) {
            this.broadcastToRoom(previousRoom, {
              type: 'user_left',
              userData: connection.userData,
              gamemode: previousRoom,
              timestamp: new Date().toISOString()
            });
            
            // Handle chat leave for previous room
            this.chatManager.handleUserLeave(connection.userData.id, previousRoom);
          }
        }
        
        // Update connection data
        connection.gamemode = gamemode;
        connection.userData = userData;
        
        // Join new room (only if not already in it)
        if (!this.rooms.has(gamemode)) {
          this.rooms.set(gamemode, new Set());
        }
        
        // Check if user is already in the room to prevent duplicates
        const isNewJoin = !this.rooms.get(gamemode).has(ws);
        
        if (isNewJoin) {
          this.rooms.get(gamemode).add(ws);
          this.logger.info(`user ${userData.username} joined ${gamemode} room`);
          
          // Only broadcast user joined for new joins
          this.broadcastToRoom(gamemode, {
            type: 'user_joined',
            gamemode,
            userData: userData,
            timestamp: new Date().toISOString()
          });
          
          // Handle chat join and send chat history
          this.chatManager.handleUserJoin(userData.id, gamemode, userData);
          await this.chatManager.sendChatHistoryToUser(ws, gamemode);
          
          // Send confirmation
          ws.send(JSON.stringify({
            type: 'joined_game',
            gamemode: gamemode,
            userData: userData,
            timestamp: new Date().toISOString()
          }));
        }
      } else {
        // Create new connection
        const newConnection = {
          gamemode: gamemode,
          userData: userData,
          joinedAt: Date.now()
        };
        
        this.connections.set(ws, newConnection);
        
        // Create room if it doesn't exist
        if (!this.rooms.has(gamemode)) {
          this.rooms.set(gamemode, new Set());
        }
        
        this.rooms.get(gamemode).add(ws);
        this.logger.info(`user ${userData.username} joined ${gamemode} room`);
        
        // Broadcast user joined
        this.broadcastToRoom(gamemode, {
          type: 'user_joined',
          gamemode,
          userData: userData,
          timestamp: new Date().toISOString()
        });
        
        // Handle chat join and send chat history
        this.chatManager.handleUserJoin(userData.id, gamemode, userData);
        await this.chatManager.sendChatHistoryToUser(ws, gamemode);
        
        // Send confirmation
        ws.send(JSON.stringify({
          type: 'joined_game',
          gamemode: gamemode,
          userData: userData,
          timestamp: new Date().toISOString()
        }));
      }
      
    } catch (error) {
      this.logger.error('error joining game:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to join game room'
      }));
    }
  }

  // Handle leave game event (extracted from websocket-server.js)
  async handleLeaveGame(ws, gamemode) {
    try {
      const connection = this.connections.get(ws);
      if (!connection || !connection.gamemode) {
        return;
      }

      const userData = connection.userData;
      const currentGamemode = connection.gamemode;
      
      // Remove from current room
      if (this.rooms.has(currentGamemode)) {
        this.rooms.get(currentGamemode).delete(ws);
        this.logger.info(`user ${userData?.username || 'anonymous'} left ${currentGamemode} room (navigating away)`);
        
        // Broadcast user left room
        if (userData) {
          this.broadcastToRoom(currentGamemode, {
            type: 'user_left',
            userData: userData,
            gamemode: currentGamemode,
            timestamp: new Date().toISOString()
          });
          
          // Handle chat leave
          this.chatManager.handleUserLeave(userData.id, currentGamemode);
        }
      }
      
      // Clear gamemode from connection
      connection.gamemode = null;
      
    } catch (error) {
      this.logger.error('error leaving game:', error);
    }
  }

  // Handle disconnection (extracted from websocket-server.js)
  handleDisconnection(ws) {
    const connection = this.connections.get(ws);
    if (connection) {
      const { gamemode, userData } = connection;
      
      if (gamemode && this.rooms.has(gamemode)) {
        this.rooms.get(gamemode).delete(ws);
        this.logger.info(`user ${userData?.username || 'anonymous'} disconnected from ${gamemode}`);
        
        // Broadcast user left room
        if (userData) {
          this.broadcastToRoom(gamemode, {
            type: 'user_left',
            userData: userData,
            gamemode: gamemode,
            timestamp: new Date().toISOString()
          });
          
          // Handle chat leave
          this.chatManager.handleUserLeave(userData.id, gamemode);
        }
      }
      
      // Remove connection
      this.connections.delete(ws);
    }
  }

  // Add user to room
  addUserToRoom(ws, gamemode, userData) {
    if (!this.rooms.has(gamemode)) {
      this.createRoom(gamemode);
    }
    
    this.rooms.get(gamemode).add(ws);
    
    // Update connection
    this.connections.set(ws, {
      gamemode: gamemode,
      userData: userData,
      joinedAt: Date.now()
    });
  }

  // Remove user from room
  removeUserFromRoom(ws, gamemode) {
    if (this.rooms.has(gamemode)) {
      this.rooms.get(gamemode).delete(ws);
    }
    
    const connection = this.connections.get(ws);
    if (connection) {
      connection.gamemode = null;
    }
  }

  // Get all users in a room
  getRoomUsers(gamemode) {
    return this.rooms.get(gamemode) || new Set();
  }

  // Get user's current room
  getUserRoom(ws) {
    const connection = this.connections.get(ws);
    return connection ? connection.gamemode : null;
  }

  // Get connection data for a websocket
  getConnection(ws) {
    return this.connections.get(ws);
  }

  // Get room statistics
  getRoomStats(gamemode) {
    const room = this.rooms.get(gamemode);
    if (!room) {
      return {
        gamemode: gamemode,
        userCount: 0,
        exists: false
      };
    }
    
    return {
      gamemode: gamemode,
      userCount: room.size,
      exists: true,
      users: Array.from(room).map(ws => {
        const connection = this.connections.get(ws);
        return connection ? connection.userData : null;
      }).filter(Boolean)
    };
  }

  // Get all room statistics
  getAllRoomStats() {
    const stats = {};
    for (const [gamemode, room] of this.rooms) {
      stats[gamemode] = this.getRoomStats(gamemode);
    }
    return stats;
  }

  // Cleanup method for graceful shutdown
  cleanup() {
    try {
      this.logger.info('cleaning up room manager...');
      
      // Clear all rooms
      this.rooms.clear();
      
      // Clear all connections
      this.connections.clear();
      
      this.logger.info('room manager cleanup complete');
    } catch (error) {
      this.logger.error('error during room manager cleanup:', error);
    }
  }
}

module.exports = RoomManager; 