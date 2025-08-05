// Chat Manager - Handle live chat functionality
// Purpose: Manage gamemode-specific chat rooms with user prefixes

const LoggingService = require('../server/logging-service');
const GameConfig = require('../config/game-config');

class ChatManager {
  constructor(envManager, broadcastCallback) {
    this.chatRooms = new Map(); // gamemode -> chat room
    this.userTyping = new Map(); // userId -> typing status
    this.messageHistory = new Map(); // gamemode -> message history
    this.rateLimits = new Map(); // userId -> last message time
    this.envManager = envManager;
    this.broadcastToRoom = broadcastCallback; // Function to broadcast to a room
    this.logger = new LoggingService();
    this.gameConfig = new GameConfig();
  }

  // Get Supabase admin client with service role key (bypasses RLS)
  getSupabaseAdminClient() {
    const { createClient } = require('@supabase/supabase-js');
    const dbConfig = this.envManager.getDatabaseConfig();
    return createClient(dbConfig.url, dbConfig.serviceKey);
  }

  // Create chat room for gamemode
  createChatRoom(gamemode) {
    if (!this.chatRooms.has(gamemode)) {
      this.chatRooms.set(gamemode, {
        users: new Set(),
        messageHistory: [],
        created: Date.now()
      });
      this.logger.info(`chat room created for ${gamemode}`);
    }
  }

  // Handle chat message (extracted from websocket-server.js)
  async handleChatMessage(ws, payload, connection) {
    try {
      const { message, gamemode } = payload;
      
      if (!connection || !connection.gamemode || !connection.userData) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Not in a game room or not authenticated'
        }));
        return;
      }

      // Validate message length and content
      if (!message || message.trim().length === 0) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Message cannot be empty'
        }));
        return;
      }

      const chatSettings = this.gameConfig.getChatSettings();
      if (message.length > chatSettings.maxMessageLength) {
        ws.send(JSON.stringify({
          type: 'error',
          message: `Message too long. Maximum ${chatSettings.maxMessageLength} characters allowed.`
        }));
        return;
      }

      const userData = connection.userData;

      // Check rate limiting
      if (!this.checkRateLimit(userData.id)) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Message sent too quickly. Please wait a moment.'
        }));
        return;
      }

      // Moderate message content
      const moderation = this.moderateMessage(message);
      if (!moderation.allowed) {
        ws.send(JSON.stringify({
          type: 'error',
          message: moderation.reason
        }));
        return;
      }
      this.logger.info(`chat message from ${userData.username} in ${connection.gamemode}: ${message}`);
      
      // Create chat message object with full user data
      // Use high-resolution timestamp for better ordering
      const timestamp = Date.now();
      const microseconds = process.hrtime.bigint();
      const chatMessage = {
        type: 'chat_message',
        id: `${timestamp}-${microseconds.toString().slice(-6)}`, // More unique ID
        username: userData.username,
        avatar: userData.avatar,
        message: message.trim(),
        gamemode: connection.gamemode, // Include the gamemode where the message was sent from
        timestamp: timestamp,
        userId: userData.id
      };
      
      // Broadcast message to ALL casino game rooms (cross-gamemode chat) - IMMEDIATE
      const casinoGamemodes = ['blackjack', 'roulette', 'crash', 'slots', 'hi-lo'];
      casinoGamemodes.forEach(gamemode => {
        this.broadcastToRoom(gamemode, chatMessage);
      });
      
      // Save message to database for persistence - ASYNCHRONOUS (non-blocking)
      if (userData.id && !userData.id.toString().startsWith('temp-user-')) {
        // Fire and forget - don't wait for database save
        this.saveMessageToDatabase(userData, message.trim(), connection.gamemode).catch(dbError => {
          this.logger.warn('failed to save message to database:', dbError);
        });
      }
      
    } catch (error) {
      this.logger.error('error processing chat message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to send chat message'
      }));
    }
  }

  // Get chat history for a user joining
  async getChatHistory(gamemode, limit = null) {
    const chatSettings = this.gameConfig.getChatSettings();
    const defaultLimit = limit || chatSettings.maxHistoryLength;
    try {
      const adminSupabase = this.getSupabaseAdminClient();
      
      // Get messages from all casino gamemodes for cross-gamemode chat
      const casinoGamemodes = ['blackjack', 'roulette', 'crash', 'slots', 'hi-lo'];
      const { data: recentMessages, error } = await adminSupabase
        .from('chat_messages')
        .select('id, user_id, username, avatar_url, message, gamemode, created_at')
        .in('gamemode', casinoGamemodes)
        .order('created_at', { ascending: false })
        .limit(limit);
      
      if (!error && recentMessages) {
        // Convert database messages to the expected format and reverse order (oldest first)
        const formattedMessages = recentMessages.reverse().map(msg => ({
          type: 'chat_message',
          id: msg.id.toString(),
          username: msg.username,
          avatar: msg.avatar_url,
          message: msg.message,
          gamemode: msg.gamemode,
          timestamp: new Date(msg.created_at).getTime(),
          userId: msg.user_id
        }));
        
        return formattedMessages;
      }
    } catch (historyError) {
      this.logger.warn('failed to load chat history:', historyError);
    }
    
    return [];
  }

  // Send chat history to user joining
  async sendChatHistoryToUser(ws, gamemode) {
    try {
      const chatSettings = this.gameConfig.getChatSettings();
      const messages = await this.getChatHistory(gamemode, chatSettings.maxHistoryLength);
      
      // Send chat history from all casino gamemodes
      ws.send(JSON.stringify({
        type: 'chat_history',
        gamemode: 'casino', // Indicates cross-gamemode chat
        messages: messages
      }));
    } catch (error) {
      this.logger.warn('failed to send chat history:', error);
    }
  }

  // Handle user join chat
  handleUserJoin(userId, gamemode, userData) {
    this.createChatRoom(gamemode);
    const room = this.chatRooms.get(gamemode);
    room.users.add(userId);
    this.logger.info(`user ${userData.username} joined chat in ${gamemode}`);
  }

  // Handle user leave chat
  handleUserLeave(userId, gamemode) {
    if (this.chatRooms.has(gamemode)) {
      const room = this.chatRooms.get(gamemode);
      room.users.delete(userId);
      
      // Clean up typing status
      if (this.userTyping.has(userId)) {
        this.userTyping.delete(userId);
      }
    }
  }

  // Handle user typing indicator
  handleUserTyping(userId, gamemode, isTyping) {
    if (isTyping) {
      this.userTyping.set(userId, {
        gamemode: gamemode,
        timestamp: Date.now()
      });
      
      // Auto-clear after 3 seconds
      setTimeout(() => {
        if (this.userTyping.has(userId)) {
          const typingData = this.userTyping.get(userId);
          if (typingData.timestamp <= Date.now() - 3000) {
            this.userTyping.delete(userId);
          }
        }
      }, 3000);
    } else {
      this.userTyping.delete(userId);
    }
  }

  // Check rate limits
  checkRateLimit(userId) {
    const now = Date.now();
    const lastMessage = this.rateLimits.get(userId);
    
    const chatSettings = this.gameConfig.getChatSettings();
    // Allow configurable rate limit from GameConfig
    if (lastMessage && (now - lastMessage) < chatSettings.messageRateLimit) {
      return false;
    }
    
    this.rateLimits.set(userId, now);
    return true;
  }

  // Moderate message content
  moderateMessage(message) {
    // Basic moderation - can be extended
    const bannedWords = ['spam', 'hack', 'cheat']; // Add more as needed
    const lowerMessage = message.toLowerCase();
    
    for (const word of bannedWords) {
      if (lowerMessage.includes(word)) {
        return {
          allowed: false,
          reason: 'Message contains inappropriate content'
        };
      }
    }
    
    return {
      allowed: true,
      reason: null
    };
  }

  // Save message to database asynchronously
  async saveMessageToDatabase(userData, message, gamemode) {
    try {
      const adminSupabase = this.getSupabaseAdminClient();
      
      await adminSupabase.rpc('insert_chat_message', {
        p_user_id: userData.id,
        p_username: userData.username,
        p_avatar_url: userData.avatar,
        p_message: message,
        p_gamemode: gamemode
      });
    } catch (error) {
      this.logger.error('error saving message to database:', error);
      throw error;
    }
  }

  // Format message with user prefix
  formatMessage(userId, message, userData, gamemode) {
    return {
      type: 'chat_message',
      id: `${Date.now()}-${userId}`,
      username: userData.username,
      avatar: userData.avatar,
      message: message.trim(),
      gamemode: gamemode,
      timestamp: Date.now(),
      userId: userId
    };
  }

  // Cleanup method for graceful shutdown
  cleanup() {
    try {
      this.logger.info('cleaning up chat manager...');
      
      // Clear all chat rooms
      this.chatRooms.clear();
      
      // Clear user typing status
      this.userTyping.clear();
      
      // Clear message history
      this.messageHistory.clear();
      
      // Clear rate limits
      this.rateLimits.clear();
      
      this.logger.info('chat manager cleanup complete');
    } catch (error) {
      this.logger.error('error during chat manager cleanup:', error);
    }
  }
}

module.exports = ChatManager; 